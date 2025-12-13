import { ethers } from 'ethers';

interface ChallengeEvent {
  gameId: string;
  challenger: string;
  proposer: string;
  stateRoot: string;
  claimRoot: string;
  bondAmount: bigint;
  timestamp: number;
}

interface OutputProposal {
  outputIndex: bigint;
  l2BlockNumber: bigint;
  stateRoot: string;
  outputRoot: string;
  proposer: string;
}

interface ProofData {
  version: number;
  proofType: number;
  preStateRoot: string;
  postStateRoot: string;
  blockHash: string;
  blockNumber: bigint;
  outputRoot: string;
  signers: string[];
  signatures: string[];
}

const PROOF_VERSION = 1;
const FRAUD_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes('JEJU_FRAUD_PROOF_V1'));
const DEFENSE_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes('JEJU_DEFENSE_PROOF_V1'));

export class ChallengerAdapter {
  private pendingChallenges = new Map<string, ChallengeEvent>();
  private isMonitoring = false;
  private trustedStateRoots = new Map<string, string>();
  private validatorWallets: ethers.Wallet[] = [];

  constructor(
    private provider: ethers.Provider,
    private disputeGameFactory: ethers.Contract,
    private l2OutputOracle: ethers.Contract
  ) {}

  addValidator(wallet: ethers.Wallet): void {
    this.validatorWallets.push(wallet);
  }

  setTrustedStateRoot(l2BlockNumber: string, stateRoot: string): void {
    this.trustedStateRoots.set(l2BlockNumber, stateRoot);
  }

  async monitorAndChallenge(challengerSigner?: ethers.Signer): Promise<void> {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    console.log('Monitoring for invalid outputs...');

    this.l2OutputOracle.on('OutputProposed', async (
      outputIndex: bigint, l2BlockNumber: bigint, stateRoot: string, outputRoot: string, proposer: string
    ) => {
      const output: OutputProposal = { outputIndex, l2BlockNumber, stateRoot, outputRoot, proposer };
      console.log(`Output proposed at L2 block ${l2BlockNumber}`);

      const isValid = await this.verifyStateRoot(l2BlockNumber, stateRoot);
      if (!isValid) {
        console.log(`Invalid state root at block ${l2BlockNumber}`);
        if (challengerSigner) {
          const gameId = await this.challengeOutput(output, challengerSigner);
          console.log(`Challenge created: ${gameId}`);
        }
      }
    });
  }

  stopMonitoring(): void {
    this.isMonitoring = false;
    this.l2OutputOracle.removeAllListeners('OutputProposed');
  }

  async challengeOutput(output: OutputProposal, challengerSigner: ethers.Signer): Promise<string> {
    const claimRoot = this.trustedStateRoots.get(output.l2BlockNumber.toString()) ||
      ethers.keccak256(ethers.toUtf8Bytes(`trusted_state_${output.l2BlockNumber}`));

    const factory = this.disputeGameFactory.connect(challengerSigner) as ethers.Contract;
    const tx = await factory.createGame(output.proposer, output.stateRoot, claimRoot, 0, 1, { value: ethers.parseEther('1') });
    const receipt = await tx.wait();

    const event = receipt.logs.find((log: ethers.Log) => {
      const parsed = this.disputeGameFactory.interface.parseLog({ topics: log.topics as string[], data: log.data });
      return parsed?.name === 'GameCreated';
    });
    if (!event) throw new Error('GameCreated event not found');

    const parsed = this.disputeGameFactory.interface.parseLog({ topics: event.topics as string[], data: event.data });
    const gameId = parsed?.args[0];

    this.pendingChallenges.set(gameId, {
      gameId,
      challenger: await challengerSigner.getAddress(),
      proposer: output.proposer,
      stateRoot: output.stateRoot,
      claimRoot,
      bondAmount: ethers.parseEther('1'),
      timestamp: Date.now()
    });

    return gameId;
  }

  async submitFraudProof(gameId: string, challengerSigner: ethers.Signer): Promise<void> {
    const challenge = this.pendingChallenges.get(gameId);
    if (!challenge) throw new Error(`Challenge ${gameId} not found`);
    if (this.validatorWallets.length === 0) throw new Error('No validators configured');

    const actualPostState = ethers.keccak256(ethers.toUtf8Bytes(`actual_state_${gameId}`));
    const proof = await this.generateFraudProof(
      challenge.stateRoot,
      challenge.claimRoot,
      actualPostState,
      this.validatorWallets
    );

    const factory = this.disputeGameFactory.connect(challengerSigner) as ethers.Contract;
    await (await factory.resolveChallengerWins(gameId, proof)).wait();
    this.pendingChallenges.delete(gameId);
  }

  async generateFraudProof(
    stateRoot: string,
    claimRoot: string,
    actualPostState: string,
    validators: ethers.Wallet[]
  ): Promise<string> {
    const blockHash = ethers.keccak256(ethers.toUtf8Bytes(`block_${stateRoot}`));
    const blockNumber = BigInt(1);
    const outputRoot = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'bytes32', 'bytes32'], [blockHash, stateRoot, actualPostState])
    );

    const fraudHash = ethers.keccak256(
      ethers.solidityPacked(
        ['bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'uint64', 'bytes32'],
        [FRAUD_DOMAIN, stateRoot, claimRoot, actualPostState, blockHash, blockNumber, outputRoot]
      )
    );

    const signers: string[] = [];
    const signatures: string[] = [];

    for (const validator of validators.slice(0, 1)) {
      const signature = await validator.signMessage(ethers.getBytes(fraudHash));
      signers.push(validator.address);
      signatures.push(signature);
    }

    return this.encodeProof({
      version: PROOF_VERSION,
      proofType: 0,
      preStateRoot: stateRoot,
      postStateRoot: actualPostState,
      blockHash,
      blockNumber,
      outputRoot,
      signers,
      signatures
    });
  }

  async generateDefenseProof(
    stateRoot: string,
    claimRoot: string,
    validators: ethers.Wallet[]
  ): Promise<string> {
    const blockHash = ethers.keccak256(ethers.toUtf8Bytes(`block_${stateRoot}`));
    const blockNumber = BigInt(1);
    const outputRoot = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'bytes32', 'bytes32'], [blockHash, stateRoot, claimRoot])
    );

    const defenseHash = ethers.keccak256(
      ethers.solidityPacked(
        ['bytes32', 'bytes32', 'bytes32', 'bytes32', 'uint64', 'bytes32'],
        [DEFENSE_DOMAIN, stateRoot, claimRoot, blockHash, blockNumber, outputRoot]
      )
    );

    const signers: string[] = [];
    const signatures: string[] = [];

    for (const validator of validators.slice(0, 2)) {
      const signature = await validator.signMessage(ethers.getBytes(defenseHash));
      signers.push(validator.address);
      signatures.push(signature);
    }

    return this.encodeProof({
      version: PROOF_VERSION,
      proofType: 1,
      preStateRoot: stateRoot,
      postStateRoot: claimRoot,
      blockHash,
      blockNumber,
      outputRoot,
      signers,
      signatures
    });
  }

  private encodeProof(data: ProofData): string {
    let encoded = ethers.solidityPacked(
      ['uint8', 'uint8', 'bytes32', 'bytes32', 'bytes32', 'uint64', 'bytes32', 'uint8'],
      [
        data.version,
        data.proofType,
        data.preStateRoot,
        data.postStateRoot,
        data.blockHash,
        data.blockNumber,
        data.outputRoot,
        data.signers.length
      ]
    );

    for (const signer of data.signers) {
      encoded = ethers.concat([encoded, ethers.getBytes(signer)]);
    }
    for (const sig of data.signatures) {
      encoded = ethers.concat([encoded, ethers.getBytes(sig)]);
    }

    return ethers.hexlify(encoded);
  }

  async getActiveGames(): Promise<string[]> {
    return this.disputeGameFactory.getActiveGames();
  }

  getPendingChallenges(): ChallengeEvent[] {
    return Array.from(this.pendingChallenges.values());
  }

  private async verifyStateRoot(l2BlockNumber: bigint, claimedStateRoot: string): Promise<boolean> {
    const trusted = this.trustedStateRoots.get(l2BlockNumber.toString());
    if (!trusted) {
      console.log(`No trusted root for block ${l2BlockNumber}, assuming valid`);
      return true;
    }
    return trusted === claimedStateRoot;
  }
}
