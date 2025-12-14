#!/usr/bin/env bun
/**
 * P2P Threshold Signer Service
 * 
 * This service runs on each sequencer node and handles signature requests
 * from other sequencers for threshold batch submission.
 * 
 * Each operator runs their own instance with their own private key.
 * Signatures are collected by the batch submitter coordinator.
 * 
 * Usage:
 *   SIGNER_PRIVATE_KEY=0x... SIGNER_PORT=4100 bun run signer-service.ts
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Wallet, keccak256, getBytes, recoverAddress, toBeHex, zeroPadValue } from 'ethers';

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

class ThresholdSignerService {
  private wallet: Wallet;
  private app: Hono;
  private stats: SignerStats;

  constructor(privateKey: string) {
    this.wallet = new Wallet(privateKey);
    this.app = new Hono();
    
    this.stats = {
      address: this.wallet.address,
      startTime: Date.now(),
      requestsReceived: 0,
      signaturesIssued: 0,
      lastSignatureTime: 0,
      version: '1.0.0',
    };

    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use('/*', cors());

    // Health check
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

    // Sign a digest
    this.app.post('/sign', async (c) => {
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
          error: 'Invalid digest format - must be 0x-prefixed 32 byte hex',
        }, 400);
      }

      // Check request age (reject if too old)
      const requestAge = Date.now() - (body.timestamp || 0);
      if (body.timestamp && requestAge > 60000) { // 1 minute max
        return c.json<SignResponse>({
          requestId: body.requestId,
          signature: '',
          signer: this.wallet.address,
          error: 'Request too old',
        }, 400);
      }

      try {
        // Sign the digest
        const digestBytes = getBytes(body.digest);
        const signature = await this.wallet.signMessage(digestBytes);

        this.stats.signaturesIssued++;
        this.stats.lastSignatureTime = Date.now();

        console.log(`[Signer] Signed request ${body.requestId} for digest ${body.digest.slice(0, 18)}...`);

        return c.json<SignResponse>({
          requestId: body.requestId,
          signature,
          signer: this.wallet.address,
        });
      } catch (err) {
        console.error(`[Signer] Sign error:`, err);
        return c.json<SignResponse>({
          requestId: body.requestId,
          signature: '',
          signer: this.wallet.address,
          error: err instanceof Error ? err.message : 'Unknown error',
        }, 500);
      }
    });

    // Sign EIP-712 typed data (for ThresholdBatchSubmitter)
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

      try {
        // Sign typed data
        const signature = await this.wallet.signTypedData(
          body.domain,
          body.types,
          body.message
        );

        this.stats.signaturesIssued++;
        this.stats.lastSignatureTime = Date.now();

        console.log(`[Signer] Signed typed data request ${body.requestId}`);

        return c.json<SignResponse>({
          requestId: body.requestId,
          signature,
          signer: this.wallet.address,
        });
      } catch (err) {
        console.error(`[Signer] Typed sign error:`, err);
        return c.json<SignResponse>({
          requestId: body.requestId,
          signature: '',
          signer: this.wallet.address,
          error: err instanceof Error ? err.message : 'Unknown error',
        }, 500);
      }
    });

    // Verify a signature
    this.app.post('/verify', async (c) => {
      const body = await c.req.json<{ digest: string; signature: string; expectedSigner?: string }>();

      if (!body.digest || !body.signature) {
        return c.json({ valid: false, error: 'Missing digest or signature' }, 400);
      }

      try {
        const digestBytes = getBytes(body.digest);
        const recovered = recoverAddress(keccak256(digestBytes), body.signature);

        const valid = !body.expectedSigner || 
          recovered.toLowerCase() === body.expectedSigner.toLowerCase();

        return c.json({
          valid,
          recovered,
          expectedSigner: body.expectedSigner,
        });
      } catch (err) {
        return c.json({
          valid: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }, 400);
      }
    });

    // Stats endpoint
    this.app.get('/stats', (c) => {
      return c.json(this.stats);
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
  private timeout: number;

  constructor(peerUrls: Record<string, string>, timeout = 5000) {
    for (const [addr, url] of Object.entries(peerUrls)) {
      this.peerUrls.set(addr.toLowerCase(), url);
    }
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

    const requestId = `${digest.slice(0, 16)}-${Date.now()}`;

    // Request signatures from all peers in parallel
    const requests = Array.from(this.peerUrls.entries()).map(async ([addr, url]) => {
      if (signers.includes(addr)) {
        return null; // Skip if we already have this signer
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(`${url}/sign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            digest,
            requestId,
            timestamp: Date.now(),
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.warn(`[Collector] Peer ${addr} returned ${response.status}`);
          return null;
        }

        const result = await response.json() as SignResponse;
        
        if (result.error) {
          console.warn(`[Collector] Peer ${addr} error: ${result.error}`);
          return null;
        }

        return { signature: result.signature, signer: result.signer };
      } catch (err) {
        console.warn(`[Collector] Failed to get signature from ${addr}:`, err);
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
  const port = parseInt(process.env.SIGNER_PORT || '4100', 10);

  if (!privateKey) {
    console.error('SIGNER_PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  const service = new ThresholdSignerService(privateKey);
  
  console.log(`
🔐 Threshold Signer Service
   Address: ${service.getAddress()}
   Port: ${port}
`);

  Bun.serve({
    port,
    fetch: service.getApp().fetch,
  });

  console.log(`Signer service running on http://localhost:${port}`);
  console.log('Endpoints:');
  console.log('  GET  /health  - Health check');
  console.log('  GET  /info    - Signer info');
  console.log('  POST /sign    - Sign a digest');
  console.log('  POST /sign-typed - Sign EIP-712 typed data');
  console.log('  GET  /stats   - Statistics');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

export { ThresholdSignerService };

