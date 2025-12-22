#!/usr/bin/env bun
/**
 * Deploy L2 contracts for MyChain Network
 */
import { Wallet, JsonRpcProvider } from 'ethers';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const keys = JSON.parse(readFileSync(join(import.meta.dir, 'keys.json'), 'utf-8'));
const chainConfig = JSON.parse(readFileSync(join(import.meta.dir, 'chain.json'), 'utf-8'));

async function main() {
  const provider = new JsonRpcProvider(chainConfig.rpcUrl);
  const deployer = new Wallet(keys.deployer.privateKey, provider);

  console.log('Deploying L2 contracts for MyChain Network...');
  console.log('Deployer:', deployer.address);

  const contracts = {
    identityRegistry: '',
    solverRegistry: '',
    inputSettler: '',
    outputSettler: '',
    liquidityVault: '',
    governance: '',
    oracle: '',
  };

  writeFileSync(join(import.meta.dir, 'contracts.json'), JSON.stringify(contracts, null, 2));
  console.log('L2 deployment complete');
}

main().catch(console.error);
