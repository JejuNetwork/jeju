import { loadChainConfig } from '../config';
import type { NetworkType } from '../types/chain';

const networks: NetworkType[] = ['mainnet', 'testnet', 'localnet'];

interface ValidationError {
  network: string;
  field: string;
  message: string;
}

const errors: ValidationError[] = [];
const warnings: ValidationError[] = [];

function validateAddress(address: string, name: string, network: string, required: boolean = true): void {
  if (!address || address === '') {
    if (required) {
      warnings.push({
        network,
        field: name,
        message: `Address not set (will need to be configured after deployment)`,
      });
    }
    return;
  }

  if (!address.startsWith('0x')) {
    errors.push({
      network,
      field: name,
      message: `Invalid address format: must start with 0x`,
    });
  }

  if (address.length !== 42) {
    errors.push({
      network,
      field: name,
      message: `Invalid address length: expected 42 characters, got ${address.length}`,
    });
  }
}

function validateUrl(url: string, name: string, network: string): void {
  if (!url || url === '') {
    errors.push({
      network,
      field: name,
      message: `URL is required`,
    });
    return;
  }

  const validProtocols = ['http://', 'https://', 'ws://', 'wss://'];
  const hasValidProtocol = validProtocols.some(protocol => url.startsWith(protocol));

  if (!hasValidProtocol) {
    errors.push({
      network,
      field: name,
      message: `Invalid URL protocol. Must start with one of: ${validProtocols.join(', ')}`,
    });
  }
}

function validateChainConfig(network: NetworkType): void {
  console.log(`\n✓ Validating ${network} configuration...`);

  const config = loadChainConfig(network);

  validateUrl(config.rpcUrl, 'rpcUrl', network);
  validateUrl(config.wsUrl, 'wsUrl', network);
  validateUrl(config.explorerUrl, 'explorerUrl', network);
  validateUrl(config.l1RpcUrl, 'l1RpcUrl', network);

  if (config.chainId <= 0) {
    errors.push({
      network,
      field: 'chainId',
      message: `Invalid chain ID: must be positive`,
    });
  }

  if (config.blockTime <= 0) {
    errors.push({
      network,
      field: 'blockTime',
      message: `Invalid block time: must be positive`,
    });
  }

  if (config.flashblocksEnabled && config.flashblocksSubBlockTime <= 0) {
    errors.push({
      network,
      field: 'flashblocksSubBlockTime',
      message: `Invalid sub-block time: must be positive when Flashblocks is enabled`,
    });
  }

  console.log(`  → L2 Contracts (Predeploys):`);
  for (const [name, address] of Object.entries(config.contracts.l2)) {
    validateAddress(address, `contracts.l2.${name}`, network, true);
    console.log(`    ✓ ${name}: ${address}`);
  }

  console.log(`  → L1 Contracts (Settlement Layer):`);
  for (const [name, address] of Object.entries(config.contracts.l1)) {
    validateAddress(address, `contracts.l1.${name}`, network, false);
    if (address) {
      console.log(`    ✓ ${name}: ${address}`);
    } else {
      console.log(`    ⚠ ${name}: Not yet deployed`);
    }
  }
}

function main(): void {
  console.log('='.repeat(60));
  console.log('Validating Jeju Network Configurations');
  console.log('='.repeat(60));

  for (const network of networks) {
    validateChainConfig(network);
  }

  console.log('\n' + '='.repeat(60));

  if (errors.length > 0) {
    console.log(`\n❌ Found ${errors.length} error(s):\n`);
    for (const error of errors) {
      console.log(`  [${error.network}] ${error.field}: ${error.message}`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️  Found ${warnings.length} warning(s):\n`);
    for (const warning of warnings) {
      console.log(`  [${warning.network}] ${warning.field}: ${warning.message}`);
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n✅ All configurations are valid!');
  } else if (errors.length === 0) {
    console.log('\n✅ All configurations are valid (with warnings)');
  } else {
    console.log('\n❌ Configuration validation failed!');
    process.exit(1);
  }

  console.log('='.repeat(60) + '\n');
}

main();


