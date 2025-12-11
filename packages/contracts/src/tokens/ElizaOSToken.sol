// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ElizaOS Token
 * @notice ERC-20 payment token
 */
contract ElizaOSToken is ERC20, Ownable {
    uint256 private constant INITIAL_SUPPLY = 1_000_000_000 * 10 ** 18;
    uint256 public constant MAX_SUPPLY = 10_000_000_000 * 10 ** 18;

    // ============ Errors ============

    error MaxSupplyExceeded();

    constructor(address initialOwner) ERC20("ElizaOS Token", "ELIZA") Ownable(initialOwner) {
        _mint(initialOwner, INITIAL_SUPPLY);
    }

    function mint(address to, uint256 amount) public onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) revert MaxSupplyExceeded();
        _mint(to, amount);
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
