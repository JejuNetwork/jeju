/**
 * E2E Test via Bundler - Submits UserOperation through Alto bundler
 *
 * This is the REAL ERC-4337 flow:
 * 1. Build UserOperation
 * 2. Submit to bundler via eth_sendUserOperation
 * 3. Bundler validates and submits to EntryPoint
 */

import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  http,
  keccak256,
  parseEther,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

// Contract addresses - v0.6 stack
const ENTRY_POINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'
const SIMPLE_PAYMASTER = '0x2c8ED11fd7A058096F2e5828799c68BE88744E2F'
const SIMPLE_ACCOUNT_FACTORY = '0x975Ab64F4901Af5f0C96636deA0b9de3419D0c2F'

// URLs
const RPC_URL = 'http://127.0.0.1:6546'
const BUNDLER_URL = 'http://127.0.0.1:4337'

// Test accounts - use account index 4 (0x15d34...) which already has an account deployed
const OWNER_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const USER_PRIVATE_KEY =
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' // Account 4 - 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65

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

// Compute UserOp hash for v0.6 format
function computeUserOpHashV06(
  userOp: {
    sender: Hex
    nonce: bigint
    initCode: Hex
    callData: Hex
    callGasLimit: bigint
    verificationGasLimit: bigint
    preVerificationGas: bigint
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
    paymasterAndData: Hex
  },
  entryPoint: Hex,
  chainId: bigint,
): Hex {
  const hashInitCode = keccak256(userOp.initCode)
  const hashCallData = keccak256(userOp.callData)
  const hashPaymasterAndData = keccak256(userOp.paymasterAndData)

  // Pack UserOp fields
  const packed = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'uint256' },
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'bytes32' },
    ],
    [
      userOp.sender,
      userOp.nonce,
      hashInitCode,
      hashCallData,
      userOp.callGasLimit,
      userOp.verificationGasLimit,
      userOp.preVerificationGas,
      userOp.maxFeePerGas,
      userOp.maxPriorityFeePerGas,
      hashPaymasterAndData,
    ],
  )

  const userOpHash = keccak256(packed)

  // Pack with entryPoint and chainId
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
      [userOpHash, entryPoint, chainId],
    ),
  )
}

async function main() {
  console.log('====================================================')
  console.log('   E2E Test via Bundler (eth_sendUserOperation)')
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

  // Step 1: Check bundler is running
  console.log('1. Checking bundler...')
  const bundlerCheck = await fetch(BUNDLER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_supportedEntryPoints',
      params: [],
    }),
  })
  const bundlerResult = await bundlerCheck.json()
  if (bundlerResult.error) {
    throw new Error(`Bundler not responding: ${bundlerResult.error.message}`)
  }
  console.log(
    `   Supported EntryPoints: ${JSON.stringify(bundlerResult.result)}`,
  )

  // Step 2: Get smart account address (use already deployed account)
  console.log('\n2. Computing smart account address...')
  const salt = 1n

  const accountAddress = await publicClient.readContract({
    address: SIMPLE_ACCOUNT_FACTORY,
    abi: simpleAccountFactoryAbi,
    functionName: 'getAddress',
    args: [userAccount.address, salt],
  })

  console.log(`   User EOA: ${userAccount.address}`)
  console.log(`   Smart Account: ${accountAddress}`)

  const code = await publicClient.getCode({ address: accountAddress })
  const accountExists = code !== undefined && code !== '0x'
  console.log(`   Deployed: ${accountExists}`)

  if (!accountExists) {
    console.log(
      "   ERROR: Account not deployed. Run 'cast send' to create it first.",
    )
    throw new Error('Account not deployed')
  }

  // Step 3: Ensure paymaster has deposit
  console.log('\n3. Checking paymaster deposit...')
  const paymasterDeposit = await publicClient.readContract({
    address: ENTRY_POINT,
    abi: entryPointAbi,
    functionName: 'balanceOf',
    args: [SIMPLE_PAYMASTER],
  })
  console.log(`   Deposit: ${Number(paymasterDeposit) / 1e18} ETH`)

  if (paymasterDeposit < parseEther('1')) {
    console.log('   Topping up...')
    const hash = await walletClient.writeContract({
      address: ENTRY_POINT,
      abi: entryPointAbi,
      functionName: 'depositTo',
      args: [SIMPLE_PAYMASTER],
      value: parseEther('5'),
    })
    await publicClient.waitForTransactionReceipt({ hash })
  }

  // Step 4: Get nonce
  console.log('\n4. Getting nonce...')
  const nonce = await publicClient.readContract({
    address: ENTRY_POINT,
    abi: entryPointAbi,
    functionName: 'getNonce',
    args: [accountAddress, 0n],
  })
  console.log(`   Nonce: ${nonce}`)

  // Step 5: Build UserOperation (no initCode for already-deployed account)
  console.log('\n5. Building UserOperation...')

  const initCode: Hex = '0x'

  const executeCallData = encodeFunctionData({
    abi: simpleAccountAbi,
    functionName: 'execute',
    args: [userAccount.address, 0n, '0x'],
  })

  // Gas parameters for v0.6
  const verificationGasLimit = 500000n
  const callGasLimit = 100000n
  const maxPriorityFeePerGas = 1000000000n
  const maxFeePerGas = 2000000000n
  const preVerificationGas = 100000n

  // v0.6 format: paymasterAndData is just the paymaster address
  const paymasterAndData = SIMPLE_PAYMASTER as Hex

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
  }

  // Step 6: Sign
  console.log('\n6. Signing UserOperation...')
  const chainId = BigInt(await publicClient.getChainId())
  const userOpHash = computeUserOpHashV06(userOp, ENTRY_POINT as Hex, chainId)
  console.log(`   Hash: ${userOpHash}`)

  // v0.6 uses toEthSignedMessageHash in the account, so we use signMessage
  const signature = await userAccount.signMessage({
    message: { raw: userOpHash },
  })
  console.log(`   Signature: ${signature.slice(0, 20)}...`)

  // Step 7: Submit to bundler
  console.log('\n7. Submitting to bundler via eth_sendUserOperation...')

  // Try v0.6 format first (what Alto expects)
  const bundlerUserOp = {
    sender: userOp.sender,
    nonce: toHex(userOp.nonce),
    initCode: userOp.initCode,
    callData: userOp.callData,
    callGasLimit: toHex(callGasLimit),
    verificationGasLimit: toHex(verificationGasLimit),
    preVerificationGas: toHex(userOp.preVerificationGas),
    maxFeePerGas: toHex(maxFeePerGas),
    maxPriorityFeePerGas: toHex(maxPriorityFeePerGas),
    paymasterAndData: userOp.paymasterAndData,
    signature: signature,
  }

  console.log('   UserOp (v0.6 format for bundler):')
  console.log(`   - sender: ${bundlerUserOp.sender}`)
  console.log(`   - nonce: ${bundlerUserOp.nonce}`)
  console.log(`   - callGasLimit: ${bundlerUserOp.callGasLimit}`)

  const sendResponse = await fetch(BUNDLER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'eth_sendUserOperation',
      params: [bundlerUserOp, ENTRY_POINT],
    }),
  })

  const sendResult = await sendResponse.json()

  if (sendResult.error) {
    console.log(`   Error: ${JSON.stringify(sendResult.error, null, 2)}`)

    // Try to get more info
    console.log('\n   Attempting gas estimation...')
    const estimateResponse = await fetch(BUNDLER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'eth_estimateUserOperationGas',
        params: [bundlerUserOp, ENTRY_POINT],
      }),
    })
    const estimateResult = await estimateResponse.json()
    console.log(`   Estimation: ${JSON.stringify(estimateResult, null, 2)}`)

    throw new Error(`Bundler rejected: ${sendResult.error.message}`)
  }

  console.log(`   UserOp hash from bundler: ${sendResult.result}`)

  // Step 8: Wait for receipt
  console.log('\n8. Waiting for receipt...')

  let receipt = null
  for (let i = 0; i < 30; i++) {
    const receiptResponse = await fetch(BUNDLER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'eth_getUserOperationReceipt',
        params: [sendResult.result],
      }),
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
    console.log(`   - Transaction: ${receipt.receipt?.transactionHash}`)
    console.log(`   - Gas used: ${receipt.actualGasUsed}`)
  } else {
    console.log('   Timeout waiting for receipt')
  }

  // Step 9: Verify
  console.log('\n9. Verifying...')
  const finalCode = await publicClient.getCode({ address: accountAddress })
  const finalDeployed = finalCode !== undefined && finalCode !== '0x'
  console.log(`   Smart account deployed: ${finalDeployed}`)

  if (finalDeployed && receipt?.success) {
    console.log('\n====================================================')
    console.log('   SUCCESS - REAL ERC-4337 FLOW VIA BUNDLER')
    console.log('====================================================')
    console.log('\n   User -> Bundler -> EntryPoint -> Account')
  }
}

main().catch(console.error)
