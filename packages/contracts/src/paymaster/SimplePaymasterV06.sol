// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IPaymaster} from "account-abstraction/interfaces/IPaymaster.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimplePaymasterV07
 * @notice A simple paymaster that sponsors all UserOperations (v0.7 compatible)
 * @dev Renamed from SimplePaymasterV06 to reflect v0.7 interface compatibility
 */
contract SimplePaymasterV07 is IPaymaster, Ownable {
    IEntryPoint public immutable entryPoint;

    constructor(IEntryPoint _entryPoint, address _owner) Ownable(_owner) {
        entryPoint = _entryPoint;
    }

    function validatePaymasterUserOp(
        PackedUserOperation calldata,
        bytes32,
        uint256
    ) external pure override returns (bytes memory context, uint256 validationData) {
        return ("", 0);
    }

    function postOp(
        IPaymaster.PostOpMode,
        bytes calldata,
        uint256,
        uint256
    ) external pure override {
        // No post-op needed
    }

    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function withdrawTo(address payable to, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(to, amount);
    }

    function getDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    receive() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }
}

