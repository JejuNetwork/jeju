// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TokenRegistry} from "./TokenRegistry.sol";
import {LiquidityPaymaster} from "./LiquidityPaymaster.sol";
import {LiquidityVault} from "../liquidity/LiquidityVault.sol";
import {FeeDistributorV2} from "../distributor/FeeDistributor.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * @title PaymasterFactory
 * @notice Factory for deploying token-specific paymasters with associated vaults and distributors
 */
contract PaymasterFactory is Ownable {
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

    /**
     * @notice Deploy a paymaster for a registered token
     * @param token The ERC20 token address
     * @param feeMargin Fee margin in basis points (100 = 1%)
     * @param operator Address that will own the deployed contracts
     * @return paymaster Address of deployed paymaster
     * @return vault Address of deployed vault
     * @return distributor Address of deployed fee distributor
     */
    function deployPaymaster(
        address token,
        uint256 feeMargin,
        address operator
    ) external returns (address paymaster, address vault, address distributor) {
        if (!registry.isSupported(token)) revert TokenNotRegistered(token);
        if (deployments[token].paymaster != address(0)) revert AlreadyDeployed(token);
        if (feeMargin > 1000) revert InvalidFeeMargin(feeMargin); // Max 10%
        if (operator == address(0)) revert InvalidOperator();

        // Deploy with factory as owner so we can configure
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

        // Configure contracts (as owner)
        LiquidityVault(payable(vault)).setPaymaster(paymaster);
        LiquidityVault(payable(vault)).setFeeDistributor(distributor);
        FeeDistributorV2(distributor).setPaymaster(paymaster);

        // Transfer ownership to operator
        LiquidityVault(payable(vault)).transferOwnership(operator);
        FeeDistributorV2(distributor).transferOwnership(operator);
        LiquidityPaymaster(payable(paymaster)).transferOwnership(operator);

        // Store deployment info
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

    function getAllDeployments() external view returns (address[] memory) {
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
}

