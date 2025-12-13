/**
 * End-to-End Attestation Tests
 * Requires: Anvil on port 9545, contracts deployed (run scripts/start-council-dev.sh)
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { ethers, Contract, Wallet, JsonRpcProvider, solidityPackedKeccak256, getBytes, keccak256, toUtf8Bytes } from 'ethers';

const RPC_URL = process.env.RPC_URL ?? 'http://localhost:9545';
const CHAIN_ID = 31337;
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const USER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const COUNCIL_ABI = [
  'function submitProposalWithAttestation(uint8 proposalType, uint8 qualityScore, bytes32 contentHash, address targetContract, bytes calldata callData, uint256 value, uint256 attestationTimestamp, bytes calldata attestationSignature) external payable returns (bytes32)',
  'function proposalBond() external view returns (uint256)',
];

const QUALITY_ORACLE_ABI = [
  'function verifyScore(bytes32 contentHash, uint256 qualityScore, uint256 attestationTimestamp, address proposer, bytes attestationSignature) external view',
  'function isAssessor(address) external view returns (bool)',
  'function minScore() external view returns (uint256)',
];

function signAttestation(
  contentHash: string,
  score: number,
  timestamp: number,
  proposerAddress: string,
  assessorKey: string,
  chainId: number
): { signature: string; assessor: string } {
  const messageHash = solidityPackedKeccak256(
    ['string', 'bytes32', 'uint256', 'uint256', 'address', 'uint256'],
    ['JejuQualityAttestation', contentHash, score, timestamp, proposerAddress, chainId]
  );
  
  const wallet = new Wallet(assessorKey);
  const signature = wallet.signMessageSync(getBytes(messageHash));
  
  return { signature, assessor: wallet.address };
}

function getContentHash(title: string, description: string, proposalType: number): string {
  return keccak256(toUtf8Bytes(JSON.stringify({ title, description, proposalType })));
}

async function checkAnvil(): Promise<boolean> {
  try {
    const provider = new JsonRpcProvider(RPC_URL);
    await provider.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

describe('Attestation End-to-End Tests', () => {
  let provider: JsonRpcProvider;
  let deployer: Wallet;
  let user: Wallet;
  let council: Contract;
  let qualityOracle: Contract;
  let anvilRunning: boolean;

  beforeAll(async () => {
    anvilRunning = await checkAnvil();
    if (!anvilRunning) {
      console.log('⚠️  Anvil not running. Run: scripts/start-council-dev.sh');
      return;
    }

    provider = new JsonRpcProvider(RPC_URL);
    deployer = new Wallet(DEPLOYER_KEY, provider);
    user = new Wallet(USER_KEY, provider);

    const councilAddress = process.env.COUNCIL_ADDRESS ?? '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';
    const qualityOracleAddress = process.env.QUALITY_ORACLE_ADDRESS ?? '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707';

    council = new Contract(councilAddress, COUNCIL_ABI, deployer);
    qualityOracle = new Contract(qualityOracleAddress, QUALITY_ORACLE_ABI, deployer);

    console.log('✅ Connected to Anvil');
    console.log(`   Council: ${councilAddress}`);
    console.log(`   QualityOracle: ${qualityOracleAddress}`);
  });

  test('signAttestation generates valid signature', async () => {
    if (!anvilRunning) return;

    const contentHash = getContentHash('Test Proposal', 'Test Description', 1);
    const score = 95;
    const timestamp = Math.floor(Date.now() / 1000);

    const { signature, assessor } = signAttestation(contentHash, score, timestamp, user.address, DEPLOYER_KEY, CHAIN_ID);

    expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
    expect(assessor).toBe(deployer.address);
    console.log('✅ Attestation signature generated');
  });

  test('verifyScore validates signature on-chain (view call)', async () => {
    if (!anvilRunning) return;

    const contentHash = getContentHash('Verify Test', 'Testing verifyScore', 1);
    const score = 95;
    const timestamp = Math.floor(Date.now() / 1000);

    const { signature } = signAttestation(contentHash, score, timestamp, user.address, DEPLOYER_KEY, CHAIN_ID);

    // Should not revert (valid attestation)
    await qualityOracle.verifyScore(contentHash, score, timestamp, user.address, signature);
    console.log('✅ On-chain attestation verification passed');
  });

  test('submitProposalWithAttestation creates proposal on-chain', async () => {
    if (!anvilRunning) return;

    const title = `E2E Test Proposal ${Date.now()}`;
    const description = 'End-to-end test proposal with attestation';
    const proposalType = 1;
    const contentHash = getContentHash(title, description, proposalType);
    const score = 95;
    const timestamp = Math.floor(Date.now() / 1000);

    const { signature } = signAttestation(contentHash, score, timestamp, user.address, DEPLOYER_KEY, CHAIN_ID);
    const proposalBond = await council.proposalBond();
    console.log(`   Proposal bond: ${ethers.formatEther(proposalBond)} ETH`);

    const councilAsUser = council.connect(user) as Contract;
    const tx = await councilAsUser.submitProposalWithAttestation(
      proposalType, score, contentHash, ethers.ZeroAddress, '0x', 0, timestamp, signature,
      { value: proposalBond }
    );

    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);
    console.log(`✅ Proposal submitted, tx: ${receipt.hash}`);

    const proposalSubmittedTopic = ethers.id('ProposalSubmitted(bytes32,address,uint256,uint8,uint8,bytes32)');
    const submittedLog = receipt.logs.find((log: ethers.Log) => log.topics[0] === proposalSubmittedTopic);
    expect(submittedLog).toBeDefined();

    const proposalId = submittedLog!.topics[1];
    console.log(`   Proposal ID: ${proposalId}`);
    expect(proposalId).toMatch(/^0x[a-fA-F0-9]{64}$/);
    console.log('✅ Proposal verified on-chain (created with attestation)');
  });

  test('attestation with score below minimum fails', async () => {
    if (!anvilRunning) return;

    const contentHash = getContentHash('Low Score Test', 'Testing low score rejection', 1);
    const score = 50;
    const timestamp = Math.floor(Date.now() / 1000);

    const { signature } = signAttestation(contentHash, score, timestamp, user.address, DEPLOYER_KEY, CHAIN_ID);

    const proposalBond = await council.proposalBond();
    const councilAsUser = council.connect(user) as Contract;

    await expect(
      councilAsUser.submitProposalWithAttestation(
        1, score, contentHash, ethers.ZeroAddress, '0x', 0, timestamp, signature,
        { value: proposalBond }
      )
    ).rejects.toThrow();
    
    console.log('✅ Low score correctly rejected');
  });

  test('attestation from non-assessor fails', async () => {
    if (!anvilRunning) return;

    const contentHash = getContentHash('Non-Assessor Test', 'Testing non-assessor rejection', 1);
    const score = 95;
    const timestamp = Math.floor(Date.now() / 1000);

    const { signature } = signAttestation(contentHash, score, timestamp, user.address, USER_KEY, CHAIN_ID);

    const proposalBond = await council.proposalBond();
    const councilAsUser = council.connect(user) as Contract;

    await expect(
      councilAsUser.submitProposalWithAttestation(
        1, score, contentHash, ethers.ZeroAddress, '0x', 0, timestamp, signature,
        { value: proposalBond }
      )
    ).rejects.toThrow();
    
    console.log('✅ Non-assessor correctly rejected');
  });

  test('expired attestation fails', async () => {
    if (!anvilRunning) return;

    const contentHash = getContentHash('Expired Test', 'Testing expired attestation', 1);
    const score = 95;
    const timestamp = Math.floor(Date.now() / 1000) - 7200;

    const { signature } = signAttestation(contentHash, score, timestamp, user.address, DEPLOYER_KEY, CHAIN_ID);

    const proposalBond = await council.proposalBond();
    const councilAsUser = council.connect(user) as Contract;

    await expect(
      councilAsUser.submitProposalWithAttestation(
        1, score, contentHash, ethers.ZeroAddress, '0x', 0, timestamp, signature,
        { value: proposalBond }
      )
    ).rejects.toThrow();
    
    console.log('✅ Expired attestation correctly rejected');
  });
});
