/**
 * Network CLI Types
 */

export type NetworkType = 'localnet' | 'testnet' | 'mainnet';

export interface CLIContext {
  network: NetworkType;
  verbose: boolean;
  ci: boolean;
  rootDir: string;
  configDir: string;
  keysDir: string;
}

export interface HealthCheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  details?: Record<string, string | number | boolean>;
}

export interface DoctorResult {
  system: HealthCheckResult[];
  dependencies: HealthCheckResult[];
  network: HealthCheckResult[];
  keys: HealthCheckResult[];
  ports: HealthCheckResult[];
  apps: HealthCheckResult[];
  ready: boolean;
}

export interface KeyConfig {
  name: string;
  address: string;
  privateKey: string;
  role?: string;
}

export interface KeySet {
  network: NetworkType;
  created: string;
  keys: KeyConfig[];
  encrypted?: boolean;
}

export interface TestPhase {
  name: string;
  description: string;
  command: string;
  cwd?: string;
  timeout?: number;
  required?: boolean;
}

export interface TestResult {
  phase: string;
  passed: boolean;
  duration: number;
  output?: string;
}

export interface DeploymentConfig {
  network: NetworkType;
  contracts: boolean;
  infrastructure: boolean;
  apps: boolean;
  dryRun: boolean;
}

export interface AppTestConfig {
  unit?: {
    command: string;
    timeout?: number;
  };
  e2e?: {
    command: string;
    config?: string;
    timeout?: number;
    requiresChain?: boolean;
    requiresWallet?: boolean;
  };
  integration?: {
    command: string;
    timeout?: number;
  };
  services?: string[];
}

export interface AppManifest {
  name: string;
  displayName?: string;
  version: string;
  type: 'core' | 'vendor' | 'service';
  description?: string;
  commands?: {
    dev?: string;
    build?: string;
    test?: string;
    start?: string;
  };
  ports?: Record<string, number>;
  dependencies?: string[];
  enabled?: boolean;
  autoStart?: boolean;
  tags?: string[];
  testing?: AppTestConfig;
}

export interface ProjectTemplate {
  name: string;
  description: string;
  files: Record<string, string>;
}

export const WELL_KNOWN_KEYS = {
  // Anvil/Hardhat default accounts - prefunded with 10k ETH
  dev: [
    {
      name: 'Account #0 (Deployer)',
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      role: 'deployer',
    },
    {
      name: 'Account #1',
      address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      role: 'user',
    },
    {
      name: 'Account #2',
      address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
      role: 'user',
    },
    {
      name: 'Account #3',
      address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
      role: 'user',
    },
    {
      name: 'Account #4',
      address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
      privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
      role: 'operator',
    },
  ],
} as const;

export const DEFAULT_PORTS = {
  // Chain
  l1Rpc: 8545,
  l2Rpc: 9545,
  l2Ws: 9546,
  
  // Apps
  gateway: 4001,
  bazaar: 4006,
  compute: 4007,
  wallet: 4015,
  
  // Infrastructure
  indexerGraphQL: 4350,
  prometheus: 9090,
  grafana: 4010,
  kurtosisUI: 9711,
  
  // Development Services
  inference: 4100,
  storage: 4101,
  cron: 4102,
  cvm: 4103,
  cql: 4300,
  oracle: 4301,
  jns: 4302,
} as const;

export const CHAIN_CONFIG = {
  localnet: {
    chainId: 1337,
    name: 'Network Localnet',
    rpcUrl: 'http://127.0.0.1:9545',
  },
  testnet: {
    chainId: 420691,
    name: 'Testnet',
    rpcUrl: 'https://rpc.testnet.jeju.network',
  },
  mainnet: {
    chainId: 42069,
    name: 'Network',
    rpcUrl: 'https://rpc.jeju.network',
  },
} as const;

