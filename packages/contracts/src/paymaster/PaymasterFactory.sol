// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TokenRegistry} from "./TokenRegistry.sol";
import {LiquidityPaymaster} from "./LiquidityPaymaster.sol";
import {LiquidityVault} from "../liquidity/LiquidityVault.sol";
import {FeeDistributorV2} from "../distributor/FeeDistributor.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ModerationMixin} from "../moderation/ModerationMixin.sol";

/**
 * @title PaymasterFactory
 * @notice Factory for deploying token-specific paymasters
 */
contract PaymasterFactory is Ownable {
    using ModerationMixin for ModerationMixin.Data;

    /// @notice Moderation integration for ban enforcement
    ModerationMixin.Data public moderation;

    struct Deployment {
        address paymaster;
        address vault;
        address distributor;
        address token;
        address operator;
        uint256 feeMargin;
        uint256 deployedAt;
    }

    TokenRegistry public immutable registry;
    IEntryPoint public immutable entryPoint;
    address public immutable oracle;
    
    mapping(address => Deployment) public deployments;
    mapping(address => address[]) public operatorDeployments;
    address[] public deployedTokens;
    uint256 public totalDeployments;

    error TokenNotRegistered(address token);
    error AlreadyDeployed(address token);
    error InvalidFeeMargin(uint256 margin);
    error InvalidOperator();
    error UserIsBanned();

    modifier notBanned() {
        if (moderation.isAddressBanned(msg.sender)) revert UserIsBanned();
        _;
    }

    event PaymasterDeployed(
        address indexed token,
        address indexed operator,
        address paymaster,
        address vault,
        address distributor,
        uint256 feeMargin,
        uint256 timestamp
    );

    constructor(
        address _registry,
        address _entryPoint,
        address _oracle,
        address _owner
    ) Ownable(_owner) {
        require(_registry != address(0), "Invalid registry");
        require(_entryPoint != address(0), "Invalid entry point");
        require(_oracle != address(0), "Invalid oracle");
        
        registry = TokenRegistry(_registry);
        entryPoint = IEntryPoint(_entryPoint);
        oracle = _oracle;
    }

    function deployPaymaster(
        address token,
        uint256 feeMargin,
        address operator
    ) external notBanned returns (address paymaster, address vault, address distributor) {
        if (!registry.isSupported(token)) revert TokenNotRegistered(token);
        if (deployments[token].paymaster != address(0)) revert AlreadyDeployed(token);
        if (feeMargin > 1000) revert InvalidFeeMargin(feeMargin);
        if (operator == address(0)) revert InvalidOperator();

        vault = address(new LiquidityVault(token, address(this)));
        distributor = address(new FeeDistributorV2(token, vault, address(this)));
        paymaster = address(new LiquidityPaymaster(
            entryPoint,
            token,
            vault,
            oracle,
            feeMargin,
            address(this)
        ));

        LiquidityVault(payable(vault)).setPaymaster(paymaster);
        LiquidityVault(payable(vault)).setFeeDistributor(distributor);
        FeeDistributorV2(distributor).setPaymaster(paymaster);

        LiquidityVault(payable(vault)).transferOwnership(operator);
        FeeDistributorV2(distributor).transferOwnership(operator);
        LiquidityPaymaster(payable(paymaster)).transferOwnership(operator);
        deployments[token] = Deployment({
            paymaster: paymaster,
            vault: vault,
            distributor: distributor,
            token: token,
            operator: operator,
            feeMargin: feeMargin,
            deployedAt: block.timestamp
        });
        deployedTokens.push(token);
        operatorDeployments[operator].push(token);
        totalDeployments++;

        emit PaymasterDeployed(
            token,
            operator,
            paymaster,
            vault,
            distributor,
            feeMargin,
            block.timestamp
        );
    }

    function getDeployment(address token) external view returns (Deployment memory) {
        return deployments[token];
    }

    function getDeployedTokens() external view returns (address[] memory) {
        return deployedTokens;
    }

    function getDeploymentsByOperator(address operator) external view returns (address[] memory) {
        return operatorDeployments[operator];
    }

    function getPaymaster(address token) external view returns (address) {
        return deployments[token].paymaster;
    }

    function getVault(address token) external view returns (address) {
        return deployments[token].vault;
    }

    function getStats() external view returns (uint256 total, uint256 active) {
        total = totalDeployments;
        for (uint256 i = 0; i < deployedTokens.length; i++) {
            if (registry.isSupported(deployedTokens[i])) {
                active++;
            }
        }
    }

    function isDeployed(address token) external view returns (bool) {
        return deployments[token].paymaster != address(0);
    }

    function setBanManager(address _banManager) external onlyOwner {
        moderation.setBanManager(_banManager);
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        moderation.setIdentityRegistry(_identityRegistry);
    }

    function isUserBanned(address user) external view returns (bool) {
        return moderation.isAddressBanned(user);
    }
}

