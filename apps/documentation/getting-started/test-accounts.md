# Test Accounts

Standard Foundry test accounts are pre-funded on localnet with 10,000 ETH each.

## Primary Test Account

The default deployer account:

```
Address:     0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## Additional Test Accounts

Account 1 is `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` with key `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`.

Account 2 is `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` with key `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`.

Account 3 is `0x90F79bf6EB2c4f870365E785982E1f101E93b906` with key `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6`.

Account 4 is `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` with key `0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a`.

Additional accounts 5-9 follow the same derivation pattern from the mnemonic.

## Using in Scripts

```typescript
import { ethers } from 'ethers';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const provider = new ethers.JsonRpcProvider('http://127.0.0.1:9545');
const wallet = new ethers.Wallet(TEST_PRIVATE_KEY, provider);

const tx = await wallet.sendTransaction({
  to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  value: ethers.parseEther('1.0')
});
await tx.wait();
```

## Using with Cast

```bash
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

cast send 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
  --value 1ether \
  --rpc-url http://127.0.0.1:9545 \
  --private-key $PRIVATE_KEY

cast balance 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --rpc-url http://127.0.0.1:9545
```

## Mnemonic

All test accounts derive from this mnemonic:

```
test test test test test test test test test test test junk
```

Generate accounts with `cast wallet derive "test test test test test test test test test test test junk" --count 10`.

## Security Warning

These accounts are publicly known. Never use them for testnet with valuable tokens, mainnet (ever), or storing anything of value. For testnet/mainnet, generate fresh keys with `cast wallet new`.
