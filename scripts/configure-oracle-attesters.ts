#!/usr/bin/env bun
/**
 * Configure Oracle Attesters
 * 
 * This script configures authorized attesters for OIF oracles:
 * - SimpleOracle: Add solver addresses as trusted attesters
 * - HyperlaneOracle: Configure trusted senders per domain
 * - SuperchainOracle: Configure trusted output settlers per chain
 */

import { ethers } from 'ethers';
import { Logger } from './shared/logger';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PUBLIC_RPCS, chainName, TESTNET_CHAIN_IDS } from './shared/chains';

const logger = new Logger('configure-oracles');

// Oracle ABIs
const SIMPLE_ORACLE_ABI = [
  'function setAttester(address attester, bool authorized) external',
  'function authorizedAttesters(address) view returns (bool)',
  'function owner() view returns (address)',
];

const HYPERLANE_ORACLE_ABI = [
  'function setAttester(address attester, bool authorized) external',
  'function setTrustedSender(uint32 domain, bytes32 sender) external',
  'function setDomainId(uint256 chainId, uint32 domainId) external',
  'function setMailbox(address mailbox) external',
  'function setISM(address ism) external',
  'function authorizedAttesters(address) view returns (bool)',
  'function trustedSenders(uint32) view returns (bytes32)',
  'function domainIds(uint256) view returns (uint32)',
  'function owner() view returns (address)',
];

const SUPERCHAIN_ORACLE_ABI = [
  'function setAttester(address attester, bool authorized) external',
  'function setSourceChain(uint256 chainId, bool valid) external',
  'function setTrustedOutputSettler(uint256 chainId, address settler) external',
  'function authorizedAttesters(address) view returns (bool)',
  'function validSourceChains(uint256) view returns (bool)',
  'function trustedOutputSettlers(uint256) view returns (address)',
  'function owner() view returns (address)',
];

// Hyperlane domain IDs (see https://docs.hyperlane.xyz/docs/resources/domains)
const HYPERLANE_DOMAINS: Record<number, number> = {
  1: 1,           // Ethereum
  10: 10,         // Optimism
  42161: 42161,   // Arbitrum
  8453: 8453,     // Base
  11155111: 11155111, // Sepolia
  84532: 84532,   // Base Sepolia
  11155420: 11155420, // Optimism Sepolia
  421614: 421614, // Arbitrum Sepolia
};

interface ChainDeployment {
  chainId: number;
  status: string;
  contracts?: {
    oracle?: string;
    oracleType?: string;
    outputSettler?: string;
    solverRegistry?: string;
  };
}

function loadDeployments(network: 'testnet' | 'mainnet'): Record<string, ChainDeployment> {
  const path = resolve(process.cwd(), `packages/contracts/deployments/oif-${network}.json`);
  if (!existsSync(path)) return {};
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  return data.chains || {};
}

function getDeployedChains(): ChainDeployment[] {
  const testnet = loadDeployments('testnet');
  const mainnet = loadDeployments('mainnet');
  const all = { ...testnet, ...mainnet };
  
  return Object.entries(all)
    .filter(([, d]) => d.status === 'deployed' && d.contracts?.oracle)
    .map(([id, d]) => ({ ...d, chainId: parseInt(id) }));
}

function _isTestnet(chainId: number): boolean {
  return TESTNET_CHAIN_IDS.includes(chainId);
}

function addressToBytes32(addr: string): string {
  return '0x' + addr.slice(2).padStart(64, '0');
}

async function configureSimpleOracle(
  provider: ethers.JsonRpcProvider,
  wallet: ethers.Wallet,
  oracleAddr: string,
  attesters: string[]
): Promise<void> {
  const oracle = new ethers.Contract(oracleAddr, SIMPLE_ORACLE_ABI, wallet);
  
  for (const attester of attesters) {
    const isAuthorized = await oracle.authorizedAttesters(attester);
    if (isAuthorized) {
      logger.info(`  ✓ ${attester.slice(0, 10)}... already authorized`);
      continue;
    }
    
    const tx = await oracle.setAttester(attester, true);
    await tx.wait();
    logger.info(`  + ${attester.slice(0, 10)}... authorized`);
  }
}

async function configureHyperlaneOracle(
  provider: ethers.JsonRpcProvider,
  wallet: ethers.Wallet,
  oracleAddr: string,
  chainId: number,
  attesters: string[],
  otherChains: ChainDeployment[]
): Promise<void> {
  const oracle = new ethers.Contract(oracleAddr, HYPERLANE_ORACLE_ABI, wallet);
  
  // Configure attesters
  for (const attester of attesters) {
    const isAuthorized = await oracle.authorizedAttesters(attester);
    if (!isAuthorized) {
      const tx = await oracle.setAttester(attester, true);
      await tx.wait();
      logger.info(`  + Attester ${attester.slice(0, 10)}...`);
    }
  }
  
  // Configure domain IDs and trusted senders for each chain
  for (const chain of otherChains) {
    if (chain.chainId === chainId) continue;
    
    const domainId = HYPERLANE_DOMAINS[chain.chainId];
    if (!domainId) continue;
    
    // Set domain ID
    const currentDomain = await oracle.domainIds(chain.chainId);
    if (Number(currentDomain) !== domainId) {
      const tx = await oracle.setDomainId(chain.chainId, domainId);
      await tx.wait();
      logger.info(`  + Domain ${chain.chainId} → ${domainId}`);
    }
    
    // Set trusted sender (OutputSettler on source chain)
    const outputSettler = chain.contracts?.outputSettler;
    if (outputSettler) {
      const senderBytes32 = addressToBytes32(outputSettler);
      const currentSender = await oracle.trustedSenders(domainId);
      if (currentSender.toLowerCase() !== senderBytes32.toLowerCase()) {
        const tx = await oracle.setTrustedSender(domainId, senderBytes32);
        await tx.wait();
        logger.info(`  + Trusted sender for domain ${domainId}`);
      }
    }
  }
}

async function configureSuperchainOracle(
  provider: ethers.JsonRpcProvider,
  wallet: ethers.Wallet,
  oracleAddr: string,
  chainId: number,
  attesters: string[],
  otherChains: ChainDeployment[]
): Promise<void> {
  const oracle = new ethers.Contract(oracleAddr, SUPERCHAIN_ORACLE_ABI, wallet);
  
  // Configure attesters
  for (const attester of attesters) {
    const isAuthorized = await oracle.authorizedAttesters(attester);
    if (!isAuthorized) {
      const tx = await oracle.setAttester(attester, true);
      await tx.wait();
      logger.info(`  + Attester ${attester.slice(0, 10)}...`);
    }
  }
  
  // Configure source chains and trusted output settlers
  for (const chain of otherChains) {
    if (chain.chainId === chainId) continue;
    
    // Only configure Superchain L2s (OP Stack chains)
    const isOpStackChain = [10, 8453, 11155420, 84532, 420690, 420691].includes(chain.chainId);
    if (!isOpStackChain) continue;
    
    // Enable source chain
    const isValid = await oracle.validSourceChains(chain.chainId);
    if (!isValid) {
      const tx = await oracle.setSourceChain(chain.chainId, true);
      await tx.wait();
      logger.info(`  + Source chain ${chain.chainId} enabled`);
    }
    
    // Set trusted output settler
    const outputSettler = chain.contracts?.outputSettler;
    if (outputSettler) {
      const currentSettler = await oracle.trustedOutputSettlers(chain.chainId);
      if (currentSettler.toLowerCase() !== outputSettler.toLowerCase()) {
        const tx = await oracle.setTrustedOutputSettler(chain.chainId, outputSettler);
        await tx.wait();
        logger.info(`  + Trusted settler for chain ${chain.chainId}`);
      }
    }
  }
}

async function configureOracle(
  chain: ChainDeployment,
  allChains: ChainDeployment[],
  attesters: string[],
  pk: string
): Promise<void> {
  const rpc = PUBLIC_RPCS[chain.chainId];
  if (!rpc) throw new Error(`No RPC for ${chain.chainId}`);
  
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  
  const oracleAddr = chain.contracts?.oracle;
  const oracleType = chain.contracts?.oracleType || 'simple';
  
  if (!oracleAddr) throw new Error('No oracle address');
  
  logger.info(`${chainName(chain.chainId)} (${oracleType} oracle)`);
  
  switch (oracleType) {
    case 'simple':
      await configureSimpleOracle(provider, wallet, oracleAddr, attesters);
      break;
    case 'hyperlane':
      await configureHyperlaneOracle(provider, wallet, oracleAddr, chain.chainId, attesters, allChains);
      break;
    case 'superchain':
      await configureSuperchainOracle(provider, wallet, oracleAddr, chain.chainId, attesters, allChains);
      break;
    default:
      logger.warn(`  Unknown oracle type: ${oracleType}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const chainIdx = args.indexOf('--chain');
  const attesterIdx = args.indexOf('--attester');
  
  const chainId = chainIdx !== -1 ? parseInt(args[chainIdx + 1]) : null;
  const extraAttester = attesterIdx !== -1 ? args[attesterIdx + 1] : null;

  console.log('═══ OIF Oracle Attester Configuration ═══\n');

  const pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) throw new Error('Set DEPLOYER_PRIVATE_KEY');

  const wallet = new ethers.Wallet(pk);
  logger.info(`Owner: ${wallet.address}\n`);

  const deployed = getDeployedChains();
  if (deployed.length === 0) throw new Error('No OIF oracles deployed');

  // Get solver addresses to configure as attesters
  const solverPk = process.env.SOLVER_PRIVATE_KEY;
  const solverAddr = solverPk ? new ethers.Wallet(solverPk).address : null;
  
  const attesters: string[] = [
    wallet.address, // Deployer can attest (for testing/admin)
  ];
  
  if (solverAddr) attesters.push(solverAddr);
  if (extraAttester) attesters.push(extraAttester);

  // Also include known solver addresses from env
  const knownSolvers = (process.env.OIF_DEV_SOLVER_ADDRESSES || '')
    .split(',')
    .filter(addr => addr.startsWith('0x') && addr.length === 42);
  attesters.push(...knownSolvers);

  // Deduplicate
  const uniqueAttesters = [...new Set(attesters.map(a => a.toLowerCase()))];
  
  logger.info(`Configuring ${uniqueAttesters.length} attesters:`);
  for (const a of uniqueAttesters) {
    logger.info(`  - ${a}`);
  }
  console.log('');

  const targets = chainId 
    ? deployed.filter(d => d.chainId === chainId) 
    : all 
    ? deployed 
    : [];

  if (targets.length === 0) {
    console.log(`Deployed oracles: ${deployed.map(c => `${chainName(c.chainId)} (${c.contracts?.oracleType})`).join(', ')}`);
    console.log('\nUsage: --chain 84532 or --all [--attester 0x...]');
    return;
  }

  let ok = 0;
  for (const chain of targets) {
    try {
      await configureOracle(chain, deployed, uniqueAttesters, pk);
      logger.success(`  ${chainName(chain.chainId)} configured`);
      ok++;
    } catch (e) {
      logger.error(`  ${chainName(chain.chainId)}: ${(e as Error).message}`);
    }
  }

  console.log(`\n═══ ${ok}/${targets.length} oracles configured ═══`);
  process.exit(ok === targets.length ? 0 : 1);
}

main().catch(e => { logger.error(e.message); process.exit(1); });
