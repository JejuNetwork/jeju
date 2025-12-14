/**
 * jeju fund - Fund development accounts
 */

import { Command } from 'commander';
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { logger } from '../lib/logger';
import { checkRpcHealth } from '../lib/chain';
import { DEFAULT_PORTS, WELL_KNOWN_KEYS } from '../types';

const localnetChain = {
  id: 1337,
  name: 'Network Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [`http://127.0.0.1:${DEFAULT_PORTS.l2Rpc}`] } },
} as const;

export const fundCommand = new Command('fund')
  .description('Fund accounts (localnet faucet)')
  .argument('[address]', 'Address to fund')
  .option('-a, --amount <eth>', 'Amount in ETH', '10')
  .option('--all', 'Fund all dev accounts')
  .action(async (address, options) => {
    const rpcUrl = `http://127.0.0.1:${DEFAULT_PORTS.l2Rpc}`;

    const isHealthy = await checkRpcHealth(rpcUrl, 3000);
    if (!isHealthy) {
      logger.error('Localnet not running. Start with: jeju dev');
      return;
    }

    // Fund all dev accounts
    if (options.all) {
      await fundAllDevAccounts(rpcUrl, options.amount);
      return;
    }

    // Fund specific address
    if (address) {
      await fundAddress(rpcUrl, address, options.amount);
      return;
    }

    // No args - show balances
    await showBalances(rpcUrl);
  });

async function fundAddress(rpcUrl: string, address: string, amountEth: string): Promise<boolean> {
  if (!address.startsWith('0x') || address.length !== 42) {
    logger.error('Invalid address');
    return false;
  }

  const client = createPublicClient({
    chain: localnetChain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: localnetChain,
    transport: http(rpcUrl),
  });

  const funder = WELL_KNOWN_KEYS.dev[0];
  const account = privateKeyToAccount(funder.privateKey as `0x${string}`);

  const funderBalance = await client.getBalance({ address: account.address });
  const requiredAmount = parseEther(amountEth);
  
  if (funderBalance < requiredAmount) {
    logger.error(`Funder balance too low: ${formatEther(funderBalance)} ETH`);
    return false;
  }

  logger.step(`Sending ${amountEth} ETH to ${address.slice(0, 10)}...`);

  try {
    const hash = await walletClient.sendTransaction({
      account,
      to: address as `0x${string}`,
      value: requiredAmount,
    });

    const receipt = await client.waitForTransactionReceipt({ hash });
    
    if (receipt.status === 'success') {
      const newBalance = await client.getBalance({ address: address as `0x${string}` });
      logger.success(`Done. Balance: ${formatEther(newBalance)} ETH`);
      return true;
    } else {
      logger.error('Transaction failed');
      return false;
    }
  } catch (error) {
    logger.error('Transaction error: ' + (error as Error).message);
    return false;
  }
}

async function fundAllDevAccounts(rpcUrl: string, amountEth: string): Promise<void> {
  logger.header('FUND DEV ACCOUNTS');

  const client = createPublicClient({
    chain: localnetChain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: localnetChain,
    transport: http(rpcUrl),
  });

  const funder = WELL_KNOWN_KEYS.dev[0];
  const account = privateKeyToAccount(funder.privateKey as `0x${string}`);
  const targetAmount = parseFloat(amountEth);

  for (let i = 1; i < WELL_KNOWN_KEYS.dev.length; i++) {
    const target = WELL_KNOWN_KEYS.dev[i];
    
    const currentBalance = await client.getBalance({ address: target.address as `0x${string}` });
    const currentEth = parseFloat(formatEther(currentBalance));
    
    if (currentEth >= targetAmount) {
      logger.info(`#${i}: ${currentEth.toFixed(2)} ETH (already funded)`);
      continue;
    }

    const needed = targetAmount - currentEth;
    
    try {
      const hash = await walletClient.sendTransaction({
        account,
        to: target.address as `0x${string}`,
        value: parseEther(needed.toString()),
      });

      await client.waitForTransactionReceipt({ hash });
      logger.success(`#${i}: +${needed.toFixed(2)} ETH`);
    } catch {
      logger.error(`#${i}: Failed`);
    }
  }

  logger.success('Done');
}

async function showBalances(rpcUrl: string): Promise<void> {
  logger.header('DEV ACCOUNT BALANCES');

  const client = createPublicClient({
    chain: localnetChain,
    transport: http(rpcUrl),
  });

  for (let i = 0; i < WELL_KNOWN_KEYS.dev.length; i++) {
    const key = WELL_KNOWN_KEYS.dev[i];
    const balance = await client.getBalance({ address: key.address as `0x${string}` });
    const eth = formatEther(balance);
    
    const role = i === 0 ? 'Deployer' : i === 4 ? 'Operator' : `User ${i}`;
    
    logger.table([{
      label: `#${i} ${role}`,
      value: `${parseFloat(eth).toFixed(4)} ETH`,
      status: parseFloat(eth) > 0.1 ? 'ok' : 'warn',
    }]);
  }

  logger.newline();
  logger.info('Fund address:  jeju fund 0x...');
  logger.info('Fund all:      jeju fund --all');
}
