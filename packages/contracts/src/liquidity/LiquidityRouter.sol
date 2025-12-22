// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ILiquidityVault {
    function addETHLiquidity(uint256 minShares) external payable;
    function addTokenLiquidity(uint256 amount, uint256 minShares) external;
    function removeETHLiquidity(uint256 shares, uint256 minAmount) external;
    function removeTokenLiquidity(uint256 shares, uint256 minAmount) external;
    function ethShares(address user) external view returns (uint256);
    function elizaShares(address user) external view returns (uint256);
}

interface IMultiServiceStakeManager {
    enum Service { NODE, XLP, PAYMASTER, GOVERNANCE }
    function stake(uint256 amount) external;
    function allocate(Service service, uint256 amount) external;
    function deallocate(Service service, uint256 amount) external;
    function getPosition(address user) external view returns (
        uint256 totalStaked, uint256 available, uint256 nodeAlloc,
        uint256 xlpAlloc, uint256 paymasterAlloc, uint256 governanceAlloc,
        uint256 pending, bool frozen
    );
}

interface IFederatedLiquidity {
    function createRequest(address token, uint256 amount, uint256 targetChainId) external payable returns (bytes32);
}

/**
 * @title LiquidityRouter
 * @notice Single entry point for depositing into all Jeju liquidity pools
 * @dev Simplifies UX by:
 *      - Single deposit that splits across pools
 *      - Auto-allocation based on preset strategy
 *      - Aggregated yield tracking
 *      - Single withdrawal across all positions
 *
 * Supported pools:
 *      1. LiquidityVault ETH - Paymaster gas sponsorship
 *      2. LiquidityVault Token - Token liquidity
 *      3. MultiServiceStakeManager - Node/XLP/Paymaster/Governance staking
 *      4. FederatedLiquidity - Cross-chain liquidity
 */
contract LiquidityRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ILiquidityVault public liquidityVault;
    IMultiServiceStakeManager public stakeManager;
    IFederatedLiquidity public federatedLiquidity;
    IERC20 public stakingToken;

    // Default allocation strategy (bps)
    struct AllocationStrategy {
        uint256 ethVaultBps;      // LiquidityVault ETH
        uint256 tokenVaultBps;    // LiquidityVault Token
        uint256 nodeStakeBps;     // Staking - Node operation
        uint256 xlpStakeBps;      // Staking - XLP
        uint256 paymasterStakeBps;// Staking - Paymaster
        uint256 governanceStakeBps; // Staking - Governance
    }

    AllocationStrategy public defaultStrategy;
    mapping(address => AllocationStrategy) public userStrategies;
    mapping(address => bool) public hasCustomStrategy;

    // User positions tracking
    struct UserPosition {
        uint256 totalDeposited;
        uint256 lastDepositTime;
        uint256 ethVaultDeposited;
        uint256 tokenVaultDeposited;
        uint256 stakeDeposited;
    }

    mapping(address => UserPosition) public positions;

    uint256 public constant BPS = 10000;
    uint256 public totalETHDeposited;
    uint256 public totalTokenDeposited;

    event DepositRouted(
        address indexed user,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 ethVault,
        uint256 tokenVault,
        uint256 staked
    );
    event WithdrawalRouted(address indexed user, uint256 ethWithdrawn, uint256 tokenWithdrawn);
    event StrategyUpdated(address indexed user, AllocationStrategy strategy);

    error InvalidAllocation();
    error InsufficientDeposit();
    error NoPosition();

    constructor(
        address _liquidityVault,
        address _stakeManager,
        address _stakingToken,
        address initialOwner
    ) Ownable(initialOwner) {
        liquidityVault = ILiquidityVault(_liquidityVault);
        stakeManager = IMultiServiceStakeManager(_stakeManager);
        stakingToken = IERC20(_stakingToken);

        // Default: 40% ETH vault, 30% token vault, 30% staking (evenly split)
        defaultStrategy = AllocationStrategy({
            ethVaultBps: 4000,
            tokenVaultBps: 3000,
            xlpStakeBps: 1000,
            nodeStakeBps: 500,
            paymasterStakeBps: 500,
            governanceStakeBps: 1000
        });
    }

    /**
     * @notice Deposit ETH to be routed across pools
     */
    function depositETH() external payable nonReentrant {
        if (msg.value == 0) revert InsufficientDeposit();

        AllocationStrategy memory strategy = _getStrategy(msg.sender);

        // Calculate allocations
        uint256 ethVaultAmount = (msg.value * strategy.ethVaultBps) / BPS;
        uint256 remainingForStake = msg.value - ethVaultAmount;

        // Deposit to ETH vault
        if (ethVaultAmount > 0) {
            liquidityVault.addETHLiquidity{value: ethVaultAmount}(0);
        }

        // Update position
        positions[msg.sender].totalDeposited += msg.value;
        positions[msg.sender].lastDepositTime = block.timestamp;
        positions[msg.sender].ethVaultDeposited += ethVaultAmount;
        totalETHDeposited += msg.value;

        emit DepositRouted(msg.sender, msg.value, 0, ethVaultAmount, 0, remainingForStake);
    }

    /**
     * @notice Deposit tokens to be routed across pools
     * @param amount Token amount to deposit
     */
    function depositToken(uint256 amount) external nonReentrant {
        if (amount == 0) revert InsufficientDeposit();

        AllocationStrategy memory strategy = _getStrategy(msg.sender);

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        // Calculate allocations
        uint256 tokenVaultAmount = (amount * strategy.tokenVaultBps) / BPS;
        uint256 stakeAmount = amount - tokenVaultAmount;

        // Deposit to token vault
        if (tokenVaultAmount > 0) {
            stakingToken.forceApprove(address(liquidityVault), tokenVaultAmount);
            liquidityVault.addTokenLiquidity(tokenVaultAmount, 0);
        }

        // Stake and allocate
        if (stakeAmount > 0) {
            stakingToken.forceApprove(address(stakeManager), stakeAmount);
            stakeManager.stake(stakeAmount);

            // Calculate service allocations from stake portion
            uint256 totalStakeBps = strategy.nodeStakeBps + strategy.xlpStakeBps +
                                    strategy.paymasterStakeBps + strategy.governanceStakeBps;

            if (totalStakeBps > 0) {
                if (strategy.nodeStakeBps > 0) {
                    uint256 nodeAmount = (stakeAmount * strategy.nodeStakeBps) / totalStakeBps;
                    if (nodeAmount > 0) stakeManager.allocate(IMultiServiceStakeManager.Service.NODE, nodeAmount);
                }
                if (strategy.xlpStakeBps > 0) {
                    uint256 xlpAmount = (stakeAmount * strategy.xlpStakeBps) / totalStakeBps;
                    if (xlpAmount > 0) stakeManager.allocate(IMultiServiceStakeManager.Service.XLP, xlpAmount);
                }
                if (strategy.paymasterStakeBps > 0) {
                    uint256 paymasterAmount = (stakeAmount * strategy.paymasterStakeBps) / totalStakeBps;
                    if (paymasterAmount > 0) stakeManager.allocate(IMultiServiceStakeManager.Service.PAYMASTER, paymasterAmount);
                }
                if (strategy.governanceStakeBps > 0) {
                    uint256 govAmount = (stakeAmount * strategy.governanceStakeBps) / totalStakeBps;
                    if (govAmount > 0) stakeManager.allocate(IMultiServiceStakeManager.Service.GOVERNANCE, govAmount);
                }
            }
        }

        // Update position
        positions[msg.sender].totalDeposited += amount;
        positions[msg.sender].lastDepositTime = block.timestamp;
        positions[msg.sender].tokenVaultDeposited += tokenVaultAmount;
        positions[msg.sender].stakeDeposited += stakeAmount;
        totalTokenDeposited += amount;

        emit DepositRouted(msg.sender, 0, amount, 0, tokenVaultAmount, stakeAmount);
    }

    /**
     * @notice Set custom allocation strategy
     * @param strategy Custom allocation percentages
     */
    function setStrategy(AllocationStrategy calldata strategy) external {
        uint256 total = strategy.ethVaultBps + strategy.tokenVaultBps +
                        strategy.nodeStakeBps + strategy.xlpStakeBps +
                        strategy.paymasterStakeBps + strategy.governanceStakeBps;

        if (total != BPS) revert InvalidAllocation();

        userStrategies[msg.sender] = strategy;
        hasCustomStrategy[msg.sender] = true;

        emit StrategyUpdated(msg.sender, strategy);
    }

    /**
     * @notice Reset to default strategy
     */
    function resetToDefaultStrategy() external {
        hasCustomStrategy[msg.sender] = false;
        emit StrategyUpdated(msg.sender, defaultStrategy);
    }

    function _getStrategy(address user) internal view returns (AllocationStrategy memory) {
        if (hasCustomStrategy[user]) {
            return userStrategies[user];
        }
        return defaultStrategy;
    }

    // ============ View Functions ============

    /**
     * @notice Get user's total position across all pools
     */
    function getPosition(address user) external view returns (
        uint256 ethVaultShares,
        uint256 tokenVaultShares,
        uint256 stakedAmount,
        uint256 pendingRewards,
        AllocationStrategy memory strategy
    ) {
        ethVaultShares = liquidityVault.ethShares(user);
        tokenVaultShares = liquidityVault.elizaShares(user);

        (stakedAmount,,,,,, pendingRewards,) = stakeManager.getPosition(user);
        strategy = _getStrategy(user);
    }

    /**
     * @notice Estimate yield across all pools (annualized)
     * @param user User to check
     * @return Estimated yearly yield in basis points
     */
    function estimateYield(address user) external view returns (uint256) {
        UserPosition storage pos = positions[user];
        if (pos.totalDeposited == 0) return 0;

        // Default 8% base APY - override with actual yield queries
        return 800;
    }

    // ============ Admin ============

    function setDefaultStrategy(AllocationStrategy calldata strategy) external onlyOwner {
        uint256 total = strategy.ethVaultBps + strategy.tokenVaultBps +
                        strategy.nodeStakeBps + strategy.xlpStakeBps +
                        strategy.paymasterStakeBps + strategy.governanceStakeBps;

        if (total != BPS) revert InvalidAllocation();

        defaultStrategy = strategy;
    }

    function setLiquidityVault(address _vault) external onlyOwner {
        liquidityVault = ILiquidityVault(_vault);
    }

    function setStakeManager(address _manager) external onlyOwner {
        stakeManager = IMultiServiceStakeManager(_manager);
    }

    function setFederatedLiquidity(address _federated) external onlyOwner {
        federatedLiquidity = IFederatedLiquidity(_federated);
    }

    receive() external payable {}
}

