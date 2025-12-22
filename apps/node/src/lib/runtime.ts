/**
 * Runtime detection and abstraction layer
 * Works in both Tauri and browser environments
 */

import { z } from 'zod';
import { detectHardware, convertHardwareToSnakeCase } from './hardware';
import { createNodeClient } from './contracts';
import type { HardwareInfo } from '../types';
import {
  validateRuntimeConfig,
  validateWalletConnection,
  validateBalanceResult,
  validateChainStatus,
  validateServiceInfo,
  validateServiceStartConfig,
  validateRuntimeServiceState,
  validateBotInfo,
  validateBotState,
  ServiceInfoSchema,
  BotInfoSchema,
  type BotState,
} from '../validation';

export type RuntimeEnv = 'tauri' | 'browser' | 'node';

export function detectRuntime(): RuntimeEnv {
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
    return 'tauri';
  }
  if (typeof window !== 'undefined') {
    return 'browser';
  }
  return 'node';
}

export const runtime = detectRuntime();
export const isTauri = runtime === 'tauri';
export const isBrowser = runtime === 'browser';
export const isNode = runtime === 'node';

/**
 * Runtime API - works in all environments
 */
export interface RuntimeAPI {
  detectHardware(): Promise<HardwareInfo>;
  getConfig(): Promise<RuntimeConfig>;
  saveConfig(config: RuntimeConfig): Promise<void>;
  connectWallet(): Promise<WalletConnection | null>;
  getBalance(address: string): Promise<BalanceResult>;
  getChainStatus(): Promise<ChainStatus>;
  // Services
  getServices(): Promise<ServiceInfo[]>;
  startService(serviceId: string, config: ServiceStartConfig): Promise<void>;
  stopService(serviceId: string): Promise<void>;
  getServiceState(serviceId: string): Promise<ServiceState>;
  // Bots
  getBots(): Promise<BotInfo[]>;
  startBot(botId: string, capital: bigint): Promise<void>;
  stopBot(botId: string): Promise<void>;
  getBotState(botId: string): Promise<BotState>;
}

export interface RuntimeConfig {
  network: 'mainnet' | 'testnet' | 'localnet';
  rpcUrl: string;
  chainId: number;
  privateKey?: string;
  autoClaim: boolean;
  autoStake: boolean;
  startMinimized: boolean;
  startOnBoot: boolean;
  notifications: boolean;
}

export interface WalletConnection {
  address: string;
  chainId: number;
  isConnected: boolean;
}

export interface BalanceResult {
  eth: bigint;
  jeju: bigint;
  staked: bigint;
  pendingRewards: bigint;
}

export interface ChainStatus {
  connected: boolean;
  chainId: number;
  blockNumber: bigint;
  syncing: boolean;
}

export interface ServiceInfo {
  id: string;
  name: string;
  description: string;
  minStakeEth: number;
  estimatedEarningsPerHourUsd: number;
  isRunning: boolean;
  meetsRequirements: boolean;
  requirementIssues: string[];
}

export interface ServiceStartConfig {
  autoStake: boolean;
  stakeAmount?: string;
}

export interface ServiceState {
  running: boolean;
  uptimeSeconds: number;
  requestsServed: number;
  earningsWei: bigint;
  health: 'healthy' | 'degraded' | 'unhealthy' | 'stopped';
}

export interface BotInfo {
  id: string;
  name: string;
  description: string;
  minCapitalEth: number;
  treasurySplitPercent: number;
  riskLevel: 'low' | 'medium' | 'high';
  isRunning: boolean;
}

// BotState is imported from validation.ts

const DEFAULT_CONFIG: RuntimeConfig = {
  network: 'localnet',
  rpcUrl: 'http://127.0.0.1:9545',
  chainId: 1337,
  autoClaim: true,
  autoStake: false,
  startMinimized: false,
  startOnBoot: false,
  notifications: true,
};

const CONFIG_KEY = 'jeju-node-config';

/**
 * Browser implementation of RuntimeAPI
 */
function createBrowserAPI(): RuntimeAPI {
  // In-memory state for browser mode
  let config: RuntimeConfig = { ...DEFAULT_CONFIG };
  const runningServices = new Map<string, ServiceState>();
  const runningBots = new Map<string, BotState>();

  // Load config from localStorage
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    }
  }

  return {
    async detectHardware(): Promise<HardwareInfo> {
      // Browser can't detect hardware, return mock in snake_case format
      return {
        os: navigator.platform,
        os_version: navigator.userAgent,
        hostname: 'browser',
        cpu: {
          name: navigator.platform,
          vendor: 'Unknown',
          cores_physical: navigator.hardwareConcurrency || 4,
          cores_logical: navigator.hardwareConcurrency || 4,
          frequency_mhz: 0,
          usage_percent: 0,
          architecture: 'unknown',
        },
        memory: {
          total_mb: (navigator.deviceMemory ?? 8) * 1024,
          used_mb: 0,
          available_mb: 0,
          usage_percent: 0,
        },
        gpus: [],
        storage: [],
        network: [],
        tee: {
          has_intel_tdx: false,
          has_intel_sgx: false,
          has_amd_sev: false,
          has_nvidia_cc: false,
          attestation_available: false,
          tdx_version: null,
          sgx_version: null,
        },
        docker: {
          available: false,
          version: null,
          runtime_available: false,
          gpu_support: false,
          images: [],
        },
      };
    },

    async getConfig(): Promise<RuntimeConfig> {
      return validateRuntimeConfig(config);
    },

    async saveConfig(newConfig: RuntimeConfig): Promise<void> {
      const validated = validateRuntimeConfig(newConfig);
      config = validated;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(validated));
      }
    },

    async connectWallet(): Promise<WalletConnection | null> {
      // Use injected wallet if available
      const ethereum = window.ethereum;
      if (ethereum) {
        const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
        const chainId = await ethereum.request({ method: 'eth_chainId' });
        if (accounts[0]) {
          const raw = {
            address: accounts[0],
            chainId: parseInt(chainId, 16),
            isConnected: true,
          };
          return validateWalletConnection(raw);
        }
      }
      return null;
    },

    async getBalance(address: string): Promise<BalanceResult> {
      const client = createNodeClient(config.rpcUrl, config.chainId);
      const ethBalance = await client.publicClient.getBalance({ address: address as `0x${string}` });
      
      // ERC-20 balanceOf ABI
      const ERC20_ABI = [
        {
          name: 'balanceOf',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [{ name: '', type: 'uint256' }],
        },
      ] as const;

      // Read Jeju token balance from environment or deployment
      const jejuTokenAddress = process.env.JEJU_TOKEN_ADDRESS;
      const stakingManagerAddress = process.env.NODE_STAKING_MANAGER;
      
      let jejuBalance = 0n;
      let stakedBalance = 0n;
      let pendingRewards = 0n;

      if (jejuTokenAddress) {
        jejuBalance = await client.publicClient.readContract({
          address: jejuTokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address as `0x${string}`],
        });
      }

      if (stakingManagerAddress) {
        // NodeStakingManager ABI for staking queries
        const STAKING_ABI = [
          {
            name: 'getStake',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'staker', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }],
          },
          {
            name: 'pendingRewards',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'staker', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }],
          },
        ] as const;

        [stakedBalance, pendingRewards] = await Promise.all([
          client.publicClient.readContract({
            address: stakingManagerAddress as `0x${string}`,
            abi: STAKING_ABI,
            functionName: 'getStake',
            args: [address as `0x${string}`],
          }),
          client.publicClient.readContract({
            address: stakingManagerAddress as `0x${string}`,
            abi: STAKING_ABI,
            functionName: 'pendingRewards',
            args: [address as `0x${string}`],
          }),
        ]);
      }
      
      const raw = {
        eth: ethBalance,
        jeju: jejuBalance,
        staked: stakedBalance,
        pendingRewards,
      };
      return validateBalanceResult(raw);
    },

    async getChainStatus(): Promise<ChainStatus> {
      const client = createNodeClient(config.rpcUrl, config.chainId);
      const blockNumber = await client.publicClient.getBlockNumber();
      const chainId = await client.publicClient.getChainId();
      
      const raw = {
        connected: true,
        chainId,
        blockNumber,
        syncing: false,
      };
      return validateChainStatus(raw);
    },

    async getServices(): Promise<ServiceInfo[]> {
      const raw = [
        {
          id: 'compute',
          name: 'Compute Provider',
          description: 'Provide GPU compute for AI inference',
          minStakeEth: 0.1,
          estimatedEarningsPerHourUsd: 2.50,
          isRunning: runningServices.has('compute'),
          meetsRequirements: false, // Browser can't run compute
          requirementIssues: ['GPU required - not available in browser'],
        },
        {
          id: 'oracle',
          name: 'Oracle Provider',
          description: 'Submit price data to the network',
          minStakeEth: 1.0,
          estimatedEarningsPerHourUsd: 0.50,
          isRunning: runningServices.has('oracle'),
          meetsRequirements: true,
          requirementIssues: [],
        },
        {
          id: 'storage',
          name: 'Storage Provider',
          description: 'Provide decentralized storage',
          minStakeEth: 0.5,
          estimatedEarningsPerHourUsd: 0.25,
          isRunning: runningServices.has('storage'),
          meetsRequirements: false,
          requirementIssues: ['Storage service requires server environment'],
        },
        {
          id: 'cron',
          name: 'Cron Executor',
          description: 'Execute scheduled tasks for others',
          minStakeEth: 0,
          estimatedEarningsPerHourUsd: 0.10,
          isRunning: runningServices.has('cron'),
          meetsRequirements: true,
          requirementIssues: [],
        },
        {
          id: 'proxy',
          name: 'Residential Proxy',
          description: 'Provide proxy bandwidth',
          minStakeEth: 0.05,
          estimatedEarningsPerHourUsd: 0.15,
          isRunning: runningServices.has('proxy'),
          meetsRequirements: false,
          requirementIssues: ['Proxy service requires dedicated IP'],
        },
      ];
      return raw.map(validateServiceInfo);
    },

    async startService(serviceId: string, config: ServiceStartConfig): Promise<void> {
      if (!serviceId || typeof serviceId !== 'string' || serviceId.length === 0) {
        throw new Error('Invalid serviceId: must be a non-empty string');
      }
      validateServiceStartConfig(config);
      const rawState = {
        running: true,
        uptimeSeconds: 0,
        requestsServed: 0,
        earningsWei: 0n,
        health: 'healthy' as const,
      };
      const validatedState = validateRuntimeServiceState(rawState);
      runningServices.set(serviceId, validatedState);
    },

    async stopService(serviceId: string): Promise<void> {
      if (!serviceId || typeof serviceId !== 'string' || serviceId.length === 0) {
        throw new Error('Invalid serviceId: must be a non-empty string');
      }
      runningServices.delete(serviceId);
    },

    async getServiceState(serviceId: string): Promise<ServiceState> {
      if (!serviceId || typeof serviceId !== 'string' || serviceId.length === 0) {
        throw new Error('Invalid serviceId: must be a non-empty string');
      }
      const raw = runningServices.get(serviceId) || {
        running: false,
        uptimeSeconds: 0,
        requestsServed: 0,
        earningsWei: 0n,
        health: 'stopped' as const,
      };
      return validateRuntimeServiceState(raw);
    },

    async getBots(): Promise<BotInfo[]> {
      return [
        {
          id: 'dex_arb',
          name: 'DEX Arbitrage',
          description: 'Arbitrage across DEXes on the network',
          minCapitalEth: 0.1,
          treasurySplitPercent: 50,
          riskLevel: 'low',
          isRunning: runningBots.has('dex_arb'),
        },
        {
          id: 'cross_chain_arb',
          name: 'Cross-Chain Arbitrage',
          description: 'Arbitrage across chains via bridges',
          minCapitalEth: 1.0,
          treasurySplitPercent: 50,
          riskLevel: 'medium',
          isRunning: runningBots.has('cross_chain_arb'),
        },
        {
          id: 'liquidation',
          name: 'Liquidation Bot',
          description: 'Liquidate undercollateralized positions',
          minCapitalEth: 0.5,
          treasurySplitPercent: 50,
          riskLevel: 'medium',
          isRunning: runningBots.has('liquidation'),
        },
        {
          id: 'oracle_keeper',
          name: 'Oracle Keeper',
          description: 'Keep oracle prices fresh',
          minCapitalEth: 0.1,
          treasurySplitPercent: 50,
          riskLevel: 'low',
          isRunning: runningBots.has('oracle_keeper'),
        },
        {
          id: 'solver',
          name: 'Intent Solver',
          description: 'Solve user intents for profit',
          minCapitalEth: 1.0,
          treasurySplitPercent: 50,
          riskLevel: 'medium',
          isRunning: runningBots.has('solver'),
        },
      ];
    },

    async startBot(botId: string, capital: bigint): Promise<void> {
      if (!botId || typeof botId !== 'string' || botId.length === 0) {
        throw new Error('Invalid botId: must be a non-empty string');
      }
      if (capital <= 0n) {
        throw new Error('Invalid capital: must be positive');
      }
      const state = runningBots.get(botId);
      if (state?.running) {
        throw new Error(`Bot ${botId} is already running`);
      }
      const rawState = {
        running: true,
        uptimeSeconds: 0,
        opportunitiesDetected: 0,
        opportunitiesExecuted: 0,
        opportunitiesFailed: 0,
        grossProfitWei: 0n,
        treasuryShareWei: 0n,
        netProfitWei: 0n,
        health: 'healthy' as const,
      };
      const validatedState = validateBotState(rawState);
      runningBots.set(botId, validatedState);
    },

    async stopBot(botId: string): Promise<void> {
      runningBots.delete(botId);
    },

    async getBotState(botId: string): Promise<BotState> {
      const raw = runningBots.get(botId) || {
        running: false,
        uptimeSeconds: 0,
        opportunitiesDetected: 0,
        opportunitiesExecuted: 0,
        opportunitiesFailed: 0,
        grossProfitWei: 0n,
        treasuryShareWei: 0n,
        netProfitWei: 0n,
        health: 'stopped' as const,
      };
      return validateBotState(raw);
    },
  };
}

/**
 * Tauri implementation of RuntimeAPI (wraps Tauri invoke)
 */
async function createTauriAPI(): Promise<RuntimeAPI> {
  const { invoke } = await import('@tauri-apps/api/core');

  return {
    async detectHardware(): Promise<HardwareInfo> {
      const raw = await invoke('detect_hardware');
      // Tauri returns snake_case format matching types.ts
      return raw as HardwareInfo;
    },

    async getConfig(): Promise<RuntimeConfig> {
      const raw = await invoke('get_config');
      return validateRuntimeConfig(raw);
    },

    async saveConfig(config: RuntimeConfig): Promise<void> {
      const validated = validateRuntimeConfig(config);
      await invoke('save_config', { config: validated });
    },

    async connectWallet(): Promise<WalletConnection | null> {
      const raw = await invoke('connect_wallet');
      if (raw === null) return null;
      return validateWalletConnection(raw);
    },

    async getBalance(address: string): Promise<BalanceResult> {
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        throw new Error(`Invalid address: ${address}`);
      }
      const result = await invoke<{eth: string, jeju: string, staked: string, pendingRewards: string}>('get_balance', { address });
      const raw = {
        eth: BigInt(result.eth),
        jeju: BigInt(result.jeju),
        staked: BigInt(result.staked),
        pendingRewards: BigInt(result.pendingRewards),
      };
      return validateBalanceResult(raw);
    },

    async getChainStatus(): Promise<ChainStatus> {
      const result = await invoke<{connected: boolean, chainId: number, blockNumber: string, syncing: boolean}>('get_chain_status');
      const raw = {
        connected: result.connected,
        chainId: result.chainId,
        blockNumber: BigInt(result.blockNumber),
        syncing: result.syncing,
      };
      return validateChainStatus(raw);
    },

    async getServices(): Promise<ServiceInfo[]> {
      const raw = await invoke('get_available_services');
      return z.array(ServiceInfoSchema).parse(raw).map(validateServiceInfo);
    },

    async startService(serviceId: string, config: ServiceStartConfig): Promise<void> {
      if (!serviceId || typeof serviceId !== 'string' || serviceId.length === 0) {
        throw new Error('Invalid serviceId: must be a non-empty string');
      }
      const validatedConfig = validateServiceStartConfig(config);
      await invoke('start_service', { serviceId, config: validatedConfig });
    },

    async stopService(serviceId: string): Promise<void> {
      if (!serviceId || typeof serviceId !== 'string' || serviceId.length === 0) {
        throw new Error('Invalid serviceId: must be a non-empty string');
      }
      await invoke('stop_service', { serviceId });
    },

    async getServiceState(serviceId: string): Promise<ServiceState> {
      if (!serviceId || typeof serviceId !== 'string' || serviceId.length === 0) {
        throw new Error('Invalid serviceId: must be a non-empty string');
      }
      const raw = await invoke('get_service_state', { serviceId });
      return validateRuntimeServiceState(raw);
    },

    async getBots(): Promise<BotInfo[]> {
      const raw = await invoke('get_available_bots');
      return z.array(BotInfoSchema).parse(raw).map(validateBotInfo);
    },

    async startBot(botId: string, capital: bigint): Promise<void> {
      if (!botId || typeof botId !== 'string' || botId.length === 0) {
        throw new Error('Invalid botId: must be a non-empty string');
      }
      if (capital <= 0n) {
        throw new Error('Invalid capital: must be positive');
      }
      await invoke('start_bot', { botId, capital: capital.toString() });
    },

    async stopBot(botId: string): Promise<void> {
      if (!botId || typeof botId !== 'string' || botId.length === 0) {
        throw new Error('Invalid botId: must be a non-empty string');
      }
      await invoke('stop_bot', { botId });
    },

    async getBotState(botId: string): Promise<BotState> {
      if (!botId || typeof botId !== 'string' || botId.length === 0) {
        throw new Error('Invalid botId: must be a non-empty string');
      }
      const raw = await invoke('get_bot_state', { botId });
      return validateBotState(raw);
    },
  };
}

/**
 * Node.js implementation (for daemon)
 */
function createNodeAPI(): RuntimeAPI {
  let config: RuntimeConfig = { ...DEFAULT_CONFIG };
  const runningServices = new Map<string, ServiceState>();
  const runningBots = new Map<string, BotState>();

  return {
    async detectHardware(): Promise<HardwareInfo> {
      const hw = detectHardware();
      return convertHardwareToSnakeCase(hw);
    },

    async getConfig(): Promise<RuntimeConfig> {
      return validateRuntimeConfig(config);
    },

    async saveConfig(newConfig: RuntimeConfig): Promise<void> {
      const validated = validateRuntimeConfig(newConfig);
      config = validated;
    },

    async connectWallet(): Promise<WalletConnection | null> {
      // For daemon, wallet is configured via private key
      if (config.privateKey) {
        if (!/^0x[a-fA-F0-9]{64}$/.test(config.privateKey)) {
          throw new Error('Invalid private key in config');
        }
        const client = createNodeClient(config.rpcUrl, config.chainId, config.privateKey);
        const address = client.walletClient?.account?.address;
        if (address) {
          const raw = {
            address,
            chainId: config.chainId,
            isConnected: true,
          };
          return validateWalletConnection(raw);
        }
      }
      return null;
    },

    async getBalance(address: string): Promise<BalanceResult> {
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        throw new Error(`Invalid address: ${address}`);
      }
      const client = createNodeClient(config.rpcUrl, config.chainId);
      const balance = await client.publicClient.getBalance({ address: address as `0x${string}` });
      const raw = {
        eth: balance,
        jeju: 0n,
        staked: 0n,
        pendingRewards: 0n,
      };
      return validateBalanceResult(raw);
    },

    async getChainStatus(): Promise<ChainStatus> {
      const client = createNodeClient(config.rpcUrl, config.chainId);
      const blockNumber = await client.publicClient.getBlockNumber();
      const chainId = await client.publicClient.getChainId();
      const raw = {
        connected: true,
        chainId,
        blockNumber,
        syncing: false,
      };
      return validateChainStatus(raw);
    },

    async getServices(): Promise<ServiceInfo[]> {
      const hardwareRaw = detectHardware();
      const hardware = convertHardwareToSnakeCase(hardwareRaw);
      const raw = [
        {
          id: 'compute',
          name: 'Compute Provider',
          description: 'Provide GPU compute for AI inference',
          minStakeEth: 0.1,
          estimatedEarningsPerHourUsd: 2.50,
          isRunning: runningServices.has('compute'),
          meetsRequirements: hardware.gpus.length > 0,
          requirementIssues: hardware.gpus.length === 0 ? ['GPU required'] : [],
        },
        {
          id: 'oracle',
          name: 'Oracle Provider',
          description: 'Submit price data to the network',
          minStakeEth: 1.0,
          estimatedEarningsPerHourUsd: 0.50,
          isRunning: runningServices.has('oracle'),
          meetsRequirements: true,
          requirementIssues: [],
        },
        {
          id: 'storage',
          name: 'Storage Provider',
          description: 'Provide decentralized storage',
          minStakeEth: 0.5,
          estimatedEarningsPerHourUsd: 0.25,
          isRunning: runningServices.has('storage'),
          meetsRequirements: true,
          requirementIssues: [],
        },
        {
          id: 'cron',
          name: 'Cron Executor',
          description: 'Execute scheduled tasks for others',
          minStakeEth: 0,
          estimatedEarningsPerHourUsd: 0.10,
          isRunning: runningServices.has('cron'),
          meetsRequirements: true,
          requirementIssues: [],
        },
        {
          id: 'proxy',
          name: 'Residential Proxy',
          description: 'Provide proxy bandwidth',
          minStakeEth: 0.05,
          estimatedEarningsPerHourUsd: 0.15,
          isRunning: runningServices.has('proxy'),
          meetsRequirements: true,
          requirementIssues: [],
        },
      ];
      return raw.map(validateServiceInfo);
    },

    async startService(serviceId: string, config: ServiceStartConfig): Promise<void> {
      if (!serviceId || typeof serviceId !== 'string' || serviceId.length === 0) {
        throw new Error('Invalid serviceId: must be a non-empty string');
      }
      validateServiceStartConfig(config);
      const rawState = {
        running: true,
        uptimeSeconds: 0,
        requestsServed: 0,
        earningsWei: 0n,
        health: 'healthy' as const,
      };
      const validatedState = validateRuntimeServiceState(rawState);
      runningServices.set(serviceId, validatedState);
    },

    async stopService(serviceId: string): Promise<void> {
      if (!serviceId || typeof serviceId !== 'string' || serviceId.length === 0) {
        throw new Error('Invalid serviceId: must be a non-empty string');
      }
      runningServices.delete(serviceId);
    },

    async getServiceState(serviceId: string): Promise<ServiceState> {
      if (!serviceId || typeof serviceId !== 'string' || serviceId.length === 0) {
        throw new Error('Invalid serviceId: must be a non-empty string');
      }
      const raw = runningServices.get(serviceId) || {
        running: false,
        uptimeSeconds: 0,
        requestsServed: 0,
        earningsWei: 0n,
        health: 'stopped' as const,
      };
      return validateRuntimeServiceState(raw);
    },

    async getBots(): Promise<BotInfo[]> {
      return [
        {
          id: 'dex_arb',
          name: 'DEX Arbitrage',
          description: 'Arbitrage across DEXes on the network',
          minCapitalEth: 0.1,
          treasurySplitPercent: 50,
          riskLevel: 'low',
          isRunning: runningBots.has('dex_arb'),
        },
        {
          id: 'cross_chain_arb',
          name: 'Cross-Chain Arbitrage',
          description: 'Arbitrage across chains via bridges',
          minCapitalEth: 1.0,
          treasurySplitPercent: 50,
          riskLevel: 'medium',
          isRunning: runningBots.has('cross_chain_arb'),
        },
        {
          id: 'liquidation',
          name: 'Liquidation Bot',
          description: 'Liquidate undercollateralized positions',
          minCapitalEth: 0.5,
          treasurySplitPercent: 50,
          riskLevel: 'medium',
          isRunning: runningBots.has('liquidation'),
        },
        {
          id: 'oracle_keeper',
          name: 'Oracle Keeper',
          description: 'Keep oracle prices fresh',
          minCapitalEth: 0.1,
          treasurySplitPercent: 50,
          riskLevel: 'low',
          isRunning: runningBots.has('oracle_keeper'),
        },
        {
          id: 'solver',
          name: 'Intent Solver',
          description: 'Solve user intents for profit',
          minCapitalEth: 1.0,
          treasurySplitPercent: 50,
          riskLevel: 'medium',
          isRunning: runningBots.has('solver'),
        },
      ];
    },

    async startBot(botId: string, capital: bigint): Promise<void> {
      if (!botId || typeof botId !== 'string' || botId.length === 0) {
        throw new Error('Invalid botId: must be a non-empty string');
      }
      if (capital <= 0n) {
        throw new Error('Invalid capital: must be positive');
      }
      const state = runningBots.get(botId);
      if (state?.running) {
        throw new Error(`Bot ${botId} is already running`);
      }
      const rawState = {
        running: true,
        uptimeSeconds: 0,
        opportunitiesDetected: 0,
        opportunitiesExecuted: 0,
        opportunitiesFailed: 0,
        grossProfitWei: 0n,
        treasuryShareWei: 0n,
        netProfitWei: 0n,
        health: 'healthy' as const,
      };
      const validatedState = validateBotState(rawState);
      runningBots.set(botId, validatedState);
    },

    async stopBot(botId: string): Promise<void> {
      if (!botId || typeof botId !== 'string' || botId.length === 0) {
        throw new Error('Invalid botId: must be a non-empty string');
      }
      const state = runningBots.get(botId);
      if (!state?.running) {
        throw new Error(`Bot ${botId} is not running`);
      }
      const rawState = {
        ...state,
        running: false,
        health: 'stopped' as const,
      };
      const validatedState = validateBotState(rawState);
      runningBots.set(botId, validatedState);
    },

    async getBotState(botId: string): Promise<BotState> {
      if (!botId || typeof botId !== 'string' || botId.length === 0) {
        throw new Error('Invalid botId: must be a non-empty string');
      }
      const state = runningBots.get(botId);
      if (!state) {
        throw new Error(`Bot ${botId} not found`);
      }
      return validateBotState(state);
    },
  };
}

/**
 * Get the appropriate API for the current runtime
 */
let cachedAPI: RuntimeAPI | null = null;

export async function getAPI(): Promise<RuntimeAPI> {
  if (cachedAPI) {
    return cachedAPI;
  }

  if (isTauri) {
    cachedAPI = await createTauriAPI();
  } else if (isBrowser) {
    cachedAPI = createBrowserAPI();
  } else {
    cachedAPI = createNodeAPI();
  }

  return cachedAPI;
}

