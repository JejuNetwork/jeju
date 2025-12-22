#!/usr/bin/env bun

/**
 * EVM DistributedTrainingCoordinator Integration Test
 *
 * Deploys and tests the full EVM training coordinator contract.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  type Abi,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

const EVM_RPC_URL = 'http://localhost:6546'
const EVM_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex
const SECOND_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex

// Mock ERC20 for testing
const MOCK_ERC20_ABI = parseAbi([
  'constructor()',
  'function mint(address to, uint256 amount) public',
  'function approve(address spender, uint256 amount) public returns (bool)',
  'function balanceOf(address owner) public view returns (uint256)',
  'function transfer(address to, uint256 amount) public returns (bool)',
])

// ABI will be loaded from compiled contract
let COORDINATOR_ABI: Abi

// Simple test token bytecode (minimal ERC20)
const MOCK_TOKEN_BYTECODE =
  '0x608060405234801561001057600080fd5b506040518060400160405280600981526020017f54657374546f6b656e00000000000000000000000000000000000000000000008152506040518060400160405280600381526020017f545354000000000000000000000000000000000000000000000000000000000081525081600090816100919190610303565b5080600190816100a19190610303565b5050506103d5565b600081519050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602260045260246000fd5b6000600282049050600182168061012a57607f821691505b60208210810361013d5761013c6100e3565b5b50919050565b60008190508160005260206000209050919050565b60006020601f8301049050919050565b600082821b905092915050565b6000600883026101a57fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff82610168565b6101af8683610168565b95508019841693508086168417925050509392505050565b6000819050919050565b6000819050919050565b60006101f66101f16101ec846101c7565b6101d1565b6101c7565b9050919050565b6000819050919050565b610210836101db565b61022461021c826101fd565b848454610175565b825550505050565b600090565b61023961022c565b610244818484610207565b505050565b5b818110156102685761025d600082610231565b60018101905061024a565b5050565b601f8211156102ad5761027e81610143565b61028784610158565b81016020851015610296578190505b6102aa6102a285610158565b830182610249565b50505b505050565b600082821c905092915050565b60006102d0600019846008026102b2565b1980831691505092915050565b60006102e983836102bf565b9150826002028217905092915050565b610302826100a9565b67ffffffffffffffff81111561031b5761031a6100b4565b5b6103258254610112565b61033082828561026c565b600060209050601f8311600181146103635760008415610351578287015190505b61035b85826102dd565b8655506103c3565b601f19841661037186610143565b60005b8281101561039957848901518255600182019150602085019450602081019050610374565b868310156103b657848901516103b2601f8916826102bf565b8355505b6001600288020188555050505b505050505050565b610685806103e46000396000f3fe608060405234801561001057600080fd5b50600436106100625760003560e01c806306fdde031461006757806340c10f1914610085578063a9059cbb146100a1578063dd62ed3e146100d1578063095ea7b31461010157806370a0823114610131575b600080fd5b61006f610161565b60405161007c91906104a3565b60405180910390f35b61009f600480360381019061009a9190610503565b6101f3565b005b6100bb60048036038101906100b69190610503565b610201565b6040516100c8919061055e565b60405180910390f35b6100eb60048036038101906100e69190610579565b610215565b6040516100f891906105d8565b60405180910390f35b61011b60048036038101906101169190610503565b61029c565b604051610128919061055e565b60405180910390f35b61014b600480360381019061014691906105f3565b6102b0565b60405161015891906105d8565b60405180910390f35b60606000805461017090610649565b80601f016020809104026020016040519081016040528092919081815260200182805461019c90610649565b80156101e95780601f106101be576101008083540402835291602001916101e9565b820191906000526020600020905b8154815290600101906020018083116101cc57829003601f168201915b5050505050905090565b6101fd82826102f8565b5050565b600061020e338484610355565b9392505050565b6000600360008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002054905092915050565b60006102a9338484610355565b9392505050565b6000600260008373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020549050919050565b8060026000828254610306919061067a565b9250508190555080600260008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020819055505050565b60019392505050565b600081519050919050565b600082825260208201905092915050565b60005b83811015610398578082015181840152602081019050610378565b60008484015250505050565b6000601f19601f8301169050919050565b60006103c08261035e565b6103ca8185610369565b93506103da81856020860161037a565b6103e3816103a4565b840191505092915050565b6000602082019050818103600083015261040881846103b5565b905092915050565b600080fd5b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b600061044082610415565b9050919050565b61045081610435565b811461045b57600080fd5b50565b60008135905061046d81610447565b92915050565b6000819050919050565b61048681610473565b811461049157600080fd5b50565b6000813590506104a38161047d565b92915050565b600080604083850312156104c0576104bf610410565b5b60006104ce8582860161045e565b92505060206104df85828601610494565b9150509250929050565b60008115159050919050565b6104fe816104e9565b82525050565b600060208201905061051960008301846104f5565b92915050565b600080604083850312156105365761053561041056'

async function main() {
  console.log('='.repeat(60))
  console.log('EVM DistributedTrainingCoordinator Test')
  console.log('='.repeat(60))

  const account = privateKeyToAccount(EVM_PRIVATE_KEY)
  const secondAccount = privateKeyToAccount(SECOND_PRIVATE_KEY)

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(EVM_RPC_URL),
  })

  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(EVM_RPC_URL),
  })

  const secondWalletClient = createWalletClient({
    account: secondAccount,
    chain: foundry,
    transport: http(EVM_RPC_URL),
  })

  // Read compiled contract
  const contractPath = path.join(
    __dirname,
    '../../../../packages/contracts/out/DistributedTrainingCoordinator.sol/DistributedTrainingCoordinator.json',
  )

  // Check if we have the compiled contract
  if (!fs.existsSync(contractPath)) {
    console.log('\n[1] Compiled contract not found...')
    console.log('   Please run: cd packages/contracts && forge build')
    process.exit(1)
  }

  console.log('\n[1] Loading compiled contract...')
  const artifact = JSON.parse(fs.readFileSync(contractPath, 'utf-8'))
  const coordinatorBytecode = artifact.bytecode.object as Hex
  COORDINATOR_ABI = artifact.abi
  console.log('   Contract bytecode and ABI loaded')

  // Deploy mock token first
  console.log('\n[2] Deploying mock reward token...')
  const tokenDeployHash = await walletClient.deployContract({
    abi: MOCK_ERC20_ABI,
    bytecode: MOCK_TOKEN_BYTECODE,
    args: [],
  })
  const tokenReceipt = await publicClient.waitForTransactionReceipt({
    hash: tokenDeployHash,
  })
  if (!tokenReceipt.contractAddress) {
    throw new Error('Token deployment failed: no contract address')
  }
  const tokenAddress = tokenReceipt.contractAddress
  console.log(`   Token deployed at: ${tokenAddress}`)

  // Deploy coordinator
  console.log('\n[3] Deploying DistributedTrainingCoordinator...')
  const deployHash = await walletClient.deployContract({
    abi: COORDINATOR_ABI,
    bytecode: coordinatorBytecode,
    args: [tokenAddress],
  })
  const deployReceipt = await publicClient.waitForTransactionReceipt({
    hash: deployHash,
  })
  if (!deployReceipt.contractAddress) {
    throw new Error('Coordinator deployment failed: no contract address')
  }
  const coordinatorAddress = deployReceipt.contractAddress
  console.log(`   Coordinator deployed at: ${coordinatorAddress}`)

  // Test 1: Create a training run
  console.log('\n[4] Creating training run...')
  const runId = keccak256(Buffer.from(`jeju-test-run-${Date.now()}`)) as Hex

  const createRunHash = await walletClient.writeContract({
    address: coordinatorAddress,
    abi: COORDINATOR_ABI,
    functionName: 'createRun',
    args: [
      runId,
      'fundamental-prediction',
      'ipfs://QmTest123',
      100, // targetEpochs
      {
        epochLengthMs: 60000n,
        warmupEpochs: 5,
        checkpointIntervalEpochs: 10,
        learningRate: BigInt(1e15), // 0.001 scaled
        batchSize: 8,
        gradientAccumulationSteps: 4,
        maxSeqLength: 2048,
        rewardPerStep: BigInt(1e18), // 1 token per step
      },
    ],
  })
  await publicClient.waitForTransactionReceipt({ hash: createRunHash })
  console.log(`   Run created: ${runId.slice(0, 18)}...`)

  // Test 2: Register a client
  console.log('\n[5] Registering training client...')
  const solanaKey = keccak256(Buffer.from('mock-solana-key')) as Hex

  const registerHash = await secondWalletClient.writeContract({
    address: coordinatorAddress,
    abi: COORDINATOR_ABI,
    functionName: 'registerClient',
    args: [secondAccount.address, solanaKey, 'RTX5090', 1, 16],
  })
  await publicClient.waitForTransactionReceipt({ hash: registerHash })
  console.log(`   Client registered: ${secondAccount.address}`)

  // Test 3: Join run
  console.log('\n[6] Client joining run...')
  const joinHash = await secondWalletClient.writeContract({
    address: coordinatorAddress,
    abi: COORDINATOR_ABI,
    functionName: 'joinRun',
    args: [runId],
  })
  await publicClient.waitForTransactionReceipt({ hash: joinHash })
  console.log('   Client joined run')

  // Test 4: Start run
  console.log('\n[7] Starting training run...')
  const startHash = await walletClient.writeContract({
    address: coordinatorAddress,
    abi: COORDINATOR_ABI,
    functionName: 'startRun',
    args: [runId],
  })
  await publicClient.waitForTransactionReceipt({ hash: startHash })
  console.log('   Run started (state: WarmingUp)')

  // Test 5: Authorize bridge and report progress
  console.log('\n[8] Authorizing bridge and reporting progress...')
  const authHash = await walletClient.writeContract({
    address: coordinatorAddress,
    abi: COORDINATOR_ABI,
    functionName: 'authorizeBridge',
    args: [account.address, true],
  })
  await publicClient.waitForTransactionReceipt({ hash: authHash })

  const progressHash = await walletClient.writeContract({
    address: coordinatorAddress,
    abi: COORDINATOR_ABI,
    functionName: 'reportProgress',
    args: [
      runId,
      10, // epoch
      100n, // step
      1, // clientCount
      keccak256(Buffer.from('model-v1')) as Hex,
      '0x' as Hex, // solanaSignature
    ],
  })
  await publicClient.waitForTransactionReceipt({ hash: progressHash })
  console.log('   Progress reported: epoch=10, step=100')

  // Test 6: Submit checkpoint
  console.log('\n[9] Submitting checkpoint...')
  const checkpointHash = await walletClient.writeContract({
    address: coordinatorAddress,
    abi: COORDINATOR_ABI,
    functionName: 'submitCheckpoint',
    args: [
      runId,
      'ipfs://QmCheckpoint123',
      10,
      keccak256(Buffer.from('checkpoint-merkle')) as Hex,
    ],
  })
  await publicClient.waitForTransactionReceipt({ hash: checkpointHash })
  console.log('   Checkpoint submitted: epoch=10')

  // Test 7: Get run state
  console.log('\n[10] Querying run state...')
  const runState = (await publicClient.readContract({
    address: coordinatorAddress,
    abi: COORDINATOR_ABI,
    functionName: 'getRunState',
    args: [runId],
  })) as readonly [bigint, bigint, bigint, bigint]
  console.log(`   Epoch: ${runState[0]}`)
  console.log(`   Step: ${runState[1]}`)
  console.log(`   Clients: ${runState[2]}`)
  console.log(`   Last Checkpoint Epoch: ${runState[3]}`)

  // Summary
  console.log(`\n${'='.repeat(60)}`)
  console.log('EVM COORDINATOR TEST COMPLETE')
  console.log('='.repeat(60))
  console.log('\nDeployed Contracts:')
  console.log(`  Token:       ${tokenAddress}`)
  console.log(`  Coordinator: ${coordinatorAddress}`)
  console.log('\nTest Results:')
  console.log('  ✓ Contract deployment')
  console.log('  ✓ Run creation')
  console.log('  ✓ Client registration')
  console.log('  ✓ Run joining')
  console.log('  ✓ Run starting')
  console.log('  ✓ Bridge authorization')
  console.log('  ✓ Progress reporting')
  console.log('  ✓ Checkpoint submission')
  console.log('  ✓ State queries')
  console.log('='.repeat(60))
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
