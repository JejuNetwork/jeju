// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ElizaOS Token
 * @author Jeju Network
 * @notice Standard ERC-20 token that can be used as a payment token in the Jeju ecosystem
 * @dev This is a standard ERC-20 token that receives equal treatment with all other tokens.
 *      It can be used with the paymaster system where users pay transaction fees in this token
 *      instead of ETH. The paymaster converts these tokens to ETH using liquidity provider pools.
 *
 * Security Features:
 * - Owner-controlled minting for supply management
 * - Supply cap at 10 billion tokens (10x initial supply)
 * - Standard OpenZeppelin ERC20 implementation
 * - Initial supply: 1 billion tokens
 *
 * Integration:
 * - Users must approve the paymaster contract to spend tokens
 * - Tokens are collected by paymaster after transaction execution
 * - Fees are distributed: 50% to apps, 50% to liquidity providers
 *
 * Note: This token receives no special treatment - it's equal to all other payment tokens
 */
contract ElizaOSToken is ERC20, Ownable {
    /// @notice Initial token supply (1 billion tokens with 18 decimals)
    uint256 private constant INITIAL_SUPPLY = 1_000_000_000 * 10 ** 18;

    /// @notice Maximum total supply cap (10 billion tokens with 18 decimals)
    /// @dev Prevents unlimited inflation, set at 10x initial supply for long-term growth
    uint256 public constant MAX_SUPPLY = 10_000_000_000 * 10 ** 18;

    // ============ Errors ============

    error MaxSupplyExceeded();

    /**
     * @notice Constructs the ElizaOS token and mints initial supply
     * @param initialOwner Address that will receive initial supply and minting rights
     * @dev Mints 1 billion tokens to the initial owner immediately upon deployment
     */
    constructor(address initialOwner) ERC20("ElizaOS Token", "ELIZA") Ownable(initialOwner) {
        _mint(initialOwner, INITIAL_SUPPLY);
    }

    /**
     * @notice Mints new tokens to a specified address
     * @param to Address to receive the newly minted tokens
     * @param amount Number of tokens to mint (in wei, 18 decimals)
     * @dev Only callable by contract owner. Use for treasury operations, rewards, or ecosystem growth.
     *      Enforces MAX_SUPPLY cap to prevent unlimited inflation.
     * @custom:security Minting is capped at 10 billion total supply
     */
    function mint(address to, uint256 amount) public onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) revert MaxSupplyExceeded();
        _mint(to, amount);
    }

    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
