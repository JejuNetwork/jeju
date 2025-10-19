/**
 * Oracle Publisher for eHorse
 * Publishes race results to PredictionOracle contract
 */

import { ethers, Contract, Wallet, JsonRpcProvider } from 'ethers';

const PREDICTION_ORACLE_ABI = [
  'function commitGame(bytes32 sessionId, string calldata question, bytes32 commitment) external',
  'function revealGame(bytes32 sessionId, bool outcome, bytes32 salt, bytes memory teeQuote, address[] calldata winners, uint256 totalPayout) external',
  'function getOutcome(bytes32 sessionId) external view returns (bool outcome, bool finalized)',
  'event GameCommitted(bytes32 indexed sessionId, string question, bytes32 commitment, uint256 startTime)',
  'event GameRevealed(bytes32 indexed sessionId, bool outcome, uint256 endTime, bytes teeQuote, uint256 winnersCount)'
];

export interface OracleConfig {
  rpcUrl: string;
  oracleAddress: string;
  privateKey: string;
}

export class OraclePublisher {
  private provider: JsonRpcProvider;
  private wallet: Wallet;
  private oracle: Contract;
  private salts: Map<string, string> = new Map();

  constructor(config: OracleConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, this.provider);
    this.oracle = new Contract(config.oracleAddress, PREDICTION_ORACLE_ABI, this.wallet);
  }

  async commitRace(raceId: string, winningHorse: number): Promise<{ txHash: string; salt: string }> {
    // Generate random salt
    const salt = ethers.hexlify(ethers.randomBytes(32));
    this.salts.set(raceId, salt);

    // Create commitment: hash(winningHorse + salt)
    // Map horse (1-4) to boolean: 1-2 = false, 3-4 = true (for binary oracle)
    const outcome = winningHorse >= 3;
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bool', 'bytes32'],
        [outcome, salt]
      )
    );

    const sessionId = ethers.id(raceId);
    
    // Create question for the market
    const horseName = ['Thunder', 'Lightning', 'Storm', 'Blaze'][winningHorse - 1];
    const question = `Will horses Storm or Blaze win race ${raceId.slice(5, 15)}?`;

    console.log(`📝 Committing race ${raceId}: winner=${winningHorse} (${horseName}), outcome=${outcome}`);
    console.log(`📊 Question: ${question}`);

    const tx = await this.oracle.commitGame(sessionId, question, commitment);
    const receipt = await tx.wait();

    console.log(`✅ Race committed: ${receipt.hash}`);

    return { txHash: receipt.hash, salt };
  }

  async revealRace(raceId: string, winningHorse: number): Promise<string> {
    const salt = this.salts.get(raceId);
    if (!salt) {
      throw new Error(`No salt found for race ${raceId}`);
    }

    // Map horse to boolean outcome
    const outcome = winningHorse >= 3;
    const sessionId = ethers.id(raceId);

    // Simple TEE quote placeholder (in production, use real Dstack SDK)
    const teeQuote = ethers.hexlify(ethers.randomBytes(32));
    
    // For horse racing, there are no individual "winners" - just the outcome
    // Winners are determined by who bet correctly on Predimarket
    const winners: string[] = [];
    const totalPayout = 0;

    const horseName = ['Thunder', 'Lightning', 'Storm', 'Blaze'][winningHorse - 1];
    console.log(`🏆 Revealing race ${raceId}: winner=${winningHorse} (${horseName}), outcome=${outcome}`);

    const tx = await this.oracle.revealGame(sessionId, outcome, salt, teeQuote, winners, totalPayout);
    const receipt = await tx.wait();

    console.log(`✅ Race revealed: ${receipt.hash}`);

    return receipt.hash;
  }

  async getOutcome(raceId: string): Promise<{ outcome: boolean; finalized: boolean }> {
    const sessionId = ethers.id(raceId);
    return await this.oracle.getOutcome(sessionId);
  }

  isEnabled(): boolean {
    return this.oracle !== null;
  }

  getAddress(): string {
    return this.wallet.address;
  }
}

