/**
 * End-to-End Attestation Tests
 * Requires: Anvil on port 9545, contracts deployed (run scripts/start-council-dev.sh)
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodePacked,
  http,
  keccak256,
  type PublicClient,
  parseAbi,
  stringToBytes,
  stringToHex,
  zeroAddress,
} from 'viem'
import {
  type PrivateKeyAccount,
  privateKeyToAccount,
} from 'viem/accounts'
import { foundry } from 'viem/chains'

const RPC_URL =
  process.env.RPC_URL ?? process.env.L2_RPC_URL ?? 'http://localhost:6546'
const CHAIN_ID = 31337
const DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const USER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const

const COUNCIL_ABI = parseAbi([
  'function submitProposalWithAttestation(uint8 proposalType, uint8 qualityScore, bytes32 contentHash, address targetContract, bytes calldata callData, uint256 value, uint256 attestationTimestamp, bytes calldata attestationSignature) external payable returns (bytes32)',
  'function proposalBond() external view returns (uint256)',
])

const QUALITY_ORACLE_ABI = parseAbi([
  'function verifyScore(bytes32 contentHash, uint256 qualityScore, uint256 attestationTimestamp, address proposer, bytes attestationSignature) external view',
  'function isAssessor(address) external view returns (bool)',
  'function minScore() external view returns (uint256)',
])

async function signAttestation(
  contentHash: `0x${string}`,
  score: number,
  timestamp: number,
  proposerAddress: Address,
  assessorKey: `0x${string}`,
  chainId: number,
): Promise<{ signature: `0x${string}`; assessor: Address }> {
  const messageHash = keccak256(
    encodePacked(
      ['string', 'bytes32', 'uint256', 'uint256', 'address', 'uint256'],
      [
        'QualityAttestation',
        contentHash,
        BigInt(score),
        BigInt(timestamp),
        proposerAddress,
        BigInt(chainId),
      ],
    ),
  )

  const account = privateKeyToAccount(assessorKey)
  const signature = await account.signMessage({
    message: { raw: messageHash },
  })

  return { signature, assessor: account.address }
}

function getContentHash(
  title: string,
  description: string,
  proposalType: number,
): `0x${string}` {
  return keccak256(
    stringToBytes(JSON.stringify({ title, description, proposalType })),
  )
}

async function checkAnvil(publicClient: PublicClient): Promise<boolean> {
  try {
    await publicClient.getBlockNumber()
    return true
  } catch {
    return false
  }
}

async function checkContractsDeployed(
  publicClient: PublicClient,
  councilAddress: Address,
): Promise<boolean> {
  try {
    const code = await publicClient.getBytecode({ address: councilAddress })
    return code !== undefined && code !== '0x' && code.length > 2
  } catch {
    return false
  }
}

describe('Attestation End-to-End Tests', () => {
  let publicClient: PublicClient
  let deployer: PrivateKeyAccount
  let user: PrivateKeyAccount
  let councilAddress: Address
  let qualityOracleAddress: Address
  let anvilRunning: boolean = false
  let contractsDeployed: boolean = false

  beforeAll(async () => {
    deployer = privateKeyToAccount(DEPLOYER_KEY)
    user = privateKeyToAccount(USER_KEY)
    publicClient = createPublicClient({
      chain: foundry,
      transport: http(RPC_URL),
    })

    anvilRunning = await checkAnvil(publicClient)
    if (!anvilRunning) {
      console.log('⚠️  Anvil not running. Run: scripts/start-council-dev.sh')
      return
    }

    councilAddress = (process.env.COUNCIL_ADDRESS ??
      '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9') as Address
    qualityOracleAddress = (process.env.QUALITY_ORACLE_ADDRESS ??
      '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707') as Address

    // Check if contracts are deployed
    contractsDeployed = await checkContractsDeployed(
      publicClient,
      councilAddress,
    )
    if (!contractsDeployed) {
      console.log('⚠️  Contracts not deployed - on-chain tests will be skipped')
      console.log(
        '   Run: jeju dev --bootstrap or scripts/start-council-dev.sh',
      )
      return
    }

    console.log('✅ Connected to Anvil')
    console.log(`   Council: ${councilAddress}`)
    console.log(`   QualityOracle: ${qualityOracleAddress}`)
  })

  test('signAttestation generates valid signature', async () => {
    if (!anvilRunning) return

    const contentHash = getContentHash('Test Proposal', 'Test Description', 1)
    const score = 95
    const timestamp = Math.floor(Date.now() / 1000)

    const { signature, assessor } = await signAttestation(
      contentHash,
      score,
      timestamp,
      user.address,
      DEPLOYER_KEY,
      CHAIN_ID,
    )

    expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/)
    expect(assessor).toBe(deployer.address)
    console.log('✅ Attestation signature generated')
  })

  test('verifyScore validates signature on-chain (view call)', async () => {
    if (!anvilRunning || !contractsDeployed) return

    const contentHash = getContentHash('Verify Test', 'Testing verifyScore', 1)
    const score = 95
    const timestamp = Math.floor(Date.now() / 1000)

    const { signature } = await signAttestation(
      contentHash,
      score,
      timestamp,
      user.address,
      DEPLOYER_KEY,
      CHAIN_ID,
    )

    // Should not revert (valid attestation)
    await publicClient.readContract({
      address: qualityOracleAddress,
      abi: QUALITY_ORACLE_ABI,
      functionName: 'verifyScore',
      args: [
        contentHash,
        BigInt(score),
        BigInt(timestamp),
        user.address,
        signature,
      ],
    })
    console.log('✅ On-chain attestation verification passed')
  })

  test('submitProposalWithAttestation creates proposal on-chain', async () => {
    if (!anvilRunning || !contractsDeployed) return

    const title = `E2E Test Proposal ${Date.now()}`
    const description = 'End-to-end test proposal with attestation'
    const proposalType = 1
    const contentHash = getContentHash(title, description, proposalType)
    const score = 95
    const timestamp = Math.floor(Date.now() / 1000)

    const { signature } = await signAttestation(
      contentHash,
      score,
      timestamp,
      user.address,
      DEPLOYER_KEY,
      CHAIN_ID,
    )
    const proposalBond = await publicClient.readContract({
      address: councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'proposalBond',
    })
    console.log(`   Proposal bond: ${proposalBond.toString()} wei`)

    const userWalletClient = createWalletClient({
      chain: foundry,
      transport: http(RPC_URL),
      account: user,
    })
    const hash = await userWalletClient.writeContract({
      address: councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'submitProposalWithAttestation',
      args: [
        proposalType,
        score,
        contentHash,
        zeroAddress,
        '0x',
        0n,
        BigInt(timestamp),
        signature,
      ],
      value: proposalBond,
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')
    console.log(`✅ Proposal submitted, tx: ${receipt.transactionHash}`)

    const proposalSubmittedTopic = keccak256(
      stringToHex(
        'ProposalSubmitted(bytes32,address,uint256,uint8,uint8,bytes32)',
      ),
    )
    const submittedLog = receipt.logs.find(
      (log) => log.topics[0] === proposalSubmittedTopic,
    )
    expect(submittedLog).toBeDefined()
    if (!submittedLog) throw new Error('submittedLog not found')

    const proposalId = submittedLog.topics[1]
    console.log(`   Proposal ID: ${proposalId}`)
    expect(proposalId).toMatch(/^0x[a-fA-F0-9]{64}$/)
    console.log('✅ Proposal verified on-chain (created with attestation)')
  })

  test('attestation with score below minimum fails', async () => {
    if (!anvilRunning || !contractsDeployed) return

    const contentHash = getContentHash(
      'Low Score Test',
      'Testing low score rejection',
      1,
    )
    const score = 50
    const timestamp = Math.floor(Date.now() / 1000)

    const { signature } = await signAttestation(
      contentHash,
      score,
      timestamp,
      user.address,
      DEPLOYER_KEY,
      CHAIN_ID,
    )

    const proposalBond = await publicClient.readContract({
      address: councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'proposalBond',
    })
    const userWalletClient = createWalletClient({
      chain: foundry,
      transport: http(RPC_URL),
      account: user,
    })

    await expect(
      userWalletClient.writeContract({
        address: councilAddress,
        abi: COUNCIL_ABI,
        functionName: 'submitProposalWithAttestation',
        args: [
          1,
          score,
          contentHash,
          zeroAddress,
          '0x',
          0n,
          BigInt(timestamp),
          signature,
        ],
        value: proposalBond,
      }),
    ).rejects.toThrow()

    console.log('✅ Low score correctly rejected')
  })

  test('attestation from non-assessor fails', async () => {
    if (!anvilRunning || !contractsDeployed) return

    const contentHash = getContentHash(
      'Non-Assessor Test',
      'Testing non-assessor rejection',
      1,
    )
    const score = 95
    const timestamp = Math.floor(Date.now() / 1000)

    const { signature } = await signAttestation(
      contentHash,
      score,
      timestamp,
      user.address,
      USER_KEY,
      CHAIN_ID,
    )

    const proposalBond = await publicClient.readContract({
      address: councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'proposalBond',
    })
    const userWalletClient = createWalletClient({
      chain: foundry,
      transport: http(RPC_URL),
      account: user,
    })

    await expect(
      userWalletClient.writeContract({
        address: councilAddress,
        abi: COUNCIL_ABI,
        functionName: 'submitProposalWithAttestation',
        args: [
          1,
          score,
          contentHash,
          zeroAddress,
          '0x',
          0n,
          BigInt(timestamp),
          signature,
        ],
        value: proposalBond,
      }),
    ).rejects.toThrow()

    console.log('✅ Non-assessor correctly rejected')
  })

  test('expired attestation fails', async () => {
    if (!anvilRunning || !contractsDeployed) return

    const contentHash = getContentHash(
      'Expired Test',
      'Testing expired attestation',
      1,
    )
    const score = 95
    const timestamp = Math.floor(Date.now() / 1000) - 7200

    const { signature } = await signAttestation(
      contentHash,
      score,
      timestamp,
      user.address,
      DEPLOYER_KEY,
      CHAIN_ID,
    )

    const proposalBond = await publicClient.readContract({
      address: councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'proposalBond',
    })
    const userWalletClient = createWalletClient({
      chain: foundry,
      transport: http(RPC_URL),
      account: user,
    })

    await expect(
      userWalletClient.writeContract({
        address: councilAddress,
        abi: COUNCIL_ABI,
        functionName: 'submitProposalWithAttestation',
        args: [
          1,
          score,
          contentHash,
          zeroAddress,
          '0x',
          0n,
          BigInt(timestamp),
          signature,
        ],
        value: proposalBond,
      }),
    ).rejects.toThrow()

    console.log('✅ Expired attestation correctly rejected')
  })
})
