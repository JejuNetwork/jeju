// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MockERC20} from "./MockERC20.sol";

contract FeeToken is MockERC20 {
    constructor(uint256 initialSupply) MockERC20("Fee Token", "FEE", 18, initialSupply) {}

    function transfer(address to, uint256 amount) public override returns (bool) {
        uint256 fee = amount / 100; // 1% fee
        uint256 net = amount - fee;
        super.transfer(to, net);
        // Burn fee
        _burn(msg.sender, fee);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 fee = amount / 100; // 1% fee
        uint256 net = amount - fee;

        // Consume full allowance
        uint256 currentAllowance = allowance(from, msg.sender);
        require(currentAllowance >= amount, "ERC20: transfer amount exceeds allowance");
        _approve(from, msg.sender, currentAllowance - amount);

        _transfer(from, to, net);
        _burn(from, fee);
        return true;
    }
}
