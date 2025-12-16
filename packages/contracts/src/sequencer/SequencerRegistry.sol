// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../registry/IdentityRegistry.sol";
import "../registry/ReputationRegistry.sol";

interface IFeeConfigSequencer {
    function getSequencerRevenueShare() external view returns (uint16);
    function getTreasury() external view returns (address);
}

/**
 * @title SequencerRegistry
 * @notice Decentralized Sequencer registration with staking and revenue sharing
 */
contract SequencerRegistry is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct Sequencer {
        uint256 agentId;
        uint256 stake;
        uint256 reputationScore;
        uint256 registeredAt;
        uint256 lastBlockProposed;
        uint256 blocksProposed;
        uint256 blocksMissed;
        uint256 totalRewardsEarned; // V2: Track total rewards
        uint256 pendingRewards; // V2: Unclaimed rewards
        bool isActive;
        bool isSlashed;
    }

    struct SlashingEvent {
        address sequencer;
        SlashingReason reason;
        uint256 amount;
        uint256 timestamp;
    }

    struct RevenueEpoch {
        uint256 epochNumber;
        uint256 totalBlocksProduced;
        uint256 totalRevenue;
        uint256 sequencerShare; // Amount for sequencers
        uint256 treasuryShare; // Amount for treasury
        uint256 distributedAt;
        bool distributed;
    }

    enum SlashingReason {
        DOUBLE_SIGNING,
        CENSORSHIP,
        DOWNTIME,
        GOVERNANCE_BAN
    }

    uint256 public constant MIN_STAKE = 1000 ether;
    uint256 public constant MAX_STAKE = 100000 ether;
    uint256 public constant SLASH_DOUBLE_SIGN = 10000;
    uint256 public constant SLASH_CENSORSHIP = 5000;
    uint256 public constant SLASH_DOWNTIME = 1000;
    uint256 public constant DOWNTIME_THRESHOLD = 100;
    uint256 public constant REPUTATION_WEIGHT = 5000;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant EPOCH_DURATION = 1 days;
    uint256 public constant MAX_SEQUENCERS = 100;
    uint256 public constant STAKE_WITHDRAWAL_DELAY = 7 days;

    IERC20 public immutable jejuToken;
    IdentityRegistry public immutable identityRegistry;
    ReputationRegistry public immutable reputationRegistry;
    address public treasury;
    mapping(address => Sequencer) public sequencers;
    address[] public activeSequencers;
    mapping(address => bool) public isActiveSequencer;
    mapping(uint256 => mapping(address => bool)) private _blockSigners;
    uint256 public totalStaked;
    SlashingEvent[] public slashingEvents;

    IFeeConfigSequencer public feeConfig;
    uint256 public sequencerRevenueShareBps = 500;
    uint256 public currentEpoch;
    uint256 public epochStartTime;
    uint256 public epochAccumulatedRevenue;
    mapping(uint256 => RevenueEpoch) public revenueEpochs;
    mapping(uint256 => mapping(address => uint256)) public epochBlocksPerSequencer;
    uint256 public totalRewardsDistributed;
    uint256 public totalRevenueCollected;

    event SequencerRegistered(address indexed sequencer, uint256 agentId, uint256 stake);
    event SequencerUnregistered(address indexed sequencer);
    event StakeIncreased(address indexed sequencer, uint256 amount);
    event StakeDecreased(address indexed sequencer, uint256 amount);
    event SequencerSlashed(address indexed sequencer, SlashingReason reason, uint256 amount, uint256 remainingStake);
    event BlockProposed(address indexed sequencer, uint256 blockNumber);
    event ReputationUpdated(address indexed sequencer, uint256 newScore);
    event RevenueReceived(uint256 amount, uint256 epoch);
    event EpochFinalized(uint256 indexed epoch, uint256 totalRevenue, uint256 sequencerShare, uint256 treasuryShare);
    event RewardsClaimed(address indexed sequencer, uint256 amount);
    event FeeConfigUpdated(address indexed oldConfig, address indexed newConfig);

    error NotRegistered();
    error AlreadyRegistered();
    error InsufficientStake();
    error ExceedsMaxStake();
    error NotActive();
    error AlreadySlashed();
    error InvalidAgentId();
    error AgentNotRegistered();
    error AgentBanned();
    error InvalidAddress();
    error MaxSequencersReached();
    error InvalidSlashProof();
    error WithdrawalDelayNotMet();

    constructor(
        address _jejuToken,
        address _identityRegistry,
        address _reputationRegistry,
        address _treasury,
        address _owner
    ) Ownable(_owner) {
        if (
            _jejuToken == address(0) || _identityRegistry == address(0) || _reputationRegistry == address(0)
                || _treasury == address(0)
        ) {
            revert InvalidAddress();
        }

        jejuToken = IERC20(_jejuToken);
        identityRegistry = IdentityRegistry(payable(_identityRegistry));
        reputationRegistry = ReputationRegistry(_reputationRegistry);
        treasury = _treasury;
    }

    function register(uint256 _agentId, uint256 _stakeAmount) external nonReentrant whenNotPaused {
        if (sequencers[msg.sender].isActive) revert AlreadyRegistered();
        if (_stakeAmount < MIN_STAKE) revert InsufficientStake();
        if (_stakeAmount > MAX_STAKE) revert ExceedsMaxStake();
        if (activeSequencers.length >= MAX_SEQUENCERS) revert MaxSequencersReached();

        if (!identityRegistry.agentExists(_agentId)) revert AgentNotRegistered();
        IdentityRegistry.AgentRegistration memory agent = identityRegistry.getAgent(_agentId);
        if (agent.isBanned) revert AgentBanned();
        if (identityRegistry.ownerOf(_agentId) != msg.sender) revert InvalidAgentId();

        jejuToken.safeTransferFrom(msg.sender, address(this), _stakeAmount);
        uint256 reputation = _getReputationScore(_agentId);

        sequencers[msg.sender] = Sequencer({
            agentId: _agentId,
            stake: _stakeAmount,
            reputationScore: reputation,
            registeredAt: block.timestamp,
            lastBlockProposed: 0,
            blocksProposed: 0,
            blocksMissed: 0,
            totalRewardsEarned: 0,
            pendingRewards: 0,
            isActive: true,
            isSlashed: false
        });

        activeSequencers.push(msg.sender);
        isActiveSequencer[msg.sender] = true;
        totalStaked += _stakeAmount;

        emit SequencerRegistered(msg.sender, _agentId, _stakeAmount);
    }

    function unregister() external nonReentrant {
        Sequencer storage seq = sequencers[msg.sender];
        if (seq.isSlashed) revert AlreadySlashed();
        if (!seq.isActive) revert NotRegistered();

        uint256 stake = seq.stake;
        seq.isActive = false;
        totalStaked -= stake;
        _removeFromActiveList(msg.sender);
        jejuToken.safeTransfer(msg.sender, stake);

        emit SequencerUnregistered(msg.sender);
    }

    function increaseStake(uint256 _amount) external nonReentrant whenNotPaused {
        Sequencer storage seq = sequencers[msg.sender];
        if (!seq.isActive) revert NotRegistered();
        if (seq.isSlashed) revert AlreadySlashed();

        uint256 newStake = seq.stake + _amount;
        if (newStake > MAX_STAKE) revert ExceedsMaxStake();

        jejuToken.safeTransferFrom(msg.sender, address(this), _amount);
        seq.stake = newStake;
        totalStaked += _amount;

        emit StakeIncreased(msg.sender, _amount);
    }

    function decreaseStake(uint256 _amount) external nonReentrant {
        Sequencer storage seq = sequencers[msg.sender];
        if (!seq.isActive) revert NotRegistered();
        if (seq.isSlashed) revert AlreadySlashed();

        uint256 newStake = seq.stake - _amount;
        if (newStake < MIN_STAKE) revert InsufficientStake();

        seq.stake = newStake;
        totalStaked -= _amount;
        jejuToken.safeTransfer(msg.sender, _amount);

        emit StakeDecreased(msg.sender, _amount);
    }

    function recordBlockProposed(address _sequencer, uint256 _blockNumber) external onlyOwner {
        Sequencer storage seq = sequencers[_sequencer];
        if (!seq.isActive) revert NotActive();

        if (_blockSigners[_blockNumber][_sequencer]) {
            _slash(_sequencer, SlashingReason.DOUBLE_SIGNING);
            return;
        }

        _advanceEpochIfNeeded();

        _blockSigners[_blockNumber][_sequencer] = true;
        seq.lastBlockProposed = _blockNumber;
        seq.blocksProposed++;
        epochBlocksPerSequencer[currentEpoch][_sequencer]++;

        emit BlockProposed(_sequencer, _blockNumber);
    }

    function updateReputation(address _sequencer) external {
        Sequencer storage seq = sequencers[_sequencer];
        if (!seq.isActive) revert NotActive();

        uint256 newReputation = _getReputationScore(seq.agentId);
        seq.reputationScore = newReputation;

        emit ReputationUpdated(_sequencer, newReputation);
    }

    function slash(address _sequencer, SlashingReason _reason, bytes calldata _proof) external onlyOwner {
        if (_reason == SlashingReason.DOUBLE_SIGNING) {
            if (_proof.length < 130) revert InvalidSlashProof();
        } else if (_reason == SlashingReason.CENSORSHIP) {
            if (_proof.length < 32) revert InvalidSlashProof();
        } else if (_reason == SlashingReason.GOVERNANCE_BAN) {
            if (_proof.length < 32) revert InvalidSlashProof();
        }
        _slash(_sequencer, _reason);
    }

    function _slash(address _sequencer, SlashingReason _reason) internal {
        Sequencer storage seq = sequencers[_sequencer];
        if (seq.isSlashed) revert AlreadySlashed();
        if (!seq.isActive) revert NotActive();

        uint256 slashAmount =
            _reason == SlashingReason.GOVERNANCE_BAN ? seq.stake : (seq.stake * _getSlashPercentage(_reason)) / 10000;

        uint256 remainingStake = seq.stake - slashAmount;
        seq.stake = remainingStake;
        seq.isSlashed = (_reason == SlashingReason.DOUBLE_SIGNING || _reason == SlashingReason.GOVERNANCE_BAN);

        if (remainingStake < MIN_STAKE) {
            seq.isActive = false;
            _removeFromActiveList(_sequencer);
            totalStaked -= remainingStake;
            jejuToken.safeTransfer(_sequencer, remainingStake);
        } else {
            totalStaked -= slashAmount;
        }

        jejuToken.safeTransfer(treasury, slashAmount);
        slashingEvents.push(
            SlashingEvent({sequencer: _sequencer, reason: _reason, amount: slashAmount, timestamp: block.timestamp})
        );

        emit SequencerSlashed(_sequencer, _reason, slashAmount, remainingStake);
    }

    function checkDowntime(address _sequencer, uint256 _currentBlock) external {
        Sequencer storage seq = sequencers[_sequencer];
        if (!seq.isActive) revert NotActive();

        uint256 blocksSinceLast = _currentBlock - seq.lastBlockProposed;
        seq.blocksMissed += blocksSinceLast;
        if (seq.blocksMissed > DOWNTIME_THRESHOLD) {
            _slash(_sequencer, SlashingReason.DOWNTIME);
        }
    }

    receive() external payable {
        epochAccumulatedRevenue += msg.value;
        totalRevenueCollected += msg.value;
        emit RevenueReceived(msg.value, currentEpoch);
        _advanceEpochIfNeeded();
    }

    function depositRevenue() external payable {
        epochAccumulatedRevenue += msg.value;
        totalRevenueCollected += msg.value;
        emit RevenueReceived(msg.value, currentEpoch);
        _advanceEpochIfNeeded();
    }

    function finalizeEpoch(uint256 epochNumber) external nonReentrant {
        require(epochNumber < currentEpoch, "Epoch not ended");

        RevenueEpoch storage epoch = revenueEpochs[epochNumber];
        require(!epoch.distributed, "Already distributed");

        uint256 sharesBps = _getSequencerRevenueShareBps();
        uint256 sequencerShare = (epoch.totalRevenue * sharesBps) / BPS_DENOMINATOR;
        uint256 treasuryShare = epoch.totalRevenue - sequencerShare;

        epoch.sequencerShare = sequencerShare;
        epoch.treasuryShare = treasuryShare;
        epoch.distributedAt = block.timestamp;
        epoch.distributed = true;

        if (epoch.totalBlocksProduced > 0 && sequencerShare > 0) {
            for (uint256 i = 0; i < activeSequencers.length; i++) {
                address sequencer = activeSequencers[i];
                uint256 blocks = epochBlocksPerSequencer[epochNumber][sequencer];
                if (blocks > 0) {
                    uint256 reward = (sequencerShare * blocks) / epoch.totalBlocksProduced;
                    sequencers[sequencer].pendingRewards += reward;
                    sequencers[sequencer].totalRewardsEarned += reward;
                }
            }
        }

        totalRewardsDistributed += sequencerShare;

        if (treasuryShare > 0 && treasury != address(0)) {
            (bool success,) = treasury.call{value: treasuryShare}("");
            require(success, "Treasury transfer failed");
        }

        emit EpochFinalized(epochNumber, epoch.totalRevenue, sequencerShare, treasuryShare);
    }

    function claimRewards() external nonReentrant {
        Sequencer storage seq = sequencers[msg.sender];
        uint256 pending = seq.pendingRewards;
        require(pending > 0, "No rewards");

        seq.pendingRewards = 0;

        (bool success,) = msg.sender.call{value: pending}("");
        require(success, "Transfer failed");

        emit RewardsClaimed(msg.sender, pending);
    }

    function getPendingRewards(address sequencer) external view returns (uint256) {
        return sequencers[sequencer].pendingRewards;
    }

    function getEpoch(uint256 epochNumber) external view returns (RevenueEpoch memory) {
        return revenueEpochs[epochNumber];
    }

    function getEffectiveRevenueShareBps() external view returns (uint256) {
        return _getSequencerRevenueShareBps();
    }

    function _getSequencerRevenueShareBps() internal view returns (uint256) {
        if (address(feeConfig) != address(0)) {
            return feeConfig.getSequencerRevenueShare();
        }
        return sequencerRevenueShareBps;
    }

    function _advanceEpochIfNeeded() internal {
        if (epochStartTime == 0) {
            epochStartTime = block.timestamp;
            return;
        }

        if (block.timestamp >= epochStartTime + EPOCH_DURATION) {
            revenueEpochs[currentEpoch] = RevenueEpoch({
                epochNumber: currentEpoch,
                totalBlocksProduced: _countEpochBlocks(currentEpoch),
                totalRevenue: epochAccumulatedRevenue,
                sequencerShare: 0,
                treasuryShare: 0,
                distributedAt: 0,
                distributed: false
            });

            currentEpoch++;
            epochStartTime = block.timestamp;
            epochAccumulatedRevenue = 0;
        }
    }

    function _countEpochBlocks(uint256 epochNumber) internal view returns (uint256 total) {
        for (uint256 i = 0; i < activeSequencers.length; i++) {
            total += epochBlocksPerSequencer[epochNumber][activeSequencers[i]];
        }
    }

    function getSelectionWeight(address _sequencer) external view returns (uint256 weight) {
        Sequencer memory seq = sequencers[_sequencer];
        if (!seq.isActive) return 0;

        uint256 baseWeight = (seq.stake * (10000 - REPUTATION_WEIGHT)) / 10000;
        uint256 repWeight = (seq.stake * REPUTATION_WEIGHT * seq.reputationScore) / 100000000;
        return baseWeight + repWeight;
    }

    function getActiveSequencers() external view returns (address[] memory addresses, uint256[] memory weights) {
        uint256 count = activeSequencers.length;
        addresses = new address[](count);
        weights = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            addresses[i] = activeSequencers[i];
            weights[i] = this.getSelectionWeight(activeSequencers[i]);
        }
    }

    function _getReputationScore(uint256 _agentId) internal view returns (uint256) {
        try reputationRegistry.getSummary(_agentId, new address[](0), bytes32(0), bytes32(0)) returns (
            uint64, uint8 averageScore
        ) {
            if (averageScore == 0) return 5000;
            return uint256(averageScore) * 100;
        } catch {
            return 5000;
        }
    }

    function _getSlashPercentage(SlashingReason _reason) private pure returns (uint256) {
        if (_reason == SlashingReason.DOUBLE_SIGNING) return SLASH_DOUBLE_SIGN;
        if (_reason == SlashingReason.CENSORSHIP) return SLASH_CENSORSHIP;
        if (_reason == SlashingReason.DOWNTIME) return SLASH_DOWNTIME;
        return 0;
    }

    function _removeFromActiveList(address _sequencer) internal {
        if (!isActiveSequencer[_sequencer]) return;

        uint256 length = activeSequencers.length;
        for (uint256 i = 0; i < length; i++) {
            if (activeSequencers[i] == _sequencer) {
                activeSequencers[i] = activeSequencers[length - 1];
                activeSequencers.pop();
                isActiveSequencer[_sequencer] = false;
                return;
            }
        }
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidAddress();
        treasury = _treasury;
    }

    function setFeeConfig(address _feeConfig) external onlyOwner {
        address oldConfig = address(feeConfig);
        feeConfig = IFeeConfigSequencer(_feeConfig);
        emit FeeConfigUpdated(oldConfig, _feeConfig);
    }

    function setSequencerRevenueShare(uint256 newShareBps) external onlyOwner {
        require(newShareBps <= 5000, "Share too high");
        sequencerRevenueShareBps = newShareBps;
    }

    function getRevenueStats()
        external
        view
        returns (
            uint256 _currentEpoch,
            uint256 _epochAccumulatedRevenue,
            uint256 _totalRevenueCollected,
            uint256 _totalRewardsDistributed,
            uint256 _currentShareBps
        )
    {
        return (
            currentEpoch,
            epochAccumulatedRevenue,
            totalRevenueCollected,
            totalRewardsDistributed,
            _getSequencerRevenueShareBps()
        );
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
