#!/usr/bin/env bun
/**
 * Example eHorse Prediction Agent
 * Demonstrates how an agent can bet on horse races via Predimarket
 */

import { ethers } from 'ethers';

const EHORSE_URL = process.env.EHORSE_URL || 'http://localhost:5700';
const PREDIMARKET_ADDRESS = process.env.PREDIMARKET_ADDRESS || '';
const ELIZAOS_ADDRESS = process.env.ELIZAOS_ADDRESS || '';
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || '';
const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';

const PREDIMARKET_ABI = [
  'function buy(bytes32 sessionId, bool outcome, uint256 tokenAmount, uint256 minShares) external returns (uint256)',
  'function markets(bytes32 sessionId) external view returns (bytes32 sessionId_, string memory question, uint256 yesShares, uint256 noShares, uint256 liquidityParameter, uint256 totalVolume, uint256 createdAt, bool resolved, bool outcome)',
  'function resolveMarket(bytes32 sessionId) external',
  'function claimPayout(bytes32 sessionId) external returns (uint256)'
];

const ELIZA_OS_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)'
];

interface Race {
  id: string;
  status: 'pending' | 'running' | 'finished';
  winner: number | null;
}

class HorseBettingAgent {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private predimarket: ethers.Contract;
  private elizaOS: ethers.Contract;
  private betHistory: Set<string> = new Set();

  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.wallet = new ethers.Wallet(AGENT_PRIVATE_KEY, this.provider);
    this.predimarket = new ethers.Contract(PREDIMARKET_ADDRESS, PREDIMARKET_ABI, this.wallet);
    this.elizaOS = new ethers.Contract(ELIZAOS_ADDRESS, ELIZA_OS_ABI, this.wallet);
  }

  async checkAndApprove(): Promise<void> {
    const allowance = await this.elizaOS.allowance(this.wallet.address, PREDIMARKET_ADDRESS);
    
    if (allowance < ethers.parseEther('10000')) {
      console.log('💰 Approving elizaOS spending...');
      const tx = await this.elizaOS.approve(PREDIMARKET_ADDRESS, ethers.MaxUint256);
      await tx.wait();
      console.log('✅ Approval granted');
    }
  }

  async getCurrentRace(): Promise<Race> {
    const res = await fetch(`${EHORSE_URL}/api/race`);
    return await res.json();
  }

  async placeBet(race: Race): Promise<void> {
    if (this.betHistory.has(race.id)) {
      return;
    }

    console.log(`\n🐴 New race detected: ${race.id}`);
    console.log(`   Status: ${race.status}`);

    if (race.status !== 'pending') {
      return;
    }

    const prediction = Math.random() < 0.5 ? 3 : 4;
    const outcome = prediction >= 3;
    const betAmount = ethers.parseEther('50');

    console.log(`📊 Prediction: Horse #${prediction} (${prediction === 3 ? 'Storm' : 'Blaze'})`);
    console.log(`📊 Binary outcome: ${outcome ? 'YES' : 'NO'}`);
    console.log(`💰 Bet amount: 50 elizaOS`);

    const sessionId = ethers.id(race.id);

    const market = await this.predimarket.markets(sessionId);
    const marketExists = market.createdAt > 0n;

    if (!marketExists) {
      console.log(`⚠️  Market not yet created for race ${race.id}`);
      console.log(`   Waiting for MarketFactory to create it...`);
      return;
    }

    const tx = await this.predimarket.buy(sessionId, outcome, betAmount, 0n);

    console.log(`⏳ Waiting for confirmation...`);
    const receipt = await tx.wait();

    this.betHistory.add(race.id);

    console.log(`✅ Bet placed! Tx: ${receipt.hash}`);
    console.log(`🎲 Now waiting for race to finish...`);
  }

  async run(): Promise<void> {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                                                              ║');
    console.log('║   🐴 eHorse Prediction Agent                                 ║');
    console.log('║   Autonomous horse race betting                              ║');
    console.log('║                                                              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    console.log(`🔐 Wallet: ${this.wallet.address}`);
    console.log(`🐴 eHorse: ${EHORSE_URL}`);
    console.log(`📊 Predimarket: ${PREDIMARKET_ADDRESS}`);
    console.log('');

    const balance = await this.elizaOS.balanceOf(this.wallet.address);
    console.log(`💰 elizaOS balance: ${ethers.formatEther(balance)} elizaOS\n`);

    await this.checkAndApprove();

    console.log('🤖 Agent active - monitoring for new races...\n');

    setInterval(async () => {
      const race = await this.getCurrentRace();
      await this.placeBet(race);
    }, 5000);
  }
}

async function main(): Promise<void> {
  if (!AGENT_PRIVATE_KEY || !PREDIMARKET_ADDRESS || !ELIZAOS_ADDRESS) {
    console.error('❌ Missing required environment variables:');
    console.error('   AGENT_PRIVATE_KEY');
    console.error('   PREDIMARKET_ADDRESS');
    console.error('   ELIZAOS_ADDRESS');
    console.error('');
    console.error('Run: source .env');
    process.exit(1);
  }

  const agent = new HorseBettingAgent();
  await agent.run();
}

main();

