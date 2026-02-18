// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ELIZAOS
 * @notice ERC20 token that mirrors the real $ELIZAOS token on Ethereum mainnet
 * @dev Used as the native gas token on Jeju L2 (OP Stack Custom Gas Token)
 *
 * Real token: 0xea17df5cf6d172224892b5477a16acb111182478 on Ethereum mainnet
 *
 * On L2, this token becomes the native gas token:
 * - All gas fees are paid in $ELIZAOS
 * - Users bridge $ELIZAOS from L1 to L2 via OptimismPortal
 * - Sequencer collects $ELIZAOS as revenue
 */
contract ELIZAOS is ERC20, ERC20Permit, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18; // 1 billion tokens

    // Track total minted for cap enforcement
    uint256 public totalMinted;

    // Faucet for testnet usage
    uint256 public faucetAmount = 10_000 * 10**18; // 10k tokens per claim
    uint256 public faucetCooldown = 1 hours;
    mapping(address => uint256) public lastFaucetClaim;

    event FaucetClaimed(address indexed recipient, uint256 amount);

    error ExceedsMaxSupply();
    error FaucetCooldown(uint256 nextClaimTime);

    constructor(address initialHolder)
        ERC20("ElizaOS", "ELIZAOS")
        ERC20Permit("ElizaOS")
        Ownable(initialHolder)
    {
        // Mint initial supply to holder (for distribution, liquidity, etc.)
        uint256 initialSupply = 100_000_000 * 10**18; // 100M tokens (10% of max)
        _mint(initialHolder, initialSupply);
        totalMinted = initialSupply;
    }

    /**
     * @notice Mint new tokens (owner only, respects max supply)
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        if (totalMinted + amount > MAX_SUPPLY) revert ExceedsMaxSupply();
        totalMinted += amount;
        _mint(to, amount);
    }

    /**
     * @notice Claim tokens from faucet (testnet only)
     */
    function faucet() external {
        _claimFaucet(msg.sender);
    }

    /**
     * @notice Claim tokens from faucet to specific address
     * @param recipient Address to receive tokens
     */
    function faucetTo(address recipient) external {
        _claimFaucet(recipient);
    }

    function _claimFaucet(address recipient) internal {
        uint256 nextClaim = lastFaucetClaim[recipient] + faucetCooldown;
        if (block.timestamp < nextClaim) revert FaucetCooldown(nextClaim);

        lastFaucetClaim[recipient] = block.timestamp;

        // Mint from remaining supply
        if (totalMinted + faucetAmount > MAX_SUPPLY) revert ExceedsMaxSupply();
        totalMinted += faucetAmount;
        _mint(recipient, faucetAmount);

        emit FaucetClaimed(recipient, faucetAmount);
    }

    /**
     * @notice Update faucet parameters
     * @param _amount Amount per claim
     * @param _cooldown Cooldown between claims
     */
    function setFaucetParams(uint256 _amount, uint256 _cooldown) external onlyOwner {
        faucetAmount = _amount;
        faucetCooldown = _cooldown;
    }

    /**
     * @notice Get remaining mintable supply
     */
    function remainingSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalMinted;
    }
}
