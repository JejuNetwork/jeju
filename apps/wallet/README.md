# Jeju Wallet

**Agentic multi-chain wallet with seamless cross-chain UX.**

No chain switching. No manual bridging. Pay gas with any token. Account abstraction first.

## Features

- **Bridgeless Cross-Chain Transfers** - Use EIL (Ethereum Interop Layer) for trustless atomic swaps
- **Intent-Based Transactions** - Express what you want via OIF (Open Intents Framework), solvers handle the rest
- **Multi-Token Gas Payment** - Pay gas in USDC, DAI, or any supported token
- **Account Abstraction (ERC-4337)** - Smart accounts with gasless transactions, batching, recovery
- **Unified Balance View** - See all assets across all chains in one place
- **Auto Network Detection** - Automatically connect to the right chain for dApps

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Jeju Wallet                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   React UI  │  │  Tauri/Cap  │  │  Extension  │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          │                                  │
│  ┌───────────────────────┴───────────────────────┐         │
│  │              Wallet Core SDK                   │         │
│  ├───────────────────────────────────────────────┤         │
│  │  ┌─────────┐  ┌─────────┐  ┌──────────────┐  │         │
│  │  │   EIL   │  │   OIF   │  │      AA      │  │         │
│  │  │ Client  │  │ Client  │  │    Client    │  │         │
│  │  └────┬────┘  └────┬────┘  └──────┬───────┘  │         │
│  │       │            │              │          │         │
│  │  ┌────┴────────────┴──────────────┴────┐     │         │
│  │  │        Gas Abstraction Layer        │     │         │
│  │  └─────────────────────────────────────┘     │         │
│  └───────────────────────────────────────────────┘         │
│                          │                                  │
├──────────────────────────┼──────────────────────────────────┤
│                          ▼                                  │
│  ┌───────────────────────────────────────────────┐         │
│  │           Jeju Network Contracts               │         │
│  ├───────────────────────────────────────────────┤         │
│  │  CrossChainPaymaster │ InputSettler │ EntryPoint        │
│  │  L1StakeManager      │ OutputSettler│ Bundler           │
│  └───────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
bun install

# Run development server
bun run dev

# Build for production
bun run build
```

## Forking Rabby Wallet

This wallet is designed to be forked from [RabbyHub/Rabby](https://github.com/RabbyHub/Rabby). Here's the integration guide:

### Step 1: Clone Rabby

```bash
git clone https://github.com/RabbyHub/Rabby.git
cd Rabby
```

### Step 2: Install Jeju SDK

```bash
# Copy the SDK from this project
cp -r /path/to/jeju/apps/wallet/src/sdk ./src/jeju-sdk

# Or install as package
bun add @jejunetwork/contracts
```

### Step 3: Integrate EIL for Cross-Chain

Replace Rabby's bridge functionality with EIL:

```typescript
// src/background/service/cross-chain.ts
import { EILClient } from '../jeju-sdk/eil';

export class CrossChainService {
  private eilClient: EILClient;

  async transfer(params: CrossChainParams) {
    // EIL handles atomic swaps - no manual bridging
    return this.eilClient.createCrossChainTransfer({
      sourceToken: params.token,
      amount: params.amount,
      destinationToken: params.destToken,
      destinationChainId: params.destChain,
      recipient: params.recipient,
    });
  }
}
```

### Step 4: Add OIF Intent Support

```typescript
// src/background/service/intent.ts
import { OIFClient } from '../jeju-sdk/oif';

export class IntentService {
  private oifClient: OIFClient;

  async submitIntent(params: IntentParams) {
    // Get quote from solver network
    const quote = await this.oifClient.getQuote(params);
    
    // User reviews quote, then submit
    return this.oifClient.createIntent(params);
  }
}
```

### Step 5: Enable Multi-Token Gas

```typescript
// src/background/controller/wallet.ts
import { createGasService } from '../jeju-sdk/gas-abstraction';

// In transaction signing flow
async signTransaction(tx: Transaction, gasToken?: Address) {
  const gasService = createGasService(config);
  
  if (gasToken) {
    // Pay gas with selected token via paymaster
    const paymasterData = gasService.buildPaymasterData(chainId, gasToken);
    tx.paymasterAndData = paymasterData;
  }
  
  return this.sign(tx);
}
```

### Step 6: Integrate Account Abstraction

```typescript
// src/background/service/smart-account.ts
import { AAClient } from '../jeju-sdk/account-abstraction';

export class SmartAccountService {
  private aaClient: AAClient;

  async execute(calls: Call[]) {
    // Build UserOperation
    const userOp = await this.aaClient.buildUserOp({
      sender: this.smartAccountAddress,
      calls,
    });

    // Sign and send via bundler
    const signedOp = await this.aaClient.signUserOp(userOp);
    return this.aaClient.sendUserOp(signedOp);
  }
}
```

## Key Integration Points

### 1. Automatic Chain Detection

Rabby already has excellent multi-chain support. Enhance it with EIL awareness:

```typescript
// When user visits a dApp on chain X but has funds on chain Y
const hasBalanceOnRequestedChain = await checkBalance(chainId, token);

if (!hasBalanceOnRequestedChain) {
  // Suggest cross-chain transfer via EIL
  const transferCost = await eilClient.getCurrentFee(requestId);
  showCrossChainPrompt({ from: userChain, to: chainId, fee: transferCost });
}
```

### 2. Gas Token Selection

Add UI for selecting gas payment token:

```typescript
// components/GasTokenSelector.tsx
function GasTokenSelector({ gasOptions, onSelect }) {
  return (
    <Select onChange={onSelect}>
      {gasOptions.map(option => (
        <Option key={option.token.address} value={option.token.address}>
          Pay with {option.token.symbol} (~${option.usdValue.toFixed(2)})
        </Option>
      ))}
    </Select>
  );
}
```

### 3. Transaction Simulation

Rabby's transaction simulation is excellent. Extend it for cross-chain:

```typescript
// Simulate full cross-chain path
const simulation = await simulateCrossChain({
  sourceChain: tx.sourceChainId,
  destChain: tx.destChainId,
  actions: tx.steps,
});

showSimulationResult({
  ...simulation,
  totalFees: calculateTotalFees(simulation),
  estimatedTime: estimateCompletionTime(simulation),
});
```

## Contract Integration

The wallet integrates with these Jeju contracts:

| Contract | Purpose |
|----------|---------|
| `CrossChainPaymaster` | Multi-token gas payment, EIL voucher system |
| `L1StakeManager` | XLP stake verification for cross-chain security |
| `InputSettler` | OIF intent submission on source chain |
| `OutputSettler` | OIF intent fulfillment on destination chain |
| `SolverRegistry` | Active solver discovery |
| `EntryPoint` | ERC-4337 account abstraction |

## Desktop (Tauri) Build

```bash
# Install Tauri CLI
bun add -d @tauri-apps/cli

# Initialize Tauri
bun tauri init

# Development
bun tauri dev

# Production build
bun tauri build
```

## Mobile (Capacitor) Build

```bash
# Install Capacitor
bun add @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android

# Initialize
bunx cap init "Jeju Wallet" network.jeju.wallet

# Add platforms
bunx cap add ios
bunx cap add android

# Build and sync
bun run build
bunx cap sync

# Run on device
bunx cap run ios
bunx cap run android
```

## Solana Support (Future)

The SDK is designed to support Solana. Integration requires:

1. Add `@solana/web3.js` for Solana interactions
2. Implement Solana account management (ed25519 keys)
3. Create Solana transaction builder
4. Bridge EVM <-> Solana via Wormhole or similar

```typescript
// Future: Solana integration
import { Connection, PublicKey } from '@solana/web3.js';

class SolanaProvider {
  async getBalance(publicKey: string): Promise<number> {
    const connection = new Connection(rpcUrl);
    return connection.getBalance(new PublicKey(publicKey));
  }
}
```

## Testing

```bash
# Unit tests
bun test

# E2E tests with Synpress
bun run test:e2e
```

## Security Considerations

1. **Key Storage**: Use platform-specific secure storage (Keychain on iOS, Keystore on Android, OS keyring on desktop)
2. **Transaction Simulation**: Always simulate before sending
3. **Cross-Chain Verification**: Verify oracle attestations for OIF
4. **Paymaster Trust**: Only use verified paymasters from Jeju's registry
5. **Smart Account Recovery**: Implement social recovery for smart accounts

## Related Projects

- [RabbyHub/Rabby](https://github.com/RabbyHub/Rabby) - Base wallet to fork
- [eth-infinitism/account-abstraction](https://github.com/eth-infinitism/account-abstraction) - ERC-4337 reference
- [Uniswap/UniswapX](https://github.com/Uniswap/UniswapX) - Intent protocol reference

## License

MIT

