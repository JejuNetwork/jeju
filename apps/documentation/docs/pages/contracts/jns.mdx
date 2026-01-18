# Jeju Name Service (JNS)

Human-readable names for addresses and agents.

## Overview

JNS provides ENS-compatible naming for Jeju. Register names like `myagent.jeju`, resolve names to addresses, enable reverse resolution (address to name), and integrate with ERC-8004 identity.

## JNSRegistry

Core registry contract.

**Location:** `src/names/JNSRegistry.sol`

Manages ownership, resolver addresses, and TTL for each name node.

## JNSResolver

Address and content resolution.

**Location:** `src/names/JNSResolver.sol`

```typescript
import { namehash } from 'viem/ens';

const node = namehash('myagent.jeju');

const address = await client.readContract({
  address: jnsResolver,
  abi: JNSResolverAbi,
  functionName: 'addr',
  args: [node],
});

const description = await client.readContract({
  address: jnsResolver,
  abi: JNSResolverAbi,
  functionName: 'text',
  args: [node, 'description'],
});
```

## JNSRegistrar

Name registration and renewal.

**Location:** `src/names/JNSRegistrar.sol`

```typescript
const available = await client.readContract({
  address: jnsRegistrar,
  abi: JNSRegistrarAbi,
  functionName: 'available',
  args: ['myagent'],
});

if (available) {
  const price = await client.readContract({
    address: jnsRegistrar,
    abi: JNSRegistrarAbi,
    functionName: 'rentPrice',
    args: ['myagent', 365n * 24n * 60n * 60n],
  });
  
  const tx = await client.writeContract({
    address: jnsRegistrar,
    abi: JNSRegistrarAbi,
    functionName: 'register',
    args: ['myagent', ownerAddress, 365n * 24n * 60n * 60n],
    value: price,
  });
}
```

## JNSReverseRegistrar

Reverse resolution (address to name).

**Location:** `src/names/JNSReverseRegistrar.sol`

```typescript
// Set reverse record for your address
const tx = await client.writeContract({
  address: jnsReverseRegistrar,
  abi: JNSReverseRegistrarAbi,
  functionName: 'setName',
  args: ['myagent.jeju'],
});
```

## ENSMirror

Mirror ENS names to JNS.

**Location:** `src/names/ENSMirror.sol`

Import ENS names to JNS with verified ENS ownership on L1. One-way sync from ENS to JNS.

## Pricing

3-character names cost 0.1 ETH per year. 4-character names cost 0.05 ETH per year. 5+ character names cost 0.01 ETH per year.

## Integration with ERC-8004 Identity

JNS integrates with IdentityRegistry. Register an agent, then set the JNS name to point to the agent. This enables discovery via `myagent.jeju`.

```typescript
const address = await publicClient.getEnsAddress({
  name: 'myagent.jeju',
  universalResolverAddress: jnsResolver,
});
```

## Deployment

```bash
cd packages/contracts

forge script script/DeployJNS.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast
```
