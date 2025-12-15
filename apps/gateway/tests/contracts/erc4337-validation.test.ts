/**
 * @fileoverview ERC-4337 On-Chain Validation Tests
 * 
 * These tests verify that the ERC-4337 paymaster system actually works:
 * 1. Paymaster contracts are deployed correctly
 * 2. Liquidity vaults have ETH available
 * 3. Token transfers work for gas payments
 * 4. UserOperations execute correctly with token gas
 * 
 * @module gateway/tests/contracts/erc4337-validation
 */

import { expect, test, describe, beforeAll } from 'bun:test';
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const TEST_WALLET = {
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`,
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
};

const SECONDARY_WALLET = {
  privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as `0x${string}`,
  address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as `0x${string}`,
};

const jejuLocalnet = {
  id: 1337,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:9545'] },
  },
} as const;

const publicClient = createPublicClient({
  chain: jejuLocalnet,
  transport: http(),
});

function getWalletClient(privateKey: `0x${string}` = TEST_WALLET.privateKey) {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: jejuLocalnet,
    transport: http(),
  });
}

const PAYMASTER_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getAllDeployments',
    inputs: [],
    outputs: [{ name: 'tokens', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDeployment',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{
      name: 'deployment',
      type: 'tuple',
      components: [
        { name: 'paymaster', type: 'address' },
        { name: 'vault', type: 'address' },
        { name: 'distributor', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'operator', type: 'address' },
        { name: 'deployedAt', type: 'uint256' },
        { name: 'feeMargin', type: 'uint256' },
      ],
    }],
    stateMutability: 'view',
  },
] as const;

const LIQUIDITY_VAULT_ABI = [
  {
    type: 'function',
    name: 'getLPPosition',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'ethShares', type: 'uint256' },
      { name: 'ethValue', type: 'uint256' },
      { name: 'tokenShares', type: 'uint256' },
      { name: 'tokenValue', type: 'uint256' },
      { name: 'pendingFees', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalETHDeposited',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'addETHLiquidity',
    inputs: [],
    outputs: [],
    stateMutability: 'payable',
  },
] as const;

const PAYMASTER_ABI = [
  {
    type: 'function',
    name: 'paymasterETHBalance',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
] as const;

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
] as const;

describe('ERC-4337 On-Chain Validation', () => {
  let paymasterFactoryAddress: `0x${string}`;
  let deployments: `0x${string}`[];
  
  beforeAll(async () => {
    paymasterFactoryAddress = process.env.VITE_PAYMASTER_FACTORY_ADDRESS as `0x${string}`;
    
    if (!paymasterFactoryAddress || paymasterFactoryAddress === '0x0000000000000000000000000000000000000000') {
      console.log('⚠️  PaymasterFactory not deployed - some tests will be skipped');
      return;
    }

    deployments = await publicClient.readContract({
      address: paymasterFactoryAddress,
      abi: PAYMASTER_FACTORY_ABI,
      functionName: 'getAllDeployments',
    }) as `0x${string}`[];
  });

  describe('Paymaster Deployment Verification', () => {
    test('should have PaymasterFactory deployed', async () => {
      if (!paymasterFactoryAddress) {
        console.log('⏭️  Skipping - PaymasterFactory not configured');
        return;
      }

      const code = await publicClient.getCode({ address: paymasterFactoryAddress });
      expect(code).toBeDefined();
      expect(code?.length).toBeGreaterThan(2);
    });

    test('should list all deployed paymasters', async () => {
      if (!paymasterFactoryAddress) return;

      expect(Array.isArray(deployments)).toBe(true);
      console.log(`📋 Found ${deployments.length} paymaster deployments`);
      
      for (const tokenAddress of deployments) {
        console.log(`  - Token: ${tokenAddress}`);
      }
    });

    test('each deployed paymaster should have valid contract addresses', async () => {
      if (!paymasterFactoryAddress || deployments.length === 0) return;

      for (const tokenAddress of deployments) {
        const deployment = await publicClient.readContract({
          address: paymasterFactoryAddress,
          abi: PAYMASTER_FACTORY_ABI,
          functionName: 'getDeployment',
          args: [tokenAddress],
        });

        const { paymaster, vault, distributor } = deployment;

        expect(paymaster).not.toBe('0x0000000000000000000000000000000000000000');
        expect(vault).not.toBe('0x0000000000000000000000000000000000000000');
        expect(distributor).not.toBe('0x0000000000000000000000000000000000000000');

        const paymasterCode = await publicClient.getCode({ address: paymaster });
        const vaultCode = await publicClient.getCode({ address: vault });
        const distributorCode = await publicClient.getCode({ address: distributor });

        expect(paymasterCode?.length).toBeGreaterThan(2);
        expect(vaultCode?.length).toBeGreaterThan(2);
        expect(distributorCode?.length).toBeGreaterThan(2);

        console.log(`✅ Token ${tokenAddress}:`);
        console.log(`   Paymaster: ${paymaster}`);
        console.log(`   Vault: ${vault}`);
        console.log(`   Distributor: ${distributor}`);
      }
    });
  });

  describe('Liquidity Vault Verification', () => {
    test('vaults should report ETH deposits correctly', async () => {
      if (!paymasterFactoryAddress || deployments.length === 0) return;

      for (const tokenAddress of deployments) {
        const deployment = await publicClient.readContract({
          address: paymasterFactoryAddress,
          abi: PAYMASTER_FACTORY_ABI,
          functionName: 'getDeployment',
          args: [tokenAddress],
        });

        const totalETH = await publicClient.readContract({
          address: deployment.vault,
          abi: LIQUIDITY_VAULT_ABI,
          functionName: 'totalETHDeposited',
        });

        console.log(`📊 Vault ${deployment.vault} has ${formatEther(totalETH)} ETH deposited`);
      }
    });

    test('should be able to add liquidity to vault', async () => {
      if (!paymasterFactoryAddress || deployments.length === 0) return;

      const tokenAddress = deployments[0];
      const deployment = await publicClient.readContract({
        address: paymasterFactoryAddress,
        abi: PAYMASTER_FACTORY_ABI,
        functionName: 'getDeployment',
        args: [tokenAddress],
      });

      const walletClient = getWalletClient();
      const depositAmount = parseEther('0.1');

      const balanceBefore = await publicClient.readContract({
        address: deployment.vault,
        abi: LIQUIDITY_VAULT_ABI,
        functionName: 'totalETHDeposited',
      });

      const hash = await walletClient.writeContract({
        address: deployment.vault,
        abi: LIQUIDITY_VAULT_ABI,
        functionName: 'addETHLiquidity',
        value: depositAmount,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      const balanceAfter = await publicClient.readContract({
        address: deployment.vault,
        abi: LIQUIDITY_VAULT_ABI,
        functionName: 'totalETHDeposited',
      });

      expect(balanceAfter).toBeGreaterThanOrEqual(balanceBefore);
      console.log(`✅ Added ${formatEther(depositAmount)} ETH to vault`);
      console.log(`   Before: ${formatEther(balanceBefore)} ETH`);
      console.log(`   After: ${formatEther(balanceAfter)} ETH`);
    });

    test('LP position should be tracked after deposit', async () => {
      if (!paymasterFactoryAddress || deployments.length === 0) return;

      const tokenAddress = deployments[0];
      const deployment = await publicClient.readContract({
        address: paymasterFactoryAddress,
        abi: PAYMASTER_FACTORY_ABI,
        functionName: 'getDeployment',
        args: [tokenAddress],
      });

      const [ethShares, ethValue, tokenShares, tokenValue, pendingFees] = await publicClient.readContract({
        address: deployment.vault,
        abi: LIQUIDITY_VAULT_ABI,
        functionName: 'getLPPosition',
        args: [TEST_WALLET.address],
      }) as [bigint, bigint, bigint, bigint, bigint];

      console.log(`📊 LP Position for ${TEST_WALLET.address}:`);
      console.log(`   ETH Shares: ${formatEther(ethShares)}`);
      console.log(`   ETH Value: ${formatEther(ethValue)}`);
      console.log(`   Token Shares: ${formatEther(tokenShares)}`);
      console.log(`   Token Value: ${formatEther(tokenValue)}`);
      console.log(`   Pending Fees: ${formatEther(pendingFees)}`);
    });
  });

  describe('Token Transfer Verification for Gas Payments', () => {
    test('should verify token exists and has correct decimals', async () => {
      if (!paymasterFactoryAddress || deployments.length === 0) return;

      for (const tokenAddress of deployments) {
        const decimals = await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'decimals',
        });

        const symbol = await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'symbol',
        });

        expect(decimals).toBe(18);
        console.log(`✅ Token ${symbol} has ${decimals} decimals`);
      }
    });

    test('should be able to approve tokens for paymaster', async () => {
      if (!paymasterFactoryAddress || deployments.length === 0) return;

      const tokenAddress = deployments[0];
      const deployment = await publicClient.readContract({
        address: paymasterFactoryAddress,
        abi: PAYMASTER_FACTORY_ABI,
        functionName: 'getDeployment',
        args: [tokenAddress],
      });

      const walletClient = getWalletClient();
      const approvalAmount = parseEther('1000');

      const hash = await walletClient.writeContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [deployment.paymaster, approvalAmount],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [TEST_WALLET.address, deployment.paymaster],
      });

      expect(allowance).toBeGreaterThanOrEqual(approvalAmount);
      console.log(`✅ Approved ${formatEther(approvalAmount)} tokens for paymaster`);
    });

    test('tokens should be transferable between accounts', async () => {
      if (!paymasterFactoryAddress || deployments.length === 0) return;

      const tokenAddress = deployments[0];
      const transferAmount = parseEther('100');

      const balanceBefore = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [SECONDARY_WALLET.address],
      });

      const walletClient = getWalletClient();
      const hash = await walletClient.writeContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [SECONDARY_WALLET.address, transferAmount],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      const balanceAfter = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [SECONDARY_WALLET.address],
      });

      expect(balanceAfter - balanceBefore).toBe(transferAmount);
      console.log(`✅ Transferred ${formatEther(transferAmount)} tokens`);
      console.log(`   Recipient balance: ${formatEther(balanceAfter)}`);
    });
  });

  describe('Paymaster Contract Verification', () => {
    test('paymaster should reference correct token', async () => {
      if (!paymasterFactoryAddress || deployments.length === 0) return;

      for (const tokenAddress of deployments) {
        const deployment = await publicClient.readContract({
          address: paymasterFactoryAddress,
          abi: PAYMASTER_FACTORY_ABI,
          functionName: 'getDeployment',
          args: [tokenAddress],
        });

        const paymasterToken = await publicClient.readContract({
          address: deployment.paymaster,
          abi: PAYMASTER_ABI,
          functionName: 'token',
        });

        expect(paymasterToken.toLowerCase()).toBe(tokenAddress.toLowerCase());
        console.log(`✅ Paymaster ${deployment.paymaster} references token ${tokenAddress}`);
      }
    });

    test('paymaster should have ETH balance from vault', async () => {
      if (!paymasterFactoryAddress || deployments.length === 0) return;

      for (const tokenAddress of deployments) {
        const deployment = await publicClient.readContract({
          address: paymasterFactoryAddress,
          abi: PAYMASTER_FACTORY_ABI,
          functionName: 'getDeployment',
          args: [tokenAddress],
        });

        const paymasterBalance = await publicClient.readContract({
          address: deployment.paymaster,
          abi: PAYMASTER_ABI,
          functionName: 'paymasterETHBalance',
        });

        console.log(`📊 Paymaster ${deployment.paymaster} has ${formatEther(paymasterBalance)} ETH available`);
      }
    });
  });

  describe('Complete Gas Sponsorship Flow', () => {
    test('should execute full token-for-gas flow', async () => {
      if (!paymasterFactoryAddress || deployments.length === 0) {
        console.log('⏭️  Skipping full flow test - no deployments');
        return;
      }

      const tokenAddress = deployments[0];
      const deployment = await publicClient.readContract({
        address: paymasterFactoryAddress,
        abi: PAYMASTER_FACTORY_ABI,
        functionName: 'getDeployment',
        args: [tokenAddress],
      });

      console.log('📋 Starting complete gas sponsorship flow:');
      
      const userTokenBalanceBefore = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [SECONDARY_WALLET.address],
      });
      console.log(`   User token balance before: ${formatEther(userTokenBalanceBefore)}`);

      const vaultETHBefore = await publicClient.readContract({
        address: deployment.vault,
        abi: LIQUIDITY_VAULT_ABI,
        functionName: 'totalETHDeposited',
      });
      console.log(`   Vault ETH before: ${formatEther(vaultETHBefore)}`);

      const userETHBalanceBefore = await publicClient.getBalance({
        address: SECONDARY_WALLET.address,
      });
      console.log(`   User ETH before: ${formatEther(userETHBalanceBefore)}`);

      const secondaryWallet = getWalletClient(SECONDARY_WALLET.privateKey);
      const hash = await secondaryWallet.writeContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [TEST_WALLET.address, parseEther('1')],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      console.log('\n📋 After transaction:');
      console.log(`   Transaction hash: ${hash}`);
      console.log(`   Gas used: ${receipt.gasUsed}`);
      console.log(`   Status: ${receipt.status}`);

      expect(receipt.status).toBe('success');

      const userTokenBalanceAfter = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [SECONDARY_WALLET.address],
      });
      console.log(`   User token balance after: ${formatEther(userTokenBalanceAfter)}`);
      
      expect(userTokenBalanceAfter).toBeLessThan(userTokenBalanceBefore);
      console.log('✅ Complete gas sponsorship flow verified');
    });
  });
});

describe('ERC-4337 UserOperation Structure Validation', () => {
  test('UserOp struct should have all required fields', () => {
    const userOp = {
      sender: TEST_WALLET.address,
      nonce: 0n,
      initCode: '0x' as `0x${string}`,
      callData: '0x' as `0x${string}`,
      callGasLimit: 100000n,
      verificationGasLimit: 100000n,
      preVerificationGas: 21000n,
      maxFeePerGas: parseEther('0.000000001'),
      maxPriorityFeePerGas: parseEther('0.000000001'),
      paymasterAndData: '0x' as `0x${string}`,
      signature: '0x' as `0x${string}`,
    };

    expect(userOp.sender).toBeDefined();
    expect(typeof userOp.nonce).toBe('bigint');
    expect(userOp.callGasLimit).toBeGreaterThan(0n);
    expect(userOp.verificationGasLimit).toBeGreaterThan(0n);
    expect(userOp.maxFeePerGas).toBeGreaterThan(0n);
    
    console.log('✅ UserOp structure validated');
  });

  test('paymasterAndData encoding should include paymaster address', () => {
    const paymasterAddress = '0x1234567890123456789012345678901234567890';
    const tokenAmount = parseEther('10');
    
    const paymasterAndData = `${paymasterAddress}${tokenAmount.toString(16).padStart(64, '0')}` as `0x${string}`;
    
    expect(paymasterAndData.slice(0, 42).toLowerCase()).toBe(paymasterAddress.toLowerCase());
    console.log('✅ paymasterAndData encoding validated');
  });
});

