// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract GovernanceTimelock is Ownable, ReentrancyGuard, Pausable {
    struct Proposal {
        address target;
        bytes data;
        uint256 value;
        uint256 proposedAt;
        uint256 executeAfter;
        bool executed;
        bool cancelled;
        ProposalType proposalType;
    }

    enum ProposalType {
        UPGRADE,
        EMERGENCY_BUGFIX
    }

    uint256 public constant TIMELOCK_DELAY = 30 days;
    uint256 public constant EMERGENCY_MIN_DELAY = 1 hours;
    address public governance;
    address public securityCouncil;
    mapping(bytes32 => Proposal) public proposals;
    bytes32[] public proposalIds;
    uint256 public timelockDelay;

    event ProposalCreated(
        bytes32 indexed proposalId,
        address indexed target,
        ProposalType proposalType,
        uint256 executeAfter,
        string description
    );
    event ProposalExecuted(bytes32 indexed proposalId, address indexed target);
    event ProposalCancelledEvent(bytes32 indexed proposalId);
    event TimelockDelayUpdated(uint256 oldDelay, uint256 newDelay);
    event GovernanceUpdated(address oldGovernance, address newGovernance);
    event SecurityCouncilUpdated(address oldCouncil, address newCouncil);

    error NotGovernance();
    error NotSecurityCouncil();
    error ProposalNotFound();
    error ProposalAlreadyExecuted();
    error ProposalAlreadyCancelled();
    error TimelockNotExpired();
    error InvalidTarget();
    error InvalidDelay();
    error ExecutionFailed();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    modifier onlySecurityCouncil() {
        if (msg.sender != securityCouncil) revert NotSecurityCouncil();
        _;
    }

    constructor(
        address _governance,
        address _securityCouncil,
        address _owner,
        uint256 _timelockDelay
    ) Ownable(_owner) {
        governance = _governance;
        securityCouncil = _securityCouncil;
        timelockDelay = _timelockDelay > 0 ? _timelockDelay : TIMELOCK_DELAY;
    }

    function proposeUpgrade(
        address _target,
        bytes calldata _data,
        string calldata _description
    ) external onlyGovernance returns (bytes32 proposalId) {
        if (_target == address(0)) revert InvalidTarget();

        proposalId = keccak256(abi.encodePacked(_target, _data, block.timestamp, block.number));
        uint256 _executeAfter = block.timestamp + timelockDelay;

        proposals[proposalId] = Proposal({
            target: _target,
            data: _data,
            value: 0,
            proposedAt: block.timestamp,
            executeAfter: _executeAfter,
            executed: false,
            cancelled: false,
            proposalType: ProposalType.UPGRADE
        });

        proposalIds.push(proposalId);

        emit ProposalCreated(proposalId, _target, ProposalType.UPGRADE, _executeAfter, _description);
    }

    function proposeEmergencyBugfix(
        address _target,
        bytes calldata _data,
        string calldata _description,
        bytes32 _bugProof
    ) external onlySecurityCouncil returns (bytes32 proposalId) {
        if (_target == address(0)) revert InvalidTarget();

        proposalId = keccak256(abi.encodePacked(_target, _data, block.timestamp, block.number, _bugProof));
        uint256 _executeAfter = block.timestamp + EMERGENCY_MIN_DELAY;

        proposals[proposalId] = Proposal({
            target: _target,
            data: _data,
            value: 0,
            proposedAt: block.timestamp,
            executeAfter: _executeAfter,
            executed: false,
            cancelled: false,
            proposalType: ProposalType.EMERGENCY_BUGFIX
        });

        proposalIds.push(proposalId);

        emit ProposalCreated(proposalId, _target, ProposalType.EMERGENCY_BUGFIX, _executeAfter, _description);
    }

    function execute(bytes32 _proposalId) external nonReentrant {
        Proposal storage proposal = proposals[_proposalId];
        if (proposal.target == address(0)) revert ProposalNotFound();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (proposal.cancelled) revert ProposalAlreadyCancelled();
        if (block.timestamp < proposal.executeAfter) revert TimelockNotExpired();

        proposal.executed = true;

        (bool success,) = proposal.target.call{value: proposal.value}(proposal.data);
        if (!success) revert ExecutionFailed();

        emit ProposalExecuted(_proposalId, proposal.target);
    }

    function cancel(bytes32 _proposalId) external onlyGovernance {
        Proposal storage proposal = proposals[_proposalId];
        if (proposal.target == address(0)) revert ProposalNotFound();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (proposal.cancelled) revert ProposalAlreadyCancelled();

        proposal.cancelled = true;

        emit ProposalCancelledEvent(_proposalId);
    }

    function getProposal(bytes32 _proposalId) external view returns (Proposal memory proposal) {
        proposal = proposals[_proposalId];
        if (proposal.target == address(0)) revert ProposalNotFound();
    }

    function getAllProposalIds() external view returns (bytes32[] memory ids) {
        return proposalIds;
    }

    function canExecute(bytes32 _proposalId) external view returns (bool) {
        Proposal memory proposal = proposals[_proposalId];
        if (proposal.target == address(0)) return false;
        if (proposal.executed) return false;
        if (proposal.cancelled) return false;
        return block.timestamp >= proposal.executeAfter;
    }

    function timeRemaining(bytes32 _proposalId) external view returns (uint256) {
        Proposal memory proposal = proposals[_proposalId];
        if (proposal.target == address(0) || proposal.executed || proposal.cancelled) {
            return proposal.target == address(0) ? type(uint256).max : 0;
        }
        return block.timestamp >= proposal.executeAfter ? 0 : proposal.executeAfter - block.timestamp;
    }

    function setGovernance(address _governance) external onlyOwner {
        address oldGovernance = governance;
        governance = _governance;
        emit GovernanceUpdated(oldGovernance, _governance);
    }

    function setSecurityCouncil(address _securityCouncil) external onlyOwner {
        address oldCouncil = securityCouncil;
        securityCouncil = _securityCouncil;
        emit SecurityCouncilUpdated(oldCouncil, _securityCouncil);
    }

    function setTimelockDelay(uint256 _newDelay) external onlyOwner {
        if (_newDelay < EMERGENCY_MIN_DELAY) revert InvalidDelay();
        uint256 oldDelay = timelockDelay;
        timelockDelay = _newDelay;
        emit TimelockDelayUpdated(oldDelay, _newDelay);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
