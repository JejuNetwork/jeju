// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockCLANKER
 * @notice Mock version of CLANKER (tokenbot) for localnet testing
 * @dev Mock token for localnet testing (0x1bc0c42215582d5a085795f4badbac3ff36d1bcb)
 *
 * Real Token Info:
 * - Name: tokenbot
 * - Symbol: CLANKER
 * - Price: ~$26.14
 * - Max Supply: 1,000,000 tokens
 * - Decimals: 18
 * - Network: Base
 *
 * This mock enables testing of:
 * - Paymaster gas payments in CLANKER
 * - LP fee distribution in CLANKER tokens
 * - Uniswap V4 CLANKER/ETH pools
 * - Bridge simulations (Ethereum → Jeju)
 */
contract MockCLANKER is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10 ** 18;
    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10 ** 18;

    error MaxSupplyExceeded();

    constructor(address initialOwner) ERC20("tokenbot", "CLANKER") Ownable(initialOwner) {
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
     * @dev Gives 1000 CLANKER tokens (~$26,140)
     */
    function faucet() external {
        uint256 faucetAmount = 1000 * 10 ** 18;
        if (totalSupply() + faucetAmount <= MAX_SUPPLY) {
            _mint(msg.sender, faucetAmount);
        }
    }
}
