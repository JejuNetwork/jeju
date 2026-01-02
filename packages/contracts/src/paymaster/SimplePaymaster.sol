// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BasePaymaster} from "account-abstraction/core/BasePaymaster.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";

/**
 * @title SimplePaymaster
 * @notice A simple paymaster that sponsors all UserOperations
 * @dev Used for testing and development - sponsors all operations without validation
 */
contract SimplePaymaster is BasePaymaster {
    constructor(IEntryPoint _entryPoint, address _owner) BasePaymaster(_entryPoint, _owner) {}

    function _validatePaymasterUserOp(
        PackedUserOperation calldata,
        bytes32,
        uint256
    ) internal pure override returns (bytes memory context, uint256 validationData) {
        // Accept all operations with no context
        return ("", 0);
    }

    function _postOp(
        PostOpMode,
        bytes calldata,
        uint256,
        uint256
    ) internal pure override {
        // No post-op logic needed
    }
}



