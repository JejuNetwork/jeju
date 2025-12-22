#!/usr/bin/env bun
/**
 * Register MyChain Network with the Federation
 */
import { Wallet, JsonRpcProvider, Contract, parseEther } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

const keys = JSON.parse(readFileSync(join(import.meta.dir, 'keys.json'), 'utf-8'));
const chainConfig = JSON.parse(readFileSync(join(import.meta.dir, 'chain.json'), 'utf-8'));
const federationConfig = JSON.parse(readFileSync(join(import.meta.dir, 'federation.json'), 'utf-8'));
const contracts = JSON.parse(readFileSync(join(import.meta.dir, 'contracts.json'), 'utf-8'));

const NETWORK_REGISTRY_ABI = [
  'function registerNetwork(uint256 chainId, string name, string rpcUrl, string explorerUrl, string wsUrl, tuple(address identityRegistry, address solverRegistry, address inputSettler, address outputSettler, address liquidityVault, address governance, address oracle) contracts, bytes32 genesisHash) payable',
  'function establishTrust(uint256 sourceChainId, uint256 targetChainId)',
];

async function main() {
  const provider = new JsonRpcProvider(federationConfig.hub.rpcUrl);
  const deployer = new Wallet(keys.deployer.privateKey, provider);

  console.log('Registering MyChain Network with Federation...');

  const registry = new Contract(federationConfig.hub.registryAddress, NETWORK_REGISTRY_ABI, deployer);
  const genesisHash = '0x' + '0'.repeat(64);

  const tx = await registry.registerNetwork(
    chainConfig.chainId,
    chainConfig.name,
    chainConfig.rpcUrl,
    chainConfig.explorerUrl,
    chainConfig.wsUrl,
    {
      identityRegistry: contracts.identityRegistry,
      solverRegistry: contracts.solverRegistry,
      inputSettler: contracts.inputSettler,
      outputSettler: contracts.outputSettler,
      liquidityVault: contracts.liquidityVault,
      governance: contracts.governance,
      oracle: contracts.oracle,
    },
    genesisHash,
    { value: parseEther('1') }
  );

  console.log('TX:', tx.hash);
  await tx.wait();
  console.log('Federation registration complete');
}

main().catch(console.error);
