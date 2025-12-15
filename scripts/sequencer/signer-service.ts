#!/usr/bin/env bun
/**
 * P2P Threshold Signer Service
 * 
 * Security: API key auth, rate limiting, 10s replay window, origin validation
 * 
 * Usage: SIGNER_PRIVATE_KEY=0x... SIGNER_API_KEY=... bun run signer-service.ts
 */

import { Hono } from 'hono';
import { signMessage, signTypedData, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createHash, randomBytes } from 'crypto';

// ============ Types ============

interface SignRequest {
  digest: string;
  requestId: string;
  timestamp: number;
  context?: string;
}

interface TypedSignRequest extends SignRequest {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: Record<string, Array<{ name: string; type: string }>>;
  message: Record<string, unknown>;
}

interface SignResponse {
  requestId: string;
  signature: string;
  signer: string;
  error?: string;
}

// ============ Constants ============

const REPLAY_WINDOW_MS = 10_000;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX = 10;
const MAX_PROCESSED_REQUESTS = 10_000;

// ============ Service ============

class ThresholdSignerService {
  private account: ReturnType<typeof privateKeyToAccount>;
  private app: Hono;
  private apiKeyHash: string;
  private allowedOrigins: Set<string>;
  private rateLimits = new Map<string, { count: number; resetAt: number }>();
  private processedRequests = new Set<string>();
  private stats = { requestsReceived: 0, signaturesIssued: 0, startTime: Date.now() };

  constructor(privateKey: string, apiKey: string, allowedOrigins: string[] = []) {
    this.account = privateKeyToAccount(privateKey as `0x${string}`);
    this.app = new Hono();
    this.apiKeyHash = createHash('sha256').update(apiKey).digest('hex');
    this.allowedOrigins = new Set(allowedOrigins);
    this.setupRoutes();
    setInterval(() => this.cleanup(), 30_000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [k, v] of this.rateLimits) if (now >= v.resetAt) this.rateLimits.delete(k);
    if (this.processedRequests.size > MAX_PROCESSED_REQUESTS) this.processedRequests.clear();
  }

  private checkAuth(authHeader: string | undefined): boolean {
    if (!authHeader) return false;
    return createHash('sha256').update(authHeader.replace('Bearer ', '')).digest('hex') === this.apiKeyHash;
  }

  private checkRateLimit(clientId: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(clientId);
    if (!entry || now >= entry.resetAt) {
      this.rateLimits.set(clientId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }
    return ++entry.count <= RATE_LIMIT_MAX;
  }

  private validateRequest(body: SignRequest): string | null {
    if (!body.digest || !body.requestId) return 'Missing digest or requestId';
    if (!body.digest.startsWith('0x') || body.digest.length !== 66) return 'Invalid digest format';
    if (!body.timestamp || Date.now() - body.timestamp > REPLAY_WINDOW_MS) return 'Request expired';
    if (this.processedRequests.has(body.requestId)) return 'Request already processed';
    return null;
  }

  private errorResponse(requestId: string, error: string, status: number) {
    return { json: { requestId, signature: '', signer: this.account.address, error } as SignResponse, status };
  }

  private setupRoutes(): void {
    // Auth middleware (skip /health)
    this.app.use('/*', async (c, next) => {
      if (c.req.path === '/health') return next();
      if (!this.checkAuth(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401);
      if (!this.checkRateLimit(c.req.header('X-Forwarded-For') || 'unknown')) return c.json({ error: 'Rate limited' }, 429);
      const origin = c.req.header('Origin') || c.req.header('X-Origin');
      if (this.allowedOrigins.size > 0 && origin && !this.allowedOrigins.has(origin)) return c.json({ error: 'Origin blocked' }, 403);
      return next();
    });

    this.app.get('/health', (c) => c.json({ status: 'ok', address: this.account.address, uptime: Date.now() - this.stats.startTime }));
    this.app.get('/info', (c) => c.json({ address: this.account.address, signaturesIssued: this.stats.signaturesIssued, uptime: Date.now() - this.stats.startTime }));
    this.app.get('/stats', (c) => c.json({ signaturesIssued: this.stats.signaturesIssued, uptime: Date.now() - this.stats.startTime }));

    this.app.post('/sign-digest', async (c) => {
      this.stats.requestsReceived++;
      const body = await c.req.json<SignRequest>();
      const err = this.validateRequest(body);
      if (err) return c.json(this.errorResponse(body.requestId || '', err, 400).json, 400);
      this.processedRequests.add(body.requestId);

      const signature = await signMessage({
        account: this.account,
        message: { raw: body.digest as `0x${string}` },
      });
      this.stats.signaturesIssued++;
      console.log(`[Signer] Signed ${body.requestId.slice(0, 8)}...`);
      return c.json<SignResponse>({ requestId: body.requestId, signature, signer: this.account.address });
    });

    this.app.post('/sign-typed', async (c) => {
      this.stats.requestsReceived++;
      const body = await c.req.json<TypedSignRequest>();
      if (!body.domain || !body.types || !body.message) return c.json(this.errorResponse(body.requestId || '', 'Missing typed data fields', 400).json, 400);
      const err = this.validateRequest(body);
      if (err) return c.json(this.errorResponse(body.requestId, err, 400).json, 400);
      this.processedRequests.add(body.requestId);

      const signature = await this.wallet.signTypedData(body.domain, body.types, body.message);
      this.stats.signaturesIssued++;
      console.log(`[Signer] Signed typed ${body.requestId.slice(0, 8)}...`);
      return c.json<SignResponse>({ requestId: body.requestId, signature, signer: this.wallet.address });
    });
  }

  getApp() { return this.app; }
  getAddress() { return this.wallet.address; }
}

// ============ Signature Collector ============

export class SignatureCollector {
  constructor(private peerUrls: Map<string, string>, private apiKey: string, private timeout = 5000) {}

  static fromRecord(urls: Record<string, string>, apiKey: string, timeout = 5000) {
    return new SignatureCollector(new Map(Object.entries(urls).map(([a, u]) => [a.toLowerCase(), u])), apiKey, timeout);
  }

  async collect(digest: string, threshold: number, selfSig?: { signature: string; signer: string }) {
    const signatures = selfSig ? [selfSig.signature] : [];
    const signers = selfSig ? [selfSig.signer] : [];
    const requestId = `${randomBytes(16).toString('hex')}-${Date.now()}`;

    const results = await Promise.all(
      Array.from(this.peerUrls.entries())
        .filter(([addr]) => !signers.includes(addr))
        .map(async ([addr, url]) => {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), this.timeout);
          try {
            const res = await fetch(`${url}/sign-digest`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
              body: JSON.stringify({ digest, requestId, timestamp: Date.now() }),
              signal: ctrl.signal,
            });
            clearTimeout(tid);
            if (!res.ok) return null;
            const r = await res.json() as SignResponse;
            return r.error ? null : { signature: r.signature, signer: r.signer };
          } catch { return null; }
        })
    );

    for (const r of results) if (r && signatures.length < threshold) { signatures.push(r.signature); signers.push(r.signer); }
    return { signatures, signers };
  }
}

// ============ Main ============

async function main() {
  const { SIGNER_PRIVATE_KEY: pk, SIGNER_API_KEY: key, SIGNER_PORT, SIGNER_ALLOWED_ORIGINS } = process.env;
  if (!pk || !key) { console.error('SIGNER_PRIVATE_KEY and SIGNER_API_KEY required'); process.exit(1); }

  const port = parseInt(SIGNER_PORT || '4100', 10);
  const origins = (SIGNER_ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  const svc = new ThresholdSignerService(pk, key, origins);

  console.log(`🔐 Signer v2.0.0 | ${svc.getAddress()} | :${port}`);
  Bun.serve({ port, fetch: svc.getApp().fetch });
}

// Only run main when executed directly
if (import.meta.main) {
  main().catch(e => { console.error(e); process.exit(1); });
}

export { ThresholdSignerService };
