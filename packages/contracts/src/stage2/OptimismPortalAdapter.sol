// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./GovernanceTimelock.sol";

/// @notice Adapter to integrate GovernanceTimelock with OptimismPortal for Stage 2
contract OptimismPortalAdapter {
    bytes4 private constant UPGRADE_TO = bytes4(keccak256("upgradeTo(address)"));
    bytes4 private constant UPGRADE_AND_CALL = bytes4(keccak256("upgradeToAndCall(address,bytes)"));
    bytes4 private constant SET_GAS_TOKEN = bytes4(keccak256("setGasPayingToken(address,uint8,bytes32,bytes32)"));
    bytes4 private constant PAUSE = bytes4(keccak256("pause()"));
    bytes4 private constant UNPAUSE = bytes4(keccak256("unpause()"));

    GovernanceTimelock public immutable governanceTimelock;
    address public optimismPortal;
    address public securityCouncil;
    bool public isPaused;

    event PortalUpdated(address indexed oldPortal, address indexed newPortal);
    event PauseToggled(bool isPaused);
    event SecurityCouncilUpdated(address indexed oldCouncil, address indexed newCouncil);

    error NotGovernanceTimelock();
    error NotSecurityCouncil();
    error PortalNotSet();
    error InvalidAddress();
    error CallFailed();

    modifier onlyGovernanceTimelock() {
        if (msg.sender != address(governanceTimelock)) revert NotGovernanceTimelock();
        _;
    }

    modifier onlySecurityCouncil() {
        if (msg.sender != securityCouncil) revert NotSecurityCouncil();
        _;
    }

    modifier whenPortalSet() {
        if (optimismPortal == address(0)) revert PortalNotSet();
        _;
    }

    constructor(address _governanceTimelock, address _securityCouncil) {
        governanceTimelock = GovernanceTimelock(_governanceTimelock);
        securityCouncil = _securityCouncil;
    }

    function setPortal(address _portal) external onlyGovernanceTimelock {
        if (_portal == address(0)) revert InvalidAddress();
        emit PortalUpdated(optimismPortal, _portal);
        optimismPortal = _portal;
    }

    function executeUpgrade(bytes calldata data) external onlyGovernanceTimelock whenPortalSet {
        (bool success,) = optimismPortal.call(data);
        if (!success) revert CallFailed();
    }

    function setSecurityCouncil(address _newCouncil) external onlyGovernanceTimelock {
        if (_newCouncil == address(0)) revert InvalidAddress();
        emit SecurityCouncilUpdated(securityCouncil, _newCouncil);
        securityCouncil = _newCouncil;
    }

    function pause() external onlySecurityCouncil whenPortalSet {
        isPaused = true;
        (bool success,) = optimismPortal.call(abi.encodeWithSelector(PAUSE));
        if (!success) revert CallFailed();
        emit PauseToggled(true);
    }

    function unpause() external onlyGovernanceTimelock whenPortalSet {
        isPaused = false;
        (bool success,) = optimismPortal.call(abi.encodeWithSelector(UNPAUSE));
        if (!success) revert CallFailed();
        emit PauseToggled(false);
    }

    function requiresTimelock(bytes4 selector) external pure returns (bool) {
        if (selector == UPGRADE_TO || selector == UPGRADE_AND_CALL || selector == SET_GAS_TOKEN || selector == UNPAUSE)
        {
            return true;
        }
        if (selector == PAUSE) return false;
        return true;
    }

    function getStatus() external view returns (address portal, bool paused, uint256 timelockDelay) {
        return (optimismPortal, isPaused, governanceTimelock.timelockDelay());
    }
}
