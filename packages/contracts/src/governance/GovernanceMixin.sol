// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title GovernanceMixin
 * @notice Library for governance integration
 */
library GovernanceMixin {
    struct Data {
        address governance;
        address securityCouncil;
        address timelock;
        bool enabled;
    }

    event GovernanceSet(address indexed governance);
    event SecurityCouncilSet(address indexed council);
    event TimelockSet(address indexed timelock);
    event GovernanceEnabledChanged(bool enabled);

    error NotGovernance();
    error NotSecurityCouncil();
    error NotTimelock();

    function setGovernance(Data storage self, address addr) internal {
        self.governance = addr;
        emit GovernanceSet(addr);
    }

    function setSecurityCouncil(Data storage self, address addr) internal {
        self.securityCouncil = addr;
        emit SecurityCouncilSet(addr);
    }

    function setTimelock(Data storage self, address addr) internal {
        self.timelock = addr;
        emit TimelockSet(addr);
    }

    function setEnabled(Data storage self, bool enabled) internal {
        self.enabled = enabled;
        emit GovernanceEnabledChanged(enabled);
    }

    function requireGovernance(Data storage self) internal view {
        if (self.enabled && msg.sender != self.governance && msg.sender != self.timelock) {
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
        if (self.enabled) {
            if (msg.sender != self.governance && msg.sender != self.timelock && msg.sender != owner) {
                revert NotGovernance();
            }
        } else if (msg.sender != owner) {
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

    function canExecute(Data storage self) internal view returns (bool) {
        return !self.enabled || msg.sender == self.governance || msg.sender == self.timelock;
    }
}
