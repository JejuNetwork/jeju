#!/usr/bin/env bun
/**
 * Fund Agent Wallets Script
 * 
 * Funds all agent test wallets with ETH and elizaOS tokens
 * Run this before starting Crucible to ensure agents have funds
 * 
 * Usage:
 *   bun run scripts/fund-wallets.ts
 */

import { ethers } from 'ethers';

// Use localhost when running from host machine (not from container)
const RPC_URL = process.env.JEJU_L2_RPC_HOST || 'http://127.0.0.1:9545';
const ELIZA_TOKEN = process.env.ELIZA_TOKEN || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';

// Jeju localnet test account (from README - should be pre-funded by bootstrap)
const FUNDER_KEY = process.env.FUNDER_KEY || '0xb71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291';

// Agent funding configuration by role
const FUNDING_BY_ROLE = {
  hacker: { eth: '2.0', eliza: '200', minEth: '0.5', minEliza: '50' },
  scammer: { eth: '1.0', eliza: '100', minEth: '0.2', minEliza: '20' },
  citizen: { eth: '1.0', eliza: '200', minEth: '0.3', minEliza: '50' },
  guardian: { eth: '3.0', eliza: '500', minEth: '1.0', minEliza: '100' },
  player: { eth: '1.5', eliza: '150', minEth: '0.3', minEliza: '30' }
};

// Agent wallets to fund
const AGENT_WALLETS = [
  {name: 'Hacker 1', type: 'hacker', key: process.env.HACKER_WALLET_1 || '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'},
  {name: 'Hacker 2', type: 'hacker', key: process.env.HACKER_WALLET_2 || '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'},
  {name: 'Scammer 1', type: 'scammer', key: process.env.SCAMMER_WALLET_1 || '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'},
  {name: 'Scammer 2', type: 'scammer', key: process.env.SCAMMER_WALLET_2 || '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'},
  {name: 'Citizen 1', type: 'citizen', key: process.env.CITIZEN_WALLET_1 || '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'},
  {name: 'Citizen 2', type: 'citizen', key: process.env.CITIZEN_WALLET_2 || '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e'},
  {name: 'Citizen 3', type: 'citizen', key: process.env.CITIZEN_WALLET_3 || '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356'},
  {name: 'Guardian 1', type: 'guardian', key: process.env.GUARDIAN_WALLET_1 || '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97'},
  {name: 'Guardian 2', type: 'guardian', key: process.env.GUARDIAN_WALLET_2 || '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6'},
  {name: 'Guardian 3', type: 'guardian', key: process.env.GUARDIAN_WALLET_3 || '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'}
].map(w => ({
  ...w,
  eth: FUNDING_BY_ROLE[w.type as keyof typeof FUNDING_BY_ROLE].eth,
  eliza: FUNDING_BY_ROLE[w.type as keyof typeof FUNDING_BY_ROLE].eliza,
  minEth: FUNDING_BY_ROLE[w.type as keyof typeof FUNDING_BY_ROLE].minEth,
  minEliza: FUNDING_BY_ROLE[w.type as keyof typeof FUNDING_BY_ROLE].minEliza
}));

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)'
];

async function main() {
  console.log('💰 Funding Crucible Agent Wallets');
  console.log(`   RPC: ${RPC_URL}`);
  console.log(`   elizaOS Token: ${ELIZA_TOKEN}`);
  console.log('');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const funder = new ethers.Wallet(FUNDER_KEY, provider);
  const elizaToken = new ethers.Contract(ELIZA_TOKEN, ERC20_ABI, funder);

  console.log(`Funder: ${funder.address}`);
  console.log(`Funder Balance: ${ethers.formatEther(await provider.getBalance(funder.address))} ETH`);
  console.log('');

  let successCount = 0;
  let failCount = 0;
  let topupCount = 0;
  let skippedCount = 0;

  for (const wallet of AGENT_WALLETS) {
    try {
      const recipientWallet = new ethers.Wallet(wallet.key, provider);
      const address = recipientWallet.address;

      // Check existing balances
      const currentEthBalance = await provider.getBalance(address);
      const minEthRequired = ethers.parseEther(wallet.minEth);
      const targetEthBalance = ethers.parseEther(wallet.eth);
      
      let currentTokenBalance = BigInt(0);
      let tokenExists = false;
      
      try {
        currentTokenBalance = await elizaToken.balanceOf(address);
        tokenExists = true;
      } catch {
        // Token not deployed yet
      }
      
      const minTokenRequired = ethers.parseEther(wallet.minEliza);
      const targetTokenBalance = ethers.parseEther(wallet.eliza);
      
      const needsEth = currentEthBalance < minEthRequired;
      const needsToken = tokenExists && currentTokenBalance < minTokenRequired;
      
      if (!needsEth && !needsToken) {
        console.log(`⏭️  ${wallet.name}: Already funded (${ethers.formatEther(currentEthBalance)} ETH, ${ethers.formatEther(currentTokenBalance)} elizaOS)`);
        skippedCount++;
        continue;
      }

      console.log(`${needsEth && needsToken ? '💵' : '🔄'} Funding ${wallet.name} (${address})...`);

      // Top up ETH if needed
      if (needsEth) {
        const ethToSend = targetEthBalance - currentEthBalance;
        const ethTx = await funder.sendTransaction({
          to: address,
          value: ethToSend
        });
        await ethTx.wait();
        console.log(`   📤 Sent ${ethers.formatEther(ethToSend)} ETH (TX: ${ethTx.hash.slice(0, 10)}...)`);
      }

      // Top up tokens if needed and token exists
      if (needsToken && tokenExists) {
        const tokensToSend = targetTokenBalance - currentTokenBalance;
        const tokenTx = await elizaToken.transfer(address, tokensToSend);
        await tokenTx.wait();
        console.log(`   📤 Sent ${ethers.formatEther(tokensToSend)} elizaOS (TX: ${tokenTx.hash.slice(0, 10)}...)`);
      }

      // Verify final balances
      const finalEthBalance = await provider.getBalance(address);
      const finalTokenBalance = tokenExists ? await elizaToken.balanceOf(address) : BigInt(0);
      
      console.log(`   ✅ ${wallet.name}: ${ethers.formatEther(finalEthBalance)} ETH, ${ethers.formatEther(finalTokenBalance)} elizaOS`);
      
      if (needsEth || needsToken) {
        topupCount++;
      }
      successCount++;
    } catch (error: any) {
      console.error(`   ❌ ${wallet.name}: ${error.message}`);
      failCount++;
    }
  }

  console.log('');
  console.log('📊 Summary:');
  console.log(`   Funded: ${successCount}/${AGENT_WALLETS.length}`);
  console.log(`   Topped up: ${topupCount}`);
  console.log(`   Skipped (already funded): ${skippedCount}`);
  console.log(`   Failed: ${failCount}/${AGENT_WALLETS.length}`);
  
  if (failCount > 0) {
    console.log('');
    console.log('⚠️  Some wallets failed to fund. Check that:');
    console.log('   1. Jeju localnet is running (bun run dev)');
    console.log('   2. Funder wallet has sufficient balance');
    console.log('   3. RPC URL is correct');
    process.exit(1);
  }

  console.log('');
  console.log('✅ All agent wallets funded successfully!');
  console.log('   You can now start Crucible with: docker-compose -f docker/docker-compose.yml up -d');
  
  // Log funding to database if possible (would need to connect to DB)
  console.log('');
  console.log('💾 Funding log saved to console (database logging requires Crucible to be running)');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

