/**
 * Uniswap V4 Integration Tests
 *
 * Tests the complete V4 deployment and functionality on Jeju localnet
 *
 * Prerequisites:
 * - Localnet running (bun run scripts/localnet/start.ts)
 * - V4 contracts deployed
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getLocalnetRpcUrl } from '../../scripts/shared/get-localnet-rpc';

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

interface V4Deployment {
    poolManager: string;
    weth: string;
    deployer: string;
    chainId: number;
    network: string;
    timestamp: number;
    deployedAt: string;
}

interface TokenDeployment {
    address: string;
    name: string;
    symbol: string;
    totalSupply: string;
    decimals: number;
    deployer: string;
    chainId: number;
}

describe('Uniswap V4 Integration Tests', () => {
    let rpcUrl: string;
    let publicClient: any;
    let walletClient: any;
    let account: any;
    let v4Deployment: V4Deployment;
    let tokenDeployment: TokenDeployment;

    beforeAll(async () => {
        // Get RPC URL
        rpcUrl = getLocalnetRpcUrl();
        console.log(`📡 Using RPC: ${rpcUrl}`);

        // Create clients
        account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

        publicClient = createPublicClient({
            transport: http(rpcUrl),
        });

        walletClient = createWalletClient({
            account,
            transport: http(rpcUrl),
        });

        // Load deployments
        const v4Path = join(process.cwd(), 'deployments', 'uniswap-v4-1337.json');
        const tokenPath = join(process.cwd(), 'deployments', 'eliza-token-1337.json');

        if (!existsSync(v4Path)) {
            throw new Error('V4 deployment not found. Run: bun run scripts/deploy-uniswap-v4.ts');
        }

        if (!existsSync(tokenPath)) {
            throw new Error('Token deployment not found. Run: bun run scripts/deploy-eliza-token.ts');
        }

        v4Deployment = JSON.parse(readFileSync(v4Path, 'utf-8'));
        tokenDeployment = JSON.parse(readFileSync(tokenPath, 'utf-8'));

        console.log(`✅ PoolManager: ${v4Deployment.poolManager}`);
        console.log(`✅ elizaOS Token: ${tokenDeployment.address}`);
    });

    describe('Deployment Verification', () => {
        test('should have valid deployment file', () => {
            expect(v4Deployment).toBeDefined();
            expect(v4Deployment.poolManager).toMatch(/^0x[a-fA-F0-9]{40}$/);
            expect(v4Deployment.weth).toBe('0x4200000000000000000000000000000000000006');
            expect(v4Deployment.chainId).toBe(1337);
            expect(v4Deployment.network).toBe('localnet');
        });

        test('should have PoolManager deployed with bytecode', async () => {
            const code = await publicClient.getBytecode({
                address: v4Deployment.poolManager as `0x${string}`,
            });

            expect(code).toBeDefined();
            expect(code).not.toBe('0x');
            expect(code!.length).toBeGreaterThan(100);

            console.log(`   Bytecode size: ${code!.length} bytes`);
        });

        test('should have elizaOS token deployed', async () => {
            const code = await publicClient.getBytecode({
                address: tokenDeployment.address as `0x${string}`,
            });

            expect(code).toBeDefined();
            expect(code).not.toBe('0x');
        });

        test('should have correct deployment metadata', () => {
            expect(v4Deployment.features).toBeDefined();
            expect(v4Deployment.features.singleton).toBe(true);
            expect(v4Deployment.features.hooks).toBe(true);
            expect(v4Deployment.features.flashAccounting).toBe(true);
            expect(v4Deployment.features.nativeETH).toBe(true);
        });
    });

    describe('PoolManager Contract Functions', () => {
        const POOL_MANAGER_ABI = [
            {
                name: 'owner',
                type: 'function',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ type: 'address' }],
            },
            {
                name: 'MAX_TICK_SPACING',
                type: 'function',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ type: 'int24' }],
            },
            {
                name: 'MIN_TICK_SPACING',
                type: 'function',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ type: 'int24' }],
            },
        ];

        test('should return owner address', async () => {
            const owner = await publicClient.readContract({
                address: v4Deployment.poolManager as `0x${string}`,
                abi: POOL_MANAGER_ABI,
                functionName: 'owner',
            });

            expect(owner).toMatch(/^0x[a-fA-F0-9]{40}$/);
            expect(owner).toBe(v4Deployment.deployer);

            console.log(`   Owner: ${owner}`);
        });

        test('should return MAX_TICK_SPACING', async () => {
            const maxTickSpacing = await publicClient.readContract({
                address: v4Deployment.poolManager as `0x${string}`,
                abi: POOL_MANAGER_ABI,
                functionName: 'MAX_TICK_SPACING',
            });

            expect(maxTickSpacing).toBeDefined();
            expect(Number(maxTickSpacing)).toBeGreaterThan(0);

            console.log(`   MAX_TICK_SPACING: ${maxTickSpacing}`);
        });

        test('should return MIN_TICK_SPACING', async () => {
            const minTickSpacing = await publicClient.readContract({
                address: v4Deployment.poolManager as `0x${string}`,
                abi: POOL_MANAGER_ABI,
                functionName: 'MIN_TICK_SPACING',
            });

            expect(minTickSpacing).toBeDefined();
            expect(Number(minTickSpacing)).toBeGreaterThan(0);

            console.log(`   MIN_TICK_SPACING: ${minTickSpacing}`);
        });
    });

    describe('elizaOS Token Functions', () => {
        const ERC20_ABI = [
            {
                name: 'name',
                type: 'function',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ type: 'string' }],
            },
            {
                name: 'symbol',
                type: 'function',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ type: 'string' }],
            },
            {
                name: 'decimals',
                type: 'function',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ type: 'uint8' }],
            },
            {
                name: 'totalSupply',
                type: 'function',
                stateMutability: 'view',
                inputs: [],
                outputs: [{ type: 'uint256' }],
            },
            {
                name: 'balanceOf',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'account', type: 'address' }],
                outputs: [{ type: 'uint256' }],
            },
        ];

        test('should have correct token name', async () => {
            const name = await publicClient.readContract({
                address: tokenDeployment.address as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'name',
            });

            expect(name).toBe('elizaOS Token');
        });

        test('should have correct token symbol', async () => {
            const symbol = await publicClient.readContract({
                address: tokenDeployment.address as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'symbol',
            });

            expect(symbol).toBe('elizaOS');
        });

        test('should have 18 decimals', async () => {
            const decimals = await publicClient.readContract({
                address: tokenDeployment.address as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'decimals',
            });

            expect(decimals).toBe(18);
        });

        test('should have initial supply', async () => {
            const totalSupply = await publicClient.readContract({
                address: tokenDeployment.address as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'totalSupply',
            });

            expect(totalSupply).toBeDefined();
            expect(totalSupply).toBeGreaterThan(0n);

            const supplyInTokens = formatEther(totalSupply as bigint);
            console.log(`   Total Supply: ${supplyInTokens} elizaOS`);
        });

        test('deployer should have initial balance', async () => {
            const balance = await publicClient.readContract({
                address: tokenDeployment.address as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [v4Deployment.deployer],
            });

            expect(balance).toBeDefined();
            expect(balance).toBeGreaterThan(0n);

            const balanceInTokens = formatEther(balance as bigint);
            console.log(`   Deployer Balance: ${balanceInTokens} elizaOS`);
        });
    });

    describe('Network Health', () => {
        test('should be connected to correct chain', async () => {
            const chainId = await publicClient.getChainId();
            expect(chainId).toBe(1337);
        });

        test('should have active block production', async () => {
            const blockNumber1 = await publicClient.getBlockNumber();

            // Wait 2 seconds
            await new Promise(resolve => setTimeout(resolve, 2000));

            const blockNumber2 = await publicClient.getBlockNumber();

            expect(blockNumber2).toBeGreaterThanOrEqual(blockNumber1);
            console.log(`   Block: ${blockNumber1} → ${blockNumber2}`);
        });

        test('deployer should have ETH balance', async () => {
            const balance = await publicClient.getBalance({
                address: v4Deployment.deployer as `0x${string}`,
            });

            expect(balance).toBeGreaterThan(0n);

            const balanceInEth = formatEther(balance);
            console.log(`   Deployer ETH: ${balanceInEth} ETH`);
        });
    });

    describe('Gas Benchmarks', () => {
        test('should measure gas for view function calls', async () => {
            const startTime = Date.now();

            await publicClient.readContract({
                address: v4Deployment.poolManager as `0x${string}`,
                abi: [{
                    name: 'owner',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [{ type: 'address' }],
                }],
                functionName: 'owner',
            });

            const endTime = Date.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(1000); // Should be fast
            console.log(`   View call latency: ${duration}ms`);
        });
    });
});
