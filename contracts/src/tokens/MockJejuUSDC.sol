// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockJejuUSDC
 * @notice Mock USDC for localnet L1/L2 testing
 * @dev Simplified version of JejuUSDC for testing - treated like any other protocol token
 * 
 * Token Info:
 * - Name: USD Coin
 * - Symbol: USDC
 * - Price: $1.00 (stable)
 * - Decimals: 6 (matching real USDC)
 * - Max Supply: Unlimited (stablecoin)
 * 
 * Deployment Flow:
 * 1. Deploy on L1 (localnet)
 * 2. Bridge to L2 via Standard Bridge
 * 3. Deploy paymaster on L2
 * 4. Initialize LP pools
 * 5. Distribute to test wallets
 * 
 * Treated identically to CLANKER, VIRTUAL, elizaOS.
 * No special privileges.
 */
contract MockJejuUSDC is ERC20, Ownable {
    uint8 private constant DECIMALS = 6;
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 10**DECIMALS; // 100M USDC

    constructor(address initialOwner) ERC20("USD Coin", "USDC") Ownable(initialOwner) {
        _mint(initialOwner, INITIAL_SUPPLY);
    }

    /**
     * @notice Override decimals to return 6 (USDC standard)
     */
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /**
     * @notice Mint tokens (owner only, for testing)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Faucet for test accounts
     * @dev Gives 100,000 USDC
     */
    function faucet() external {
        uint256 faucetAmount = 100_000 * 10**DECIMALS;
        _mint(msg.sender, faucetAmount);
    }
    
    /**
     * @notice Burn tokens
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}

