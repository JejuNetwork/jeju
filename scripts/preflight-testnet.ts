#!/usr/bin/env bun
/**
 * @fileoverview Testnet Deployment Preflight Check
 * 
 * Validates all prerequisites before deploying to testnet:
 * - Environment variables
 * - Network connectivity
 * - Contract deployments
 * - Liquidity requirements
 * - Service health
 * 
 * Usage:
 *   bun run scripts/preflight-testnet.ts
 */

import { ethers } from 'ethers';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  required: boolean;
}

const results: CheckResult[] = [];

function addResult(name: string, status: CheckResult['status'], message: string, required = true) {
  results.push({ name, status, message, required });
  const icon = status === 'pass' ? '✅' : status === 'warn' ? '⚠️' : '❌';
  console.log(`${icon} ${name}: ${message}`);
}

async function checkEnvVars() {
  console.log('\n📋 Checking environment variables...\n');
  
  const required = ['DEPLOYER_PRIVATE_KEY'];
  const optional = ['ETHERSCAN_API_KEY', 'WALLETCONNECT_PROJECT_ID'];
  
  for (const v of required) {
    if (process.env[v]) {
      addResult(`ENV ${v}`, 'pass', 'Set');
    } else {
      addResult(`ENV ${v}`, 'fail', 'Missing - required for deployment');
    }
  }
  
  for (const v of optional) {
    if (process.env[v]) {
      addResult(`ENV ${v}`, 'pass', 'Set', false);
    } else {
      addResult(`ENV ${v}`, 'warn', 'Not set - optional but recommended', false);
    }
  }
}

async function checkNetworkConnectivity() {
  console.log('\n🌐 Checking network connectivity...\n');
  
  const networks = [
    { name: 'Sepolia', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', expectedChainId: 11155111 },
    { name: 'Base Sepolia', rpc: 'https://sepolia.base.org', expectedChainId: 84532 },
    { name: 'Jeju Testnet', rpc: 'https://testnet-rpc.jeju.network', expectedChainId: 420690 },
  ];
  
  for (const net of networks) {
    try {
      const provider = new ethers.JsonRpcProvider(net.rpc);
      const network = await provider.getNetwork();
      if (Number(network.chainId) === net.expectedChainId) {
        addResult(`${net.name} RPC`, 'pass', `Connected (Chain ID: ${network.chainId})`);
      } else {
        addResult(`${net.name} RPC`, 'fail', `Wrong chain ID: ${network.chainId}, expected ${net.expectedChainId}`);
      }
    } catch (e) {
      addResult(`${net.name} RPC`, net.name === 'Jeju Testnet' ? 'warn' : 'fail', `Not reachable: ${(e as Error).message.slice(0, 50)}`);
    }
  }
}

async function checkDeployerBalance() {
  console.log('\n💰 Checking deployer balance...\n');
  
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) {
    addResult('Deployer Balance', 'fail', 'No private key set');
    return;
  }
  
  const wallet = new ethers.Wallet(pk);
  
  const networks = [
    { name: 'Sepolia', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', minBalance: 0.5 },
    { name: 'Base Sepolia', rpc: 'https://sepolia.base.org', minBalance: 0.1 },
  ];
  
  for (const net of networks) {
    try {
      const provider = new ethers.JsonRpcProvider(net.rpc);
      const balance = await provider.getBalance(wallet.address);
      const ethBalance = Number(ethers.formatEther(balance));
      
      if (ethBalance >= net.minBalance) {
        addResult(`${net.name} Balance`, 'pass', `${ethBalance.toFixed(4)} ETH (min: ${net.minBalance})`);
      } else {
        addResult(`${net.name} Balance`, 'fail', `${ethBalance.toFixed(4)} ETH - need ${net.minBalance} ETH`);
      }
    } catch (e) {
      addResult(`${net.name} Balance`, 'warn', `Could not check: ${(e as Error).message.slice(0, 30)}`);
    }
  }
}

async function checkContractDeployments() {
  console.log('\n📜 Checking contract deployments...\n');
  
  // OIF contracts on Base Sepolia (fully deployed)
  const contracts = [
    { name: 'SolverRegistry (Base Sepolia)', address: '0xecfe47302d941c8ce5b0009c0ac2e6d6ee2a42de', rpc: 'https://sepolia.base.org' },
    { name: 'InputSettler (Base Sepolia)', address: '0x9bb59d0329fccedd99f1753d20af50347ad2eb75', rpc: 'https://sepolia.base.org' },
    { name: 'OutputSettler (Base Sepolia)', address: '0xf7ef3c6a54da3e03a96d23864e5865e7e3ebecf5', rpc: 'https://sepolia.base.org' },
  ];
  
  // Note: L1StakeManager needs to be deployed - not checking as it's expected to be missing
  
  for (const c of contracts) {
    try {
      const provider = new ethers.JsonRpcProvider(c.rpc);
      const code = await provider.getCode(c.address);
      
      if (code !== '0x' && code.length > 2) {
        addResult(c.name, 'pass', `Deployed at ${c.address.slice(0, 10)}...`);
      } else {
        addResult(c.name, 'fail', `No code at ${c.address}`);
      }
    } catch (e) {
      addResult(c.name, 'warn', `Could not verify: ${(e as Error).message.slice(0, 30)}`);
    }
  }
}

async function checkOIFTestnet() {
  console.log('\n🎯 Checking OIF deployment status...\n');
  
  try {
    const oifDeployment = await Bun.file('packages/contracts/deployments/oif-testnet.json').json();
    
    for (const [_chainKey, chainData] of Object.entries(oifDeployment.chains as Record<string, { status: string; name: string; contracts: Record<string, string> }>)) {
      const chain = chainData as { status: string; name: string; contracts: Record<string, string> };
      if (chain.status === 'deployed') {
        addResult(`OIF ${chain.name}`, 'pass', 'Fully deployed');
      } else if (chain.status === 'pending') {
        addResult(`OIF ${chain.name}`, 'warn', 'Pending deployment');
      } else {
        addResult(`OIF ${chain.name}`, 'fail', `Status: ${chain.status}`);
      }
    }
  } catch (e) {
    addResult('OIF Config', 'fail', 'Could not read oif-testnet.json');
  }
}

async function checkEILTestnet() {
  console.log('\n🔗 Checking EIL deployment status...\n');
  
  try {
    const eilDeployment = await Bun.file('packages/contracts/deployments/eil-testnet.json').json();
    
    if (eilDeployment.l1StakeManager && eilDeployment.l1StakeManager !== '') {
      addResult('EIL L1StakeManager', 'pass', `Deployed: ${eilDeployment.l1StakeManager.slice(0, 15)}...`);
    } else {
      addResult('EIL L1StakeManager', 'fail', 'Not deployed');
    }
    
    if (eilDeployment.crossChainPaymaster && eilDeployment.crossChainPaymaster !== '') {
      addResult('EIL CrossChainPaymaster', 'pass', `Deployed: ${eilDeployment.crossChainPaymaster.slice(0, 15)}...`);
    } else {
      addResult('EIL CrossChainPaymaster', 'warn', 'Not deployed - needs Jeju testnet RPC');
    }
    
    addResult('EIL Status', eilDeployment.status === 'complete' ? 'pass' : 'warn', eilDeployment.status);
  } catch (e) {
    addResult('EIL Config', 'fail', 'Could not read eil-testnet.json');
  }
}

async function checkEntryPoint() {
  console.log('\n🚪 Checking ERC-4337 EntryPoint...\n');
  
  const entryPointV6 = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
  
  const networks = [
    { name: 'Sepolia', rpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
    { name: 'Base Sepolia', rpc: 'https://sepolia.base.org' },
  ];
  
  for (const net of networks) {
    try {
      const provider = new ethers.JsonRpcProvider(net.rpc);
      const code = await provider.getCode(entryPointV6);
      
      if (code !== '0x' && code.length > 100) {
        addResult(`EntryPoint v0.6 (${net.name})`, 'pass', 'Available');
      } else {
        addResult(`EntryPoint v0.6 (${net.name})`, 'fail', 'Not found');
      }
    } catch (e) {
      addResult(`EntryPoint v0.6 (${net.name})`, 'warn', 'Could not verify');
    }
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           Jeju Testnet Deployment Preflight Check              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  
  await checkEnvVars();
  await checkNetworkConnectivity();
  await checkDeployerBalance();
  await checkContractDeployments();
  await checkOIFTestnet();
  await checkEILTestnet();
  await checkEntryPoint();
  
  console.log('\n' + '═'.repeat(60) + '\n');
  console.log('📊 Summary:\n');
  
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail' && r.required).length;
  const warnings = results.filter(r => r.status === 'warn' || (r.status === 'fail' && !r.required)).length;
  
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   ⚠️  Warnings: ${warnings}`);
  
  console.log('\n' + '═'.repeat(60) + '\n');
  
  if (failed > 0) {
    console.log('❌ PREFLIGHT FAILED - Fix required issues before deployment\n');
    
    console.log('Next steps:');
    results.filter(r => r.status === 'fail' && r.required).forEach(r => {
      console.log(`  - ${r.name}: ${r.message}`);
    });
    
    process.exit(1);
  } else if (warnings > 0) {
    console.log('⚠️  PREFLIGHT PASSED WITH WARNINGS\n');
    console.log('Deployment can proceed, but consider addressing:\n');
    results.filter(r => r.status === 'warn').forEach(r => {
      console.log(`  - ${r.name}: ${r.message}`);
    });
    process.exit(0);
  } else {
    console.log('✅ PREFLIGHT PASSED - Ready for deployment\n');
    console.log('Run deployment with:');
    console.log('  bun run scripts/deploy/testnet.ts\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Preflight check failed:', err);
  process.exit(1);
});

