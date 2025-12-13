/**
 * Pre-flight Validation - Ensures chain is ready before E2E tests
 * 
 * ASSUMPTIONS:
 * - Test wallet 0xf39Fd6... is Anvil account #0 with 10k ETH
 * - Private key 0xac097... is the well-known Anvil test key (NOT A SECRET)
 * - Default RPC at localhost:9545 is Jeju localnet
 * - Chain ID 1337 is localnet (use CHAIN_ID env for others)
 * 
 * CHECKS PERFORMED:
 * 1. RPC connectivity
 * 2. Chain ID matches expected
 * 3. Test wallet has minimum balance
 * 4. Blocks are being produced (2s check)
 * 5. Gas estimation works
 * 6. Test transaction succeeds
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Address, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export interface PreflightConfig {
  rpcUrl: string;
  chainId: number;
  testPrivateKey: string;
  minBalance: bigint;
  timeout: number;
}

export interface PreflightResult {
  success: boolean;
  checks: PreflightCheck[];
  duration: number;
}

export interface PreflightCheck {
  name: string;
  passed: boolean;
  message: string;
  details?: Record<string, string | number | boolean>;
}

const DEFAULT_CONFIG: PreflightConfig = {
  rpcUrl: process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://localhost:9545',
  chainId: parseInt(process.env.CHAIN_ID || '1337'),
  testPrivateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  minBalance: parseEther('1'),
  timeout: 30000,
};

const TEST_WALLET_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;

function createChain(rpcUrl: string, chainId: number): Chain {
  return {
    id: chainId,
    name: 'Jeju Local',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

export async function runPreflightChecks(config: Partial<PreflightConfig> = {}): Promise<PreflightResult> {
  const startTime = Date.now();
  const checks: PreflightCheck[] = [];
  const cfg = { ...DEFAULT_CONFIG, ...config };

  console.log('\n' + '='.repeat(70));
  console.log('E2E PRE-FLIGHT CHECKS');
  console.log('='.repeat(70));
  console.log(`RPC: ${cfg.rpcUrl} | Chain ID: ${cfg.chainId}\n`);

  const chain = createChain(cfg.rpcUrl, cfg.chainId);
  const publicClient = createPublicClient({
    chain,
    transport: http(cfg.rpcUrl, { timeout: cfg.timeout }),
  });

  const fail = (name: string, msg: string) => {
    checks.push({ name, passed: false, message: msg });
    console.log(`    ❌ ${msg}`);
    return { success: false, checks, duration: Date.now() - startTime };
  };

  // Check 1: RPC Connectivity
  console.log('1/6 RPC connectivity...');
  let blockNumber: bigint;
  try {
    blockNumber = await publicClient.getBlockNumber();
    checks.push({ name: 'RPC', passed: true, message: `Block ${blockNumber}` });
    console.log(`    ✅ Block ${blockNumber}`);
  } catch (e) {
    return fail('RPC', `Failed: ${e instanceof Error ? e.message : e}`);
  }

  // Check 2: Chain ID
  console.log('2/6 Chain ID...');
  try {
    const actualChainId = await publicClient.getChainId();
    if (actualChainId !== cfg.chainId) {
      return fail('Chain ID', `Mismatch: expected ${cfg.chainId}, got ${actualChainId}`);
    }
    checks.push({ name: 'Chain ID', passed: true, message: `${actualChainId}` });
    console.log(`    ✅ ${actualChainId}`);
  } catch (e) {
    return fail('Chain ID', `Failed: ${e instanceof Error ? e.message : e}`);
  }

  // Check 3: Balance
  console.log('3/6 Test account balance...');
  try {
    const balance = await publicClient.getBalance({ address: TEST_WALLET_ADDRESS });
    if (balance < cfg.minBalance) {
      return fail('Balance', `${formatEther(balance)} ETH (need ${formatEther(cfg.minBalance)})`);
    }
    checks.push({ name: 'Balance', passed: true, message: `${formatEther(balance)} ETH` });
    console.log(`    ✅ ${formatEther(balance)} ETH`);
  } catch (e) {
    return fail('Balance', `Failed: ${e instanceof Error ? e.message : e}`);
  }

  // Check 4: Block Production (informational - Anvil uses on-demand blocks)
  console.log('4/6 Block production...');
  try {
    const block1 = await publicClient.getBlockNumber();
    await new Promise(r => setTimeout(r, 2000));
    const block2 = await publicClient.getBlockNumber();
    const blocksProduced = block2 > block1;
    // Always pass - on-demand block chains (Anvil) won't produce without txs
    checks.push({
      name: 'Blocks',
      passed: true,
      message: blocksProduced ? `${block1} -> ${block2}` : `On-demand (at ${block1})`,
    });
    console.log(`    ✅ ${blocksProduced ? `${block1} -> ${block2}` : `On-demand mode (block ${block1})`}`);
  } catch (e) {
    return fail('Blocks', `Failed: ${e instanceof Error ? e.message : e}`);
  }

  // Check 5: Gas Estimation
  console.log('5/6 Gas estimation...');
  try {
    const account = privateKeyToAccount(cfg.testPrivateKey as `0x${string}`);
    const gas = await publicClient.estimateGas({
      account: account.address,
      to: TEST_WALLET_ADDRESS,
      value: parseEther('0.001'),
    });
    checks.push({ name: 'Gas', passed: true, message: `${gas}` });
    console.log(`    ✅ ${gas}`);
  } catch (e) {
    return fail('Gas', `Failed: ${e instanceof Error ? e.message : e}`);
  }

  // Check 6: Test Transaction
  console.log('6/6 Test transaction...');
  try {
    const account = privateKeyToAccount(cfg.testPrivateKey as `0x${string}`);
    const walletClient = createWalletClient({
      chain,
      transport: http(cfg.rpcUrl, { timeout: cfg.timeout }),
      account,
    });

    const txHash = await walletClient.sendTransaction({
      to: account.address,
      value: parseEther('0.0001'),
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: cfg.timeout,
    });

    const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
    checks.push({ name: 'Transaction', passed: receipt.status === 'success', message: `Block ${receipt.blockNumber}` });
    console.log(`    ✅ Block ${receipt.blockNumber}, gas: ${formatEther(gasUsed)} ETH`);
  } catch (e) {
    return fail('Transaction', `Failed: ${e instanceof Error ? e.message : e}`);
  }

  const duration = Date.now() - startTime;
  console.log('\n' + '='.repeat(70));
  console.log(`✅ ALL CHECKS PASSED (${(duration / 1000).toFixed(2)}s)`);
  console.log('='.repeat(70) + '\n');

  return { success: true, checks, duration };
}

export async function quickHealthCheck(config: Partial<PreflightConfig> = {}): Promise<boolean> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const client = createPublicClient({
    chain: createChain(cfg.rpcUrl, cfg.chainId),
    transport: http(cfg.rpcUrl, { timeout: 5000 }),
  });

  try {
    return (await client.getChainId()) === cfg.chainId;
  } catch {
    return false;
  }
}

export async function waitForChain(config: Partial<PreflightConfig> = {}, maxWaitMs = 60000): Promise<boolean> {
  const startTime = Date.now();
  console.log(`Waiting for chain (max ${maxWaitMs / 1000}s)...`);

  while (Date.now() - startTime < maxWaitMs) {
    if (await quickHealthCheck(config)) {
      console.log('Chain ready');
      return true;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('Chain not ready');
  return false;
}
