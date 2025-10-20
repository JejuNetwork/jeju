/**
 * Contest Publisher for eHorse
 * Publishes race results to Contest.sol with TEE attestation
 * Handles full lifecycle: announce → start → grace period → publish results
 */

import { ethers, Contract, Wallet, JsonRpcProvider } from 'ethers';
import { createHash, randomBytes } from 'crypto';

const CONTEST_ABI = [
  'function announceContest(string[] calldata options, uint256 scheduledStart, uint8 mode) external returns (bytes32)',
  'function startContest(bytes32 contestId) external',
  'function startGracePeriod(bytes32 contestId) external',
  'function publishResults(bytes32 contestId, uint256 winner, bytes32 containerHash, bytes calldata attestationQuote, bytes calldata signature) external',
  'function getCurrentContest() external view returns (bytes32)',
  'function getWinner(bytes32 contestId) external view returns (uint256 winner, bool finalized)',
  'event ContestAnnounced(bytes32 indexed contestId, uint256 startTime, string[] options)',
  'event ContestCreated(bytes32 indexed contestId, uint8 mode, string[] options, uint256 startTime)',
  'event ContestStarted(bytes32 indexed contestId, uint256 timestamp)',
  'event GracePeriodStarted(bytes32 indexed contestId, uint256 timestamp)',
  'event ContestFinalized(bytes32 indexed contestId, uint256 winner, bytes32 containerHash, uint256 timestamp)'
];

export interface ContestPublisherConfig {
  rpcUrl: string;
  contestAddress: string;
  privateKey: string;
  containerImage?: string;
}

export class ContestPublisher {
  private provider: JsonRpcProvider;
  private wallet: Wallet;
  private contest: Contract;
  private contestIds: Map<string, string> = new Map(); // raceId -> contestId mapping
  private containerHash: string;

  constructor(config: ContestPublisherConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, this.provider);
    this.contest = new Contract(config.contestAddress, CONTEST_ABI, this.wallet);
    
    // Generate container hash for TEE attestation
    const containerImage = config.containerImage || 'ehorse-tee:v1.0.0';
    const hash = createHash('sha256').update(containerImage).digest('hex');
    this.containerHash = '0x' + hash;
  }

  /**
   * Announce contest when race is created
   */
  async announceRace(raceId: string, predeterminedWinner: number): Promise<{ txHash: string; contestId: string }> {
    const options = ['Thunder', 'Lightning', 'Storm', 'Blaze'];
    const startTime = Math.floor(Date.now() / 1000) + 35; // Start in 35s (allow time for announcement tx)
    const mode = 0; // SINGLE_WINNER

    const horseName = options[predeterminedWinner - 1];
    console.log(`📝 Announcing contest for race ${raceId}`);
    console.log(`   Winner: ${horseName} (predetermined in TEE, kept secret)`);
    console.log(`   Start time: ${new Date(startTime * 1000).toLocaleTimeString()}`);

    const tx = await this.contest.announceContest(options, startTime, mode);
    const receipt = await tx.wait();
    
    console.log(`   Transaction mined: ${receipt.hash}`);
    console.log(`   Parsing ${receipt.logs.length} logs for ContestAnnounced event...`);
    
    // Extract contestId from event
    const parsedEvents = receipt.logs
      .map((log: ethers.Log) => {
        try {
          const parsed = this.contest.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
          if (parsed) {
            console.log(`   Found event: ${parsed.name}`);
          }
          return parsed;
        } catch {
          return null;
        }
      })
      .filter((e: ethers.LogDescription | null) => e !== null);

    console.log(`   Parsed ${parsedEvents.length} events from ${receipt.logs.length} logs`);
    
    // Try ContestAnnounced first, fallback to ContestCreated
    let event = parsedEvents.find((e: ethers.LogDescription | null) => e?.name === 'ContestAnnounced');
    
    if (!event) {
      event = parsedEvents.find((e: ethers.LogDescription | null) => e?.name === 'ContestCreated');
    }

    if (!event) {
      console.error(`   Available events: ${parsedEvents.map(e => e?.name).join(', ')}`);
      throw new Error('ContestAnnounced or ContestCreated event not found in transaction logs');
    }

    const contestId = event.args?.contestId || event.args?.[0];
    if (!contestId) {
      console.error(`   Event args:`, event.args);
      throw new Error('Contest ID not found in event args');
    }

    this.contestIds.set(raceId, contestId);

    console.log(`✅ Contest announced: ${contestId}`);
    console.log(`   Stored mapping: ${raceId} → ${contestId}`);

    return { txHash: receipt.hash, contestId };
  }

  /**
   * Start contest - begin trading
   */
  async startRace(raceId: string): Promise<string> {
    const contestId = this.contestIds.get(raceId);
    if (!contestId) {
      throw new Error(`No contest ID found for race ${raceId}`);
    }

    console.log(`🏁 Starting contest ${contestId} (race ${raceId})...`);
    console.log(`   Trading ACTIVE for 60 seconds`);

    const tx = await this.contest.startContest(contestId);
    const receipt = await tx.wait();

    console.log(`✅ Contest started: ${receipt.hash}`);

    return receipt.hash;
  }

  /**
   * Start grace period after race finishes
   */
  async startGracePeriod(raceId: string): Promise<string> {
    const contestId = this.contestIds.get(raceId);
    if (!contestId) {
      throw new Error(`No contest ID found for race ${raceId}`);
    }

    console.log(`⏸️  Starting grace period for contest ${contestId}...`);
    console.log(`   Trading FROZEN for 30 seconds (prevents MEV)`);

    const tx = await this.contest.startGracePeriod(contestId);
    const receipt = await tx.wait();

    console.log(`✅ Grace period started: ${receipt.hash}`);

    return receipt.hash;
  }

  /**
   * Publish results with TEE attestation
   */
  async revealRace(raceId: string, winningHorse: number): Promise<string> {
    const contestId = this.contestIds.get(raceId);
    if (!contestId) {
      throw new Error(`No contest ID found for race ${raceId}`);
    }

    // Convert horse ID (1-4) to index (0-3)
    const winnerIndex = winningHorse - 1;

    // Generate TEE attestation
    const attestation = this.generateTEEAttestation(contestId, winnerIndex);

    const horseName = ['Thunder', 'Lightning', 'Storm', 'Blaze'][winnerIndex];
    console.log(`🏆 Publishing results for contest ${contestId}`);
    console.log(`   Winner: ${horseName} (#${winningHorse})`);
    console.log(`   Container: ${this.containerHash.slice(0, 20)}...`);

    const tx = await this.contest.publishResults(
      contestId,
      winnerIndex,
      this.containerHash,
      attestation.quote,
      attestation.signature
    );
    const receipt = await tx.wait();

    console.log(`✅ Results published with TEE attestation: ${receipt.hash}`);

    // Clean up
    this.contestIds.delete(raceId);

    return receipt.hash;
  }

  /**
   * Generate TEE attestation (mock for development)
   * In production, this would use actual TEE SDK (Intel SGX, AMD SEV-SNP, etc.)
   */
  private generateTEEAttestation(contestId: string, winner: number): {
    quote: string;
    signature: string;
  } {
    // Mock attestation quote containing:
    // - Contest ID
    // - Winner
    // - Timestamp
    // - Container hash
    // - TEE measurements (MRENCLAVE, MRSIGNER for SGX)
    const quoteData = {
      contestId,
      winner,
      timestamp: Date.now(),
      containerHash: this.containerHash,
      teeType: 'mock-sgx', // In production: 'sgx', 'sev-snp', 'nitro', etc.
      mrenclave: randomBytes(32).toString('hex'), // TEE code measurement
      mrsigner: randomBytes(32).toString('hex')   // TEE signer
    };
    
    const quote = '0x' + Buffer.from(JSON.stringify(quoteData)).toString('hex');
    
    // Sign the results (in production: TEE attestation key signs this)
    const messageHash = createHash('sha256')
      .update(contestId + winner.toString() + this.containerHash)
      .digest();
    
    const signature = this.wallet.signMessageSync(messageHash);
    
    return { quote, signature };
  }

  async getOutcome(raceId: string): Promise<{ outcome: boolean; finalized: boolean }> {
    const contestId = this.contestIds.get(raceId);
    if (!contestId) {
      return { outcome: false, finalized: false };
    }
    
    const [winner, finalized] = await this.contest.getWinner(contestId);
    
    // Map winner to binary: 0-1 = NO, 2-3 = YES
    const outcome = Number(winner) >= 2;
    
    return { outcome, finalized };
  }

  isEnabled(): boolean {
    return this.contest !== null;
  }

  getAddress(): string {
    return this.wallet.address;
  }

  getContainerHash(): string {
    return this.containerHash;
  }
}
