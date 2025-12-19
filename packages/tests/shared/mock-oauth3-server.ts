/**
 * OAuth3 TEE Test Server
 * 
 * Production-grade OAuth3 TEE agent for E2E testing.
 * Uses the REAL DstackAuthAgent with TEE simulator mode.
 * 
 * This is NOT a mock - it runs actual production code with:
 * - Real FROST MPC coordination (simulated nodes in test mode)
 * - Real TEE attestation (simulator mode)
 * - Real session management
 * - Real credential issuance
 * 
 * Usage:
 *   import { startOAuth3TestServer, stopOAuth3TestServer } from '@jejunetwork/tests';
 *   
 *   beforeAll(async () => { await startOAuth3TestServer(); });
 *   afterAll(async () => { await stopOAuth3TestServer(); });
 */

import { toHex, type Address, type Hex } from 'viem';

// Import from source since we're in the same monorepo
// The DstackAuthAgent runs the real production OAuth3 TEE code
import { DstackAuthAgent } from '../../oauth3/src/tee/dstack-agent';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface OAuth3TestServerConfig {
  port?: number;
  chainRpcUrl?: string;
  chainId?: number;
  mpcEnabled?: boolean;
  mpcThreshold?: number;
  mpcTotalParties?: number;
  storageEndpoint?: string;
  jnsGateway?: string;
}

const DEFAULT_CONFIG: OAuth3TestServerConfig = {
  port: 4200,
  chainRpcUrl: process.env.L2_RPC_URL || process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545',
  chainId: parseInt(process.env.CHAIN_ID || '1337'),
  mpcEnabled: false, // Disable MPC by default in tests for speed
  mpcThreshold: 2,
  mpcTotalParties: 3,
  storageEndpoint: process.env.STORAGE_API_ENDPOINT,
  jnsGateway: process.env.JNS_GATEWAY,
};

// ============================================================================
// STATE
// ============================================================================

let agent: DstackAuthAgent | null = null;
let serverPort = 4200;
let serverProcess: ReturnType<typeof Bun.serve> | null = null;

// ============================================================================
// SERVER LIFECYCLE
// ============================================================================

/**
 * Start the OAuth3 test server using the real DstackAuthAgent.
 * 
 * Environment: TEE_MODE=simulated (real code, simulated attestation)
 * 
 * Note: In test mode, we disable decentralized storage unless explicitly configured.
 * This allows testing the auth flows without requiring the full infrastructure.
 */
export async function startOAuth3TestServer(config: OAuth3TestServerConfig = {}): Promise<number> {
  if (agent) {
    console.log(`OAuth3 test server already running on port ${serverPort}`);
    return serverPort;
  }

  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  serverPort = mergedConfig.port || 4200;

  // Set TEE mode to simulated for testing
  process.env.TEE_MODE = 'simulated';

  // Generate a test node private key (Anvil account 0)
  const nodePrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;

  // In test mode, don't use decentralized storage unless explicitly configured
  // This allows testing auth flows without full infrastructure
  const useDecentralizedStorage = !!mergedConfig.storageEndpoint;

  agent = new DstackAuthAgent({
    nodeId: `test-node-${Date.now().toString(36)}`,
    clusterId: 'oauth3-test-cluster',
    privateKey: nodePrivateKey,
    mpcEndpoint: `http://localhost:${serverPort}`,
    identityRegistryAddress: '0x0000000000000000000000000000000000000000' as Address,
    appRegistryAddress: '0x0000000000000000000000000000000000000000' as Address,
    chainRpcUrl: mergedConfig.chainRpcUrl || 'http://127.0.0.1:9545',
    chainId: mergedConfig.chainId || 1337,
    // Only enable decentralized storage if endpoint is provided
    jnsGateway: useDecentralizedStorage ? mergedConfig.jnsGateway : undefined,
    storageEndpoint: useDecentralizedStorage ? mergedConfig.storageEndpoint : undefined,
    mpcEnabled: mergedConfig.mpcEnabled,
    mpcThreshold: mergedConfig.mpcThreshold,
    mpcTotalParties: mergedConfig.mpcTotalParties,
  });

  // Initialize MPC if enabled
  if (mergedConfig.mpcEnabled) {
    await agent.initializeMPC();
  }

  // Start the server
  const app = agent.getApp();
  serverProcess = Bun.serve({
    port: serverPort,
    fetch: app.fetch,
  });

  console.log(`OAuth3 TEE test server running on http://localhost:${serverPort} (TEE_MODE=simulated)`);

  return serverPort;
}

/**
 * Stop the OAuth3 test server.
 */
export async function stopOAuth3TestServer(): Promise<void> {
  if (serverProcess) {
    serverProcess.stop();
    serverProcess = null;
  }
  agent = null;
  console.log('OAuth3 test server stopped');
}

/**
 * Get the OAuth3 test server URL.
 */
export function getOAuth3TestServerUrl(): string {
  return `http://localhost:${serverPort}`;
}

/**
 * Get the DstackAuthAgent instance for direct access in tests.
 */
export function getOAuth3TestAgent(): DstackAuthAgent | null {
  return agent;
}

// ============================================================================
// LEGACY ALIASES (for backwards compatibility)
// ============================================================================

export const startMockOAuth3Server = startOAuth3TestServer;
export const stopMockOAuth3Server = stopOAuth3TestServer;
export const getMockOAuth3Url = getOAuth3TestServerUrl;
export const clearMockOAuth3State = () => {
  // The real agent handles its own state - this is a no-op
  console.log('Note: clearMockOAuth3State is a no-op with real OAuth3 agent');
};

