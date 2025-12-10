/**
 * @fileoverview Export ABIs from forge build artifacts
 * Run after `forge build` to update abis/ folder
 */

import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';

const OUT_DIR = join(import.meta.dir, '../out');
const ABIS_DIR = join(import.meta.dir, '../abis');

// Contracts to export ABIs for
const CONTRACTS_TO_EXPORT = [
  // Core
  { file: 'ERC20.sol', contract: 'ERC20' },
  { file: 'SimpleERC20Factory.sol', contract: 'SimpleERC20Factory', outputName: 'ERC20Factory' },
  { file: 'Bazaar.sol', contract: 'Bazaar' },
  { file: 'IdentityRegistry.sol', contract: 'IdentityRegistry' },
  // Tokens
  { file: 'JejuToken.sol', contract: 'JejuToken' },
  // Moderation
  { file: 'BanManager.sol', contract: 'BanManager' },
  { file: 'ModerationMarketplace.sol', contract: 'ModerationMarketplace' },
  // Services
  { file: 'CreditManager.sol', contract: 'CreditManager' },
  { file: 'MultiTokenPaymaster.sol', contract: 'MultiTokenPaymaster' },
  // Paymaster
  { file: 'TokenRegistry.sol', contract: 'TokenRegistry' },
  { file: 'PaymasterFactory.sol', contract: 'PaymasterFactory' },
  { file: 'LiquidityVault.sol', contract: 'LiquidityVault' },
  { file: 'AppTokenPreference.sol', contract: 'AppTokenPreference' },
  // OIF
  { file: 'InputSettler.sol', contract: 'InputSettler' },
  { file: 'OutputSettler.sol', contract: 'OutputSettler' },
  { file: 'SolverRegistry.sol', contract: 'SolverRegistry' },
  { file: 'OracleAdapter.sol', contract: 'SimpleOracle' },
  { file: 'OracleAdapter.sol', contract: 'HyperlaneOracle' },
  { file: 'OracleAdapter.sol', contract: 'SuperchainOracle' },
  // OTC
  { file: 'OTC.sol', contract: 'OTC' },
  { file: 'SimplePoolOracle.sol', contract: 'SimplePoolOracle' },
  { file: 'RegistrationHelper.sol', contract: 'RegistrationHelper' },
  { file: 'MockERC20.sol', contract: 'MockERC20' },
  { file: 'MockAggregator.sol', contract: 'MockAggregatorV3' },
];

async function fileExists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

async function main() {
  await mkdir(ABIS_DIR, { recursive: true });

  let exported = 0;
  let skipped = 0;

  for (const { file, contract, outputName } of CONTRACTS_TO_EXPORT) {
    const artifactPath = join(OUT_DIR, file, `${contract}.json`);
    
    if (!await fileExists(artifactPath)) {
      console.log(`⚠ Skipped ${contract} (artifact not found)`);
      skipped++;
      continue;
    }

    const content = await readFile(artifactPath, 'utf-8');
    const artifact = JSON.parse(content);
    const abi = artifact.abi;

    const name = outputName || contract;
    const outputPath = join(ABIS_DIR, `${name}.json`);
    await writeFile(outputPath, JSON.stringify({ abi }, null, 2));
    
    console.log(`✓ Exported ${name} (${abi.length} entries)`);
    exported++;
  }

  console.log(`\nExported ${exported} ABIs to abis/ (${skipped} skipped)`);
}

main().catch(console.error);
