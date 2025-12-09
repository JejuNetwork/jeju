// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockVIRTUAL
 * @notice Mock version of Virtuals Protocol token for localnet testing
 * @dev Mock token for localnet testing (0x44ff8620b8cA30902395A7bD3F2407e1A091BF73)
 *
 * Real Token Info:
 * - Name: Virtuals Protocol
 * - Symbol: VIRTUAL
 * - Price: ~$1.85
 * - Decimals: 18
 * - Network: Base
 *
 * This mock enables testing of:
 * - Paymaster gas payments in VIRTUAL
 * - LP fee distribution in VIRTUAL tokens
 * - Uniswap V4 VIRTUAL/ETH pools
 * - Bridge simulations (Ethereum → Jeju)
 */
contract MockVIRTUAL is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10 ** 18;
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 10 ** 18;

    error MaxSupplyExceeded();

    constructor(address initialOwner) ERC20("Virtuals Protocol", "VIRTUAL") Ownable(initialOwner) {
        _mint(initialOwner, INITIAL_SUPPLY);
    }

    /**
     * @notice Mint tokens (owner only, for testing)
     * @dev Respects MAX_SUPPLY cap
     */
    function mint(address to, uint256 amount) external onlyOwner {
        if (totalSupply() + amount > MAX_SUPPLY) revert MaxSupplyExceeded();
        _mint(to, amount);
    }

    /**
     * @notice Faucet for test accounts
     * @dev Gives 5000 VIRTUAL tokens (~$9,250)
     */
    function faucet() external {
        uint256 faucetAmount = 5000 * 10 ** 18;
        if (totalSupply() + faucetAmount <= MAX_SUPPLY) {
            _mint(msg.sender, faucetAmount);
        }
    }
}
