#!/usr/bin/env bun
/**
 * Deploy L1 contracts for MyChain Network
 */
import { Wallet, JsonRpcProvider } from 'ethers';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const keys = JSON.parse(readFileSync(join(import.meta.dir, 'keys.json'), 'utf-8'));
const chainConfig = JSON.parse(readFileSync(join(import.meta.dir, 'chain.json'), 'utf-8'));

async function main() {
  const provider = new JsonRpcProvider(chainConfig.l1RpcUrl);
  const deployer = new Wallet(keys.deployer.privateKey, provider);

  console.log('Deploying L1 contracts for MyChain Network...');
  console.log('Deployer:', deployer.address);
  console.log('Balance:', (await provider.getBalance(deployer.address)).toString());

  // TODO: Deploy L1 contracts
  console.log('L1 deployment complete');
}

main().catch(console.error);
