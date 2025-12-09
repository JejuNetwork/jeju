/**
 * @fileoverview Integration tests for OIF Solver with real chain interactions
 * Uses Ethereum testnet/mainnet for on-chain verification
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';

// Test configuration
const PRIVATE_KEY = process.env.MAINNET_EVM_PRIVATE_KEY as `0x${string}`;
const USE_TESTNET = process.env.USE_TESTNET === 'true';
const chain = USE_TESTNET ? sepolia : mainnet;
const rpcUrl = USE_TESTNET 
  ? 'https://ethereum-sepolia-rpc.publicnode.com'
  : (process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com');

// Skip integration tests if no private key
const skipIntegration = !PRIVATE_KEY;

describe('Solver Chain Integration', () => {
  let publicClient: ReturnType<typeof createPublicClient>;
  let walletClient: ReturnType<typeof createWalletClient>;
  let account: ReturnType<typeof privateKeyToAccount>;

  beforeAll(() => {
    if (skipIntegration) return;
    
    account = privateKeyToAccount(PRIVATE_KEY);
    publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
    walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });
  });

  test('can connect to chain and get block number', async () => {
    if (skipIntegration) {
      console.log('Skipping: No MAINNET_EVM_PRIVATE_KEY provided');
      return;
    }

    const blockNumber = await publicClient.getBlockNumber();
    expect(blockNumber).toBeGreaterThan(0n);
    console.log(`Connected to ${chain.name} at block ${blockNumber}`);
  });

  test('wallet has expected address', async () => {
    if (skipIntegration) return;

    expect(account.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    console.log(`Wallet address: ${account.address}`);
  });

  test('can check wallet balance', async () => {
    if (skipIntegration) return;

    const balance = await publicClient.getBalance({
      address: account.address,
    });
    
    console.log(`Wallet balance: ${formatEther(balance)} ETH`);
    expect(balance).toBeGreaterThanOrEqual(0n);
  });

  test('can estimate gas for transfer', async () => {
    if (skipIntegration) return;

    const gasEstimate = await publicClient.estimateGas({
      account: account.address,
      to: account.address, // Self-transfer for test
      value: parseEther('0.0001'),
    });

    expect(gasEstimate).toBeGreaterThan(0n);
    console.log(`Gas estimate for transfer: ${gasEstimate}`);
  });

  test('can get current gas price', async () => {
    if (skipIntegration) return;

    const gasPrice = await publicClient.getGasPrice();
    expect(gasPrice).toBeGreaterThan(0n);
    console.log(`Current gas price: ${gasPrice / 10n ** 9n} gwei`);
  });

  test('can simulate contract call without execution', async () => {
    if (skipIntegration) return;

    // Simulate a simple value transfer (acts like a contract call)
    const result = await publicClient.call({
      account: account.address,
      to: account.address,
      value: parseEther('0.0001'),
    });

    // For a value transfer, result.data is empty/undefined
    expect(result).toBeDefined();
  });
});

describe('OutputSettler Contract Interaction', () => {
  const OUTPUT_SETTLER_ABI = [
    {
      type: 'function',
      name: 'isFilled',
      stateMutability: 'view',
      inputs: [{ name: 'orderId', type: 'bytes32' }],
      outputs: [{ type: 'bool' }],
    },
    {
      type: 'function',
      name: 'fill',
      stateMutability: 'payable',
      inputs: [
        { name: 'orderId', type: 'bytes32' },
        { name: 'recipient', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [],
    },
  ] as const;

  let publicClient: ReturnType<typeof createPublicClient>;

  beforeAll(() => {
    if (skipIntegration) return;

    publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
  });

  test('can read from OutputSettler if deployed', async () => {
    if (skipIntegration) return;

    const outputSettlerAddress = process.env[`OIF_OUTPUT_SETTLER_${chain.id}`] as `0x${string}`;
    if (!outputSettlerAddress || outputSettlerAddress === '0x0000000000000000000000000000000000000000') {
      console.log('Skipping: No OutputSettler deployed on this chain');
      return;
    }

    // Check if a random order ID is filled (should be false)
    const randomOrderId = '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;
    
    const isFilled = await publicClient.readContract({
      address: outputSettlerAddress,
      abi: OUTPUT_SETTLER_ABI,
      functionName: 'isFilled',
      args: [randomOrderId],
    });

    expect(typeof isFilled).toBe('boolean');
    console.log(`Order ${randomOrderId.slice(0, 10)}... filled: ${isFilled}`);
  });
});

describe('SolverRegistry Contract Interaction', () => {
  const SOLVER_REGISTRY_ABI = [
    {
      type: 'function',
      name: 'isSolverActive',
      stateMutability: 'view',
      inputs: [{ name: 'solver', type: 'address' }],
      outputs: [{ type: 'bool' }],
    },
    {
      type: 'function',
      name: 'minStakeAmount',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ type: 'uint256' }],
    },
  ] as const;

  let publicClient: ReturnType<typeof createPublicClient>;
  let account: ReturnType<typeof privateKeyToAccount>;

  beforeAll(() => {
    if (skipIntegration) return;

    account = privateKeyToAccount(PRIVATE_KEY);
    publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
  });

  test('can check solver status if registry deployed', async () => {
    if (skipIntegration) return;

    const registryAddress = process.env.OIF_SOLVER_REGISTRY as `0x${string}`;
    if (!registryAddress || registryAddress === '0x0000000000000000000000000000000000000000') {
      console.log('Skipping: No SolverRegistry deployed');
      return;
    }

    const isActive = await publicClient.readContract({
      address: registryAddress,
      abi: SOLVER_REGISTRY_ABI,
      functionName: 'isSolverActive',
      args: [account.address],
    });

    expect(typeof isActive).toBe('boolean');
    console.log(`Solver ${account.address.slice(0, 10)}... active: ${isActive}`);
  });

  test('can read min stake amount if registry deployed', async () => {
    if (skipIntegration) return;

    const registryAddress = process.env.OIF_SOLVER_REGISTRY as `0x${string}`;
    if (!registryAddress || registryAddress === '0x0000000000000000000000000000000000000000') {
      console.log('Skipping: No SolverRegistry deployed');
      return;
    }

    const minStake = await publicClient.readContract({
      address: registryAddress,
      abi: SOLVER_REGISTRY_ABI,
      functionName: 'minStakeAmount',
    });

    expect(minStake).toBeGreaterThanOrEqual(0n);
    console.log(`Minimum stake: ${formatEther(minStake)} ETH`);
  });
});

describe('InputSettler Contract Interaction', () => {
  const INPUT_SETTLER_ABI = [
    {
      type: 'function',
      name: 'isSettled',
      stateMutability: 'view',
      inputs: [{ name: 'orderId', type: 'bytes32' }],
      outputs: [{ type: 'bool' }],
    },
    {
      type: 'function',
      name: 'isCancelled',
      stateMutability: 'view',
      inputs: [{ name: 'orderId', type: 'bytes32' }],
      outputs: [{ type: 'bool' }],
    },
  ] as const;

  let publicClient: ReturnType<typeof createPublicClient>;

  beforeAll(() => {
    if (skipIntegration) return;

    publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
  });

  test('can check order settlement status if deployed', async () => {
    if (skipIntegration) return;

    const inputSettlerAddress = process.env[`OIF_INPUT_SETTLER_${chain.id}`] as `0x${string}`;
    if (!inputSettlerAddress || inputSettlerAddress === '0x0000000000000000000000000000000000000000') {
      console.log('Skipping: No InputSettler deployed on this chain');
      return;
    }

    const randomOrderId = '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;
    
    const isSettled = await publicClient.readContract({
      address: inputSettlerAddress,
      abi: INPUT_SETTLER_ABI,
      functionName: 'isSettled',
      args: [randomOrderId],
    });

    expect(typeof isSettled).toBe('boolean');
    console.log(`Order settled: ${isSettled}`);
  });
});

describe('Cross-Chain Monitoring', () => {
  const chains = [
    { id: 1, name: 'Ethereum', rpcUrl: 'https://eth.llamarpc.com' },
    { id: 42161, name: 'Arbitrum', rpcUrl: 'https://arb1.arbitrum.io/rpc' },
    { id: 10, name: 'Optimism', rpcUrl: 'https://mainnet.optimism.io' },
  ];

  test('can connect to multiple chains', async () => {
    if (skipIntegration) return;

    for (const chainConfig of chains) {
      const client = createPublicClient({
        transport: http(chainConfig.rpcUrl),
      });

      const blockNumber = await client.getBlockNumber();
      expect(blockNumber).toBeGreaterThan(0n);
      console.log(`${chainConfig.name}: Block ${blockNumber}`);
    }
  });

  test('can monitor gas prices across chains', async () => {
    if (skipIntegration) return;

    const gasPrices: { chain: string; gwei: string }[] = [];

    for (const chainConfig of chains) {
      const client = createPublicClient({
        transport: http(chainConfig.rpcUrl),
      });

      const gasPrice = await client.getGasPrice();
      gasPrices.push({
        chain: chainConfig.name,
        gwei: (gasPrice / 10n ** 9n).toString(),
      });
    }

    console.log('Gas prices:', gasPrices);
    expect(gasPrices.length).toBe(chains.length);
  });
});

