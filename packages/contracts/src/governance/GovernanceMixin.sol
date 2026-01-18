// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title GovernanceMixin
 * @notice Library for governance integration
 */
library GovernanceMixin {
    struct Data {
        address governance;
        address securityBoard;
        address timelock;
        bool enabled;
    }

    event GovernanceSet(address indexed governance);
    event SecurityBoardSet(address indexed board);
    event TimelockSet(address indexed timelock);
    event GovernanceEnabledChanged(bool enabled);

    error NotGovernance();
    error NotSecurityBoard();
    error NotTimelock();

    function setGovernance(Data storage self, address addr) internal {
        self.governance = addr;
        emit GovernanceSet(addr);
    }

    function setSecurityBoard(Data storage self, address addr) internal {
        self.securityBoard = addr;
        emit SecurityBoardSet(addr);
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

    function requireSecurityBoard(Data storage self) internal view {
        if (msg.sender != self.securityBoard) revert NotSecurityBoard();
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

    function requireSecurityBoardOrOwner(Data storage self, address owner) internal view {
        if (msg.sender != self.securityBoard && msg.sender != owner) {
            revert NotSecurityBoard();
        }
    }

    function isGovernance(Data storage self) internal view returns (bool) {
        return msg.sender == self.governance || msg.sender == self.timelock;
    }

    function isSecurityBoard(Data storage self) internal view returns (bool) {
        return msg.sender == self.securityBoard;
    }

    function canExecute(Data storage self) internal view returns (bool) {
        return !self.enabled || msg.sender == self.governance || msg.sender == self.timelock;
    }
}
