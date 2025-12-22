// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GovernanceToken
 * @notice ERC20 token with voting delegation for Jeju governance
 * @dev Features:
 *      - ERC20Votes: Checkpointed balances for voting
 *      - Delegation: Delegate voting power without transferring tokens
 *      - EIP-712 signatures: Gasless delegation via permit
 *      - Quadratic voting support via weighted delegation
 *      - Conviction voting: Longer holdings = more weight
 *
 * Delegation works as follows:
 *      - Token holders delegate to themselves or others
 *      - Delegation is required to activate voting power
 *      - Voting power is snapshotted at proposal creation
 *      - Delegation can be changed anytime
 */
contract GovernanceToken is ERC20, ERC20Permit, ERC20Votes, Ownable {
    // Conviction multiplier (hold time bonus)
    uint256 public constant CONVICTION_PERIOD = 30 days;
    uint256 public constant MAX_CONVICTION_MULTIPLIER = 200; // 2x max
    uint256 public constant BASE_MULTIPLIER = 100; // 1x base

    // Track when tokens were received
    mapping(address => uint256) public lastTransferTimestamp;

    // Track conviction-weighted delegation
    mapping(address => uint256) public convictionDelegationStart;

    // Weighted delegation (for quadratic voting implementations)
    struct WeightedDelegation {
        address delegate;
        uint256 weightBps;  // Basis points (100 = 1%)
    }
    mapping(address => WeightedDelegation[]) public weightedDelegations;

    // Max supply cap
    uint256 public immutable maxSupply;

    event ConvictionUpdated(address indexed account, uint256 multiplier);
    event WeightedDelegationSet(address indexed delegator, address indexed delegate, uint256 weightBps);

    error ExceedsMaxSupply();
    error InvalidDelegation();
    error TotalWeightExceeds100Percent();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        uint256 maxSupply_,
        address owner_
    ) ERC20(name_, symbol_) ERC20Permit(name_) Ownable(owner_) {
        maxSupply = maxSupply_;
        if (initialSupply_ > 0) {
            _mint(owner_, initialSupply_);
        }
        // Auto-delegate to self on creation
        _delegate(owner_, owner_);
    }

    // ============ Voting Overrides ============

    function _update(address from, address to, uint256 amount) internal virtual override(ERC20, ERC20Votes) {
        super._update(from, to, amount);

        // Track transfer time for conviction
        if (to != address(0)) {
            lastTransferTimestamp[to] = block.timestamp;
        }
    }

    function nonces(address owner) public view virtual override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }

    // ============ Conviction Voting ============

    /**
     * @notice Get conviction multiplier for an account
     * @param account Account to check
     * @return Multiplier in basis points (100 = 1x, 200 = 2x)
     */
    function getConvictionMultiplier(address account) public view returns (uint256) {
        uint256 holdTime = block.timestamp - lastTransferTimestamp[account];

        if (holdTime >= CONVICTION_PERIOD) {
            return MAX_CONVICTION_MULTIPLIER;
        }

        // Linear interpolation from 1x to 2x over conviction period
        uint256 bonus = (holdTime * (MAX_CONVICTION_MULTIPLIER - BASE_MULTIPLIER)) / CONVICTION_PERIOD;
        return BASE_MULTIPLIER + bonus;
    }

    /**
     * @notice Get conviction-weighted voting power
     * @param account Account to check
     * @return Voting power with conviction multiplier applied
     */
    function getConvictionVotes(address account) external view returns (uint256) {
        uint256 baseVotes = getVotes(account);
        uint256 multiplier = getConvictionMultiplier(account);
        return (baseVotes * multiplier) / BASE_MULTIPLIER;
    }

    // ============ Weighted Delegation ============

    /**
     * @notice Set weighted delegations (split voting power across delegates)
     * @param delegates Array of delegates
     * @param weights Array of weight basis points (must sum to <= 10000)
     */
    function setWeightedDelegations(
        address[] calldata delegates,
        uint256[] calldata weights
    ) external {
        require(delegates.length == weights.length, "Length mismatch");

        // Clear existing delegations
        delete weightedDelegations[msg.sender];

        uint256 totalWeight = 0;
        for (uint256 i = 0; i < delegates.length; i++) {
            if (delegates[i] == address(0)) revert InvalidDelegation();
            totalWeight += weights[i];

            weightedDelegations[msg.sender].push(WeightedDelegation({
                delegate: delegates[i],
                weightBps: weights[i]
            }));

            emit WeightedDelegationSet(msg.sender, delegates[i], weights[i]);
        }

        if (totalWeight > 10000) revert TotalWeightExceeds100Percent();

        // If total < 100%, remaining goes to self
        if (totalWeight < 10000) {
            _delegate(msg.sender, msg.sender);
        } else if (delegates.length > 0) {
            // Primary delegation to first delegate for standard voting
            _delegate(msg.sender, delegates[0]);
        }
    }

    /**
     * @notice Get weighted delegations for an account
     * @param account Account to query
     * @return Array of weighted delegations
     */
    function getWeightedDelegations(address account)
        external
        view
        returns (WeightedDelegation[] memory)
    {
        return weightedDelegations[account];
    }

    /**
     * @notice Calculate weighted votes for a delegate from a specific delegator
     * @param delegator The account who delegated
     * @param delegate The delegate receiving votes
     * @return Weighted vote amount
     */
    function getWeightedVotesFrom(address delegator, address delegate)
        external
        view
        returns (uint256)
    {
        WeightedDelegation[] storage delegations = weightedDelegations[delegator];
        uint256 balance = balanceOf(delegator);

        for (uint256 i = 0; i < delegations.length; i++) {
            if (delegations[i].delegate == delegate) {
                return (balance * delegations[i].weightBps) / 10000;
            }
        }

        // If using standard delegation
        if (delegates(delegator) == delegate) {
            return balance;
        }

        return 0;
    }

    // ============ Minting ============

    /**
     * @notice Mint new tokens
     * @param to Recipient
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > maxSupply) revert ExceedsMaxSupply();
        _mint(to, amount);
    }

    // ============ View Functions ============

    function getRemainingMintable() external view returns (uint256) {
        return maxSupply - totalSupply();
    }

    function clock() public view virtual override returns (uint48) {
        return uint48(block.timestamp);
    }

    function CLOCK_MODE() public pure virtual override returns (string memory) {
        return "mode=timestamp";
    }
}

