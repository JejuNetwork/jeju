// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MockERC20} from "./MockERC20.sol";

contract ReentrantToken is MockERC20 {
    address public target;
    bytes public callData;
    bool public attack;

    constructor() MockERC20("Reentrant", "RE", 18, 1000000e18) {}

    function setAttack(address _target, bytes memory _callData) external {
        target = _target;
        callData = _callData;
        attack = true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (attack && msg.sender == target) {
            attack = false; // Prevent infinite loop
            (bool success,) = target.call(callData);
            require(success, "Reentry failed");
        }
        return super.transferFrom(from, to, amount);
    }
}
