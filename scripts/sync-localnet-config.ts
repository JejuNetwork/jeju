#!/usr/bin/env bun
/**
 * Sync Localnet Deployment to Config
 * 
 * Reads localnet-complete.json and updates contracts.json with the addresses.
 * Run after bootstrap: bun run scripts/sync-localnet-config.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const DEPLOYMENT_FILE = join(ROOT, 'packages/contracts/deployments/localnet-complete.json');
const CONFIG_FILE = join(ROOT, 'packages/config/contracts.json');

interface BootstrapResult {
  contracts: {
    jeju?: string;
    usdc?: string;
    elizaOS?: string;
    weth?: string;
    creditManager?: string;
    universalPaymaster?: string;
    serviceRegistry?: string;
    priceOracle?: string;
    tokenRegistry?: string;
    paymasterFactory?: string;
    entryPoint?: string;
    identityRegistry?: string;
    reputationRegistry?: string;
    validationRegistry?: string;
    nodeStakingManager?: string;
    nodePerformanceOracle?: string;
    poolManager?: string;
    swapRouter?: string;
    positionManager?: string;
    quoterV4?: string;
    stateView?: string;
    futarchyGovernor?: string;
    fileStorageManager?: string;
    banManager?: string;
    reputationLabelManager?: string;
    computeRegistry?: string;
    ledgerManager?: string;
    inferenceServing?: string;
    computeStaking?: string;
    riskSleeve?: string;
    liquidityRouter?: string;
    multiServiceStakeManager?: string;
    liquidityVault?: string;
  };
}

function isValidAddress(addr: string | undefined): boolean {
  return !!addr && addr !== '0x0000000000000000000000000000000000000000' && addr.startsWith('0x');
}

function main() {
  if (!existsSync(DEPLOYMENT_FILE)) {
    console.error('No deployment file found. Run bootstrap first: jeju dev');
    process.exit(1);
  }

  const deployment: BootstrapResult = JSON.parse(readFileSync(DEPLOYMENT_FILE, 'utf-8'));
  const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));

  console.log('Syncing localnet addresses to contracts.json...');

  // Update tokens
  if (isValidAddress(deployment.contracts.jeju)) {
    config.localnet.tokens.jeju = deployment.contracts.jeju;
    console.log(`  tokens.jeju: ${deployment.contracts.jeju}`);
  }
  if (isValidAddress(deployment.contracts.usdc)) {
    config.localnet.tokens.usdc = deployment.contracts.usdc;
    console.log(`  tokens.usdc: ${deployment.contracts.usdc}`);
  }
  if (isValidAddress(deployment.contracts.elizaOS)) {
    config.localnet.tokens.elizaOS = deployment.contracts.elizaOS;
    console.log(`  tokens.elizaOS: ${deployment.contracts.elizaOS}`);
  }

  // Update registry
  if (isValidAddress(deployment.contracts.identityRegistry)) {
    config.localnet.registry.identity = deployment.contracts.identityRegistry;
    console.log(`  registry.identity: ${deployment.contracts.identityRegistry}`);
  }
  if (isValidAddress(deployment.contracts.reputationRegistry)) {
    config.localnet.registry.reputation = deployment.contracts.reputationRegistry;
    console.log(`  registry.reputation: ${deployment.contracts.reputationRegistry}`);
  }
  if (isValidAddress(deployment.contracts.validationRegistry)) {
    config.localnet.registry.validation = deployment.contracts.validationRegistry;
    console.log(`  registry.validation: ${deployment.contracts.validationRegistry}`);
  }

  // Update moderation
  if (isValidAddress(deployment.contracts.banManager)) {
    config.localnet.moderation.banManager = deployment.contracts.banManager;
    console.log(`  moderation.banManager: ${deployment.contracts.banManager}`);
  }
  if (isValidAddress(deployment.contracts.reputationLabelManager)) {
    config.localnet.moderation.reputationLabelManager = deployment.contracts.reputationLabelManager;
    console.log(`  moderation.reputationLabelManager: ${deployment.contracts.reputationLabelManager}`);
  }

  // Update nodeStaking
  if (isValidAddress(deployment.contracts.nodeStakingManager)) {
    config.localnet.nodeStaking.manager = deployment.contracts.nodeStakingManager;
    console.log(`  nodeStaking.manager: ${deployment.contracts.nodeStakingManager}`);
  }
  if (isValidAddress(deployment.contracts.nodePerformanceOracle)) {
    config.localnet.nodeStaking.performanceOracle = deployment.contracts.nodePerformanceOracle;
    console.log(`  nodeStaking.performanceOracle: ${deployment.contracts.nodePerformanceOracle}`);
  }

  // Update payments
  if (isValidAddress(deployment.contracts.tokenRegistry)) {
    config.localnet.payments.tokenRegistry = deployment.contracts.tokenRegistry;
    console.log(`  payments.tokenRegistry: ${deployment.contracts.tokenRegistry}`);
  }
  if (isValidAddress(deployment.contracts.paymasterFactory)) {
    config.localnet.payments.paymasterFactory = deployment.contracts.paymasterFactory;
    console.log(`  payments.paymasterFactory: ${deployment.contracts.paymasterFactory}`);
  }
  if (isValidAddress(deployment.contracts.priceOracle)) {
    config.localnet.payments.priceOracle = deployment.contracts.priceOracle;
    console.log(`  payments.priceOracle: ${deployment.contracts.priceOracle}`);
  }
  if (isValidAddress(deployment.contracts.universalPaymaster)) {
    config.localnet.payments.multiTokenPaymaster = deployment.contracts.universalPaymaster;
    console.log(`  payments.multiTokenPaymaster: ${deployment.contracts.universalPaymaster}`);
  }

  // Update defi
  if (isValidAddress(deployment.contracts.poolManager)) {
    config.localnet.defi.poolManager = deployment.contracts.poolManager;
    console.log(`  defi.poolManager: ${deployment.contracts.poolManager}`);
  }
  if (isValidAddress(deployment.contracts.swapRouter)) {
    config.localnet.defi.swapRouter = deployment.contracts.swapRouter;
    console.log(`  defi.swapRouter: ${deployment.contracts.swapRouter}`);
  }
  if (isValidAddress(deployment.contracts.positionManager)) {
    config.localnet.defi.positionManager = deployment.contracts.positionManager;
    console.log(`  defi.positionManager: ${deployment.contracts.positionManager}`);
  }
  if (isValidAddress(deployment.contracts.quoterV4)) {
    config.localnet.defi.quoterV4 = deployment.contracts.quoterV4;
    console.log(`  defi.quoterV4: ${deployment.contracts.quoterV4}`);
  }
  if (isValidAddress(deployment.contracts.stateView)) {
    config.localnet.defi.stateView = deployment.contracts.stateView;
    console.log(`  defi.stateView: ${deployment.contracts.stateView}`);
  }

  // Update compute
  if (isValidAddress(deployment.contracts.computeRegistry)) {
    config.localnet.compute.registry = deployment.contracts.computeRegistry;
    console.log(`  compute.registry: ${deployment.contracts.computeRegistry}`);
  }
  if (isValidAddress(deployment.contracts.ledgerManager)) {
    config.localnet.compute.ledgerManager = deployment.contracts.ledgerManager;
    console.log(`  compute.ledgerManager: ${deployment.contracts.ledgerManager}`);
  }
  if (isValidAddress(deployment.contracts.inferenceServing)) {
    config.localnet.compute.inferenceServing = deployment.contracts.inferenceServing;
    console.log(`  compute.inferenceServing: ${deployment.contracts.inferenceServing}`);
  }
  if (isValidAddress(deployment.contracts.computeStaking)) {
    config.localnet.compute.staking = deployment.contracts.computeStaking;
    console.log(`  compute.staking: ${deployment.contracts.computeStaking}`);
  }

  // Update liquidity
  if (isValidAddress(deployment.contracts.riskSleeve)) {
    config.localnet.liquidity.riskSleeve = deployment.contracts.riskSleeve;
    console.log(`  liquidity.riskSleeve: ${deployment.contracts.riskSleeve}`);
  }
  if (isValidAddress(deployment.contracts.liquidityRouter)) {
    config.localnet.liquidity.liquidityRouter = deployment.contracts.liquidityRouter;
    console.log(`  liquidity.liquidityRouter: ${deployment.contracts.liquidityRouter}`);
  }
  if (isValidAddress(deployment.contracts.multiServiceStakeManager)) {
    config.localnet.liquidity.multiServiceStakeManager = deployment.contracts.multiServiceStakeManager;
    console.log(`  liquidity.multiServiceStakeManager: ${deployment.contracts.multiServiceStakeManager}`);
  }
  if (isValidAddress(deployment.contracts.liquidityVault)) {
    config.localnet.liquidity.liquidityVault = deployment.contracts.liquidityVault;
    console.log(`  liquidity.liquidityVault: ${deployment.contracts.liquidityVault}`);
  }

  // Save updated config
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log('\nConfig updated: packages/config/contracts.json');
}

main();

