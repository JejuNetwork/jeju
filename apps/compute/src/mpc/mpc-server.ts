/**
 * MPC Node HTTP Server
 *
 * HTTP server that wraps MPCNodeService for deployment to Phala TEE.
 * Exposes endpoints that the @babylon/auth MPCClient expects.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { MPCNodeService, type MPCNodeConfig } from './node-service.js';
import {
  type KeyGenRequest,
  type SignRequest,
  MPCMessageType,
} from './types.js';

export interface MPCServerConfig extends MPCNodeConfig {
  port: number;
}

/**
 * MPC Node Server - HTTP wrapper for MPCNodeService
 */
export class MPCServer {
  private app: Hono;
  private nodeService: MPCNodeService;
  private config: MPCServerConfig;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(config: MPCServerConfig) {
    this.config = config;
    this.nodeService = new MPCNodeService(config);
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use('/*', cors());

    // Health check - required by @babylon/auth MPCClient
    this.app.get('/health', async (c) => {
      const status = this.nodeService.getStatus();
      const heartbeat = await this.nodeService.generateHeartbeat();

      return c.json({
        status: 'ok',
        nodeId: status.nodeId,
        networkId: status.networkId,
        healthy: status.healthy,
        attestation: heartbeat.attestation,
        timestamp: Date.now(),
      });
    });

    // Key generation endpoint
    this.app.post('/mpc/keygen', async (c) => {
      const body = await c.req.json<{
        userId: string;
        authProof: KeyGenRequest['authProof'];
        threshold?: number;
        totalShares?: number;
      }>();

      const request: KeyGenRequest = {
        id: `keygen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: MPCMessageType.KEY_GEN_INIT,
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        userId: body.userId,
        threshold: body.threshold ?? this.config.defaultThreshold,
        totalShares: body.totalShares ?? this.config.defaultTotalShares,
        authProof: body.authProof,
      };

      const response = await this.nodeService.handleKeyGen(request);

      if (!response.success) {
        return c.json({ error: response.error }, 400);
      }

      return c.json({
        success: true,
        publicKey: response.publicKey,
        walletAddress: response.walletAddress,
        shareIndex: response.shareIndex,
      });
    });

    // Signing endpoint
    this.app.post('/mpc/sign', async (c) => {
      const body = await c.req.json<{
        userId: string;
        messageHash: string;
        signatureType: 'message' | 'typedData' | 'transaction';
      }>();

      const request: SignRequest = {
        id: `sign-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: MPCMessageType.SIGN_INIT,
        timestamp: Date.now(),
        nodeId: this.config.nodeId,
        userId: body.userId,
        messageHash: body.messageHash as `0x${string}`,
        signatureType: body.signatureType,
      };

      const response = await this.nodeService.handleSign(request);

      if (!response.success) {
        return c.json({ error: response.error }, 400);
      }

      return c.json({
        success: true,
        partialSignature: response.partialSignature,
        fullSignature: response.fullSignature,
        r: response.r,
        s: response.s,
        v: response.v,
      });
    });

    // Status endpoint
    this.app.get('/mpc/status', (c) => {
      return c.json(this.nodeService.getStatus());
    });

    // Heartbeat endpoint
    this.app.get('/mpc/heartbeat', async (c) => {
      const heartbeat = await this.nodeService.generateHeartbeat();
      return c.json(heartbeat);
    });
  }

  async start(): Promise<void> {
    await this.nodeService.initialize();

    this.server = Bun.serve({
      port: this.config.port,
      fetch: this.app.fetch,
    });

    console.log(`🔐 MPC Node started on port ${this.config.port}`);
    console.log(`   Node ID: ${this.config.nodeId}`);
    console.log(`   Network: ${this.config.networkId}`);
    console.log(`   Threshold: ${this.config.defaultThreshold}/${this.config.defaultTotalShares}`);
  }

  stop(): void {
    this.nodeService.shutdown();
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  getApp(): Hono {
    return this.app;
  }
}

/**
 * Start MPC node from environment variables
 */
export async function startMPCNode(): Promise<MPCServer> {
  const nodeId = process.env.MPC_NODE_ID ?? `mpc-node-${Date.now()}`;
  const port = parseInt(process.env.MPC_PORT ?? '4010', 10);
  const networkId = process.env.MPC_NETWORK_ID ?? 'jeju-localnet';
  const enclaveMeasurement = process.env.MPC_ENCLAVE_MEASUREMENT ?? '0x' + '0'.repeat(64);
  const threshold = parseInt(process.env.MPC_THRESHOLD ?? '1', 10);
  const totalShares = parseInt(process.env.MPC_TOTAL_SHARES ?? '1', 10);

  // Parse peer nodes from env
  const peersEnv = process.env.MPC_PEERS ?? '';
  const peers = peersEnv
    ? peersEnv.split(',').map((p) => {
        const [nodeId, endpoint] = p.split('@');
        return { nodeId: nodeId ?? '', endpoint: endpoint ?? '' };
      })
    : [];

  const config: MPCServerConfig = {
    nodeId,
    port,
    endpoint: `http://localhost:${port}`,
    enclaveMeasurement,
    networkId,
    defaultThreshold: threshold,
    defaultTotalShares: totalShares,
    peers,
    verbose: process.env.MPC_VERBOSE === 'true',
  };

  const server = new MPCServer(config);
  await server.start();
  return server;
}

// CLI entry point
if (import.meta.main) {
  startMPCNode().catch((err) => {
    console.error('Failed to start MPC node:', err);
    process.exit(1);
  });
}
