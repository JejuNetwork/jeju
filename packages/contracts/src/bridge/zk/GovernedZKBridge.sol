// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "./ZKBridge.sol";
import "../../governance/interfaces/ICouncilGovernance.sol";

/**
 * @title GovernedZKBridge
 * @author Jeju Network
 * @notice ZK Bridge with Autocrat Council governance
 * @dev Admin functions require approved proposals from the council
 *
 * Governance Flow:
 * 1. Proposer submits proposal to Council
 * 2. Autocrat agents (Treasury, Code, Community, Security) vote
 * 3. AI CEO makes final decision
 * 4. Grace period allows community veto
 * 5. If approved, proposal can be executed here
 */
contract GovernedZKBridge is ZKBridge {
    // ============ Immutables ============

    ICouncilGovernance public immutable council;

    /// @notice Timelock for emergency actions
    uint256 public constant EMERGENCY_TIMELOCK = 2 hours;

    /// @notice Guardian for emergency pause (multisig)
    address public guardian;

    // ============ State ============

    struct EmergencyAction {
        bytes32 actionHash;
        uint256 executeAfter;
        bool executed;
    }

    mapping(bytes32 => EmergencyAction) public emergencyActions;
    mapping(bytes32 => bool) public executedProposals;

    // ============ Events ============

    event ProposalExecuted(bytes32 indexed proposalId, address indexed executor);
    event EmergencyQueued(bytes32 indexed actionHash, uint256 executeAfter);
    event EmergencyExecuted(bytes32 indexed actionHash);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);

    // ============ Errors ============

    error NotCouncilApproved();
    error GracePeriodNotComplete();
    error ProposalAlreadyExecuted();
    error NotGuardian();
    error EmergencyNotQueued();
    error EmergencyTimelockNotPassed();
    error EmergencyAlreadyExecuted();

    // ============ Modifiers ============

    modifier onlyGovernance(bytes32 proposalId) {
        if (!council.isProposalApproved(proposalId)) revert NotCouncilApproved();
        if (!council.isGracePeriodComplete(proposalId)) revert GracePeriodNotComplete();
        if (executedProposals[proposalId]) revert ProposalAlreadyExecuted();
        _;
        executedProposals[proposalId] = true;
        council.markCompleted(proposalId);
        emit ProposalExecuted(proposalId, msg.sender);
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    // ============ Constructor ============

    constructor(
        address _lightClient,
        address _identityRegistry,
        address _verifier,
        address _council,
        address _guardian,
        uint256 _baseFee,
        uint256 _feePerByte
    ) ZKBridge(_lightClient, _identityRegistry, _verifier, _baseFee, _feePerByte) {
        council = ICouncilGovernance(_council);
        guardian = _guardian;
        admin = address(this); // Self-admin, only governance can modify
    }

    // ============ Governed Admin Functions ============

    function registerTokenGoverned(bytes32 proposalId, address token, bytes32 solanaMint, bool _isHomeChain)
        external
        onlyGovernance(proposalId)
    {
        ICouncilGovernance.Proposal memory proposal = council.getProposal(proposalId);
        require(proposal.targetContract == address(this), "Wrong target");

        tokenToSolanaMint[token] = solanaMint;
        solanaMintToToken[solanaMint] = token;
        isTokenHome[token] = _isHomeChain;
        emit TokenRegistered(token, solanaMint, _isHomeChain);
    }

    function setFeesGoverned(bytes32 proposalId, uint256 _baseFee, uint256 _feePerByte)
        external
        onlyGovernance(proposalId)
    {
        ICouncilGovernance.Proposal memory proposal = council.getProposal(proposalId);
        require(proposal.targetContract == address(this), "Wrong target");

        baseFee = _baseFee;
        feePerByte = _feePerByte;
        emit FeeUpdated(_baseFee, _feePerByte);
    }

    function setFeeCollectorGoverned(bytes32 proposalId, address _feeCollector) external onlyGovernance(proposalId) {
        ICouncilGovernance.Proposal memory proposal = council.getProposal(proposalId);
        require(proposal.targetContract == address(this), "Wrong target");

        feeCollector = _feeCollector;
    }

    function setTransferRequirementsGoverned(bytes32 proposalId, uint256 _threshold, uint8 _tier)
        external
        onlyGovernance(proposalId)
    {
        ICouncilGovernance.Proposal memory proposal = council.getProposal(proposalId);
        require(proposal.targetContract == address(this), "Wrong target");

        largeTransferThreshold = _threshold;
        requiredStakeTier = _tier;
    }

    function setGuardianGoverned(bytes32 proposalId, address _guardian) external onlyGovernance(proposalId) {
        ICouncilGovernance.Proposal memory proposal = council.getProposal(proposalId);
        require(proposal.targetContract == address(this), "Wrong target");

        address oldGuardian = guardian;
        guardian = _guardian;
        emit GuardianUpdated(oldGuardian, _guardian);
    }

    // ============ Emergency Functions ============

    function queueEmergencyPause() external onlyGuardian {
        bytes32 actionHash = keccak256(abi.encodePacked("pause", block.timestamp));
        emergencyActions[actionHash] = EmergencyAction({
            actionHash: actionHash,
            executeAfter: block.timestamp + EMERGENCY_TIMELOCK,
            executed: false
        });
        emit EmergencyQueued(actionHash, block.timestamp + EMERGENCY_TIMELOCK);
    }

    function executeEmergencyPause(bytes32 actionHash) external onlyGuardian {
        EmergencyAction storage action = emergencyActions[actionHash];
        if (action.actionHash == bytes32(0)) revert EmergencyNotQueued();
        if (block.timestamp < action.executeAfter) revert EmergencyTimelockNotPassed();
        if (action.executed) revert EmergencyAlreadyExecuted();

        action.executed = true;
        _pause();
        emit EmergencyExecuted(actionHash);
        emit Paused(msg.sender);
    }

    function unpauseGoverned(bytes32 proposalId) external onlyGovernance(proposalId) {
        _unpause();
        emit Unpaused(msg.sender);
    }

    // ============ View Functions ============

    function isProposalExecuted(bytes32 proposalId) external view returns (bool) {
        return executedProposals[proposalId];
    }

    function getCouncil() external view returns (address) {
        return address(council);
    }
}
