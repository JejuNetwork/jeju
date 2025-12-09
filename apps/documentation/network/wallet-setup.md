# Wallet Setup

## Add to MetaMask

### Testnet

| Field | Value |
|-------|-------|
| Network | Jeju Testnet |
| RPC | https://testnet-rpc.jeju.network |
| Chain ID | 420690 |
| Symbol | ETH |
| Explorer | https://testnet-explorer.jeju.network |

### Mainnet

| Field | Value |
|-------|-------|
| Network | Jeju |
| RPC | https://rpc.jeju.network |
| Chain ID | 420691 |
| Symbol | ETH |
| Explorer | https://explorer.jeju.network |

## Programmatic

```typescript
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [{
    chainId: '0x66B53', // 420691
    chainName: 'Jeju',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.jeju.network'],
    blockExplorerUrls: ['https://explorer.jeju.network'],
  }],
});
```

## Get ETH

### Testnet

1. Get Sepolia ETH: https://sepoliafaucet.com
2. Bridge to Jeju: https://testnet-gateway.jeju.network

### Mainnet

1. Get ETH on Ethereum
2. Bridge at https://gateway.jeju.network/bridge

## Hardware Wallets

Ledger/Trezor work via MetaMask or Frame. "Unknown chain" warning is safe to ignore.

## Multisig (Safe)

- Testnet: https://testnet-safe.jeju.network
- Mainnet: https://safe.jeju.network

## Smart Wallets (ERC-4337)

Jeju has native account abstraction support:

- Pay gas with any registered token
- Social recovery
- Batch transactions
- Session keys

Supported providers: Stackup, Biconomy, Alchemy Account Kit

## Use Token for Gas

If you have tokens but no ETH:

1. Go to Gateway → Pay with Token
2. Select token
3. Approve paymaster
4. Transactions use token for gas

```typescript
// Viem with paymaster
const hash = await walletClient.sendTransaction({
  to: recipient,
  value: amount,
  paymaster: paymasterAddress,
  paymasterData: tokenPaymentData,
});
```
