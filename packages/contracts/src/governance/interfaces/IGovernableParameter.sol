// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IGovernableParameter
 * @notice Interface for contracts with governance-controlled parameters
 * @dev Implement this interface to allow governance proposals to modify parameters
 *
 * Pattern:
 * 1. Contract implements IGovernableParameter
 * 2. Governance creates proposal with parameter change
 * 3. After voting/timelock, governance calls setParameter()
 * 4. Contract validates and applies the change
 *
 * Benefits:
 * - Standardized parameter governance across all contracts
 * - Type-safe parameter encoding
 * - Introspection of governable parameters
 * - Audit trail via events
 */
interface IGovernableParameter {
    /**
     * @notice Describes a governable parameter
     */
    struct ParameterInfo {
        bytes32 id; // Unique parameter identifier
        string name; // Human-readable name
        string description; // Description of what it controls
        ParameterType pType; // Type of the parameter
        uint256 minValue; // Minimum allowed value (for numeric types)
        uint256 maxValue; // Maximum allowed value (for numeric types)
        uint256 currentValue; // Current value (encoded as uint256)
        bool requiresTimelock; // Whether changes require timelock
    }

    enum ParameterType {
        UINT256,
        BOOL,
        ADDRESS,
        BYTES32
    }

    /**
     * @notice Emitted when a parameter is updated via governance
     */
    event ParameterUpdated(bytes32 indexed parameterId, uint256 oldValue, uint256 newValue, address indexed updatedBy);

    /**
     * @notice Get all governable parameters for this contract
     * @return Array of parameter info structs
     */
    function getGovernableParameters() external view returns (ParameterInfo[] memory);

    /**
     * @notice Get info about a specific parameter
     * @param parameterId The parameter identifier
     * @return Parameter info struct
     */
    function getParameterInfo(bytes32 parameterId) external view returns (ParameterInfo memory);

    /**
     * @notice Get current value of a parameter
     * @param parameterId The parameter identifier
     * @return Current value encoded as bytes
     */
    function getParameter(bytes32 parameterId) external view returns (bytes memory);

    /**
     * @notice Set a parameter value (called by governance)
     * @param parameterId The parameter identifier
     * @param value New value encoded as bytes
     * @return success Whether the update was successful
     */
    function setParameter(bytes32 parameterId, bytes calldata value) external returns (bool success);

    /**
     * @notice Check if an address is authorized to change parameters
     * @param account Address to check
     * @return Whether the address can change parameters
     */
    function isGovernor(address account) external view returns (bool);
}

/**
 * @title GovernableParameterBase
 * @notice Base implementation of IGovernableParameter
 * @dev Extend this contract to add governance to your parameters
 */
abstract contract GovernableParameterBase is IGovernableParameter {
    mapping(bytes32 => ParameterInfo) internal _parameters;
    bytes32[] internal _parameterIds;

    address public governance;
    address public pendingGovernance;

    error OnlyGovernance();
    error InvalidParameter();
    error ValueOutOfRange();
    error InvalidType();

    modifier onlyGovernance() {
        if (msg.sender != governance) revert OnlyGovernance();
        _;
    }

    constructor(address _governance) {
        governance = _governance;
    }

    /**
     * @notice Register a new governable parameter
     * @dev Call this in constructor to define parameters
     */
    function _registerParameter(
        bytes32 id,
        string memory name,
        string memory description,
        ParameterType pType,
        uint256 minValue,
        uint256 maxValue,
        uint256 currentValue,
        bool requiresTimelock
    ) internal {
        _parameters[id] = ParameterInfo({
            id: id,
            name: name,
            description: description,
            pType: pType,
            minValue: minValue,
            maxValue: maxValue,
            currentValue: currentValue,
            requiresTimelock: requiresTimelock
        });
        _parameterIds.push(id);
    }

    function getGovernableParameters() external view override returns (ParameterInfo[] memory) {
        ParameterInfo[] memory params = new ParameterInfo[](_parameterIds.length);
        for (uint256 i = 0; i < _parameterIds.length; i++) {
            params[i] = _parameters[_parameterIds[i]];
        }
        return params;
    }

    function getParameterInfo(bytes32 parameterId) external view override returns (ParameterInfo memory) {
        return _parameters[parameterId];
    }

    function getParameter(bytes32 parameterId) external view virtual override returns (bytes memory) {
        return abi.encode(_parameters[parameterId].currentValue);
    }

    function setParameter(bytes32 parameterId, bytes calldata value) external override onlyGovernance returns (bool) {
        ParameterInfo storage param = _parameters[parameterId];
        if (param.id == bytes32(0)) revert InvalidParameter();

        uint256 newValue = abi.decode(value, (uint256));

        if (param.pType == ParameterType.UINT256) {
            if (newValue < param.minValue || newValue > param.maxValue) revert ValueOutOfRange();
        }

        uint256 oldValue = param.currentValue;
        param.currentValue = newValue;

        // Apply the change to the actual contract state
        _applyParameter(parameterId, oldValue, newValue);

        emit ParameterUpdated(parameterId, oldValue, newValue, msg.sender);
        return true;
    }

    /**
     * @notice Apply parameter change to contract state
     * @dev Override this to actually apply the parameter change
     */
    function _applyParameter(bytes32 parameterId, uint256 oldValue, uint256 newValue) internal virtual;

    function isGovernor(address account) external view override returns (bool) {
        return account == governance;
    }

    /**
     * @notice Transfer governance to a new address (2-step)
     */
    function transferGovernance(address newGovernance) external onlyGovernance {
        pendingGovernance = newGovernance;
    }

    /**
     * @notice Accept governance transfer
     */
    function acceptGovernance() external {
        require(msg.sender == pendingGovernance, "Not pending governance");
        governance = pendingGovernance;
        pendingGovernance = address(0);
    }
}
