// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LiquidityPaymaster} from "./LiquidityPaymaster.sol";
import {LiquidityVault} from "../liquidity/LiquidityVault.sol";
import {FeeDistributor} from "../distributor/FeeDistributor.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {TokenRegistry} from "./TokenRegistry.sol";

interface IPriceOracle {
    function getElizaOSPerETH() external view returns (uint256);
    function isPriceFresh() external view returns (bool);
}

/**
 * @title PaymasterFactory
 * @author Jeju Network
 * @notice Factory for deploying token-specific paymaster instances
 * @dev Enables permissionless paymaster deployment for any registered token.
 *      Each deployment creates a complete paymaster system: vault, distributor, and paymaster.
 *
 * Architecture:
 * - Projects register token in TokenRegistry first
 * - Factory validates registration before deployment
 * - Deploys 3 contracts per token:
 *   1. LiquidityVault (ETH + token pools)
 *   2. FeeDistributor (fee splits)
 *   3. LiquidityPaymaster (ERC-4337 sponsorship)
 * - Wires all contracts together automatically
 * - Transfers ownership to operator
 *
 * Usage Flow:
 * 1. Register token: TokenRegistry.registerToken()
 * 2. Deploy paymaster: factory.deployPaymaster(token, feeMargin)
 * 3. Add liquidity: vault.addETHLiquidity()
 * 4. Users can pay gas with token!
 *
 * @custom:security-contact security@jeju.network
 */
contract PaymasterFactory is Ownable {
    // ============ State Variables ============

    /// @notice TokenRegistry for validation
    TokenRegistry public immutable registry;

    /// @notice ERC-4337 EntryPoint (shared by all paymasters)
    IEntryPoint public immutable entryPoint;

    /// @notice Price oracle (shared by all paymasters)
    IPriceOracle public immutable oracle;

    /// @notice Deployment information for each token
    struct Deployment {
        address paymaster;
        address vault;
        address distributor;
        address token;
        address operator;
        uint256 deployedAt;
        uint256 feeMargin;
    }

    /// @notice Mapping from token address to deployment info
    mapping(address => Deployment) public deployments;

    /// @notice Array of all deployed tokens
    address[] public deployedTokens;

    /// @notice Total number of deployments
    uint256 public totalDeployments;

    // ============ Events ============

    event PaymasterDeployed(
        address indexed token,
        address indexed operator,
        address paymaster,
        address vault,
        address distributor,
        uint256 feeMargin,
        uint256 timestamp
    );

    event OwnershipTransferred(address indexed token, address indexed paymaster, address indexed newOwner);

    // ============ Errors ============

    error TokenNotRegistered(address token);
    error AlreadyDeployed(address token);
    error InvalidFeeMargin(uint256 margin, uint256 min, uint256 max);
    error DeploymentFailed(string reason);
    error InvalidOperator(address operator);

    // ============ Constructor ============

    /**
     * @notice Constructs the PaymasterFactory
     * @param _registry TokenRegistry contract address
     * @param _entryPoint ERC-4337 EntryPoint address
     * @param _oracle Price oracle address
     * @param initialOwner Address that will own the factory
     */
    constructor(address _registry, address _entryPoint, address _oracle, address initialOwner) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry");
        require(_entryPoint != address(0), "Invalid entry point");
        require(_oracle != address(0), "Invalid oracle");

        registry = TokenRegistry(_registry);
        entryPoint = IEntryPoint(_entryPoint);
        oracle = IPriceOracle(_oracle);
    }

    // ============ Core Functions ============

    /**
     * @notice Deploy paymaster instance for a registered token
     * @param token ERC20 token address (must be registered)
     * @param feeMargin Fee margin in basis points (must be within token's range)
     * @param operator Address that will own and operate the paymaster
     * @return paymaster Address of deployed paymaster
     * @return vault Address of deployed vault
     * @return distributor Address of deployed fee distributor
     *
     * @dev This function:
     * 1. Validates token is registered and active
     * 2. Validates fee margin is within allowed range
     * 3. Deploys LiquidityVault, FeeDistributor, LiquidityPaymaster
     * 4. Wires all contracts together
     * 5. Transfers ownership to operator
     * 6. Records deployment
     *
     * Example:
     * ```
     * (address pm, address v, address d) = factory.deployPaymaster(
     *   tokenAddress,
     *   100,  // 1% fee
     *   msg.sender
     * );
     * ```
     */
    function deployPaymaster(address token, uint256 feeMargin, address operator)
        external
        returns (address payable paymaster, address payable vault, address distributor)
    {
        // Validate operator
        if (operator == address(0)) revert InvalidOperator(operator);

        // Validate token is registered
        if (!registry.isTokenSupported(token)) {
            revert TokenNotRegistered(token);
        }

        // Check not already deployed
        if (deployments[token].paymaster != address(0)) {
            revert AlreadyDeployed(token);
        }

        // Validate fee margin is within token's allowed range
        if (!registry.isValidFeeMargin(token, feeMargin)) {
            TokenRegistry.TokenConfig memory config = registry.getTokenConfig(token);
            revert InvalidFeeMargin(feeMargin, config.minFeeMargin, config.maxFeeMargin);
        }

        // Deploy all contracts with factory as owner, configure, then transfer to operator
        LiquidityVault _vault;
        FeeDistributor _distributor;
        LiquidityPaymaster _paymaster;

        // Deploy LiquidityVault with factory as initial owner
        try new LiquidityVault(token, address(this)) returns (LiquidityVault v) {
            _vault = v;
            vault = payable(address(v));
        } catch {
            revert DeploymentFailed("Vault deployment failed");
        }

        // Deploy FeeDistributor with factory as initial owner
        try new FeeDistributor(token, address(_vault), address(this)) returns (FeeDistributor d) {
            _distributor = d;
            distributor = address(d);
        } catch {
            revert DeploymentFailed("Distributor deployment failed");
        }

        // Deploy LiquidityPaymaster (factory will be initial owner)
        try new LiquidityPaymaster(entryPoint, token, address(_vault), address(_distributor), address(oracle)) returns (
            LiquidityPaymaster pm
        ) {
            _paymaster = pm;
            paymaster = payable(address(pm));
        } catch {
            revert DeploymentFailed("Paymaster deployment failed");
        }

        // EFFECTS: Record deployment state FIRST (CEI pattern)
        // We have the addresses now, store them before configuration calls
        deployments[token] = Deployment({
            paymaster: paymaster,
            vault: vault,
            distributor: distributor,
            token: token,
            operator: operator,
            deployedAt: block.timestamp,
            feeMargin: feeMargin
        });

        deployedTokens.push(token);
        totalDeployments++;

        // Emit event before additional external calls
        emit PaymasterDeployed(token, operator, paymaster, vault, distributor, feeMargin, block.timestamp);

        // INTERACTIONS: Wire up and configure contracts LAST
        _vault.setPaymaster(address(_paymaster));
        _vault.setFeeDistributor(address(_distributor));
        _distributor.setPaymaster(address(_paymaster));

        // Set fee margin (factory owns it now)
        _paymaster.emergencySetFeeMargin(feeMargin);

        // Transfer ownership (contracts are fully configured)
        _vault.transferOwnership(operator);
        _distributor.transferOwnership(operator);
        _paymaster.transferOwnership(operator);

        return (paymaster, vault, distributor);
    }

    // ============ View Functions ============

    /**
     * @notice Get deployment info for a token
     * @param token Token address
     * @return deployment Complete deployment information
     */
    function getDeployment(address token) external view returns (Deployment memory deployment) {
        deployment = deployments[token];
        require(deployment.paymaster != address(0), "Not deployed");
    }

    /**
     * @notice Get paymaster address for a token
     * @param token Token address
     * @return paymaster Paymaster address (address(0) if not deployed)
     */
    function getPaymaster(address token) external view returns (address paymaster) {
        return deployments[token].paymaster;
    }

    /**
     * @notice Get vault address for a token
     * @param token Token address
     * @return vault Vault address (address(0) if not deployed)
     */
    function getVault(address token) external view returns (address vault) {
        return deployments[token].vault;
    }

    /**
     * @notice Get all deployed paymasters
     * @return tokens Array of token addresses with deployed paymasters
     */
    function getAllDeployments() external view returns (address[] memory tokens) {
        return deployedTokens;
    }

    /**
     * @notice Get deployments by operator
     * @param operator Operator address
     * @return tokens Array of tokens operated by this address
     */
    function getDeploymentsByOperator(address operator) external view returns (address[] memory tokens) {
        uint256 count = 0;

        // Count deployments by operator
        for (uint256 i = 0; i < deployedTokens.length; i++) {
            if (deployments[deployedTokens[i]].operator == operator) {
                count++;
            }
        }

        // Build array
        tokens = new address[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < deployedTokens.length; i++) {
            if (deployments[deployedTokens[i]].operator == operator) {
                tokens[index] = deployedTokens[i];
                index++;
            }
        }
    }

    /**
     * @notice Check if paymaster is deployed for a token
     * @param token Token address
     * @return deployed Whether paymaster exists
     */
    function isDeployed(address token) external view returns (bool deployed) {
        return deployments[token].paymaster != address(0);
    }

    /**
     * @notice Get deployment statistics
     * @return total Total deployments
     * @return active Deployments with active tokens
     */
    function getStats() external view returns (uint256 total, uint256 active) {
        total = totalDeployments;

        for (uint256 i = 0; i < deployedTokens.length; i++) {
            if (registry.isTokenSupported(deployedTokens[i])) {
                active++;
            }
        }
    }

    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
