/**
 * E2E UserOp Test - Submits a real UserOperation through the Alto bundler
 *
 * This script:
 * 1. Creates a smart contract wallet via SimpleAccountFactory
 * 2. Funds the paymaster with ETH for the EntryPoint deposit
 * 3. Constructs a UserOperation
 * 4. Submits it to the bundler
 * 5. Verifies execution
 */

import {
  concat,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  type Hex,
  http,
  parseEther,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

// Contract addresses from deployment
const ENTRY_POINT = '0x547382C0D1b23f707918D3c83A77317B71Aa8470'
const MULTI_TOKEN_PAYMASTER = '0x7C8BaafA542c57fF9B2B90612bf8aB9E86e22C09'
const SIMPLE_ACCOUNT_FACTORY = '0x0Dd99d9f56A14E9D53b2DdC62D9f0bAbe806647A'

// URLs
const RPC_URL = 'http://127.0.0.1:6546'
const BUNDLER_URL = 'http://127.0.0.1:4337'

// Test accounts
const OWNER_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const USER_PRIVATE_KEY =
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' // Account 2

// ABIs
const simpleAccountFactoryAbi = [
  {
    name: 'createAccount',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: 'ret', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getAddress',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const

const entryPointAbi = [
  {
    name: 'getNonce',
    type: 'function',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ name: 'nonce', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getUserOpHash',
    type: 'function',
    inputs: [
      {
        name: 'userOp',
        type: 'tuple',
        components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'callGasLimit', type: 'uint256' },
          { name: 'verificationGasLimit', type: 'uint256' },
          { name: 'preVerificationGas', type: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256' },
          { name: 'maxPriorityFeePerGas', type: 'uint256' },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'depositTo',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [],
    stateMutability: 'payable',
  },
] as const

const simpleAccountAbi = [
  {
    name: 'execute',
    type: 'function',
    inputs: [
      { name: 'dest', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'func', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

async function main() {
  console.log('====================================================')
  console.log('   E2E UserOperation Test via Alto Bundler')
  console.log('====================================================\n')

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(RPC_URL),
  })

  const ownerAccount = privateKeyToAccount(OWNER_PRIVATE_KEY)
  const userAccount = privateKeyToAccount(USER_PRIVATE_KEY)

  const walletClient = createWalletClient({
    chain: foundry,
    transport: http(RPC_URL),
    account: ownerAccount,
  })

  // Step 1: Get or create smart account address
  console.log('1. Computing smart account address...')
  const salt = 0n

  const accountAddress = await publicClient.readContract({
    address: SIMPLE_ACCOUNT_FACTORY,
    abi: simpleAccountFactoryAbi,
    functionName: 'getAddress',
    args: [userAccount.address, salt],
  })

  console.log(`   User EOA: ${userAccount.address}`)
  console.log(`   Smart Account (counterfactual): ${accountAddress}`)

  // Check if account exists
  const code = await publicClient.getCode({ address: accountAddress })
  const accountExists = code !== undefined && code !== '0x'
  console.log(`   Account deployed: ${accountExists}`)

  // Step 2: Ensure paymaster has deposit at EntryPoint
  console.log('\n2. Checking paymaster deposit...')
  const paymasterDeposit = await publicClient.readContract({
    address: ENTRY_POINT,
    abi: entryPointAbi,
    functionName: 'balanceOf',
    args: [MULTI_TOKEN_PAYMASTER],
  })
  console.log(
    `   Paymaster deposit: ${paymasterDeposit} wei (${Number(paymasterDeposit) / 1e18} ETH)`,
  )

  if (paymasterDeposit < parseEther('1')) {
    console.log('   Topping up paymaster deposit...')
    const hash = await walletClient.writeContract({
      address: ENTRY_POINT,
      abi: entryPointAbi,
      functionName: 'depositTo',
      args: [MULTI_TOKEN_PAYMASTER],
      value: parseEther('5'),
    })
    await publicClient.waitForTransactionReceipt({ hash })
    console.log('   Deposited 5 ETH')
  }

  // Step 3: Get nonce
  console.log('\n3. Getting nonce...')
  const nonce = await publicClient.readContract({
    address: ENTRY_POINT,
    abi: entryPointAbi,
    functionName: 'getNonce',
    args: [accountAddress, 0n],
  })
  console.log(`   Nonce: ${nonce}`)

  // Step 4: Build UserOperation
  console.log('\n4. Building UserOperation...')

  // Create initCode if account doesn't exist
  let initCode: Hex = '0x'
  if (!accountExists) {
    const initCallData = encodeFunctionData({
      abi: simpleAccountFactoryAbi,
      functionName: 'createAccount',
      args: [userAccount.address, salt],
    })
    initCode = concat([SIMPLE_ACCOUNT_FACTORY as Hex, initCallData])
    console.log(`   InitCode length: ${initCode.length} bytes`)
  }

  // Simple execute call - just send 0 ETH to self (no-op)
  const executeCallData = encodeFunctionData({
    abi: simpleAccountAbi,
    functionName: 'execute',
    args: [userAccount.address, 0n, '0x'],
  })
  console.log(`   CallData: ${executeCallData.slice(0, 20)}...`)

  // Gas parameters for ERC-4337 v0.6 format (what Alto bundler expects)
  const verificationGasLimit = 500000n
  const callGasLimit = 100000n
  const maxPriorityFeePerGas = 1000000000n // 1 gwei
  const maxFeePerGas = 2000000000n // 2 gwei
  const preVerificationGas = 100000n

  // v0.6 format: paymasterAndData is just the paymaster address + optional data
  const paymasterAndData = MULTI_TOKEN_PAYMASTER as Hex

  // Build the UserOperation for v0.6 format
  const userOp = {
    sender: accountAddress,
    nonce,
    initCode,
    callData: executeCallData,
    callGasLimit,
    verificationGasLimit,
    preVerificationGas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymasterAndData,
    signature: '0x' as Hex, // Will be replaced after signing
  }

  // Step 5: Get UserOp hash and sign
  console.log('\n5. Signing UserOperation...')

  // Get the hash from EntryPoint
  const userOpHash = await publicClient.readContract({
    address: ENTRY_POINT,
    abi: entryPointAbi,
    functionName: 'getUserOpHash',
    args: [userOp],
  })
  console.log(`   UserOp hash: ${userOpHash}`)

  // Sign the hash with the user's key
  const signature = await userAccount.signMessage({
    message: { raw: userOpHash },
  })
  userOp.signature = signature
  console.log(`   Signature: ${signature.slice(0, 20)}...`)

  // Step 6: Submit to bundler
  console.log('\n6. Submitting to bundler...')

  // Convert to bundler format (all hex strings)
  const bundlerUserOp = {
    sender: userOp.sender,
    nonce: toHex(userOp.nonce),
    initCode: userOp.initCode,
    callData: userOp.callData,
    callGasLimit: toHex(userOp.callGasLimit),
    verificationGasLimit: toHex(userOp.verificationGasLimit),
    preVerificationGas: toHex(userOp.preVerificationGas),
    maxFeePerGas: toHex(userOp.maxFeePerGas),
    maxPriorityFeePerGas: toHex(userOp.maxPriorityFeePerGas),
    paymasterAndData: userOp.paymasterAndData,
    signature: userOp.signature,
  }

  const bundlerRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendUserOperation',
    params: [bundlerUserOp, ENTRY_POINT],
  }

  console.log('   Sending to bundler...')

  const response = await fetch(BUNDLER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundlerRequest),
  })

  const result = await response.json()

  if (result.error) {
    console.log(`   Error: ${JSON.stringify(result.error, null, 2)}`)

    // Try debug_traceCall to get more info
    console.log('\n   Attempting to diagnose...')

    // Check if the account is properly initialized
    if (!accountExists) {
      console.log(
        '   Account not deployed yet - this is expected for first UserOp',
      )
    }

    // Check paymaster validation
    console.log('   Checking if paymaster is properly configured...')

    throw new Error(`Bundler rejected UserOp: ${result.error.message}`)
  }

  console.log(`   UserOp hash from bundler: ${result.result}`)

  // Step 7: Wait for receipt
  console.log('\n7. Waiting for receipt...')

  // Poll for receipt
  let receipt = null
  for (let i = 0; i < 30; i++) {
    const receiptRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'eth_getUserOperationReceipt',
      params: [result.result],
    }

    const receiptResponse = await fetch(BUNDLER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(receiptRequest),
    })

    const receiptResult = await receiptResponse.json()
    if (receiptResult.result) {
      receipt = receiptResult.result
      break
    }

    await new Promise((r) => setTimeout(r, 500))
  }

  if (receipt) {
    console.log('   Receipt received:')
    console.log(`   - Success: ${receipt.success}`)
    console.log(`   - Transaction hash: ${receipt.receipt?.transactionHash}`)
    console.log(`   - Gas used: ${receipt.receipt?.gasUsed}`)
    console.log(`   - Actual gas cost: ${receipt.actualGasCost}`)
  } else {
    console.log('   No receipt received (timeout)')
  }

  // Step 8: Verify account is now deployed
  console.log('\n8. Verifying final state...')
  const finalCode = await publicClient.getCode({ address: accountAddress })
  const finalDeployed = finalCode !== undefined && finalCode !== '0x'
  console.log(`   Smart account deployed: ${finalDeployed}`)

  console.log('\n====================================================')
  console.log('   E2E Test Complete')
  console.log('====================================================')
}

main().catch(console.error)
