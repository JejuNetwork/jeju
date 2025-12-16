// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FederatedLiquidity
 * @author Jeju Network
 * @notice Cross-network liquidity aggregation and routing
 * @dev Coordinates liquidity requests across multiple Jeju networks
 *
 * Architecture:
 * - Each network has its local LiquidityVault
 * - FederatedLiquidity aggregates liquidity views
 * - Routes requests to networks with best liquidity
 * - XLPs (Cross-chain Liquidity Providers) earn fees
 *
 * Integration:
 * - Works with NetworkRegistry for network discovery
 * - Works with local LiquidityVault for actual liquidity
 * - Works with CrossChainPaymaster for gas sponsorship
 */
contract FederatedLiquidity is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    struct NetworkLiquidity {
        uint256 chainId;
        address vault;
        uint256 ethLiquidity;
        uint256 tokenLiquidity;
        uint256 utilizationBps;
        uint256 lastUpdated;
    }

    struct LiquidityRequest {
        bytes32 requestId;
        address requester;
        address token;
        uint256 amount;
        uint256 sourceChainId;
        uint256 targetChainId;
        uint256 createdAt;
        uint256 deadline;
        bool fulfilled;
        address fulfiller;
    }

    struct XLP {
        address provider;
        uint256[] supportedChains;
        uint256 totalProvided;
        uint256 totalEarned;
        uint256 registeredAt;
        bool isActive;
    }

    uint256 public immutable localChainId;
    address public oracle;
    address public governance;
    address public networkRegistry;
    address public localVault;

    mapping(uint256 => NetworkLiquidity) public networkLiquidity;
    uint256[] public trackedNetworks;

    mapping(bytes32 => LiquidityRequest) public requests;
    bytes32[] public pendingRequests;

    mapping(address => XLP) public xlps;
    address[] public xlpList;
    uint256 public totalXLPs;

    uint256 public minRequestAmount = 0.001 ether;
    uint256 public requestDeadlineBlocks = 100;
    uint256 public fulfillmentFeeBps = 50;

    event LiquidityUpdated(uint256 indexed chainId, uint256 ethLiquidity, uint256 tokenLiquidity);
    event RequestCreated(bytes32 indexed requestId, address indexed requester, uint256 amount, uint256 targetChainId);
    event RequestFulfilled(bytes32 indexed requestId, address indexed fulfiller, uint256 amount);
    event RequestExpired(bytes32 indexed requestId);
    event XLPRegistered(address indexed provider, uint256[] supportedChains);
    event XLPDeactivated(address indexed provider);

    error RequestNotFound();
    error RequestExpiredError();
    error RequestAlreadyFulfilled();
    error InsufficientAmount();
    error NotAuthorized();
    error XLPExists();
    error XLPNotFound();
    error InvalidChain();
    error NoLiquidity();

    constructor(
        uint256 _localChainId,
        address _oracle,
        address _governance,
        address _networkRegistry,
        address _localVault
    ) Ownable(msg.sender) {
        localChainId = _localChainId;
        oracle = _oracle;
        governance = _governance;
        networkRegistry = _networkRegistry;
        localVault = _localVault;
    }

    function registerXLP(uint256[] calldata supportedChains) external nonReentrant {
        if (xlps[msg.sender].registeredAt != 0) revert XLPExists();

        xlps[msg.sender] = XLP({
            provider: msg.sender,
            supportedChains: supportedChains,
            totalProvided: 0,
            totalEarned: 0,
            registeredAt: block.timestamp,
            isActive: true
        });

        xlpList.push(msg.sender);
        totalXLPs++;

        emit XLPRegistered(msg.sender, supportedChains);
    }

    function deactivateXLP() external {
        XLP storage xlp = xlps[msg.sender];
        if (xlp.registeredAt == 0) revert XLPNotFound();

        xlp.isActive = false;

        emit XLPDeactivated(msg.sender);
    }

    function updateNetworkLiquidity(
        uint256 chainId,
        address vault,
        uint256 ethLiquidity,
        uint256 tokenLiquidity,
        uint256 utilizationBps
    ) external {
        if (msg.sender != oracle && msg.sender != owner()) revert NotAuthorized();

        NetworkLiquidity storage nl = networkLiquidity[chainId];
        if (nl.lastUpdated == 0) {
            trackedNetworks.push(chainId);
        }

        nl.chainId = chainId;
        nl.vault = vault;
        nl.ethLiquidity = ethLiquidity;
        nl.tokenLiquidity = tokenLiquidity;
        nl.utilizationBps = utilizationBps;
        nl.lastUpdated = block.timestamp;

        emit LiquidityUpdated(chainId, ethLiquidity, tokenLiquidity);
    }

    function createRequest(
        address token,
        uint256 amount,
        uint256 targetChainId
    ) external payable nonReentrant returns (bytes32 requestId) {
        if (amount < minRequestAmount) revert InsufficientAmount();

        requestId = keccak256(
            abi.encodePacked(msg.sender, token, amount, targetChainId, block.number, block.timestamp)
        );

        if (token == address(0)) {
            require(msg.value >= amount, "Insufficient ETH");
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        requests[requestId] = LiquidityRequest({
            requestId: requestId,
            requester: msg.sender,
            token: token,
            amount: amount,
            sourceChainId: localChainId,
            targetChainId: targetChainId,
            createdAt: block.timestamp,
            deadline: block.number + requestDeadlineBlocks,
            fulfilled: false,
            fulfiller: address(0)
        });

        pendingRequests.push(requestId);

        emit RequestCreated(requestId, msg.sender, amount, targetChainId);
    }

    function fulfillRequest(bytes32 requestId, bytes calldata /* proof */) external nonReentrant {
        LiquidityRequest storage request = requests[requestId];
        if (request.createdAt == 0) revert RequestNotFound();
        if (request.fulfilled) revert RequestAlreadyFulfilled();
        if (block.number > request.deadline) revert RequestExpiredError();

        XLP storage xlp = xlps[msg.sender];
        if (xlp.registeredAt == 0 || !xlp.isActive) revert XLPNotFound();

        request.fulfilled = true;
        request.fulfiller = msg.sender;

        uint256 fee = (request.amount * fulfillmentFeeBps) / 10000;
        uint256 payout = request.amount - fee;

        xlp.totalProvided += request.amount;
        xlp.totalEarned += fee;

        if (request.token == address(0)) {
            (bool success,) = msg.sender.call{value: payout}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(request.token).safeTransfer(msg.sender, payout);
        }

        _removePendingRequest(requestId);

        emit RequestFulfilled(requestId, msg.sender, request.amount);
    }

    function refundExpiredRequest(bytes32 requestId) external nonReentrant {
        LiquidityRequest storage request = requests[requestId];
        if (request.createdAt == 0) revert RequestNotFound();
        if (request.fulfilled) revert RequestAlreadyFulfilled();
        if (block.number <= request.deadline) revert NotAuthorized();

        request.fulfilled = true;

        if (request.token == address(0)) {
            (bool success,) = request.requester.call{value: request.amount}("");
            require(success, "ETH refund failed");
        } else {
            IERC20(request.token).safeTransfer(request.requester, request.amount);
        }

        _removePendingRequest(requestId);

        emit RequestExpired(requestId);
    }

    function _removePendingRequest(bytes32 requestId) internal {
        for (uint256 i = 0; i < pendingRequests.length; i++) {
            if (pendingRequests[i] == requestId) {
                pendingRequests[i] = pendingRequests[pendingRequests.length - 1];
                pendingRequests.pop();
                break;
            }
        }
    }

    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
    }

    function setGovernance(address _governance) external onlyOwner {
        governance = _governance;
    }

    function setFulfillmentFeeBps(uint256 feeBps) external onlyOwner {
        require(feeBps <= 1000, "Fee too high");
        fulfillmentFeeBps = feeBps;
    }

    function setMinRequestAmount(uint256 amount) external onlyOwner {
        minRequestAmount = amount;
    }

    function getRequest(bytes32 requestId) external view returns (LiquidityRequest memory) {
        return requests[requestId];
    }

    function getPendingRequests() external view returns (bytes32[] memory) {
        return pendingRequests;
    }

    function getNetworkLiquidity(uint256 chainId) external view returns (NetworkLiquidity memory) {
        return networkLiquidity[chainId];
    }

    function getTotalFederatedLiquidity() external view returns (uint256 totalEth, uint256 totalToken) {
        for (uint256 i = 0; i < trackedNetworks.length; i++) {
            NetworkLiquidity storage nl = networkLiquidity[trackedNetworks[i]];
            totalEth += nl.ethLiquidity;
            totalToken += nl.tokenLiquidity;
        }
    }

    function getBestNetworkForLiquidity(uint256 amount) external view returns (uint256 bestChainId, uint256 available) {
        uint256 bestUtilization = type(uint256).max;

        for (uint256 i = 0; i < trackedNetworks.length; i++) {
            NetworkLiquidity storage nl = networkLiquidity[trackedNetworks[i]];
            if (nl.ethLiquidity >= amount && nl.utilizationBps < bestUtilization) {
                bestChainId = nl.chainId;
                available = nl.ethLiquidity;
                bestUtilization = nl.utilizationBps;
            }
        }
    }

    function getXLP(address provider) external view returns (XLP memory) {
        return xlps[provider];
    }

    function getActiveXLPs() external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < xlpList.length; i++) {
            if (xlps[xlpList[i]].isActive) count++;
        }

        address[] memory active = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < xlpList.length; i++) {
            if (xlps[xlpList[i]].isActive) {
                active[idx++] = xlpList[i];
            }
        }
        return active;
    }

    function getXLPsForRoute(uint256 sourceChain, uint256 destChain) external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < xlpList.length; i++) {
            XLP storage xlp = xlps[xlpList[i]];
            if (!xlp.isActive) continue;

            bool supportsSource = false;
            bool supportsDest = false;
            for (uint256 j = 0; j < xlp.supportedChains.length; j++) {
                if (xlp.supportedChains[j] == sourceChain) supportsSource = true;
                if (xlp.supportedChains[j] == destChain) supportsDest = true;
            }
            if (supportsSource && supportsDest) count++;
        }

        address[] memory result = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < xlpList.length; i++) {
            XLP storage xlp = xlps[xlpList[i]];
            if (!xlp.isActive) continue;

            bool supportsSource = false;
            bool supportsDest = false;
            for (uint256 j = 0; j < xlp.supportedChains.length; j++) {
                if (xlp.supportedChains[j] == sourceChain) supportsSource = true;
                if (xlp.supportedChains[j] == destChain) supportsDest = true;
            }
            if (supportsSource && supportsDest) {
                result[idx++] = xlpList[i];
            }
        }
        return result;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}

