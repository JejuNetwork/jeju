# ELIZAOS Paymaster System

## Overview

The ELIZAOS Paymaster allows AI agents on the Jeju L2 network to pay for gas fees using ELIZAOS tokens instead of ETH. This is implemented using the ERC-4337 Account Abstraction standard.

## Why Use a Paymaster?

1. **Better UX for Agents**: Agents don't need to manage ETH balances
2. **Single Token Economy**: Everything runs on ELIZAOS tokens
3. **Flexible Pricing**: Paymaster owner can adjust exchange rates
4. **Gasless Experience**: From the agent's perspective, they only interact with ELIZAOS

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐     ┌─────────────┐
│   Agent     │────▶│   Bundler    │────▶│ EntryPoint │────▶│  Paymaster  │
│             │     │              │     │            │     │             │
│ Pay ELIZAOS │     │ Submit to L2 │     │ Validate & │     │ Take ELIZAOS│
│             │     │              │     │ Execute    │     │ Pay ETH gas │
└─────────────┘     └──────────────┘     └────────────┘     └─────────────┘
```

### Step-by-Step Flow

1. **Agent Creates UserOperation**
   - Agent wants to execute a transaction (e.g., store memory on-chain)
   - Agent creates a UserOperation with the Paymaster's address

2. **Agent Approves ELIZAOS**
   - Agent must approve the Paymaster to spend their ELIZAOS tokens
   - `elizaosToken.approve(paymasterAddress, amount)`

3. **Bundler Submits Transaction**
   - Bundler collects UserOperations and submits them to EntryPoint
   - EntryPoint is pre-deployed at `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`

4. **Paymaster Validates**
   - EntryPoint calls `validatePaymasterUserOp`
   - Paymaster checks agent has enough ELIZAOS balance and allowance
   - Calculates required ELIZAOS based on gas estimate

5. **Transaction Executes**
   - The actual transaction runs
   - Gas is consumed

6. **Paymaster Collects Payment**
   - EntryPoint calls `postOp`
   - Paymaster transfers ELIZAOS from agent to itself
   - ETH is deducted from Paymaster's deposit at EntryPoint

## Contract Addresses

| Contract | Address | Network |
|----------|---------|---------|
| EntryPoint v0.6.0 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | Jeju L2 |
| EntryPoint v0.7.0 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Jeju L2 |
| ELIZAOS | TBD | Jeju L2 |
| ELIZAOSPaymaster | TBD | Jeju L2 |

## Deployment

### 1. Deploy ELIZAOS Token

```bash
forge create contracts/src/ELIZAOS.sol:ELIZAOS \
  --rpc-url $L2_RPC_URL \
  --private-key $DEPLOYER_KEY \
  --broadcast
```

### 2. Deploy Paymaster

```bash
forge create contracts/src/ELIZAOSPaymaster.sol:ELIZAOSPaymaster \
  --rpc-url $L2_RPC_URL \
  --private-key $DEPLOYER_KEY \
  --constructor-args $ENTRYPOINT_ADDRESS $ELIZAOS_TOKEN_ADDRESS \
  --broadcast
```

### 3. Fund Paymaster with ETH

```bash
# Deposit ETH to EntryPoint for the Paymaster
cast send $PAYMASTER_ADDRESS "deposit()" \
  --value 10ether \
  --rpc-url $L2_RPC_URL \
  --private-key $DEPLOYER_KEY
```

## Usage Example

### Agent Setup

```javascript
// 1. Approve Paymaster to spend ELIZAOS
const elizaos = new ethers.Contract(ELIZAOS_ADDRESS, ERC20_ABI, agentWallet);
await elizaos.approve(PAYMASTER_ADDRESS, ethers.MaxUint256);

// 2. Create UserOperation
const userOp = {
  sender: agentWallet.address,
  nonce: await entryPoint.getNonce(agentWallet.address, 0),
  initCode: "0x",
  callData: encodedTransaction,
  callGasLimit: 100000,
  verificationGasLimit: 100000,
  preVerificationGas: 50000,
  maxFeePerGas: await provider.getFeeData().maxFeePerGas,
  maxPriorityFeePerGas: 1000000000,
  paymasterAndData: PAYMASTER_ADDRESS, // Just the address for simple paymaster
  signature: "0x"
};

// 3. Sign the UserOperation
userOp.signature = await agentWallet.signMessage(
  ethers.getBytes(await entryPoint.getUserOpHash(userOp))
);

// 4. Submit via Bundler
await bundler.sendUserOperation(userOp);
```

## Economics

### Exchange Rate
- Default: 1000 ELIZAOS = 1 ETH worth of gas
- Adjustable by Paymaster owner via `setRate()`

### Revenue Model
- Paymaster collects ELIZAOS from agents
- Paymaster owner can:
  - Withdraw ELIZAOS to sell for ETH
  - Withdraw excess ETH from EntryPoint deposit
  - Adjust rates based on market conditions

### L2 → L1 Costs
- L2 sequencer batches transactions to L1
- L1 posting cost is amortized across many L2 transactions
- With EIP-4844 blobs, L1 costs are ~10x cheaper

## Security Considerations

1. **Approval Management**: Agents should only approve necessary amounts
2. **Rate Manipulation**: Owner can change rates - consider timelocks
3. **Deposit Management**: Keep sufficient ETH at EntryPoint
4. **Reentrancy**: postOp is called by EntryPoint, limited attack surface

## Testing

```bash
# Run local tests
forge test --match-contract ELIZAOSPaymasterTest

# Test on local anvil
anvil --fork-url $L2_RPC_URL
forge script script/DeployPaymaster.s.sol --rpc-url http://localhost:8545
```
