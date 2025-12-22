// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {EIP3009Token} from "./EIP3009Token.sol";

/**
 * @title NetworkUSDC
 * @notice Test USDC token with EIP-3009 support for localnet
 * @dev Deployed on localnet for testing x402 payments and gasless transfers
 */
contract NetworkUSDC is EIP3009Token {
    bool public immutable mintable;

    constructor(address owner_, uint256 initialSupply_, bool mintable_)
        EIP3009Token("USD Coin", "USDC", 6, owner_)
    {
        mintable = mintable_;
        if (initialSupply_ > 0) {
            _mint(owner_, initialSupply_);
        }
    }

    function mint(address to, uint256 amount) external override onlyOwner {
        require(mintable, "NetworkUSDC: not mintable");
        _mint(to, amount);
    }
}
