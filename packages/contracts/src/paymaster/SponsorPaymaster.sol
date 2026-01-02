// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

interface IEntryPointV06 {
    function depositTo(address account) external payable;
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title SponsorPaymaster
 * @notice Simple paymaster that sponsors all operations (v0.6 compatible)
 */
contract SponsorPaymaster is Ownable {
    IEntryPointV06 public immutable entryPoint;

    constructor(address _entryPoint, address _owner) Ownable(_owner) {
        entryPoint = IEntryPointV06(_entryPoint);
    }

    // v0.6 UserOperation struct
    struct UserOperation {
        address sender;
        uint256 nonce;
        bytes initCode;
        bytes callData;
        uint256 callGasLimit;
        uint256 verificationGasLimit;
        uint256 preVerificationGas;
        uint256 maxFeePerGas;
        uint256 maxPriorityFeePerGas;
        bytes paymasterAndData;
        bytes signature;
    }

    enum PostOpMode { opSucceeded, opReverted, postOpReverted }

    function validatePaymasterUserOp(
        UserOperation calldata,
        bytes32,
        uint256
    ) external pure returns (bytes memory context, uint256 validationData) {
        return ("", 0);
    }

    function postOp(PostOpMode, bytes calldata, uint256) external pure {}

    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function getDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    receive() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }
}
