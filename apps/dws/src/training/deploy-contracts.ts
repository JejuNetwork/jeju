#!/usr/bin/env bun

/**
 * Deploy Training Contracts to Local Anvil
 *
 * Deploys real EVM contracts for fully decentralized training:
 * - Mock ERC20 reward token
 * - DistributedTrainingCoordinator
 *
 * Outputs deployed addresses for use in E2E tests.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

// Anvil default private key
const DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex
const ANVIL_RPC = 'http://127.0.0.1:9545'

// Mock ERC20 bytecode (simplified)
const MOCK_ERC20_ABI = parseAbi([
  'constructor(string name, string symbol, uint256 initialSupply)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

// Minimal ERC20 bytecode
const MOCK_ERC20_BYTECODE =
  '0x60806040523480156200001157600080fd5b5060405162000c3838038062000c388339810160408190526200003491620001db565b8251839083906200004d906003906020850190620000a1565b50805162000063906004906020840190620000a1565b50505062000078338262000080602090811b91909117901c565b505050620002f0565b6001600160a01b038216620000db5760405162461bcd60e51b815260206004820152601f60248201527f45524332303a206d696e7420746f20746865207a65726f206164647265737300604482015260640160405180910390fd5b8060026000828254620000ef919062000290565b90915550506001600160a01b038216600090815260208190526040812080548392906200011e90849062000290565b90915550506040518181526001600160a01b038316906000907fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9060200160405180910390a35050565b634e487b7160e01b600052604160045260246000fd5b600082601f8301126200019057600080fd5b81516001600160401b0380821115620001ad57620001ad62000168565b604051601f8301601f19908116603f01168101908282118183101715620001d857620001d862000168565b81604052838152602092508683858801011115620001f557600080fd5b600091505b838210156200021957858201830151818301840152908201906200001fa565b600093810190920192909252949350505050565b600080600060608486031215620002435761000080fd5b83516001600160401b03808211156200025b57600080fd5b62000269878388016200017e565b945060208601519150808211156200028057600080fd5b506200028f868287016200017e565b925050604084015190509250925092565b80820180821115620002c257634e487b7160e01b600052601160045260246000fd5b92915050565b61093880620003006000396000f3fe608060405234801561001057600080fd5b50600436106100a95760003560e01c806340c10f191161007157806340c10f191461012357806370a082311461013857806395d89b4114610161578063a9059cbb14610169578063dd62ed3e1461017c578063313ce567146101b557600080fd5b806306fdde03146100ae578063095ea7b3146100cc57806318160ddd146100ef57806323b872dd14610101578063395093511461011457600080fd5b3661010f57005b600080fd5b6100b66101c4565b6040516100c391906106d5565b60405180910390f35b6100df6100da366004610740565b610256565b60405190151581526020016100c3565b6002545b6040519081526020016100c3565b6100df61010f36600461076a565b61026e565b6100df610122366004610740565b610292565b610136610131366004610740565b6102b4565b005b6100f36101463660046107a6565b6001600160a01b031660009081526020819052604090205490565b6100b66102c2565b6100df610177366004610740565b6102d1565b6100f361018a3660046107c8565b6001600160a01b03918216600090815260016020908152604080832093909416825291909152205490565b604051601281526020016100c3565b6060600380546101d3906107fb565b80601f01602080910402602001604051908101604052809291908181526020018280546101ff906107fb565b801561024c5780601f106102215761010080835404028352916020019161024c565b820191906000526020600020905b81548152906001019060200180831161022f57829003601f168201915b5050505050905090565b6000336102648185856102df565b5060019392505050565b60003361027c858285610403565b61028785858561047d565b506001949350505050565b6000336102648185856102a5838361018a565b6102af9190610835565b6102df565b6102be8282610621565b5050565b6060600480546101d3906107fb565b60003361026481858561047d565b6001600160a01b0383166103415760405162461bcd60e51b8152602060048201526024808201527f45524332303a20617070726f76652066726f6d20746865207a65726f206164646044820152637265737360e01b60648201526084015b60405180910390fd5b6001600160a01b0382166103a25760405162461bcd60e51b815260206004820152602260248201527f45524332303a20617070726f766520746f20746865207a65726f206164647265604482015261737360f01b6064820152608401610338565b6001600160a01b0383811660008181526001602090815260408083209487168084529482529182902085905590518481527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925910160405180910390a3505050565b6000610410848461018a565b905060001981146104775781811015610468576040805162461bcd60e51b815260206004820152601d60248201527f45524332303a20696e73756666696369656e7420616c6c6f77616e6365000000604482015290519081900360640190fd5b61047784848484036102df565b50505050565b6001600160a01b0383166104e15760405162461bcd60e51b815260206004820152602560248201527f45524332303a207472616e736665722066726f6d20746865207a65726f206164604482015264647265737360d81b6064820152608401610338565b6001600160a01b0382166105435760405162461bcd60e51b815260206004820152602360248201527f45524332303a207472616e7366657220746f20746865207a65726f206164647260448201526265737360e81b6064820152608401610338565b6001600160a01b038316600090815260208190526040902054818110156105bb5760405162461bcd60e51b815260206004820152602660248201527f45524332303a207472616e7366657220616d6f756e7420657863656564732062604482015265616c616e636560d01b6064820152608401610338565b6001600160a01b038085166000908152602081905260408082208585039055918516815290812080548492906105f2908490610835565b92505081905550826001600160a01b0316846001600160a01b031660008051602061091e8339815191528460405161062c91815260200190565b60405180910390a3610477565b6001600160a01b0382166106775760405162461bcd60e51b815260206004820152601f60248201527f45524332303a206d696e7420746f20746865207a65726f2061646472657373006044820152606401610338565b80600260008282546106899190610835565b90915550506001600160a01b038216600081815260208181526040808320805486019055518481527fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef910160405180910390a35050565b600060208083528351808285015260005b8181101561070257858101830151858201604001528201610646565b506000604082860101526040601f19601f8301168501019250505092915050565b80356001600160a01b038116811461073a57600080fd5b92915050565b6000806040838503121561075357600080fd5b61075c83610723565b946020939093013593505050565b60008060006060848603121561077f57600080fd5b61078884610723565b925061079660208501610723565b9150604084013590509250925092565b6000602082840312156107b857600080fd5b6107c182610723565b9392505050565b600080604083850312156107db57600080fd5b6107e483610723565b91506107f260208401610723565b90509250929050565b600181811c9082168061080f57607f821691505b60208210810361082f57634e487b7160e01b600052602260045260246000fd5b50919050565b8082018082111561073a57634e487b7160e01b600052601160045260246000fdfeddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as Hex

// DistributedTrainingCoordinator ABI (simplified for deployment)
const COORDINATOR_ABI = [
  {
    type: 'constructor',
    inputs: [{ name: '_rewardToken', type: 'address' }],
  },
  {
    type: 'function',
    name: 'authorizeBridge',
    inputs: [
      { name: 'bridge', type: 'address' },
      { name: 'authorized', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerClient',
    inputs: [
      { name: 'evmAddress', type: 'address' },
      { name: 'solanaKey', type: 'bytes32' },
      { name: 'gpuType', type: 'string' },
      { name: 'gpuCount', type: 'uint8' },
      { name: 'memoryGb', type: 'uint16' },
    ],
    outputs: [{ type: 'uint32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createRun',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'environmentId', type: 'string' },
      { name: 'modelCid', type: 'string' },
      { name: 'targetEpochs', type: 'uint32' },
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'epochLengthMs', type: 'uint64' },
          { name: 'warmupEpochs', type: 'uint32' },
          { name: 'checkpointIntervalEpochs', type: 'uint32' },
          { name: 'learningRate', type: 'uint256' },
          { name: 'batchSize', type: 'uint32' },
          { name: 'gradientAccumulationSteps', type: 'uint32' },
          { name: 'maxSeqLength', type: 'uint32' },
          { name: 'rewardPerStep', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'joinRun',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'startRun',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'reportProgress',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'epoch', type: 'uint32' },
      { name: 'step', type: 'uint64' },
      { name: 'clientCount', type: 'uint32' },
      { name: 'modelHash', type: 'bytes32' },
      { name: 'solanaSignature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'finishRun',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getRunState',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [
      { name: 'epoch', type: 'uint32' },
      { name: 'step', type: 'uint64' },
      { name: 'clientCount', type: 'uint32' },
      { name: 'lastCheckpointEpoch', type: 'uint32' },
      { name: 'totalRewardsDistributed', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'clientIdByAddress',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ type: 'uint32' }],
    stateMutability: 'view',
  },
] as const

// Read the DistributedTrainingCoordinator bytecode from compiled artifact
async function getCoordinatorBytecode(): Promise<Hex> {
  // Compile with forge first, then read artifact
  const artifactPath =
    '/home/shaw/Documents/jeju/packages/contracts/out/DistributedTrainingCoordinator.sol/DistributedTrainingCoordinator.json'

  const file = Bun.file(artifactPath)
  if (!(await file.exists())) {
    console.log('[Deploy] Compiling contracts with forge...')
    const proc = Bun.spawn(
      ['forge', 'build', '--root', '/home/shaw/Documents/jeju/packages/contracts'],
      { stdout: 'inherit', stderr: 'inherit' },
    )
    await proc.exited
  }

  const artifact = await file.json()
  return artifact.bytecode.object as Hex
}

export interface DeployedContracts {
  rewardToken: Hex
  coordinator: Hex
  deployer: Hex
}

export async function deployTrainingContracts(): Promise<DeployedContracts> {
  console.log('='.repeat(70))
  console.log('DEPLOYING TRAINING CONTRACTS')
  console.log('='.repeat(70))

  const account = privateKeyToAccount(DEPLOYER_KEY)
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(ANVIL_RPC),
  })
  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(ANVIL_RPC),
  })

  // Check anvil is running
  const blockNumber = await publicClient.getBlockNumber().catch(() => null)
  if (blockNumber === null) {
    throw new Error('Anvil not running. Start with: anvil --port 9545')
  }
  console.log(`[Deploy] Connected to Anvil at block ${blockNumber}`)
  console.log(`[Deploy] Deployer: ${account.address}`)

  // 1. Deploy Mock ERC20 Reward Token
  console.log('\n[1/2] Deploying Reward Token (TRAIN)...')

  const tokenHash = await walletClient.deployContract({
    abi: MOCK_ERC20_ABI,
    bytecode: MOCK_ERC20_BYTECODE,
    args: ['Training Reward Token', 'TRAIN', BigInt(1000000) * BigInt(10 ** 18)],
  })

  const tokenReceipt = await publicClient.waitForTransactionReceipt({
    hash: tokenHash,
  })
  const rewardTokenAddress = tokenReceipt.contractAddress
  if (!rewardTokenAddress) throw new Error('Token deployment failed')
  console.log(`       Reward Token: ${rewardTokenAddress}`)

  // 2. Deploy DistributedTrainingCoordinator
  console.log('\n[2/2] Deploying DistributedTrainingCoordinator...')
  const coordinatorBytecode = await getCoordinatorBytecode()

  const coordinatorHash = await walletClient.deployContract({
    abi: COORDINATOR_ABI,
    bytecode: coordinatorBytecode,
    args: [rewardTokenAddress],
  })

  const coordinatorReceipt = await publicClient.waitForTransactionReceipt({
    hash: coordinatorHash,
  })
  const coordinatorAddress = coordinatorReceipt.contractAddress
  if (!coordinatorAddress) throw new Error('Coordinator deployment failed')
  console.log(`       Coordinator: ${coordinatorAddress}`)

  // 3. Authorize deployer as bridge
  console.log('\n[3/3] Authorizing deployer as bridge...')
  const authHash = await walletClient.writeContract({
    address: coordinatorAddress,
    abi: COORDINATOR_ABI,
    functionName: 'authorizeBridge',
    args: [account.address, true],
  })
  await publicClient.waitForTransactionReceipt({ hash: authHash })
  console.log('       Deployer authorized as bridge')

  // Summary
  console.log('\n' + '='.repeat(70))
  console.log('DEPLOYMENT COMPLETE')
  console.log('='.repeat(70))
  console.log(`Reward Token:  ${rewardTokenAddress}`)
  console.log(`Coordinator:   ${coordinatorAddress}`)
  console.log(`Deployer:      ${account.address}`)
  console.log('='.repeat(70))

  return {
    rewardToken: rewardTokenAddress,
    coordinator: coordinatorAddress,
    deployer: account.address,
  }
}

// Run if called directly
if (import.meta.main) {
  deployTrainingContracts()
    .then((contracts) => {
      // Write to file for other scripts to use
      const configPath = './training_output/deployed-contracts.json'
      Bun.write(configPath, JSON.stringify(contracts, null, 2))
      console.log(`\nConfig written to: ${configPath}`)
    })
    .catch((err) => {
      console.error('Deployment failed:', err)
      process.exit(1)
    })
}

