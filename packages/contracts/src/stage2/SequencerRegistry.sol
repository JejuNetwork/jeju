// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../registry/IdentityRegistry.sol";
import "../registry/ReputationRegistry.sol";

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
        bool isActive;
        bool isSlashed;
    }

    struct SlashingEvent {
        address sequencer;
        SlashingReason reason;
        uint256 amount;
        uint256 timestamp;
    }

    enum SlashingReason { DOUBLE_SIGNING, CENSORSHIP, DOWNTIME, GOVERNANCE_BAN }

    uint256 public constant MIN_STAKE = 1000 ether;
    uint256 public constant MAX_STAKE = 100000 ether;
    uint256 public constant SLASH_DOUBLE_SIGN = 10000;
    uint256 public constant SLASH_CENSORSHIP = 5000;
    uint256 public constant SLASH_DOWNTIME = 1000;
    uint256 public constant DOWNTIME_THRESHOLD = 100;
    uint256 public constant REPUTATION_WEIGHT = 5000;

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

    event SequencerRegistered(address indexed sequencer, uint256 agentId, uint256 stake);
    event SequencerUnregistered(address indexed sequencer);
    event StakeIncreased(address indexed sequencer, uint256 amount);
    event StakeDecreased(address indexed sequencer, uint256 amount);
    event SequencerSlashed(
        address indexed sequencer,
        SlashingReason reason,
        uint256 amount,
        uint256 remainingStake
    );
    event BlockProposed(address indexed sequencer, uint256 blockNumber);
    event ReputationUpdated(address indexed sequencer, uint256 newScore);

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

    constructor(
        address _jejuToken,
        address _identityRegistry,
        address _reputationRegistry,
        address _treasury,
        address _owner
    ) Ownable(_owner) {
        if (_jejuToken == address(0) || _identityRegistry == address(0) || 
            _reputationRegistry == address(0) || _treasury == address(0)) {
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

        _blockSigners[_blockNumber][_sequencer] = true;
        seq.lastBlockProposed = _blockNumber;
        seq.blocksProposed++;

        emit BlockProposed(_sequencer, _blockNumber);
    }

    function updateReputation(address _sequencer) external {
        Sequencer storage seq = sequencers[_sequencer];
        if (!seq.isActive) revert NotActive();

        uint256 newReputation = _getReputationScore(seq.agentId);
        seq.reputationScore = newReputation;

        emit ReputationUpdated(_sequencer, newReputation);
    }

    function slash(address _sequencer, SlashingReason _reason) external onlyOwner {
        _slash(_sequencer, _reason);
    }

    function _slash(address _sequencer, SlashingReason _reason) internal {
        Sequencer storage seq = sequencers[_sequencer];
        if (seq.isSlashed) revert AlreadySlashed();
        if (!seq.isActive) revert NotActive();

        uint256 slashAmount = _reason == SlashingReason.GOVERNANCE_BAN
            ? seq.stake
            : (seq.stake * _getSlashPercentage(_reason)) / 10000;

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
            SlashingEvent({
                sequencer: _sequencer,
                reason: _reason,
                amount: slashAmount,
                timestamp: block.timestamp
            })
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

    function getSelectionWeight(address _sequencer) external view returns (uint256 weight) {
        Sequencer memory seq = sequencers[_sequencer];
        if (!seq.isActive) return 0;

        uint256 baseWeight = (seq.stake * (10000 - REPUTATION_WEIGHT)) / 10000;
        uint256 repWeight = (seq.stake * REPUTATION_WEIGHT * seq.reputationScore) / 100000000;
        return baseWeight + repWeight;
    }

    function getActiveSequencers()
        external
        view
        returns (address[] memory addresses, uint256[] memory weights)
    {
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
            uint64,
            uint8 averageScore
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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}

