/**
 * jeju faucet - Multi-chain testnet faucet
 * 
 * Supported chains:
 * - Jeju Testnet (Base Sepolia)
 * - Base Sepolia
 * - Ethereum Sepolia
 * - Solana Devnet (via web faucet)
 */

import { Command } from 'commander';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, sepolia } from 'viem/chains';
import { logger } from '../lib/logger';
import { loadPrivateKey } from '../lib/keys';

// Chain configurations
const CHAINS = {
  jeju: {
    id: 84532, // Base Sepolia
    name: 'Jeju Testnet',
    rpc: 'https://sepolia.base.org',
    faucet: 'https://www.alchemy.com/faucets/base-sepolia',
    explorer: 'https://sepolia.basescan.org',
    native: 'ETH',
  },
  base: {
    id: 84532,
    name: 'Base Sepolia',
    rpc: 'https://sepolia.base.org',
    faucet: 'https://www.alchemy.com/faucets/base-sepolia',
    explorer: 'https://sepolia.basescan.org',
    native: 'ETH',
  },
  ethereum: {
    id: 11155111,
    name: 'Ethereum Sepolia',
    rpc: 'https://rpc.sepolia.org',
    faucet: 'https://sepoliafaucet.com',
    explorer: 'https://sepolia.etherscan.io',
    native: 'ETH',
  },
  solana: {
    id: 0,
    name: 'Solana Devnet',
    rpc: 'https://api.devnet.solana.com',
    faucet: 'https://faucet.solana.com',
    explorer: 'https://explorer.solana.com/?cluster=devnet',
    native: 'SOL',
  },
} as const;

type ChainName = keyof typeof CHAINS;

export const faucetCommand = new Command('faucet')
  .description('Request testnet funds from faucets')
  .argument('[address]', 'Address to fund (defaults to deployer)')
  .option('-c, --chain <chain>', 'Chain to use (jeju, base, ethereum, solana)', 'jeju')
  .option('-a, --amount <eth>', 'Amount in ETH (for self-funding)', '0.1')
  .option('--list', 'List all available faucets')
  .option('--check', 'Check balance only')
  .option('--self-fund', 'Fund from your own wallet (requires DEPLOYER_KEY)')
  .action(async (address, options) => {
    // List faucets
    if (options.list) {
      listFaucets();
      return;
    }

    const chainName = options.chain.toLowerCase() as ChainName;
    const chain = CHAINS[chainName];
    
    if (!chain) {
      logger.error(`Unknown chain: ${options.chain}`);
      logger.info('Available chains: ' + Object.keys(CHAINS).join(', '));
      return;
    }

    // Get target address
    let targetAddress = address;
    if (!targetAddress) {
      const key = loadPrivateKey('deployer');
      if (key) {
        const account = privateKeyToAccount(key as `0x${string}`);
        targetAddress = account.address;
        logger.info(`Using deployer address: ${targetAddress}`);
      } else {
        logger.error('No address provided and no deployer key found');
        logger.info('Run: jeju keys generate deployer');
        return;
      }
    }

    if (!isAddress(targetAddress)) {
      logger.error('Invalid address format');
      return;
    }

    // Check balance
    if (options.check || !options.selfFund) {
      await checkBalance(chainName, targetAddress);
    }

    // Self-fund option
    if (options.selfFund) {
      await selfFund(chainName, targetAddress, options.amount);
      return;
    }

    // Show faucet link
    logger.newline();
    logger.header(`${chain.name.toUpperCase()} FAUCET`);
    logger.info(`Get free ${chain.native} for testing:`);
    logger.newline();
    logger.info(`  ${chain.faucet}`);
    logger.newline();
    
    if (chainName === 'solana') {
      logger.info('For Solana, use the web faucet or run:');
      logger.info(`  solana airdrop 2 ${targetAddress} --url devnet`);
    } else {
      logger.info('Paste your address in the faucet and request funds.');
      logger.info(`Your address: ${targetAddress}`);
    }
    
    logger.newline();
    logger.info(`Explorer: ${chain.explorer}`);
  });

function listFaucets(): void {
  logger.header('TESTNET FAUCETS');
  logger.newline();
  
  for (const [key, chain] of Object.entries(CHAINS)) {
    logger.table([{
      label: `${chain.name} (${key})`,
      value: chain.native,
      status: 'ok',
    }]);
    logger.info(`  Faucet:   ${chain.faucet}`);
    logger.info(`  Explorer: ${chain.explorer}`);
    logger.newline();
  }
  
  logger.info('Usage: jeju faucet [address] --chain <chain>');
}

async function checkBalance(chainName: ChainName, address: string): Promise<void> {
  const chain = CHAINS[chainName];
  
  if (chainName === 'solana') {
    logger.info('For Solana balance, run: solana balance --url devnet');
    return;
  }

  const viemChain = chainName === 'ethereum' ? sepolia : baseSepolia;
  
  const client = createPublicClient({
    chain: viemChain,
    transport: http(chain.rpc),
  });

  const balance = await client.getBalance({ address: address as `0x${string}` });
  const ethBalance = formatEther(balance);
  
  logger.table([{
    label: `${chain.name} Balance`,
    value: `${parseFloat(ethBalance).toFixed(4)} ${chain.native}`,
    status: parseFloat(ethBalance) >= 0.01 ? 'ok' : 'warn',
  }]);
  
  if (parseFloat(ethBalance) < 0.01) {
    logger.warn('Low balance. Request funds from faucet.');
  }
}

async function selfFund(chainName: ChainName, targetAddress: string, amountEth: string): Promise<void> {
  if (chainName === 'solana') {
    logger.error('Self-funding not supported for Solana. Use: solana transfer');
    return;
  }

  const key = loadPrivateKey('deployer');
  if (!key) {
    logger.error('No deployer key found');
    logger.info('Run: jeju keys generate deployer');
    return;
  }

  const chain = CHAINS[chainName];
  const viemChain = chainName === 'ethereum' ? sepolia : baseSepolia;

  const account = privateKeyToAccount(key as `0x${string}`);
  
  if (account.address.toLowerCase() === targetAddress.toLowerCase()) {
    logger.error('Cannot self-fund to the same address');
    return;
  }

  const client = createPublicClient({
    chain: viemChain,
    transport: http(chain.rpc),
  });

  const walletClient = createWalletClient({
    chain: viemChain,
    transport: http(chain.rpc),
    account,
  });

  const senderBalance = await client.getBalance({ address: account.address });
  const amount = parseEther(amountEth);

  if (senderBalance < amount) {
    logger.error(`Insufficient balance: ${formatEther(senderBalance)} ${chain.native}`);
    return;
  }

  logger.step(`Sending ${amountEth} ${chain.native} to ${targetAddress.slice(0, 10)}...`);

  const hash = await walletClient.sendTransaction({
    to: targetAddress as `0x${string}`,
    value: amount,
  });

  const receipt = await client.waitForTransactionReceipt({ hash });

  if (receipt.status === 'success') {
    logger.success(`Sent. TX: ${hash}`);
    logger.info(`Explorer: ${chain.explorer}/tx/${hash}`);
  } else {
    logger.error('Transaction failed');
  }
}

// Subcommand: faucet deploy - Deploy faucet contract
export const faucetDeployCommand = new Command('deploy')
  .description('Deploy a Faucet contract')
  .option('-c, --chain <chain>', 'Chain to deploy to', 'jeju')
  .option('--eth-amount <wei>', 'ETH drip amount in wei', '100000000000000000') // 0.1 ETH
  .option('--cooldown <seconds>', 'Cooldown in seconds', '86400') // 24 hours
  .action(async (options) => {
    logger.header('DEPLOY FAUCET');
    logger.info('Use: bun run scripts/deploy/faucet.ts --network testnet');
    logger.newline();
    logger.info('Or deploy manually with Foundry:');
    logger.info('  forge create src/tokens/Faucet.sol:Faucet --constructor-args $OWNER');
  });

faucetCommand.addCommand(faucetDeployCommand);



