// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IProver {
    function verifyProof(bytes32 stateRoot, bytes32 claimRoot, bytes calldata proof)
        external
        view
        returns (bool valid);
    function verifyDefenseProof(bytes32 stateRoot, bytes32 claimRoot, bytes calldata defenseProof)
        external
        view
        returns (bool valid);
    function proverType() external pure returns (string memory proverType);
}
