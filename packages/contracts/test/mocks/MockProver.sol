// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../../src/dispute/provers/IProver.sol";

/// @title MockProver
/// @notice Simple mock prover for testing - returns configurable results
contract MockProver is IProver {
    bool public shouldVerifyFraud = true;
    bool public shouldVerifyDefense = true;

    function setVerifyFraud(bool _should) external {
        shouldVerifyFraud = _should;
    }

    function setVerifyDefense(bool _should) external {
        shouldVerifyDefense = _should;
    }

    function verifyProof(bytes32, bytes32, bytes calldata) external view override returns (bool) {
        return shouldVerifyFraud;
    }

    function verifyDefenseProof(bytes32, bytes32, bytes calldata) external view override returns (bool) {
        return shouldVerifyDefense;
    }

    function proverType() external pure override returns (string memory) {
        return "MOCK_PROVER";
    }
}
