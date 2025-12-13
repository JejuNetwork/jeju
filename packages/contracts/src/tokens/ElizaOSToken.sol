// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IPaymentToken.sol";

/**
 * @title ElizaOS Token
 * @author Jeju Network
 * @notice ERC-20 payment token - default implementation of IPaymentToken
 * @dev This is the default payment token for Jeju Network. Any ERC-20 token
 *      can be used by configuring the payment token address in deployments.
 *
 * NOTE: This is the vendor-default token. For custom deployments, you can:
 * 1. Use any existing ERC-20 token (configure address in deployment)
 * 2. Deploy your own token implementing IPaymentToken
 * 3. Use this token as-is for standard Jeju deployments
 *
 * The token is used for:
 * - Service payments (via CreditManager)
 * - Staking (via NodeStakingManager)
 * - Prediction markets (via Predimarket)
 * - Liquidity provision (via LiquidityVault)
 */
contract ElizaOSToken is IPaymentToken, ERC20, Ownable {
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

    function version() external pure override returns (string memory) {
        return "1.0.0";
    }
}
