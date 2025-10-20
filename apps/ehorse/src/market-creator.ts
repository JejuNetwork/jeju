/**
 * Market Creator for eHorse
 * Automatically creates Predimarket markets when contests are announced
 */

import { ethers, Contract, Wallet, JsonRpcProvider } from 'ethers';

const MARKET_FACTORY_ABI = [
  'function createMarketFromOracle(bytes32 sessionId, string calldata question) external',
  'function marketCreated(bytes32 sessionId) external view returns (bool)',
  'event MarketAutoCreated(bytes32 indexed sessionId, string question)'
];

const CONTEST_ORACLE_ABI = [
  // Use getOptions instead of contests to get option names
  'function getOptions(bytes32 contestId) external view returns (string[] memory)',
  'function getContestInfo(bytes32 contestId) external view returns (uint8 state, uint8 mode, uint256 startTime, uint256 endTime, uint256 optionCount)',
  'event ContestAnnounced(bytes32 indexed contestId, uint256 startTime, string[] options)',
  'event ContestStarted(bytes32 indexed contestId, uint256 timestamp)'
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
  private contest: Contract;
  private createdMarkets: Set<string> = new Set();

  constructor(config: MarketCreatorConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, this.provider);
    this.marketFactory = new Contract(config.marketFactoryAddress, MARKET_FACTORY_ABI, this.wallet);
    this.contest = new Contract(config.oracleAddress, CONTEST_ORACLE_ABI, this.provider);
  }

  async startWatching(): Promise<void> {
    console.log(`👀 Watching Contest.sol for ContestStarted events...`);
    console.log(`   Contest Oracle: ${await this.contest.getAddress()}`);
    console.log(`   MarketFactory: ${await this.marketFactory.getAddress()}`);

    // Listen for ContestStarted events (when trading begins)
    this.contest.on('ContestStarted', async (contestId: string, timestamp: bigint) => {
      await this.createMarketForContest(contestId);
    });

    // Also check for any existing contests we missed
    await this.checkPastContests();
  }

  private async checkPastContests(): Promise<void> {
    console.log(`🔍 Checking for past contests...`);
    
    // Get recent ContestStarted events
    const filter = this.contest.filters.ContestStarted();
    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 1000); // Last ~1000 blocks
    
    const events = await this.contest.queryFilter(filter, fromBlock, currentBlock);
    
    for (const event of events) {
      const contestId = event.args?.[0];
      
      if (contestId) {
        await this.createMarketForContest(contestId);
      }
    }
  }

  private async createMarketForContest(contestId: string): Promise<void> {
    // Skip if already created
    if (this.createdMarkets.has(contestId)) {
      return;
    }

    // Check if market already exists on-chain
    const exists = await this.marketFactory.marketCreated(contestId);
    if (exists) {
      console.log(`✅ Market already exists for contest ${contestId}`);
      this.createdMarkets.add(contestId);
      return;
    }

    // Get contest options to build question
    const options = await this.contest.getOptions(contestId);
    const question = `Will ${options[2]} or ${options[3]} win? (eHorse race)`;

    console.log(`🏭 Creating market for contest ${contestId}`);
    console.log(`   Question: ${question}`);

    const tx = await this.marketFactory.createMarketFromOracle(contestId, question);
    const receipt = await tx.wait();

    this.createdMarkets.add(contestId);
    console.log(`✅ Market created! Tx: ${receipt.hash}`);
  }

  getWalletAddress(): string {
    return this.wallet.address;
  }

  stop(): void {
    this.contest.removeAllListeners();
  }
}



