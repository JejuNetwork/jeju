// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title ChainlinkGovernance
/// @notice DAO governance for Chainlink contracts
contract ChainlinkGovernance is Ownable2Step {
    enum ProposalType { VRF_FEE_UPDATE, AUTOMATION_FEE_UPDATE, ORACLE_FEE_UPDATE, KEEPER_APPROVAL, ORACLE_APPROVAL, STAKING_ALLOCATION, EMERGENCY_PAUSE, CONTRACT_UPGRADE }

    struct Proposal {
        uint256 id;
        ProposalType proposalType;
        address target;
        bytes data;
        uint256 value;
        uint256 eta;
        bool executed;
        bool cancelled;
        string description;
    }

    struct GovernanceConfig {
        uint256 proposalDelay;
        uint256 gracePeriod;
        uint256 minimumDelay;
        uint256 maximumDelay;
    }

    struct RevenueConfig {
        uint16 treasuryBps;
        uint16 operationalBps;
        uint16 communityBps;
        address treasury;
        address operational;
        address community;
    }

    address public vrfCoordinator;
    address public automationRegistry;
    address public oracleRouter;
    address public autocrat;

    mapping(uint256 => Proposal) public proposals;
    mapping(bytes32 => bool) public queuedTransactions;
    uint256 public proposalCount;

    GovernanceConfig public config;
    RevenueConfig public revenueConfig;
    mapping(address => bool) public proposers;
    bool public paused;
    address[] public guardians;
    mapping(address => bool) public isGuardian;

    event ProposalCreated(uint256 indexed id, ProposalType proposalType, address target, uint256 eta, string description);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id);
    event ContractUpdated(string name, address oldAddress, address newAddress);
    event ConfigUpdated(GovernanceConfig config);
    event RevenueConfigUpdated(RevenueConfig config);
    event EmergencyPause(address indexed guardian);
    event EmergencyUnpause(address indexed guardian);

    error NotAuthorized();
    error ProposalNotFound();
    error ProposalAlreadyExecuted();
    error ProposalAlreadyCancelled();
    error ProposalNotReady();
    error ProposalExpired();
    error InvalidDelay();
    error ContractPaused();
    error NotGuardian();
    error InvalidBps();

    modifier onlyProposer() {
        if (!proposers[msg.sender] && msg.sender != autocrat && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    modifier onlyGuardian() {
        if (!isGuardian[msg.sender] && msg.sender != owner()) revert NotGuardian();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor(address _autocrat, address _vrfCoordinator, address _automationRegistry, address _oracleRouter) Ownable(msg.sender) {
        autocrat = _autocrat;
        vrfCoordinator = _vrfCoordinator;
        automationRegistry = _automationRegistry;
        oracleRouter = _oracleRouter;

        config = GovernanceConfig({
            proposalDelay: 2 days,
            gracePeriod: 14 days,
            minimumDelay: 1 hours,
            maximumDelay: 30 days
        });

        revenueConfig = RevenueConfig({
            treasuryBps: 7000,
            operationalBps: 2000,
            communityBps: 1000,
            treasury: msg.sender,
            operational: msg.sender,
            community: msg.sender
        });

        proposers[msg.sender] = true;
        isGuardian[msg.sender] = true;
        guardians.push(msg.sender);
    }

    function propose(
        ProposalType proposalType,
        address target,
        bytes calldata data,
        uint256 value,
        string calldata description
    ) external onlyProposer whenNotPaused returns (uint256 proposalId) {
        proposalId = ++proposalCount;
        uint256 eta = block.timestamp + config.proposalDelay;

        proposals[proposalId] = Proposal({
            id: proposalId,
            proposalType: proposalType,
            target: target,
            data: data,
            value: value,
            eta: eta,
            executed: false,
            cancelled: false,
            description: description
        });

        bytes32 txHash = keccak256(abi.encode(target, value, data, eta));
        queuedTransactions[txHash] = true;
        emit ProposalCreated(proposalId, proposalType, target, eta, description);
    }

    function execute(uint256 proposalId) external onlyProposer whenNotPaused {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.id == 0) revert ProposalNotFound();
        if (proposal.executed) revert ProposalAlreadyExecuted();
        if (proposal.cancelled) revert ProposalAlreadyCancelled();
        if (block.timestamp < proposal.eta) revert ProposalNotReady();
        if (block.timestamp > proposal.eta + config.gracePeriod) revert ProposalExpired();

        proposal.executed = true;
        bytes32 txHash = keccak256(abi.encode(proposal.target, proposal.value, proposal.data, proposal.eta));
        queuedTransactions[txHash] = false;

        (bool success,) = proposal.target.call{value: proposal.value}(proposal.data);
        require(success, "Execution failed");
        emit ProposalExecuted(proposalId);
    }

    function cancel(uint256 proposalId) external onlyProposer {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.id == 0) revert ProposalNotFound();
        if (proposal.executed) revert ProposalAlreadyExecuted();

        proposal.cancelled = true;
        bytes32 txHash = keccak256(abi.encode(proposal.target, proposal.value, proposal.data, proposal.eta));
        queuedTransactions[txHash] = false;
        emit ProposalCancelled(proposalId);
    }

    function setVRFFeeRecipient(address recipient) external {
        require(msg.sender == autocrat || msg.sender == owner(), "Only Autocrat");
        (bool success,) = vrfCoordinator.call(abi.encodeWithSignature("setFeeRecipient(address)", recipient));
        require(success, "Failed");
    }

    function setAutomationFeeRecipient(address recipient) external {
        require(msg.sender == autocrat || msg.sender == owner(), "Only Autocrat");
        (bool success,) = automationRegistry.call(abi.encodeWithSignature("setFeeRecipient(address)", recipient));
        require(success, "Failed");
    }

    function setOracleFeeRecipient(address recipient) external {
        require(msg.sender == autocrat || msg.sender == owner(), "Only Autocrat");
        (bool success,) = oracleRouter.call(abi.encodeWithSignature("setFeeRecipient(address)", recipient));
        require(success, "Failed");
    }

    function approveKeeper(address keeper) external {
        require(msg.sender == autocrat || msg.sender == owner(), "Only Autocrat");
        (bool success,) = automationRegistry.call(abi.encodeWithSignature("approveKeeper(address)", keeper));
        require(success, "Failed");
    }

    function approveOracle(address oracle) external {
        require(msg.sender == autocrat || msg.sender == owner(), "Only Autocrat");
        (bool success,) = oracleRouter.call(abi.encodeWithSignature("approveOracle(address)", oracle));
        require(success, "Failed");
    }

    function emergencyPause() external onlyGuardian {
        paused = true;
        if (vrfCoordinator != address(0)) vrfCoordinator.call(abi.encodeWithSignature("pause()"));
        if (automationRegistry != address(0)) automationRegistry.call(abi.encodeWithSignature("pause()"));
        emit EmergencyPause(msg.sender);
    }

    function emergencyUnpause() external onlyOwner {
        paused = false;
        if (vrfCoordinator != address(0)) vrfCoordinator.call(abi.encodeWithSignature("unpause()"));
        if (automationRegistry != address(0)) automationRegistry.call(abi.encodeWithSignature("unpause()"));
        emit EmergencyUnpause(msg.sender);
    }

    function setContracts(address _vrfCoordinator, address _automationRegistry, address _oracleRouter) external onlyOwner {
        if (_vrfCoordinator != address(0)) { emit ContractUpdated("VRFCoordinator", vrfCoordinator, _vrfCoordinator); vrfCoordinator = _vrfCoordinator; }
        if (_automationRegistry != address(0)) { emit ContractUpdated("AutomationRegistry", automationRegistry, _automationRegistry); automationRegistry = _automationRegistry; }
        if (_oracleRouter != address(0)) { emit ContractUpdated("OracleRouter", oracleRouter, _oracleRouter); oracleRouter = _oracleRouter; }
    }

    function setAutocrat(address _autocrat) external onlyOwner {
        emit ContractUpdated("Autocrat", autocrat, _autocrat);
        autocrat = _autocrat;
    }

    function setConfig(GovernanceConfig calldata _config) external onlyOwner {
        if (_config.proposalDelay < _config.minimumDelay || _config.proposalDelay > _config.maximumDelay) revert InvalidDelay();
        config = _config;
        emit ConfigUpdated(_config);
    }

    function setRevenueConfig(RevenueConfig calldata _config) external {
        require(msg.sender == autocrat || msg.sender == owner(), "Only Autocrat");
        if (_config.treasuryBps + _config.operationalBps + _config.communityBps != 10000) revert InvalidBps();
        revenueConfig = _config;
        emit RevenueConfigUpdated(_config);
    }

    function setProposer(address proposer, bool authorized) external onlyOwner {
        proposers[proposer] = authorized;
    }

    function setGuardian(address guardian, bool active) external onlyOwner {
        if (active && !isGuardian[guardian]) {
            isGuardian[guardian] = true;
            guardians.push(guardian);
        } else if (!active && isGuardian[guardian]) {
            isGuardian[guardian] = false;
            for (uint256 i = 0; i < guardians.length; i++) {
                if (guardians[i] == guardian) {
                    guardians[i] = guardians[guardians.length - 1];
                    guardians.pop();
                    break;
                }
            }
        }
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function isProposalReady(uint256 proposalId) external view returns (bool) {
        Proposal storage p = proposals[proposalId];
        return !p.executed && !p.cancelled && block.timestamp >= p.eta && block.timestamp <= p.eta + config.gracePeriod;
    }

    function getGuardians() external view returns (address[] memory) {
        return guardians;
    }

    function getRevenueDistribution(uint256 amount) external view returns (uint256, uint256, uint256) {
        return (amount * revenueConfig.treasuryBps / 10000, amount * revenueConfig.operationalBps / 10000, amount * revenueConfig.communityBps / 10000);
    }
}
