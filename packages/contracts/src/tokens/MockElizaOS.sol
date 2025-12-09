// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockElizaOS
 * @notice Mock version of elizaOS Token for localnet L1/L2 testing
 * @dev Treated EXACTLY like other protocol tokens (CLANKER, VIRTUAL, CLANKERMON)
 *
 * Token Info:
 * - Name: elizaOS Token
 * - Symbol: elizaOS
 * - Price: ~$0.10
 * - Max Supply: 10,000,000,000 tokens
 * - Initial Supply: 1,000,000,000 tokens
 * - Decimals: 18
 *
 * Deployment Flow:
 * 1. Deploy on L1 (localnet Geth)
 * 2. Bridge to L2 (localnet Jeju) via Standard Bridge
 * 3. Deploy paymaster on L2
 * 4. Initialize LP pools on L2
 * 5. Distribute to test wallets
 *
 * This ensures elizaOS is treated IDENTICALLY to CLANKER, VIRTUAL, etc.
 * No special privileges. No hardcoded preferences. Equal treatment.
 */
contract MockElizaOS is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 10_000_000_000 * 10 ** 18;
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 * 10 ** 18;

    error MaxSupplyExceeded();

    constructor(address initialOwner) ERC20("elizaOS Token", "elizaOS") Ownable(initialOwner) {
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
     * @dev Gives 100,000 elizaOS tokens (~$10,000)
     */
    function faucet() external {
        uint256 faucetAmount = 100_000 * 10 ** 18;
        if (totalSupply() + faucetAmount <= MAX_SUPPLY) {
            _mint(msg.sender, faucetAmount);
        }
    }

    /**
     * @notice Burn tokens
     * @dev Anyone can burn their own tokens
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
