# Wallet Setup

Complete guide to setting up your wallet to use Jeju on testnet and mainnet.

## MetaMask Setup

### Automatic Setup (Recommended)

**Testnet**:
1. Visit [chainlist.org/chain/420690](https://chainlist.org/chain/420690)
2. Click "Add to MetaMask"
3. Approve the connection

**Mainnet**:
1. Visit [chainlist.org/chain/420691](https://chainlist.org/chain/420691)
2. Click "Add to MetaMask"
3. Approve the connection

### Manual Setup

#### Add Jeju Testnet

1. Open MetaMask
2. Click network dropdown (top)
3. Click "Add Network" → "Add a network manually"
4. Enter the following:

```
Network Name: Jeju Testnet
New RPC URL: https://testnet-rpc.jeju.network
Chain ID: 420690
Currency Symbol: ETH
Block Explorer URL: https://testnet-explorer.jeju.network
```

5. Click "Save"

#### Add Jeju Mainnet

1. Open MetaMask
2. Click network dropdown (top)
3. Click "Add Network" → "Add a network manually"
4. Enter the following:

```
Network Name: Jeju
New RPC URL: https://rpc.jeju.network
Chain ID: 420691
Currency Symbol: ETH
Block Explorer URL: https://explorer.jeju.network
```

5. Click "Save"

## WalletConnect

Jeju supports WalletConnect v2 for dApp connections.

### Supported Wallets

- MetaMask Mobile
- Rainbow Wallet
- Trust Wallet
- Coinbase Wallet
- Argent
- And 200+ more

### Usage

1. Open your WalletConnect-compatible wallet
2. Scan QR code from dApp
3. Approve connection
4. Select "Jeju" or "Jeju Testnet" network

## Rabby Wallet

Rabby automatically detects and configures Jeju networks.

### Setup

1. Install [Rabby](https://rabby.io)
2. Create or import wallet
3. Visit any Jeju dApp
4. Rabby auto-detects network
5. Approve connection

::: tip
Rabby shows which network each dApp expects, preventing wrong-network transactions.
:::

## Coinbase Wallet

### Browser Extension

1. Install [Coinbase Wallet Extension](https://chrome.google.com/webstore/detail/coinbase-wallet/hnfanknocfeofbddgcijnmhnfnkdnaad)
2. Create or import wallet
3. Click Settings → Networks → Add Custom Network
4. Enter Jeju network details (see MetaMask section above)

### Mobile App

1. Download Coinbase Wallet mobile app
2. Go to Settings → Networks
3. Enable "Testnets" to see Jeju Testnet
4. Jeju Mainnet appears automatically once added to WalletConnect registry

## Hardware Wallets

### Ledger

#### Prerequisites
- Ledger Nano S Plus, Nano X, or Stax
- Latest firmware
- Ethereum app installed

#### Setup with MetaMask

1. Connect Ledger to computer
2. Open Ethereum app on Ledger
3. Open MetaMask
4. Click account icon → Connect Hardware Wallet
5. Select Ledger → Connect
6. Choose accounts to import
7. Add Jeju network (see MetaMask section)
8. Switch to Jeju network

#### Setup with Frame

[Frame](https://frame.sh) provides native hardware wallet support:

1. Install Frame
2. Connect Ledger
3. Frame auto-detects Jeju networks
4. Use Frame as your web3 provider

### Trezor

1. Connect Trezor to computer
2. Open Trezor Suite
3. In MetaMask: Account icon → Connect Hardware Wallet
4. Select Trezor → Connect
5. Choose accounts
6. Add Jeju network

::: warning Hardware Wallet Support
Hardware wallets work perfectly with Jeju. However, Ledger/Trezor apps may show "Unknown chain" warnings since Jeju is not in their built-in registry. This is safe to ignore.
:::

## Safe (Multi-sig)

Deploy a multi-sig Safe wallet on Jeju for enhanced security.

### Testnet Deployment

1. Visit [Jeju Safe Testnet](https://testnet-safe.jeju.network)
2. Connect wallet
3. Click "Create Safe"
4. Add owners (addresses)
5. Set threshold (signatures required)
6. Deploy (costs gas)

### Mainnet Deployment

1. Visit [Jeju Safe](https://safe.jeju.network)
2. Connect wallet
3. Create Safe (3-of-5 recommended)
4. Fund Safe
5. Use for treasury/governance

::: tip Multi-sig for Teams
Safes are perfect for:
- DAO treasuries
- Protocol upgrades
- Shared funds
- Team wallets
:::

## Account Abstraction (ERC-4337)

Jeju has native ERC-4337 support for smart contract wallets.

### Benefits

- **Gasless transactions**: Paymasters can sponsor gas
- **Social recovery**: Recover wallet without seed phrase
- **Batch operations**: Multiple transactions in one
- **Session keys**: Temporary permissions for dApps

### Supported Wallets

- **Stackup**: [stackup.sh](https://stackup.sh)
- **Biconomy**: [biconomy.io](https://biconomy.io)
- **Alchemy Account Kit**: [accountkit.alchemy.com](https://accountkit.alchemy.com)

### Example: Create AA Wallet

```typescript
import { createSmartAccountClient } from '@alchemy/aa-core';
import { jejuTestnet } from './chains';

const client = await createSmartAccountClient({
  chain: jejuTestnet,
  signer,
  // Smart wallet automatically deployed on first transaction
});

// Send gasless transaction
await client.sendTransaction({
  to: '0x...',
  data: '0x...',
  // Gas paid by paymaster
});
```

## Best Practices

### Security

1. **Never share seed phrases**
   - Not even with "support"
   - Store offline in secure location
   - Consider metal backup

2. **Use hardware wallets for large amounts**
   - >$10k: Use Ledger/Trezor
   - >$100k: Use multi-sig Safe

3. **Separate wallets for different purposes**
   - Hot wallet: Small amounts for testing
   - Cold wallet: Long-term holdings
   - Development wallet: Never hold real value

4. **Verify network before transactions**
   - Check chain ID
   - Confirm in block explorer
   - Start with small test transaction

### Managing Multiple Networks

```
Recommended Setup:
├── Wallet 1 (Hot - MetaMask)
│   ├── Ethereum Mainnet
│   ├── Base Mainnet
│   └── Jeju Mainnet
│
├── Wallet 2 (Cold - Ledger)
│   ├── Ethereum (large holdings)
│   └── Jeju (large holdings)
│
└── Wallet 3 (Dev - MetaMask)
    ├── Local (localnet)
    ├── Sepolia
    ├── Base Sepolia
    └── Jeju Testnet
```

## Troubleshooting

### "Wrong Network" Error

**Problem**: dApp says "Switch to Jeju"

**Solution**:
1. Open network dropdown in wallet
2. Select "Jeju" or "Jeju Testnet"
3. Refresh page

### Transaction Stuck

**Problem**: Transaction pending forever

**Solution**:
```bash
# Check transaction on explorer
# View in block explorer using transaction hash

# If truly stuck:
# 1. Note the nonce
# 2. Send 0 ETH to yourself
# 3. Use same nonce but higher gas price
# 4. This "replaces" the stuck transaction
```

### "Insufficient Funds"

**Problem**: Can't send transaction, need more ETH

**Testnet**:
- Use [faucet](https://faucet.jeju.network)
- Request in [Discord](https://discord.gg/jeju)

**Mainnet**:
- Bridge from Base using [Jeju Bridge](https://bridge.jeju.network)
- Buy directly with on-ramp (coming soon)

### Can't See Tokens

**Problem**: Tokens not appearing in wallet

**Solution**:
1. Get token contract address from explorer
2. In MetaMask: Assets → Import tokens
3. Paste contract address
4. Token details auto-fill
5. Click "Add"

### Hardware Wallet Connection Issues

**Problem**: Ledger/Trezor won't connect

**Solutions**:
- Close Ledger Live (conflicts with MetaMask)
- Enable "blind signing" in Ethereum app
- Update firmware to latest version
- Try different USB port/cable
- Use Frame instead of MetaMask

## Developer Integration

### Detect Jeju Network

```typescript
import { useNetwork } from 'wagmi';

function YourComponent() {
  const { chain } = useNetwork();
  
  if (chain?.id !== 420691) {
    return <div>Please switch to Jeju Mainnet</div>;
  }
  
  return <div>Connected to Jeju! ✅</div>;
}
```

### Request Network Switch

```typescript
import { useSwitchNetwork } from 'wagmi';

function SwitchNetworkButton() {
  const { switchNetwork } = useSwitchNetwork();
  
  return (
    <button onClick={() => switchNetwork?.(420691)}>
      Switch to Jeju
    </button>
  );
}
```

### Add Network Programmatically

```typescript
// Request user add Jeju to their wallet
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [{
    chainId: '0x66B53', // 420691 in hex
    chainName: 'Jeju',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: ['https://rpc.jeju.network'],
    blockExplorerUrls: ['https://explorer.jeju.network'],
  }],
});
```

## Next Steps

- [**Bridge Assets**](./bridge) - Move funds to Jeju
- [**Testnet**](./testnet) - Get testnet ETH
- [**Mainnet**](./mainnet) - Use production network
- [**Deploy Contracts**](/developers/deploy-contracts) - Start building

