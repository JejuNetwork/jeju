/**
 * Market Creator for eHorse
 * Automatically creates Predimarket markets when races are committed to oracle
 */

import { ethers, Contract, Wallet, JsonRpcProvider } from 'ethers';

const MARKET_FACTORY_ABI = [
  'function createMarketFromOracle(bytes32 sessionId, string calldata question) external',
  'function marketCreated(bytes32 sessionId) external view returns (bool)',
  'event MarketAutoCreated(bytes32 indexed sessionId, string question)'
];

const PREDICTION_ORACLE_ABI = [
  'function games(bytes32 sessionId) external view returns (bytes32 _sessionId, string memory question, bool outcome, bytes32 commitment, bytes32 salt, uint256 startTime, uint256 endTime, bytes memory teeQuote, address[] memory winners, uint256 totalPayout, bool finalized)',
  'event GameCommitted(bytes32 indexed sessionId, string question, bytes32 commitment, uint256 startTime)'
];

export interface MarketCreatorConfig {
  rpcUrl: string;
  marketFactoryAddress: string;
  oracleAddress: string;
  privateKey: string;
}

export class MarketCreator {
  private provider: JsonRpcProvider;
  private wallet: Wallet;
  private marketFactory: Contract;
  private oracle: Contract;
  private createdMarkets: Set<string> = new Set();

  constructor(config: MarketCreatorConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, this.provider);
    this.marketFactory = new Contract(config.marketFactoryAddress, MARKET_FACTORY_ABI, this.wallet);
    this.oracle = new Contract(config.oracleAddress, PREDICTION_ORACLE_ABI, this.provider);
  }

  async startWatching(): Promise<void> {
    console.log(`👀 Watching oracle for GameCommitted events...`);
    console.log(`   Oracle: ${await this.oracle.getAddress()}`);
    console.log(`   MarketFactory: ${await this.marketFactory.getAddress()}`);

    // Listen for GameCommitted events
    this.oracle.on('GameCommitted', async (sessionId: string, question: string, commitment: string, startTime: bigint) => {
      await this.createMarket(sessionId, question);
    });

    // Also check for any existing commitments we missed
    await this.checkPastCommitments();
  }

  private async checkPastCommitments(): Promise<void> {
    console.log(`🔍 Checking for past uncommitted races...`);
    
    // Get recent GameCommitted events
    const filter = this.oracle.filters.GameCommitted();
    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 1000); // Last ~1000 blocks
    
    const events = await this.oracle.queryFilter(filter, fromBlock, currentBlock);
    
    for (const event of events) {
      const sessionId = event.args?.[0];
      const question = event.args?.[1];
      
      if (sessionId && question) {
        await this.createMarket(sessionId, question);
      }
    }
  }

  private async createMarket(sessionId: string, question: string): Promise<void> {
    // Skip if already created
    if (this.createdMarkets.has(sessionId)) {
      return;
    }

    // Check if market already exists on-chain
    const exists = await this.marketFactory.marketCreated(sessionId);
    if (exists) {
      console.log(`✅ Market already exists for ${sessionId}`);
      this.createdMarkets.add(sessionId);
      return;
    }

    console.log(`🏭 Creating market for race ${sessionId}`);
    console.log(`   Question: ${question}`);

    const tx = await this.marketFactory.createMarketFromOracle(sessionId, question);
    const receipt = await tx.wait();

    this.createdMarkets.add(sessionId);
    console.log(`✅ Market created! Tx: ${receipt.hash}`);
  }

  getWalletAddress(): string {
    return this.wallet.address;
  }

  stop(): void {
    this.oracle.removeAllListeners();
  }
}



