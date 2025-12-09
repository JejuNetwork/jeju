// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockClankermon
 * @notice Mock version of Clankermon token for localnet testing
 * @dev Mock token for localnet testing (0x1cDbB57b12f732cFb4DC06f690ACeF476485B2a5)
 *
 * Real Token Info:
 * - Name: Clankermon
 * - Symbol: CLANKERMON
 * - Price: ~$0.15
 * - Decimals: 18
 * - Network: Base
 *
 * This mock enables testing of:
 * - Paymaster gas payments in CLANKERMON
 * - LP fee distribution in CLANKERMON tokens
 * - Uniswap V4 CLANKERMON/ETH pools
 * - Bridge simulations (Ethereum → Jeju)
 */
contract MockClankermon is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10 ** 18;
    uint256 public constant INITIAL_SUPPLY = 33_333_333 * 10 ** 18;

    error MaxSupplyExceeded();

    constructor(address initialOwner) ERC20("Clankermon", "CLANKERMON") Ownable(initialOwner) {
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
     * @dev Gives 10000 CLANKERMON tokens (~$1,500)
     */
    function faucet() external {
        uint256 faucetAmount = 10000 * 10 ** 18;
        if (totalSupply() + faucetAmount <= MAX_SUPPLY) {
            _mint(msg.sender, faucetAmount);
        }
    }
}
