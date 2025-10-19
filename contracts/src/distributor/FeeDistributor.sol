// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface ILiquidityVault {
    function distributeFees(uint256 ethPoolFees, uint256 elizaPoolFees) external;
}

/**
 * @title FeeDistributor
 * @author Jeju Network
 * @notice Distributes transaction fees between application developers and liquidity providers
 * @dev Central fee distribution hub called by paymaster after each sponsored transaction.
 *      Implements a 50/50 split: half to app developers, half to LPs (further split 70/30).
 * 
 * Architecture:
 * - Receives elizaOS tokens from paymaster after each transaction
 * - Splits fees: 50% to app wallet, 50% to liquidity providers
 * - LP portion is further split: 70% to ETH LPs, 30% to elizaOS LPs
 * - Apps can claim earnings anytime
 * - LP earnings go to vault for per-share distribution
 * 
 * Fee Flow:
 * 1. User pays 100 elizaOS for gas
 * 2. Distributor splits: 50 to app, 50 to LPs
 * 3. LP portion splits: 35 to ETH LPs (70%), 15 to elizaOS LPs (30%)
 * 4. App can claim 50 immediately
 * 5. LPs earn proportionally based on their share ownership
 * 
 * Security Features:
 * - Only paymaster can trigger distributions
 * - Reentrancy protection on all state-changing functions
 * - Apps must claim earnings (not push payments)
 * - Proper approval handling for token transfers
 * 
 * @custom:security-contact security@jeju.network
 */
contract FeeDistributor is ReentrancyGuard, Ownable {
    // ============ State Variables ============
    
    /// @notice Reward token contract (used for fee payments)
    IERC20 public immutable rewardToken;
    
    /// @notice Liquidity vault that receives LP portion of fees
    ILiquidityVault public immutable liquidityVault;
    
    /// @notice Authorized paymaster contract that triggers distributions
    address public paymaster;
    
    // ============ Fee Split Ratios (Basis Points) ============
    
    /// @notice App developer share of total fees (50% = 5000 basis points)
    uint256 public constant APP_SHARE = 5000;
    
    /// @notice Liquidity provider share of total fees (50% = 5000 basis points)
    uint256 public constant LP_SHARE = 5000;
    
    /// @notice ETH LP share of LP portion (70% = 7000 basis points)
    /// @dev Higher than token LPs because they provide riskier asset (ETH)
    uint256 public constant ETH_LP_SHARE = 7000;
    
    /// @notice Token LP share of LP portion (30% = 3000 basis points)
    uint256 public constant TOKEN_LP_SHARE = 3000;
    
    // ============ Accounting ============
    
    /// @notice Claimable earnings for each app address
    mapping(address => uint256) public appEarnings;
    
    /// @notice Total fees distributed through the system
    uint256 public totalDistributed;
    
    /// @notice Cumulative earnings allocated to apps
    uint256 public totalAppEarnings;
    
    /// @notice Cumulative earnings allocated to LPs
    uint256 public totalLPEarnings;
    
    // ============ Events ============
    
    event FeesDistributed(
        address indexed app,
        uint256 appAmount,
        uint256 lpAmount,
        uint256 ethLPAmount,
        uint256 elizaLPAmount,
        uint256 timestamp
    );
    event AppClaimed(address indexed app, uint256 amount);
    event PaymasterSet(address indexed paymaster);
    
    // ============ Errors ============
    
    error OnlyPaymaster();
    error InvalidAddress();
    error InvalidAmount();
    error NoEarningsToClaim();
    error TransferFailed();
    
    // ============ Constructor ============
    
    /**
     * @notice Constructs the FeeDistributor with required dependencies
     * @param _rewardToken Address of the reward token contract
     * @param _liquidityVault Address of the liquidity vault contract
     * @param initialOwner Address that will own the contract
     * @dev Validates addresses are non-zero before setting immutable variables
     */
    constructor(
        address _rewardToken,
        address _liquidityVault,
        address initialOwner
    ) Ownable(initialOwner) {
        if (_rewardToken == address(0)) revert InvalidAddress();
        if (_liquidityVault == address(0)) revert InvalidAddress();
        
        rewardToken = IERC20(_rewardToken);
        liquidityVault = ILiquidityVault(_liquidityVault);
    }
    
    // ============ Core Functions ============
    
    /**
     * @notice Distribute transaction fees between app and liquidity providers
     * @param amount Total reward tokens collected from user as fees
     * @param appAddress Wallet address that will receive the app's share
     * @dev Only callable by authorized paymaster contract after a transaction.
     * 
     * Distribution Flow:
     * 1. Transfer tokens from paymaster to this contract
     * 2. Calculate 50/50 split: appAmount and lpAmount
     * 3. Credit app's share to their claimable earnings
     * 4. Split LP portion: 70% ETH LPs, 30% token LPs
     * 5. Transfer LP portion to vault for per-share distribution
     * 
     * Example: 100 tokens total fees:
     * - App gets: 50 tokens (claimable)
     * - ETH LPs get: 35 tokens (70% of 50)
     * - Token LPs get: 15 tokens (30% of 50)
     * 
     * @custom:security Only paymaster can call to prevent unauthorized distributions
     * @custom:security Requires paymaster to approve this contract first
     */
    function distributeFees(
        uint256 amount,
        address appAddress
    ) external nonReentrant {
        if (msg.sender != paymaster) revert OnlyPaymaster();
        if (amount == 0) revert InvalidAmount();
        if (appAddress == address(0)) revert InvalidAddress();
        
        // Transfer tokens from paymaster to this contract
        bool received = rewardToken.transferFrom(msg.sender, address(this), amount);
        if (!received) revert TransferFailed();
        
        // Calculate splits
        uint256 appAmount = (amount * APP_SHARE) / 10000;
        uint256 lpAmount = amount - appAmount;
        
        // App's share goes to their earnings (claimable)
        appEarnings[appAddress] += appAmount;
        totalAppEarnings += appAmount;
        
        // Split LP portion between ETH and token LPs
        uint256 ethLPAmount = (lpAmount * ETH_LP_SHARE) / 10000;
        uint256 tokenLPAmount = lpAmount - ethLPAmount;
        totalLPEarnings += lpAmount;
        
        // Approve liquidity vault to pull LP rewards
        require(rewardToken.approve(address(liquidityVault), lpAmount), "Approval failed");
        
        // Send to liquidity vault for distribution to LPs
        liquidityVault.distributeFees(ethLPAmount, tokenLPAmount);
        
        totalDistributed += amount;
        
        emit FeesDistributed(
            appAddress, 
            appAmount, 
            lpAmount, 
            ethLPAmount, 
            tokenLPAmount, 
            block.timestamp
        );
    }
    
    /**
     * @notice Claim accumulated earnings to caller's address
     * @dev Transfers all claimable reward tokens to msg.sender.
     *      Reverts if no earnings available. Protected against reentrancy.
     * 
     * @custom:security Pull pattern (not push) prevents griefing attacks
     */
    function claimEarnings() external nonReentrant {
        uint256 amount = appEarnings[msg.sender];
        if (amount == 0) revert NoEarningsToClaim();
        
        appEarnings[msg.sender] = 0;
        
        bool sent = rewardToken.transfer(msg.sender, amount);
        if (!sent) revert TransferFailed();
        
        emit AppClaimed(msg.sender, amount);
    }
    
    /**
     * @notice Claim accumulated earnings to a specified address
     * @param recipient Address to receive the earnings
     * @dev Useful for apps that want to send earnings to a different wallet
     *      (e.g., treasury, multisig, or user wallet).
     * 
     * @custom:security Only caller's earnings can be claimed, not arbitrary accounts
     */
    function claimEarningsTo(address recipient) external nonReentrant {
        if (recipient == address(0)) revert InvalidAddress();
        
        uint256 amount = appEarnings[msg.sender];
        if (amount == 0) revert NoEarningsToClaim();
        
        appEarnings[msg.sender] = 0;
        
        bool sent = rewardToken.transfer(recipient, amount);
        if (!sent) revert TransferFailed();
        
        emit AppClaimed(msg.sender, amount);
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Get claimable earnings for an app address
     * @param app Address of the application
     * @return Amount of reward tokens available to claim
     * @dev Convenience function for frontends to display earnings
     */
    function getEarnings(address app) external view returns (uint256) {
        return appEarnings[app];
    }
    
    /**
     * @notice Preview how fees would be distributed for a given amount
     * @param amount Total fee amount to simulate distribution for
     * @return appAmount Amount that would go to the app (50%)
     * @return ethLPAmount Amount that would go to ETH LPs (35%)
     * @return tokenLPAmount Amount that would go to token LPs (15%)
     * @dev Pure function useful for frontends to show expected distributions
     */
    function previewDistribution(uint256 amount) external pure returns (
        uint256 appAmount,
        uint256 ethLPAmount,
        uint256 tokenLPAmount
    ) {
        appAmount = (amount * APP_SHARE) / 10000;
        uint256 lpAmount = amount - appAmount;
        ethLPAmount = (lpAmount * ETH_LP_SHARE) / 10000;
        tokenLPAmount = lpAmount - ethLPAmount;
    }
    
    /**
     * @notice Get global fee distribution statistics
     * @return _totalDistributed Total fees processed through distributor
     * @return _totalAppEarnings Cumulative amount allocated to apps
     * @return _totalLPEarnings Cumulative amount allocated to LPs
     * @return pendingAppClaims Current unclaimed app earnings in contract
     * @dev Useful for analytics and monitoring dashboards
     */
    function getStats() external view returns (
        uint256 _totalDistributed,
        uint256 _totalAppEarnings,
        uint256 _totalLPEarnings,
        uint256 pendingAppClaims
    ) {
        _totalDistributed = totalDistributed;
        _totalAppEarnings = totalAppEarnings;
        _totalLPEarnings = totalLPEarnings;
        
        // Sum all pending app claims
        // Note: This is gas-intensive, use off-chain for large-scale
        pendingAppClaims = rewardToken.balanceOf(address(this));
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Set the authorized paymaster contract address
     * @param _paymaster Address of the paymaster contract
     * @dev Only callable by owner. Paymaster is the only address that can trigger distributions.
     * @custom:security Verify paymaster contract before setting
     */
    function setPaymaster(address _paymaster) external onlyOwner {
        if (_paymaster == address(0)) revert InvalidAddress();
        paymaster = _paymaster;
        emit PaymasterSet(_paymaster);
    }
    
    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

