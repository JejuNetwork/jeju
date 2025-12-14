#!/usr/bin/env bun
/**
 * P2P Threshold Signer Service
 * 
 * This service runs on each sequencer node and handles signature requests
 * from other sequencers for threshold batch submission.
 * 
 * SECURITY FEATURES:
 * - API key authentication required
 * - Rate limiting per client
 * - Short replay window (10 seconds)
 * - Request origin validation
 * - No private key logging
 * 
 * Each operator runs their own instance with their own private key.
 * Signatures are collected by the batch submitter coordinator.
 * 
 * Usage:
 *   SIGNER_PRIVATE_KEY=0x... SIGNER_PORT=4100 SIGNER_API_KEY=... bun run signer-service.ts
 */

import { Hono } from 'hono';
import { Wallet, keccak256, getBytes, recoverAddress, Signature } from 'ethers';
import { createHash, randomBytes } from 'crypto';

interface SignRequest {
  digest: string;        // 0x-prefixed 32 byte hex
  requestId: string;     // Unique request ID
  timestamp: number;     // Unix timestamp
  context?: string;      // Optional context (e.g., batch nonce)
}

interface SignResponse {
  requestId: string;
  signature: string;     // 65 byte signature (r, s, v)
  signer: string;        // Signer address
  error?: string;
}

interface SignerStats {
  address: string;
  startTime: number;
  requestsReceived: number;
  signaturesIssued: number;
  lastSignatureTime: number;
  version: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Security constants
const REPLAY_WINDOW_MS = 10_000; // 10 second max replay window (was 60s)
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

class ThresholdSignerService {
  private wallet: Wallet;
  private app: Hono;
  private stats: SignerStats;
  private apiKeyHash: string;
  private allowedOrigins: Set<string>;
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private processedRequests: Set<string> = new Set();

  constructor(privateKey: string, apiKey: string, allowedOrigins: string[] = []) {
    this.wallet = new Wallet(privateKey);
    this.app = new Hono();
    this.apiKeyHash = createHash('sha256').update(apiKey).digest('hex');
    this.allowedOrigins = new Set(allowedOrigins);
    
    this.stats = {
      address: this.wallet.address,
      startTime: Date.now(),
      requestsReceived: 0,
      signaturesIssued: 0,
      lastSignatureTime: 0,
      version: '2.0.0',
    };

    this.setupRoutes();
    
    // Cleanup old rate limit entries every minute
    setInterval(() => this.cleanupRateLimits(), 60_000);
    // Cleanup processed requests every 30 seconds
    setInterval(() => this.cleanupProcessedRequests(), 30_000);
  }

  private validateApiKey(authHeader: string | undefined): boolean {
    if (!authHeader) return false;
    const providedKey = authHeader.replace('Bearer ', '');
    const providedHash = createHash('sha256').update(providedKey).digest('hex');
    return providedHash === this.apiKeyHash;
  }

  private checkRateLimit(clientId: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(clientId);
    
    if (!entry || now >= entry.resetAt) {
      this.rateLimits.set(clientId, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS
      });
      return true;
    }
    
    if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
      return false;
    }
    
    entry.count++;
    return true;
  }

  private cleanupRateLimits(): void {
    const now = Date.now();
    for (const [key, entry] of this.rateLimits.entries()) {
      if (now >= entry.resetAt) {
        this.rateLimits.delete(key);
      }
    }
  }

  private cleanupProcessedRequests(): void {
    // Keep only recent request IDs to prevent memory bloat
    if (this.processedRequests.size > 10000) {
      this.processedRequests.clear();
    }
  }

  private setupRoutes(): void {
    // Authentication middleware for all routes except health
    this.app.use('/*', async (c, next) => {
      const path = c.req.path;
      
      // Health check doesn't require auth
      if (path === '/health') {
        return next();
      }
      
      // Validate API key
      const authHeader = c.req.header('Authorization');
      if (!this.validateApiKey(authHeader)) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      
      // Check rate limit
      const clientIp = c.req.header('X-Forwarded-For') || 'unknown';
      if (!this.checkRateLimit(clientIp)) {
        return c.json({ error: 'Rate limit exceeded' }, 429);
      }
      
      // Validate origin if configured
      if (this.allowedOrigins.size > 0) {
        const origin = c.req.header('Origin') || c.req.header('X-Origin');
        if (origin && !this.allowedOrigins.has(origin)) {
          return c.json({ error: 'Origin not allowed' }, 403);
        }
      }
      
      return next();
    });

    // Health check - no auth required
    this.app.get('/health', (c) => {
      return c.json({
        status: 'ok',
        service: 'threshold-signer',
        address: this.stats.address,
        uptime: Date.now() - this.stats.startTime,
      });
    });

    // Get signer info
    this.app.get('/info', (c) => {
      return c.json({
        address: this.stats.address,
        version: this.stats.version,
        signaturesIssued: this.stats.signaturesIssued,
        uptime: Date.now() - this.stats.startTime,
      });
    });

    // Sign a raw digest (for contracts using ECDSA.recover)
    this.app.post('/sign-digest', async (c) => {
      this.stats.requestsReceived++;

      const body = await c.req.json<SignRequest>();

      if (!body.digest || !body.requestId) {
        return c.json<SignResponse>({
          requestId: body.requestId || '',
          signature: '',
          signer: this.wallet.address,
          error: 'Missing digest or requestId',
        }, 400);
      }

      // Validate digest format
      if (!body.digest.startsWith('0x') || body.digest.length !== 66) {
        return c.json<SignResponse>({
          requestId: body.requestId,
          signature: '',
          signer: this.wallet.address,
          error: 'Invalid digest format',
        }, 400);
      }

      // SECURITY: Check request age with short window
      const requestAge = Date.now() - (body.timestamp || 0);
      if (!body.timestamp || requestAge > REPLAY_WINDOW_MS) {
        return c.json<SignResponse>({
          requestId: body.requestId,
          signature: '',
          signer: this.wallet.address,
          error: 'Request expired or invalid timestamp',
        }, 400);
      }

      // SECURITY: Prevent replay attacks
      if (this.processedRequests.has(body.requestId)) {
        return c.json<SignResponse>({
          requestId: body.requestId,
          signature: '',
          signer: this.wallet.address,
          error: 'Request already processed',
        }, 400);
      }
      this.processedRequests.add(body.requestId);

      try {
        // Sign the raw digest directly (without message prefix)
        const signingKey = this.wallet.signingKey;
        const sig = signingKey.sign(body.digest);
        
        // Pack r, s, v into a single bytes signature
        const signature = Signature.from({
          r: sig.r,
          s: sig.s,
          v: sig.v,
        }).serialized;

        this.stats.signaturesIssued++;
        this.stats.lastSignatureTime = Date.now();

        // SECURITY: Don't log digest details
        console.log(`[Signer] Signed request ${body.requestId.slice(0, 8)}...`);

        return c.json<SignResponse>({
          requestId: body.requestId,
          signature,
          signer: this.wallet.address,
        });
      } catch (err) {
        console.error(`[Signer] Sign error for request ${body.requestId.slice(0, 8)}...`);
        return c.json<SignResponse>({
          requestId: body.requestId,
          signature: '',
          signer: this.wallet.address,
          error: 'Signing failed',
        }, 500);
      }
    });

    // Sign EIP-712 typed data
    this.app.post('/sign-typed', async (c) => {
      this.stats.requestsReceived++;

      interface TypedSignRequest extends SignRequest {
        domain: {
          name: string;
          version: string;
          chainId: number;
          verifyingContract: string;
        };
        types: Record<string, Array<{ name: string; type: string }>>;
        message: Record<string, unknown>;
      }

      const body = await c.req.json<TypedSignRequest>();

      if (!body.domain || !body.types || !body.message || !body.requestId) {
        return c.json<SignResponse>({
          requestId: body.requestId || '',
          signature: '',
          signer: this.wallet.address,
          error: 'Missing domain, types, message, or requestId',
        }, 400);
      }

      // SECURITY: Check request age
      const requestAge = Date.now() - (body.timestamp || 0);
      if (!body.timestamp || requestAge > REPLAY_WINDOW_MS) {
        return c.json<SignResponse>({
          requestId: body.requestId,
          signature: '',
          signer: this.wallet.address,
          error: 'Request expired',
        }, 400);
      }

      // SECURITY: Prevent replay
      if (this.processedRequests.has(body.requestId)) {
        return c.json<SignResponse>({
          requestId: body.requestId,
          signature: '',
          signer: this.wallet.address,
          error: 'Request already processed',
        }, 400);
      }
      this.processedRequests.add(body.requestId);

      try {
        const signature = await this.wallet.signTypedData(
          body.domain,
          body.types,
          body.message
        );

        this.stats.signaturesIssued++;
        this.stats.lastSignatureTime = Date.now();

        console.log(`[Signer] Signed typed data request ${body.requestId.slice(0, 8)}...`);

        return c.json<SignResponse>({
          requestId: body.requestId,
          signature,
          signer: this.wallet.address,
        });
      } catch (err) {
        console.error(`[Signer] Typed sign error for request ${body.requestId.slice(0, 8)}...`);
        return c.json<SignResponse>({
          requestId: body.requestId,
          signature: '',
          signer: this.wallet.address,
          error: 'Signing failed',
        }, 500);
      }
    });

    // Stats endpoint (limited info for security)
    this.app.get('/stats', (c) => {
      return c.json({
        signaturesIssued: this.stats.signaturesIssued,
        uptime: Date.now() - this.stats.startTime,
        version: this.stats.version,
      });
    });
  }

  getApp(): Hono {
    return this.app;
  }

  getAddress(): string {
    return this.wallet.address;
  }
}

// Signature collection client for the coordinator
export class SignatureCollector {
  private peerUrls: Map<string, string> = new Map(); // address -> URL
  private apiKey: string;
  private timeout: number;

  constructor(peerUrls: Record<string, string>, apiKey: string, timeout = 5000) {
    for (const [addr, url] of Object.entries(peerUrls)) {
      this.peerUrls.set(addr.toLowerCase(), url);
    }
    this.apiKey = apiKey;
    this.timeout = timeout;
  }

  async collectSignatures(
    digest: string,
    threshold: number,
    selfSignature?: { signature: string; signer: string }
  ): Promise<{ signatures: string[]; signers: string[] }> {
    const signatures: string[] = [];
    const signers: string[] = [];

    // Add self-signature first if provided
    if (selfSignature) {
      signatures.push(selfSignature.signature);
      signers.push(selfSignature.signer);
    }

    const requestId = `${randomBytes(16).toString('hex')}-${Date.now()}`;

    // Request signatures from all peers in parallel
    const requests = Array.from(this.peerUrls.entries()).map(async ([addr, url]) => {
      if (signers.includes(addr)) {
        return null;
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(`${url}/sign-digest`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            digest,
            requestId,
            timestamp: Date.now(),
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.warn(`[Collector] Peer ${addr.slice(0, 8)}... returned ${response.status}`);
          return null;
        }

        const result = await response.json() as SignResponse;
        
        if (result.error) {
          console.warn(`[Collector] Peer ${addr.slice(0, 8)}... error: ${result.error}`);
          return null;
        }

        return { signature: result.signature, signer: result.signer };
      } catch (err) {
        console.warn(`[Collector] Failed to get signature from ${addr.slice(0, 8)}...`);
        return null;
      }
    });

    const results = await Promise.all(requests);

    for (const result of results) {
      if (result && signatures.length < threshold) {
        signatures.push(result.signature);
        signers.push(result.signer);
      }
    }

    return { signatures, signers };
  }
}

// Main entry point
async function main(): Promise<void> {
  const privateKey = process.env.SIGNER_PRIVATE_KEY;
  const apiKey = process.env.SIGNER_API_KEY;
  const port = parseInt(process.env.SIGNER_PORT || '4100', 10);
  const allowedOriginsStr = process.env.SIGNER_ALLOWED_ORIGINS || '';

  if (!privateKey) {
    console.error('SIGNER_PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  if (!apiKey) {
    console.error('SIGNER_API_KEY environment variable required for security');
    process.exit(1);
  }

  const allowedOrigins = allowedOriginsStr.split(',').filter(o => o.length > 0);
  const service = new ThresholdSignerService(privateKey, apiKey, allowedOrigins);
  
  console.log(`
🔐 Threshold Signer Service v2.0.0
   Address: ${service.getAddress()}
   Port: ${port}
   Security: API Key + Rate Limiting + Replay Protection
`);

  Bun.serve({
    port,
    fetch: service.getApp().fetch,
  });

  console.log(`Signer service running on http://localhost:${port}`);
  console.log('Endpoints (require Authorization header):');
  console.log('  GET  /health      - Health check (no auth)');
  console.log('  GET  /info        - Signer info');
  console.log('  POST /sign-digest - Sign a raw digest');
  console.log('  POST /sign-typed  - Sign EIP-712 typed data');
  console.log('  GET  /stats       - Statistics');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

export { ThresholdSignerService };
