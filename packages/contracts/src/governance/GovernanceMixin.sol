// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title GovernanceMixin
 * @notice Library for standardized governance integration across contracts
 */
library GovernanceMixin {
    struct Data {
        address governance;
        address securityCouncil;
        address timelock;
        bool governanceEnabled;
    }

    event GovernanceSet(address indexed governance);
    event SecurityCouncilSet(address indexed securityCouncil);
    event TimelockSet(address indexed timelock);
    event GovernanceEnabledChanged(bool enabled);

    error NotGovernance();
    error NotSecurityCouncil();
    error NotTimelock();
    error GovernanceNotEnabled();
    error ZeroAddress();

    function setGovernance(Data storage self, address _governance) internal {
        self.governance = _governance;
        emit GovernanceSet(_governance);
    }

    function setSecurityCouncil(Data storage self, address _securityCouncil) internal {
        self.securityCouncil = _securityCouncil;
        emit SecurityCouncilSet(_securityCouncil);
    }

    function setTimelock(Data storage self, address _timelock) internal {
        self.timelock = _timelock;
        emit TimelockSet(_timelock);
    }

    function setGovernanceEnabled(Data storage self, bool enabled) internal {
        self.governanceEnabled = enabled;
        emit GovernanceEnabledChanged(enabled);
    }

    function requireGovernance(Data storage self) internal view {
        if (!self.governanceEnabled) return;
        if (msg.sender != self.governance && msg.sender != self.timelock) {
            revert NotGovernance();
        }
    }

    function requireSecurityCouncil(Data storage self) internal view {
        if (msg.sender != self.securityCouncil) revert NotSecurityCouncil();
    }

    function requireTimelock(Data storage self) internal view {
        if (msg.sender != self.timelock) revert NotTimelock();
    }

    function requireGovernanceOrOwner(Data storage self, address owner) internal view {
        if (!self.governanceEnabled) {
            if (msg.sender != owner) revert NotGovernance();
            return;
        }
        if (msg.sender != self.governance && msg.sender != self.timelock && msg.sender != owner) {
            revert NotGovernance();
        }
    }

    function requireSecurityCouncilOrOwner(Data storage self, address owner) internal view {
        if (msg.sender != self.securityCouncil && msg.sender != owner) {
            revert NotSecurityCouncil();
        }
    }

    function isGovernance(Data storage self) internal view returns (bool) {
        return msg.sender == self.governance || msg.sender == self.timelock;
    }

    function isSecurityCouncil(Data storage self) internal view returns (bool) {
        return msg.sender == self.securityCouncil;
    }

    function canExecuteGovernanceAction(Data storage self) internal view returns (bool) {
        if (!self.governanceEnabled) return true;
        return msg.sender == self.governance || msg.sender == self.timelock;
    }
}
