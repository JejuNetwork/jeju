// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IPriceFeedAggregator} from "../../src/perps/PerpetualMarket.sol";

/// @title MockERC20
/// @notice Standard mintable ERC20 for testing (18 decimals default)
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _decimals = 18;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}

/// @title MockERC20WithDecimals
/// @notice Mintable ERC20 with configurable decimals
contract MockERC20WithDecimals is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}

/// @title MockUSDC
/// @notice USDC-like token with 6 decimals
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/// @title MockTokenRegistry
/// @notice Simulates token registration for margin collateral
contract MockTokenRegistry {
    mapping(address => bool) public isRegistered;

    function setRegistered(address token, bool registered) external {
        isRegistered[token] = registered;
    }

    function isTokenRegistered(address token) external view returns (bool) {
        return isRegistered[token];
    }
}

/// @title MockPriceOracle
/// @notice Simple price oracle for collateral valuation
contract MockPriceOracle {
    mapping(address => uint256) public prices;

    function setPrice(address token, uint256 price) external {
        prices[token] = price;
    }

    function getPrice(address token) external view returns (uint256) {
        return prices[token];
    }

    function getTokenPriceUSD(address token) external view returns (uint256) {
        return prices[token];
    }
}

/// @title MockPriceFeed
/// @notice Price feed for perpetual markets (asset prices like BTC-USD)
contract MockPriceFeed is IPriceFeedAggregator {
    struct PriceData {
        uint256 price;
        uint256 timestamp;
        bool isValid;
    }

    mapping(string => PriceData) private priceData;

    function setPrice(string calldata asset, uint256 price, bool isValid) external {
        priceData[asset] = PriceData({price: price, timestamp: block.timestamp, isValid: isValid});
    }

    function setPriceWithTimestamp(string calldata asset, uint256 price, uint256 timestamp, bool isValid) external {
        priceData[asset] = PriceData({price: price, timestamp: timestamp, isValid: isValid});
    }

    function getPrice(string calldata asset) external view returns (uint256 price, uint256 timestamp, bool isValid) {
        PriceData memory data = priceData[asset];
        return (data.price, data.timestamp, data.isValid);
    }

    function batchSetPrices(string[] calldata assets, uint256[] calldata prices, bool[] calldata validFlags) external {
        for (uint256 i = 0; i < assets.length; i++) {
            priceData[assets[i]] = PriceData({price: prices[i], timestamp: block.timestamp, isValid: validFlags[i]});
        }
    }
}

/// @title MockCrossChainPaymaster
/// @notice Mock for cross-chain voucher validation in MarginManager
contract MockCrossChainPaymaster {
    struct Voucher {
        bytes32 requestId;
        address xlp;
        uint256 sourceChainId;
        uint256 destinationChainId;
        address sourceToken;
        address destinationToken;
        uint256 amount;
        uint256 fee;
        uint256 gasProvided;
        uint256 issuedBlock;
        uint256 expiresBlock;
        bool fulfilled;
        bool slashed;
        bool claimed;
    }

    struct VoucherRequest {
        address requester;
        address token;
        uint256 amount;
        address destinationToken;
        uint256 destinationChainId;
        address recipient;
    }

    mapping(bytes32 => Voucher) public vouchers;
    mapping(bytes32 => VoucherRequest) public requests;

    function setVoucher(
        bytes32 voucherId,
        bytes32 requestId,
        address destinationToken,
        uint256 amount,
        address recipient,
        address requester,
        bool fulfilled
    ) external {
        vouchers[voucherId] = Voucher({
            requestId: requestId,
            xlp: address(0),
            sourceChainId: 1,
            destinationChainId: 1,
            sourceToken: address(0),
            destinationToken: destinationToken,
            amount: amount,
            fee: 0,
            gasProvided: 0,
            issuedBlock: block.number,
            expiresBlock: block.number + 100,
            fulfilled: fulfilled,
            slashed: false,
            claimed: false
        });

        requests[requestId] = VoucherRequest({
            requester: requester,
            token: destinationToken,
            amount: amount,
            destinationToken: destinationToken,
            destinationChainId: 1,
            recipient: recipient
        });
    }

    function getVoucher(bytes32 voucherId) external view returns (Voucher memory) {
        return vouchers[voucherId];
    }

    function getRequest(bytes32 requestId) external view returns (VoucherRequest memory) {
        return requests[requestId];
    }
}

/// @title MockIdentityRegistry
/// @notice Mock for ERC-8004 identity registry
contract MockIdentityRegistry {
    mapping(uint256 => address) public owners;
    mapping(uint256 => bool) public exists;

    function setOwner(uint256 agentId, address owner) external {
        owners[agentId] = owner;
        exists[agentId] = true;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        return owners[agentId];
    }

    function agentExists(uint256 agentId) external view returns (bool) {
        return exists[agentId];
    }
}

/// @title MockReputationRegistry
/// @notice Mock for reputation scores
contract MockReputationRegistry {
    mapping(uint256 => uint256) public reputations;

    function setReputation(uint256 agentId, uint256 score) external {
        reputations[agentId] = score;
    }

    function getReputation(uint256 agentId) external view returns (uint256) {
        return reputations[agentId];
    }

    function getSummary(uint256 agentId, address[] calldata, bytes32, bytes32) external view returns (uint64, uint8) {
        uint256 rep = reputations[agentId];
        if (rep == 0) return (0, 50);
        return (1, uint8(rep));
    }
}

/// @title MockPerpMarket
/// @notice Mock perpetual market for liquidation engine tests
contract MockPerpMarket {
    mapping(bytes32 => bool) public liquidatable;
    mapping(bytes32 => uint256) public rewards;

    function setLiquidatable(bytes32 positionId, bool status, uint256 reward) external {
        liquidatable[positionId] = status;
        rewards[positionId] = reward;
    }

    function isLiquidatable(bytes32 positionId) external view returns (bool, uint256) {
        return (liquidatable[positionId], 0);
    }

    function liquidate(bytes32 positionId) external returns (uint256) {
        return rewards[positionId];
    }
}

/// @title MockMarginManager
/// @notice Mock margin manager for tests
contract MockMarginManager {
    function releaseCollateral(address, address, uint256) external pure returns (bool) {
        return true;
    }
}

/// @title MockInsuranceFund
/// @notice Mock insurance fund for tests
contract MockInsuranceFund {
    function coverBadDebt(address, uint256) external pure returns (bool) {
        return true;
    }
}
