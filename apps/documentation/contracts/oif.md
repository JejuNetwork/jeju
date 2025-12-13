# Open Intents Framework (OIF)

Cross-chain intent system compatible with ERC-7683.

## Overview

OIF enables users to express intents on any supported chain and have solvers fulfill them on Jeju. A user on Base creates an intent, a solver fills it on Jeju, an oracle verifies the source, and settlement occurs.

## Architecture

On the source chain, **InputSettler** locks funds and creates intents. On the destination chain (Jeju), **OutputSettler** fills orders and verifies the source. The **OracleAdapter** provides cross-chain attestation. The **SolverRegistry** handles solver registration, staking, and slashing.

## InputSettler

Deployed on source chains. Handles intent creation and fund locking.

**Location:** `src/oif/InputSettler.sol`

Each intent contains the user address, input token and amount, output chain ID, output token and minimum amount, recipient address, deadline timestamp, and intent hash.

```typescript
import { InputSettlerAbi } from '@jejunetwork/contracts';

// On Base Sepolia
const tx = await client.writeContract({
  address: inputSettlerAddress,
  abi: InputSettlerAbi,
  functionName: 'createIntent',
  args: [
    usdcAddress,
    parseUnits('100', 6),
    420691n,
    jejuUsdcAddress,
    parseUnits('99', 6),
    recipientAddress,
    deadline,
  ],
});
```

## OutputSettler

Deployed on Jeju. Handles solver fills and settlement.

**Location:** `src/oif/OutputSettler.sol`

```typescript
import { OutputSettlerAbi } from '@jejunetwork/contracts';

// Solver fills on Jeju
const tx = await client.writeContract({
  address: outputSettlerAddress,
  abi: OutputSettlerAbi,
  functionName: 'fillIntent',
  args: [intentHash, outputTokenAddress, outputAmount, recipientAddress],
});
```

## SolverRegistry

Registration and staking for solvers.

**Location:** `src/oif/SolverRegistry.sol`

```bash
# Register as solver (requires 0.5 ETH stake)
cast send $SOLVER_REGISTRY "register(uint256[])" "[420691,84532]" \
  --value 0.5ether \
  --rpc-url $RPC_URL \
  --private-key $PK
```

See [Become a Solver Guide](/guides/become-solver) for the full process.

## OracleAdapter

Cross-chain attestation for settlement.

**Location:** `src/oif/OracleAdapter.sol`

The OracleAdapter verifies intent creation on the source chain via Hyperlane or other messaging. Multi-oracle support provides redundancy.

## Intent Lifecycle

1. **Creation**: User calls `InputSettler.createIntent()` on source chain
2. **Discovery**: Solvers monitor via Indexer/WebSocket
3. **Fill**: Solver calls `OutputSettler.fillIntent()` on Jeju
4. **Attestation**: Oracle verifies source chain state
5. **Settlement**: Solver calls `claimSettlement()` to get funds from InputSettler

## Supported Chains

Jeju Mainnet (420691) and Jeju Testnet (420690) support both InputSettler and OutputSettler. Base Sepolia (84532) and Ethereum Sepolia (11155111) support InputSettler only (source chains).

## Deployment

```bash
cd packages/contracts

forge script script/DeployOIF.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast

# Testnet with verification
PRIVATE_KEY=$DEPLOYER_PRIVATE_KEY forge script script/DeployOIF.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast --verify
```

## Fees

The protocol fee is 0.1% going to the protocol treasury. Solver fees are variable from the spread. Oracle fees are 0.01% going to oracle operators.
