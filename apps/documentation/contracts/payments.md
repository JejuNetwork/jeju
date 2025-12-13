# Payments & Paymasters

ERC-4337 account abstraction for gasless and multi-token transactions.

## Overview

Jeju uses ERC-4337 paymasters to enable gasless transactions where gas is sponsored for users, multi-token gas payment in JEJU, USDC, or any registered token, and app-specific sponsorship where apps can sponsor user transactions.

## MultiTokenPaymaster

Main paymaster supporting multiple tokens for gas payment.

**Location:** `src/paymaster/MultiTokenPaymaster.sol`

The MultiTokenPaymaster accepts any registered token for gas payment, integrates with Chainlink oracles for pricing, supports configurable fee margins, and handles deposit/withdraw for paymaster operators.

```typescript
import { encodeFunctionData } from 'viem';

const userOp = {
  sender: smartWalletAddress,
  callData: encodeFunctionData({
    abi: SomeContractAbi,
    functionName: 'someFunction',
    args: [arg1, arg2],
  }),
  paymasterAndData: encodePaymasterData(
    paymasterAddress,
    tokenAddress,
    maxTokenAmount
  ),
};

const hash = await bundler.sendUserOperation(userOp);
```

## PaymasterFactory

Deploy new paymaster instances.

**Location:** `src/paymaster/PaymasterFactory.sol`

The factory creates sponsored paymasters for apps and multi-token paymasters with consistent configuration across instances.

## SponsoredPaymaster

Sponsor gas for specific contracts or users.

**Location:** `src/paymaster/SponsoredPaymaster.sol`

SponsoredPaymaster allows whitelisting contracts for sponsorship, whitelisting users for sponsorship, rate limiting per user, and deposit management.

```typescript
const paymaster = await factory.createSponsoredPaymaster(
  appAddress,
  [gameContract, marketplaceContract]
);

await paymaster.deposit({ value: parseEther('1') });
// Users can now interact with sponsored contracts without gas
```

## AppTokenPreference

Let apps set preferred tokens for their users.

**Location:** `src/paymaster/AppTokenPreference.sol`

Apps can configure a default payment token, users can override preferences, and the system falls back to ETH if the token is unavailable.

## TokenRegistry

Registry of tokens approved for paymaster usage. See [Tokens](/contracts/tokens) for details.

## x402 Facilitator

HTTP payment verification and settlement for the x402 protocol.

**Location:** `src/x402/X402Facilitator.sol`

The Facilitator verifies EIP-712 payment signatures, settles payments on-chain, collects protocol fees, and supports multiple networks. See [x402 API Reference](/api-reference/x402) for details.

## Payment Flow

When a user creates a UserOperation with paymaster data, the Bundler calls EntryPoint.handleOps(). The EntryPoint calls Paymaster.validatePaymasterUserOp(). The Paymaster checks the token balance and oracle price, then calculates and reserves the fee. After the transaction executes, the Paymaster transfers tokens from the user and refunds any excess.

## Deployment

```bash
cd packages/contracts

forge script script/DeployMultiTokenSystem.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast
```

## Constants

EntryPoint v0.6 is at `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`. EntryPoint v0.7 is at `0x0000000071727De22E5E9d8BAf0edAc6f37da032`. These addresses are the same across all EVM chains.
