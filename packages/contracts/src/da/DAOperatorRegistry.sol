// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {ProviderRegistryBase} from "../registry/ProviderRegistryBase.sol";
import {ERC8004ProviderMixin} from "../registry/ERC8004ProviderMixin.sol";
import {IDATypes} from "./IDATypes.sol";

/**
 * @title DAOperatorRegistry
 * @notice Registry for Data Availability operators with staking and slashing
 * 
 * Operators stake tokens to participate in the DA network:
 * - Store blob chunks assigned to them
 * - Respond to sampling queries
 * - Sign availability attestations
 * - Get slashed for unavailability
 */
contract DAOperatorRegistry is IDATypes, ProviderRegistryBase {
    // ============ State ============

    mapping(address => DAOperator) private _operators;
    mapping(address => uint256) private _pendingUnstake;
    mapping(address => uint256) private _unstakeRequestTime;
    
    address[] private _activeOperatorList;
    mapping(address => uint256) private _activeOperatorIndex;
    
    uint256 public constant UNSTAKE_DELAY = 7 days;
    uint256 public constant MIN_HEARTBEAT_INTERVAL = 1 hours;
    uint256 public constant SLASH_PERCENT_DOWNTIME = 500; // 5%
    uint256 public constant SLASH_PERCENT_UNAVAILABLE = 1000; // 10%
    
    // ============ Constructor ============

    constructor(
        address _owner,
        address _identityRegistry,
        address _banManager,
        uint256 _minOperatorStake
    ) ProviderRegistryBase(_owner, _identityRegistry, _banManager, _minOperatorStake) {}

    // ============ Registration ============

    /**
     * @notice Register as a DA operator
     */
    function register(
        string calldata endpoint,
        bytes32 teeAttestation,
        string calldata region,
        uint256 capacityGB
    ) external payable nonReentrant whenNotPaused {
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (_operators[msg.sender].registeredAt != 0) revert OperatorAlreadyRegistered();
        
        _registerProviderWithoutAgent(msg.sender);
        _storeOperatorData(msg.sender, 0, endpoint, teeAttestation, region, capacityGB);
    }

    /**
     * @notice Register as a DA operator with ERC-8004 agent
     */
    function registerWithAgent(
        uint256 agentId,
        string calldata endpoint,
        bytes32 teeAttestation,
        string calldata region,
        uint256 capacityGB
    ) external payable nonReentrant whenNotPaused {
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        if (_operators[msg.sender].registeredAt != 0) revert OperatorAlreadyRegistered();
        
        _registerProviderWithAgent(msg.sender, agentId);
        _storeOperatorData(msg.sender, agentId, endpoint, teeAttestation, region, capacityGB);
    }

    function _storeOperatorData(
        address operator,
        uint256 agentId,
        string calldata endpoint,
        bytes32 teeAttestation,
        string calldata region,
        uint256 capacityGB
    ) internal {
        _operators[operator] = DAOperator({
            operator: operator,
            agentId: agentId,
            stake: msg.value,
            endpoint: endpoint,
            teeAttestation: teeAttestation,
            region: region,
            capacityGB: capacityGB,
            usedGB: 0,
            status: OperatorStatus.ACTIVE,
            registeredAt: block.timestamp,
            lastHeartbeat: block.timestamp,
            samplesResponded: 0,
            samplesFailed: 0
        });

        _addToActiveList(operator);
        emit OperatorRegistered(operator, agentId, msg.value, endpoint);
    }

    function _onProviderRegistered(address provider, uint256 agentId, uint256 stake) internal override {
        // Provider data stored in _storeOperatorData
    }

    // ============ Operator Updates ============

    /**
     * @notice Update operator endpoint
     */
    function updateEndpoint(string calldata endpoint) external {
        if (_operators[msg.sender].registeredAt == 0) revert OperatorNotRegistered();
        if (bytes(endpoint).length == 0) revert InvalidEndpoint();
        
        _operators[msg.sender].endpoint = endpoint;
        emit OperatorUpdated(msg.sender);
    }

    /**
     * @notice Update operator capacity
     */
    function updateCapacity(uint256 capacityGB, uint256 usedGB) external {
        if (_operators[msg.sender].registeredAt == 0) revert OperatorNotRegistered();
        
        _operators[msg.sender].capacityGB = capacityGB;
        _operators[msg.sender].usedGB = usedGB;
        emit OperatorUpdated(msg.sender);
    }

    /**
     * @notice Update TEE attestation
     */
    function updateTEEAttestation(bytes32 attestation) external {
        if (_operators[msg.sender].registeredAt == 0) revert OperatorNotRegistered();
        
        _operators[msg.sender].teeAttestation = attestation;
        emit OperatorUpdated(msg.sender);
    }

    /**
     * @notice Operator heartbeat
     */
    function heartbeat() external {
        DAOperator storage op = _operators[msg.sender];
        if (op.registeredAt == 0) revert OperatorNotRegistered();
        
        op.lastHeartbeat = block.timestamp;
    }

    // ============ Staking ============

    /**
     * @notice Add stake
     */
    function addStake() external payable nonReentrant {
        DAOperator storage op = _operators[msg.sender];
        if (op.registeredAt == 0) revert OperatorNotRegistered();
        
        op.stake += msg.value;
        
        // Reactivate if was inactive due to low stake
        if (op.status == OperatorStatus.INACTIVE && op.stake >= minProviderStake) {
            op.status = OperatorStatus.ACTIVE;
            _addToActiveList(msg.sender);
        }
    }

    /**
     * @notice Request unstake (starts delay period)
     */
    function requestUnstake(uint256 amount) external {
        DAOperator storage op = _operators[msg.sender];
        if (op.registeredAt == 0) revert OperatorNotRegistered();
        if (op.stake < amount) revert DAInsufficientStake(op.stake, amount);
        
        _pendingUnstake[msg.sender] = amount;
        _unstakeRequestTime[msg.sender] = block.timestamp;
    }

    /**
     * @notice Complete unstake after delay
     */
    function completeUnstake() external nonReentrant {
        DAOperator storage op = _operators[msg.sender];
        if (op.registeredAt == 0) revert OperatorNotRegistered();
        
        uint256 amount = _pendingUnstake[msg.sender];
        if (amount == 0) revert DAInsufficientStake(0, 1);
        if (block.timestamp < _unstakeRequestTime[msg.sender] + UNSTAKE_DELAY) {
            revert Unauthorized();
        }
        
        op.stake -= amount;
        _pendingUnstake[msg.sender] = 0;
        _unstakeRequestTime[msg.sender] = 0;
        
        // Deactivate if below minimum
        if (op.stake < minProviderStake) {
            op.status = OperatorStatus.INACTIVE;
            _removeFromActiveList(msg.sender);
        }
        
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit OperatorExited(msg.sender, amount);
    }

    // ============ Slashing ============

    /**
     * @notice Slash operator for downtime
     */
    function slashForDowntime(address operator) external onlyOwner {
        DAOperator storage op = _operators[operator];
        if (op.registeredAt == 0) revert OperatorNotRegistered();
        if (op.status == OperatorStatus.SLASHED) revert OperatorSlashedError();
        
        // Check if operator missed heartbeat
        if (block.timestamp - op.lastHeartbeat < MIN_HEARTBEAT_INTERVAL * 24) {
            revert Unauthorized();
        }
        
        uint256 slashAmount = (op.stake * SLASH_PERCENT_DOWNTIME) / 10000;
        _executeSlash(operator, slashAmount, "Downtime");
    }

    /**
     * @notice Slash operator for unavailability (failed to respond to samples)
     */
    function slashForUnavailability(address operator, bytes32 /* blobId */) external onlyOwner {
        DAOperator storage op = _operators[operator];
        if (op.registeredAt == 0) revert OperatorNotRegistered();
        if (op.status == OperatorStatus.SLASHED) revert OperatorSlashedError();
        
        uint256 slashAmount = (op.stake * SLASH_PERCENT_UNAVAILABLE) / 10000;
        _executeSlash(operator, slashAmount, "Unavailability");
    }

    function _executeSlash(address operator, uint256 amount, string memory reason) internal {
        DAOperator storage op = _operators[operator];
        
        if (amount > op.stake) {
            amount = op.stake;
        }
        
        op.stake -= amount;
        
        if (op.stake < minProviderStake) {
            op.status = OperatorStatus.SLASHED;
            _removeFromActiveList(operator);
        }
        
        // Send slashed funds to treasury (owner)
        (bool success,) = owner().call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit OperatorSlashed(operator, amount, reason);
    }

    // ============ Metrics ============

    /**
     * @notice Record sample response
     */
    function recordSampleResponse(address operator, bool success) external onlyOwner {
        DAOperator storage op = _operators[operator];
        if (op.registeredAt == 0) return;
        
        if (success) {
            op.samplesResponded++;
        } else {
            op.samplesFailed++;
        }
    }

    // ============ View Functions ============

    function getOperator(address operator) external view returns (DAOperator memory) {
        return _operators[operator];
    }

    function getActiveOperators() external view returns (address[] memory) {
        return _activeOperatorList;
    }

    function getActiveOperatorCount() external view returns (uint256) {
        return _activeOperatorList.length;
    }

    function isActive(address operator) external view returns (bool) {
        return _operators[operator].status == OperatorStatus.ACTIVE;
    }

    function getOperatorStake(address operator) external view returns (uint256) {
        return _operators[operator].stake;
    }

    function getPendingUnstake(address operator) external view returns (uint256 amount, uint256 availableAt) {
        return (
            _pendingUnstake[operator],
            _unstakeRequestTime[operator] + UNSTAKE_DELAY
        );
    }

    function getOperatorsByRegion(string calldata region) external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < _activeOperatorList.length; i++) {
            if (keccak256(bytes(_operators[_activeOperatorList[i]].region)) == keccak256(bytes(region))) {
                count++;
            }
        }
        
        address[] memory result = new address[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < _activeOperatorList.length; i++) {
            if (keccak256(bytes(_operators[_activeOperatorList[i]].region)) == keccak256(bytes(region))) {
                result[j++] = _activeOperatorList[i];
            }
        }
        
        return result;
    }

    function getTotalStake() external view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < _activeOperatorList.length; i++) {
            total += _operators[_activeOperatorList[i]].stake;
        }
        return total;
    }

    function getTotalCapacity() external view returns (uint256 totalGB, uint256 usedGB) {
        for (uint256 i = 0; i < _activeOperatorList.length; i++) {
            DAOperator storage op = _operators[_activeOperatorList[i]];
            totalGB += op.capacityGB;
            usedGB += op.usedGB;
        }
    }

    // ============ Internal ============

    function _addToActiveList(address operator) internal {
        if (_activeOperatorIndex[operator] != 0 || 
            (_activeOperatorList.length > 0 && _activeOperatorList[0] == operator)) {
            return;
        }
        
        _activeOperatorIndex[operator] = _activeOperatorList.length;
        _activeOperatorList.push(operator);
    }

    function _removeFromActiveList(address operator) internal {
        uint256 index = _activeOperatorIndex[operator];
        if (index >= _activeOperatorList.length) return;
        if (_activeOperatorList[index] != operator) return;
        
        uint256 lastIndex = _activeOperatorList.length - 1;
        if (index != lastIndex) {
            address lastOperator = _activeOperatorList[lastIndex];
            _activeOperatorList[index] = lastOperator;
            _activeOperatorIndex[lastOperator] = index;
        }
        
        _activeOperatorList.pop();
        delete _activeOperatorIndex[operator];
    }

    error InvalidEndpoint();
}

