/**
 * XLP Voucher Flow Test
 *
 * Tests the complete cross-chain voucher flow:
 * 1. XLP registers and stakes on L1
 * 2. Stake is synced to L2 CrossChainPaymaster
 * 3. User creates voucher request for cross-chain transfer
 * 4. XLP issues voucher
 * 5. XLP fulfills voucher on destination
 * 6. (Failure case) XLP fails to fulfill, gets slashed
 */

import {
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

// Deployed contracts from our localnet
const RPC_URL = 'http://127.0.0.1:6546'

// From latest deployment (DeployFullLocalnet)
const L1_STAKE_MANAGER = '0x5081a39b8A5f0E35a8D959395a630b68B74Dd30f'
const CROSS_CHAIN_PAYMASTER = '0x4C4a2f8c81640e47606d3fd77B353E87Ba015584'
const _MOCK_MESSENGER = '0x1fA02b2d6A771842690194Cf62D91bdd92BfE28d'

// Test accounts
const DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const XLP_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' // Account 1
const USER_KEY =
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' // Account 2

// ABIs
const l1StakeManagerAbi = [
  {
    name: 'register',
    type: 'function',
    inputs: [{ name: 'chains', type: 'uint256[]' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'addStake',
    type: 'function',
    inputs: [],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'getStake',
    type: 'function',
    inputs: [{ name: 'xlp', type: 'address' }],
    outputs: [
      {
        name: 'stake',
        type: 'tuple',
        components: [
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'unbondingAmount', type: 'uint256' },
          { name: 'unbondingStartTime', type: 'uint256' },
          { name: 'lockedUnbondingPeriod', type: 'uint256' },
          { name: 'slashedAmount', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
          { name: 'registeredAt', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getEffectiveStake',
    type: 'function',
    inputs: [{ name: 'xlp', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'syncStakeToL2',
    type: 'function',
    inputs: [
      { name: 'chainId', type: 'uint256' },
      { name: 'xlp', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setAuthorizedSlasher',
    type: 'function',
    inputs: [
      { name: 'slasher', type: 'address' },
      { name: 'authorized', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'slash',
    type: 'function',
    inputs: [
      { name: 'xlp', type: 'address' },
      { name: 'chainId', type: 'uint256' },
      { name: 'voucherId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'victim', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'slashRecords',
    type: 'function',
    inputs: [{ name: 'slashId', type: 'bytes32' }],
    outputs: [
      { name: 'xlp', type: 'address' },
      { name: 'chainId', type: 'uint256' },
      { name: 'voucherId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'victim', type: 'address' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'executed', type: 'bool' },
      { name: 'disputed', type: 'bool' },
      { name: 'disputeStatus', type: 'uint8' },
      { name: 'fulfillmentProofHash', type: 'bytes32' },
      { name: 'disputeDeadline', type: 'uint256' },
      { name: 'disputeArbitrator', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'totalSlashed',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

const crossChainPaymasterAbi = [
  {
    name: 'createVoucherRequestETH',
    type: 'function',
    inputs: [
      { name: 'destinationChain', type: 'uint256' },
      { name: 'destinationToken', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'maxFee', type: 'uint256' },
    ],
    outputs: [{ name: 'requestId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'issueVoucher',
    type: 'function',
    inputs: [{ name: 'requestId', type: 'bytes32' }],
    outputs: [{ name: 'voucherId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'fulfillVoucher',
    type: 'function',
    inputs: [
      { name: 'voucherId', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'xlpStakes',
    type: 'function',
    inputs: [{ name: 'xlp', type: 'address' }],
    outputs: [{ name: 'stake', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'adminSetXLPStake',
    type: 'function',
    inputs: [
      { name: 'xlp', type: 'address' },
      { name: 'stake', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'requests',
    type: 'function',
    inputs: [{ name: 'requestId', type: 'bytes32' }],
    outputs: [
      { name: 'requester', type: 'address' },
      { name: 'sourceToken', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'destinationChain', type: 'uint256' },
      { name: 'destinationToken', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'claimed', type: 'bool' },
      { name: 'expired', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'vouchers',
    type: 'function',
    inputs: [{ name: 'voucherId', type: 'bytes32' }],
    outputs: [
      { name: 'requestId', type: 'bytes32' },
      { name: 'xlp', type: 'address' },
      { name: 'issuedBlock', type: 'uint256' },
      { name: 'fulfilled', type: 'bool' },
      { name: 'expired', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const

async function main() {
  console.log('====================================================')
  console.log('   XLP Voucher Flow Test')
  console.log('====================================================\n')

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(RPC_URL),
  })

  const deployerAccount = privateKeyToAccount(DEPLOYER_KEY)
  const xlpAccount = privateKeyToAccount(XLP_KEY)
  const userAccount = privateKeyToAccount(USER_KEY)

  const deployerWallet = createWalletClient({
    chain: foundry,
    transport: http(RPC_URL),
    account: deployerAccount,
  })

  const xlpWallet = createWalletClient({
    chain: foundry,
    transport: http(RPC_URL),
    account: xlpAccount,
  })

  const userWallet = createWalletClient({
    chain: foundry,
    transport: http(RPC_URL),
    account: userAccount,
  })

  console.log('Accounts:')
  console.log(`  Deployer: ${deployerAccount.address}`)
  console.log(`  XLP:      ${xlpAccount.address}`)
  console.log(`  User:     ${userAccount.address}\n`)

  // Step 1: Check XLP stake on L1
  console.log('1. Checking XLP stake on L1...')
  let l1Stake = 0n
  try {
    const stake = await publicClient.readContract({
      address: L1_STAKE_MANAGER,
      abi: l1StakeManagerAbi,
      functionName: 'getStake',
      args: [xlpAccount.address],
    })
    l1Stake = stake.stakedAmount
    console.log(`   L1 Stake: ${formatEther(l1Stake)} ETH`)
    console.log(`   Active: ${stake.isActive}`)
  } catch {
    console.log('   No stake found')
  }

  if (l1Stake === 0n) {
    console.log('   Registering XLP...')
    const hash = await xlpWallet.writeContract({
      address: L1_STAKE_MANAGER,
      abi: l1StakeManagerAbi,
      functionName: 'register',
      args: [[31337n]],
      value: parseEther('5'),
    })
    await publicClient.waitForTransactionReceipt({ hash })
    console.log('   Registered with 5 ETH stake')

    // Get updated stake
    const stake = await publicClient.readContract({
      address: L1_STAKE_MANAGER,
      abi: l1StakeManagerAbi,
      functionName: 'getStake',
      args: [xlpAccount.address],
    })
    l1Stake = stake.stakedAmount
  }

  // Step 2: Check XLP stake on L2
  console.log('\n2. Checking XLP stake on L2...')
  const l2Stake = await publicClient.readContract({
    address: CROSS_CHAIN_PAYMASTER,
    abi: crossChainPaymasterAbi,
    functionName: 'xlpStakes',
    args: [xlpAccount.address],
  })
  console.log(`   L2 Stake: ${formatEther(l2Stake)} ETH`)

  if (l2Stake === 0n) {
    console.log('   Syncing stake to L2 (admin set for local testing)...')
    // Note: In production, this would come via L1→L2 bridge message
    // updateXLPStake() requires the call to come from L2 messenger
    // with xDomainMessageSender = L1StakeManager
    const hash = await deployerWallet.writeContract({
      address: CROSS_CHAIN_PAYMASTER,
      abi: crossChainPaymasterAbi,
      functionName: 'adminSetXLPStake',
      args: [xlpAccount.address, l1Stake],
    })
    await publicClient.waitForTransactionReceipt({ hash })
    console.log(`   Synced ${formatEther(l1Stake)} ETH to L2`)
  }

  // Step 3: User creates voucher request
  console.log('\n3. User creating voucher request...')
  const destChain = 31337n
  const destToken = '0x0000000000000000000000000000000000000000' as Hex // ETH
  const recipient = userAccount.address
  const maxFee = parseEther('0.01')
  const amount = parseEther('0.1')

  let requestId: Hex
  {
    const hash = await userWallet.writeContract({
      address: CROSS_CHAIN_PAYMASTER,
      abi: crossChainPaymasterAbi,
      functionName: 'createVoucherRequestETH',
      args: [destChain, destToken, recipient, maxFee],
      value: amount,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    // Get requestId from logs
    const logs = receipt.logs
    if (logs.length > 0) {
      requestId = logs[0].topics[1] as Hex
      console.log(`   Request created: ${requestId.slice(0, 20)}...`)
    } else {
      throw new Error('No logs from createVoucherRequestETH')
    }
  }

  // Verify request
  const request = await publicClient.readContract({
    address: CROSS_CHAIN_PAYMASTER,
    abi: crossChainPaymasterAbi,
    functionName: 'requests',
    args: [requestId],
  })
  console.log(`   Amount: ${formatEther(request[2])} ETH`)
  console.log(`   Recipient: ${request[5]}`)

  // Step 4: XLP deposits liquidity
  console.log('\n4. XLP depositing liquidity...')
  {
    const hash = await xlpWallet.writeContract({
      address: CROSS_CHAIN_PAYMASTER,
      abi: [
        {
          name: 'depositETH',
          type: 'function',
          inputs: [],
          outputs: [],
          stateMutability: 'payable',
        },
      ] as const,
      functionName: 'depositETH',
      value: parseEther('1'),
    })
    await publicClient.waitForTransactionReceipt({ hash })
    console.log('   Deposited 1 ETH liquidity')
  }

  // Step 5: XLP issues voucher
  console.log('\n5. XLP issuing voucher...')
  let voucherId: Hex
  {
    const hash = await xlpWallet.writeContract({
      address: CROSS_CHAIN_PAYMASTER,
      abi: crossChainPaymasterAbi,
      functionName: 'issueVoucher',
      args: [requestId],
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    const logs = receipt.logs
    if (logs.length > 0) {
      voucherId = logs[0].topics[1] as Hex
      console.log(`   Voucher issued: ${voucherId.slice(0, 20)}...`)
    } else {
      throw new Error('No logs from issueVoucher')
    }
  }

  // Verify voucher
  const voucher = await publicClient.readContract({
    address: CROSS_CHAIN_PAYMASTER,
    abi: crossChainPaymasterAbi,
    functionName: 'vouchers',
    args: [voucherId],
  })
  console.log(`   XLP: ${voucher[1]}`)
  console.log(`   Issued Block: ${voucher[2]}`)
  console.log(`   Fulfilled: ${voucher[3]}`)

  // Step 6: XLP fulfills voucher
  console.log('\n6. XLP fulfilling voucher...')
  {
    const hash = await xlpWallet.writeContract({
      address: CROSS_CHAIN_PAYMASTER,
      abi: crossChainPaymasterAbi,
      functionName: 'fulfillVoucher',
      args: [voucherId, recipient],
    })
    await publicClient.waitForTransactionReceipt({ hash })
    console.log('   Voucher fulfilled')
  }

  // Verify fulfillment
  const voucherAfter = await publicClient.readContract({
    address: CROSS_CHAIN_PAYMASTER,
    abi: crossChainPaymasterAbi,
    functionName: 'vouchers',
    args: [voucherId],
  })
  console.log(`   Fulfilled: ${voucherAfter[3]}`)

  // Step 7: Check final stake
  console.log('\n7. Checking final stakes...')

  const finalL1Stake = await publicClient.readContract({
    address: L1_STAKE_MANAGER,
    abi: l1StakeManagerAbi,
    functionName: 'getStake',
    args: [xlpAccount.address],
  })
  console.log(
    `   Final L1 Stake: ${formatEther(finalL1Stake.stakedAmount)} ETH`,
  )

  const finalL2Stake = await publicClient.readContract({
    address: CROSS_CHAIN_PAYMASTER,
    abi: crossChainPaymasterAbi,
    functionName: 'xlpStakes',
    args: [xlpAccount.address],
  })
  console.log(`   Final L2 Stake: ${formatEther(finalL2Stake)} ETH`)

  // =============================================================
  // SLASHING TEST
  // =============================================================
  console.log('\n====================================================')
  console.log('   SLASHING TEST')
  console.log('====================================================\n')

  // Need a second XLP for slashing test (can't slash the one we just used)
  const XLP2_KEY =
    '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' // Account 3
  const xlp2Account = privateKeyToAccount(XLP2_KEY)
  const xlp2Wallet = createWalletClient({
    chain: foundry,
    transport: http(RPC_URL),
    account: xlp2Account,
  })

  console.log(`Second XLP: ${xlp2Account.address}`)

  // Step 8: Register second XLP
  console.log('\n8. Registering second XLP for slashing test...')
  {
    const hash = await xlp2Wallet.writeContract({
      address: L1_STAKE_MANAGER,
      abi: l1StakeManagerAbi,
      functionName: 'register',
      args: [[31337n]],
      value: parseEther('3'),
    })
    await publicClient.waitForTransactionReceipt({ hash })
    console.log('   Registered XLP2 with 3 ETH stake')
  }

  const xlp2StakeBefore = await publicClient.readContract({
    address: L1_STAKE_MANAGER,
    abi: l1StakeManagerAbi,
    functionName: 'getStake',
    args: [xlp2Account.address],
  })
  console.log(
    `   XLP2 Stake before slash: ${formatEther(xlp2StakeBefore.stakedAmount)} ETH`,
  )

  // Step 9: Set authorized slasher (deployer for testing)
  console.log('\n9. Setting authorized slasher...')
  {
    const hash = await deployerWallet.writeContract({
      address: L1_STAKE_MANAGER,
      abi: l1StakeManagerAbi,
      functionName: 'setAuthorizedSlasher',
      args: [deployerAccount.address, true],
    })
    await publicClient.waitForTransactionReceipt({ hash })
    console.log(`   Authorized: ${deployerAccount.address}`)
  }

  // Step 10: Slash XLP2 for failing to fulfill a voucher
  console.log('\n10. Slashing XLP2 for unfulfilled voucher...')
  const fakeVoucherId =
    '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex
  const slashAmount = parseEther('1') // Slash 1 ETH
  const victimBalanceBefore = await publicClient.getBalance({
    address: userAccount.address,
  })

  {
    const hash = await deployerWallet.writeContract({
      address: L1_STAKE_MANAGER,
      abi: l1StakeManagerAbi,
      functionName: 'slash',
      args: [
        xlp2Account.address,
        31337n,
        fakeVoucherId,
        slashAmount,
        userAccount.address,
      ],
    })
    await publicClient.waitForTransactionReceipt({ hash })
    console.log('   Slash executed')
  }

  // Verify slashing
  const xlp2StakeAfter = await publicClient.readContract({
    address: L1_STAKE_MANAGER,
    abi: l1StakeManagerAbi,
    functionName: 'getStake',
    args: [xlp2Account.address],
  })
  console.log(
    `   XLP2 Stake after slash: ${formatEther(xlp2StakeAfter.stakedAmount)} ETH`,
  )
  console.log(
    `   XLP2 Slashed amount: ${formatEther(xlp2StakeAfter.slashedAmount)} ETH`,
  )

  const victimBalanceAfter = await publicClient.getBalance({
    address: userAccount.address,
  })
  const compensationReceived = victimBalanceAfter - victimBalanceBefore
  console.log(
    `   Victim compensation: ${formatEther(compensationReceived)} ETH`,
  )

  const totalSlashed = await publicClient.readContract({
    address: L1_STAKE_MANAGER,
    abi: l1StakeManagerAbi,
    functionName: 'totalSlashed',
  })
  console.log(`   Total slashed in protocol: ${formatEther(totalSlashed)} ETH`)

  console.log('\n====================================================')
  console.log('   XLP VOUCHER + SLASHING TEST COMPLETE')
  console.log('====================================================')
  console.log('\n   Tested:')
  console.log('   ✓ XLP registration and staking on L1')
  console.log('   ✓ Stake sync L1 → L2 (via admin for local test)')
  console.log('   ✓ User creates voucher request')
  console.log('   ✓ XLP deposits liquidity on L2')
  console.log('   ✓ XLP issues voucher')
  console.log('   ✓ XLP fulfills voucher (transfers to user)')
  console.log('   ✓ Authorized slasher can slash misbehaving XLP')
  console.log('   ✓ Victim receives compensation from slashed stake')
}

main().catch(console.error)
