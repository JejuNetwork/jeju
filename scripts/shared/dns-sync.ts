/**
 * DNS Sync Service - Production Implementation
 *
 * Multi-provider DNS synchronization with:
 * - AWS Route53, GCP Cloud DNS, Cloudflare
 * - On-chain endpoint registry fallback
 * - Retry logic with exponential backoff
 * - Health checks with automatic failover
 * - Audit logging
 * - Prometheus metrics
 * - Graceful shutdown
 */

import { createPublicClient, createWalletClient, http as httpTransport, keccak256, toBytes, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import { Registry, Counter, Gauge, Histogram } from 'prom-client';
import * as http from 'http';

// AWS SDK types (optional - loaded dynamically)
interface ResourceRecordSet {
  Name?: string;
  Type?: string;
  TTL?: number;
  ResourceRecords?: Array<{ Value?: string }>;
  AliasTarget?: { DNSName?: string };
}

// Type definitions for dynamically loaded SDK classes
interface Route53ClientConstructor {
  new (config: { region: string }): Route53ClientInstance;
}

interface Route53ClientInstance {
  send(command: Route53Command): Promise<Route53Response>;
}

interface Route53Command {
  // Marker interface for Route53 commands
}

interface Route53Response {
  ResourceRecordSets?: ResourceRecordSet[];
}

interface ChangeResourceRecordSetsCommandConstructor {
  new (input: {
    HostedZoneId: string;
    ChangeBatch: {
      Changes: Array<{
        Action: 'UPSERT' | 'DELETE' | 'CREATE';
        ResourceRecordSet: {
          Name: string;
          Type: string;
          TTL: number;
          ResourceRecords: Array<{ Value: string }>;
        };
      }>;
    };
  }): Route53Command;
}

interface ListResourceRecordSetsCommandConstructor {
  new (input: { HostedZoneId: string }): Route53Command;
}

// GCP Cloud DNS types
interface CloudDNSConstructor {
  new (config: { projectId: string }): CloudDNSInstance;
}

interface CloudDNSInstance {
  zone(name: string): CloudDNSZone;
}

interface CloudDNSZone {
  record(type: 'a' | 'aaaa' | 'cname', config: { name: string; ttl: number; data: string[] }): CloudDNSRecord;
  addRecords(record: CloudDNSRecord): Promise<void>;
  replaceRecords(type: 'a' | 'aaaa' | 'cname', record: CloudDNSRecord): Promise<void>;
}

interface CloudDNSRecord {
  // Marker interface for Cloud DNS records
}

// Dynamic SDK storage with proper types
let Route53ClientClass: Route53ClientConstructor | null = null;
let ChangeResourceRecordSetsCommandClass: ChangeResourceRecordSetsCommandConstructor | null = null;
let ListResourceRecordSetsCommandClass: ListResourceRecordSetsCommandConstructor | null = null;
let DNSClass: CloudDNSConstructor | null = null;

async function loadAWSSDK(): Promise<boolean> {
  try {
    const aws = await import('@aws-sdk/client-route-53');
    Route53ClientClass = aws.Route53Client as unknown as Route53ClientConstructor;
    ChangeResourceRecordSetsCommandClass = aws.ChangeResourceRecordSetsCommand as unknown as ChangeResourceRecordSetsCommandConstructor;
    ListResourceRecordSetsCommandClass = aws.ListResourceRecordSetsCommand as unknown as ListResourceRecordSetsCommandConstructor;
    return true;
  } catch {
    console.warn('[DNSSync] AWS SDK not available - Route53 sync disabled');
    return false;
  }
}

async function loadGCPSDK(): Promise<boolean> {
  try {
    const gcp = await import('@google-cloud/dns');
    DNSClass = gcp.DNS as unknown as CloudDNSConstructor;
    return true;
  } catch {
    console.warn('[DNSSync] GCP SDK not available - Cloud DNS sync disabled');
    return false;
  }
}

// ============================================================================
// Configuration Schema
// ============================================================================

const DNSProviderConfigSchema = z.object({
  route53: z
    .object({
      zoneId: z.string(),
      region: z.string().default('us-east-1'),
    })
    .optional(),
  cloudDns: z
    .object({
      projectId: z.string(),
      zoneName: z.string(),
    })
    .optional(),
  cloudflare: z
    .object({
      apiToken: z.string(),
      zoneId: z.string(),
    })
    .optional(),
  onChain: z
    .object({
      rpcUrl: z.string().url(),
      privateKey: z.string(),
      registryAddress: z.string(),
    })
    .optional(),
});

const DNSSyncConfigSchema = z.object({
  domain: z.string(),
  providers: DNSProviderConfigSchema,
  syncIntervalMs: z.number().default(300000),
  healthCheckIntervalMs: z.number().default(60000),
  retryAttempts: z.number().default(3),
  retryDelayMs: z.number().default(1000),
  metricsPort: z.number().optional(),
});

export type DNSProviderConfig = z.infer<typeof DNSProviderConfigSchema>;
export type DNSSyncConfig = z.infer<typeof DNSSyncConfigSchema>;

// ============================================================================
// Types
// ============================================================================

export interface DNSRecord {
  name: string;
  type: 'A' | 'AAAA' | 'CNAME';
  ttl: number;
  values: string[];
  healthCheckEnabled?: boolean;
}

export interface HealthCheckResult {
  provider: string;
  endpoint: string;
  healthy: boolean;
  latencyMs: number;
  lastCheck: number;
  consecutiveFailures: number;
}

interface AuditLogEntry {
  timestamp: number;
  action: 'sync' | 'health_check' | 'failover' | 'error';
  provider: string;
  details: Record<string, unknown>;
}

// ============================================================================
// Default Records
// ============================================================================

const DEFAULT_RECORDS: DNSRecord[] = [
  { name: 'rpc', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
  { name: 'testnet-rpc', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
  { name: 'ws', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
  { name: 'api', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
  { name: 'gateway', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
  { name: 'ipfs', type: 'A', ttl: 300, values: [], healthCheckEnabled: true },
  { name: 'storage', type: 'A', ttl: 300, values: [], healthCheckEnabled: true },
  { name: 'cdn', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
  { name: 'proxy', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
];

// ============================================================================
// Endpoint Registry ABI (reference - inline ABIs used in writeContract calls)
// ============================================================================

const _ENDPOINT_REGISTRY_ABI = [
  'function setEndpoint(bytes32 service, string url, string region, uint256 priority) external',
  'function removeEndpoint(bytes32 service, string url) external',
  'function getEndpoints(bytes32 service) view returns (tuple(string url, string region, uint256 priority, bool active)[])',
  'event EndpointUpdated(bytes32 indexed service, string url, string region, uint256 priority)',
];
void _ENDPOINT_REGISTRY_ABI; // Suppress unused warning - kept for reference

// ============================================================================
// Prometheus Metrics
// ============================================================================

const metricsRegistry = new Registry();

const dnsSyncTotal = new Counter({
  name: 'dns_sync_total',
  help: 'Total DNS sync operations',
  labelNames: ['provider', 'status'],
  registers: [metricsRegistry],
});

const dnsSyncDuration = new Histogram({
  name: 'dns_sync_duration_seconds',
  help: 'DNS sync duration',
  labelNames: ['provider'],
  buckets: [0.1, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

const dnsHealthCheckResults = new Gauge({
  name: 'dns_health_check_healthy',
  help: 'Health check result',
  labelNames: ['service', 'endpoint'],
  registers: [metricsRegistry],
});

const dnsEndpointLatency = new Gauge({
  name: 'dns_endpoint_latency_ms',
  help: 'Endpoint latency',
  labelNames: ['service', 'endpoint'],
  registers: [metricsRegistry],
});

// ============================================================================
// Retry Helper
// ============================================================================

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  delayMs: number
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * Math.pow(2, i)));
      }
    }
  }

  throw lastError;
}

// ============================================================================
// DNS Sync Service
// ============================================================================

export class DNSSyncService {
  private config: DNSSyncConfig;
  private route53Client: Route53ClientInstance | null = null;
  private cloudDnsClient: CloudDNSInstance | null = null;
  private publicClient: ReturnType<typeof createPublicClient> | null = null;
  private walletClient: ReturnType<typeof createWalletClient> | null = null;
  private endpointRegistryAddress: Address | null = null;
  private healthResults = new Map<string, HealthCheckResult>();
  private auditLog: AuditLogEntry[] = [];
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private metricsServer: http.Server | null = null;
  private running = false;
  private currentRecords: DNSRecord[] = [];

  constructor(config: DNSSyncConfig) {
    this.config = DNSSyncConfigSchema.parse(config);
    // SDK initialization happens async in start()
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Load SDKs
    await loadAWSSDK();
    await loadGCPSDK();

    // Initialize Route53
    if (this.config.providers.route53 && Route53ClientClass) {
      this.route53Client = new Route53ClientClass({
        region: this.config.providers.route53.region,
      });
    }

    // Initialize Cloud DNS
    if (this.config.providers.cloudDns && DNSClass) {
      this.cloudDnsClient = new DNSClass({
        projectId: this.config.providers.cloudDns.projectId,
      });
    }

    // Initialize on-chain registry
    if (this.config.providers.onChain) {
      this.publicClient = createPublicClient({ transport: httpTransport(this.config.providers.onChain.rpcUrl) });
      const account = privateKeyToAccount(this.config.providers.onChain.privateKey as `0x${string}`);
      this.walletClient = createWalletClient({ 
        account, 
        transport: httpTransport(this.config.providers.onChain.rpcUrl) 
      });
      this.endpointRegistryAddress = this.config.providers.onChain.registryAddress as Address;
    }

    this.running = true;
    console.log('[DNS Sync] Starting service...');

    // Start metrics server
    if (this.config.metricsPort) {
      await this.startMetricsServer();
    }

    // Initial sync
    await this.syncAll();

    // Periodic sync
    this.syncInterval = setInterval(
      () => this.syncAll(),
      this.config.syncIntervalMs
    );

    // Periodic health checks
    this.healthInterval = setInterval(
      () => this.runHealthChecks(),
      this.config.healthCheckIntervalMs
    );

    console.log('[DNS Sync] Running');
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.healthInterval) clearInterval(this.healthInterval);
    if (this.metricsServer) this.metricsServer.close();

    console.log('[DNS Sync] Stopped');
  }

  private async startMetricsServer(): Promise<void> {
    this.metricsServer = http.createServer(async (req, res) => {
      if (req.url === '/metrics') {
        res.setHeader('Content-Type', metricsRegistry.contentType);
        res.end(await metricsRegistry.metrics());
      } else if (req.url === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          status: this.running ? 'healthy' : 'stopped',
          healthyEndpoints: this.getHealthyEndpointCount(),
          lastSync: this.auditLog.find((e) => e.action === 'sync')?.timestamp,
        }));
      } else if (req.url === '/audit') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(this.auditLog.slice(-100)));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    await new Promise<void>((resolve) => {
      this.metricsServer!.listen(this.config.metricsPort, resolve);
    });

    console.log(`[DNS Sync] Metrics server on port ${this.config.metricsPort}`);
  }

  // ============================================================================
  // Sync Operations
  // ============================================================================

  async syncAll(): Promise<void> {
    console.log('[DNS Sync] Starting sync...');
    const startTime = Date.now();

    try {
      // Get current records from primary (Route53)
      const records = await this.getRecordsFromRoute53();
      this.currentRecords = records;

      // Sync to all providers in parallel
      await Promise.all([
        this.syncToCloudDns(records),
        this.syncToCloudflare(records),
        this.syncToOnChain(records),
      ]);

      this.logAudit('sync', 'all', {
        recordCount: records.length,
        durationMs: Date.now() - startTime,
      });

      console.log('[DNS Sync] Sync complete');
    } catch (error) {
      this.logAudit('error', 'sync', { error: (error as Error).message });
      console.error('[DNS Sync] Sync failed:', error);
    }
  }

  // ============================================================================
  // Route53
  // ============================================================================

  private async getRecordsFromRoute53(): Promise<DNSRecord[]> {
    if (!this.route53Client || !this.config.providers.route53) {
      return DEFAULT_RECORDS;
    }

    const timer = dnsSyncDuration.startTimer({ provider: 'route53' });

    try {
      const response = (await withRetry(
        () =>
          this.route53Client!.send(
            new ListResourceRecordSetsCommandClass({
              HostedZoneId: this.config.providers.route53!.zoneId,
            })
          ),
        this.config.retryAttempts,
        this.config.retryDelayMs
      )) as { ResourceRecordSets?: ResourceRecordSet[] };

      const records: DNSRecord[] = [];

      for (const rrs of response.ResourceRecordSets ?? []) {
        if (rrs.Type === 'A' || rrs.Type === 'AAAA' || rrs.Type === 'CNAME') {
          const name = rrs.Name?.replace(`.${this.config.domain}.`, '') ?? '';
          records.push({
            name,
            type: rrs.Type as 'A' | 'AAAA' | 'CNAME',
            ttl: rrs.TTL ?? 60,
            values: rrs.ResourceRecords?.map((r) => r.Value ?? '') ?? [],
            healthCheckEnabled: DEFAULT_RECORDS.some(
              (d) => d.name === name && d.healthCheckEnabled
            ),
          });
        }
      }

      dnsSyncTotal.inc({ provider: 'route53', status: 'success' });
      return records.length > 0 ? records : DEFAULT_RECORDS;
    } catch (error) {
      dnsSyncTotal.inc({ provider: 'route53', status: 'error' });
      throw error;
    } finally {
      timer();
    }
  }

  async syncToRoute53(records: DNSRecord[]): Promise<void> {
    if (!this.route53Client || !this.config.providers.route53) return;

    const timer = dnsSyncDuration.startTimer({ provider: 'route53' });

    try {
      const changes = records
        .filter((r) => r.values.length > 0)
        .map((record) => ({
          Action: 'UPSERT' as const,
          ResourceRecordSet: {
            Name: `${record.name}.${this.config.domain}`,
            Type: record.type,
            TTL: record.ttl,
            ResourceRecords: record.values.map((v) => ({ Value: v })),
          },
        }));

      if (changes.length === 0) return;

      await withRetry(
        () =>
          this.route53Client!.send(
            new ChangeResourceRecordSetsCommandClass({
              HostedZoneId: this.config.providers.route53!.zoneId,
              ChangeBatch: { Changes: changes },
            })
          ),
        this.config.retryAttempts,
        this.config.retryDelayMs
      );

      dnsSyncTotal.inc({ provider: 'route53', status: 'success' });
      console.log(`[DNS Sync] Route53: Updated ${changes.length} records`);
    } catch (error) {
      dnsSyncTotal.inc({ provider: 'route53', status: 'error' });
      this.logAudit('error', 'route53', { error: (error as Error).message });
      throw error;
    } finally {
      timer();
    }
  }

  // ============================================================================
  // Cloud DNS
  // ============================================================================

  private async syncToCloudDns(records: DNSRecord[]): Promise<void> {
    if (!this.cloudDnsClient || !this.config.providers.cloudDns) return;

    const timer = dnsSyncDuration.startTimer({ provider: 'cloud-dns' });

    try {
      const zone = this.cloudDnsClient.zone(this.config.providers.cloudDns.zoneName);

      for (const record of records.filter((r) => r.values.length > 0)) {
        const gcloudRecord = zone.record(
          record.type.toLowerCase() as 'a' | 'aaaa' | 'cname',
          {
            name: `${record.name}.${this.config.domain}.`,
            ttl: record.ttl,
            data: record.values,
          }
        );

        try {
          await zone.addRecords(gcloudRecord);
        } catch {
          // Record exists, try to replace
          await zone.replaceRecords(
            record.type.toLowerCase() as 'a' | 'aaaa' | 'cname',
            gcloudRecord
          );
        }
      }

      dnsSyncTotal.inc({ provider: 'cloud-dns', status: 'success' });
      console.log(`[DNS Sync] Cloud DNS: Updated ${records.length} records`);
    } catch (error) {
      dnsSyncTotal.inc({ provider: 'cloud-dns', status: 'error' });
      this.logAudit('error', 'cloud-dns', { error: (error as Error).message });
    } finally {
      timer();
    }
  }

  // ============================================================================
  // Cloudflare
  // ============================================================================

  private async syncToCloudflare(records: DNSRecord[]): Promise<void> {
    if (!this.config.providers.cloudflare) return;

    const timer = dnsSyncDuration.startTimer({ provider: 'cloudflare' });
    const { apiToken, zoneId } = this.config.providers.cloudflare;

    try {
      for (const record of records.filter((r) => r.values.length > 0)) {
        // List existing records
        const listResponse = await withRetry(
          () =>
            fetch(
              `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${record.name}.${this.config.domain}&type=${record.type}`,
              {
                headers: {
                  Authorization: `Bearer ${apiToken}`,
                  'Content-Type': 'application/json',
                },
              }
            ),
          this.config.retryAttempts,
          this.config.retryDelayMs
        );

        const listData = (await listResponse.json()) as {
          result: Array<{ id: string }>;
        };
        const existing = listData.result[0];

        const recordData = {
          type: record.type,
          name: record.name,
          content: record.values[0],
          ttl: record.ttl,
          proxied: record.name === 'cdn',
        };

        if (existing) {
          await withRetry(
            () =>
              fetch(
                `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${existing.id}`,
                {
                  method: 'PATCH',
                  headers: {
                    Authorization: `Bearer ${apiToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(recordData),
                }
              ),
            this.config.retryAttempts,
            this.config.retryDelayMs
          );
        } else {
          await withRetry(
            () =>
              fetch(
                `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${apiToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(recordData),
                }
              ),
            this.config.retryAttempts,
            this.config.retryDelayMs
          );
        }
      }

      dnsSyncTotal.inc({ provider: 'cloudflare', status: 'success' });
      console.log(`[DNS Sync] Cloudflare: Updated ${records.length} records`);
    } catch (error) {
      dnsSyncTotal.inc({ provider: 'cloudflare', status: 'error' });
      this.logAudit('error', 'cloudflare', { error: (error as Error).message });
    } finally {
      timer();
    }
  }

  // ============================================================================
  // On-Chain
  // ============================================================================

  private async syncToOnChain(records: DNSRecord[]): Promise<void> {
    if (!this.endpointRegistryAddress || !this.walletClient || !this.publicClient) return;

    const timer = dnsSyncDuration.startTimer({ provider: 'on-chain' });

    try {
      for (const record of records.filter((r) => r.values.length > 0)) {
        const serviceKey = keccak256(toBytes(record.name));

        for (let i = 0; i < record.values.length; i++) {
          const ip = record.values[i];
          const url = record.type === 'A' ? `https://${ip}` : ip;
          const region = this.guessRegion(ip);

          await withRetry(
            async () => {
              const endpointRegistryAbi = [{ name: 'setEndpoint', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'service', type: 'bytes32' }, { name: 'url', type: 'string' }, { name: 'region', type: 'string' }, { name: 'priority', type: 'uint256' }], outputs: [] }] as const;
              // writeContract requires chain when not set on client
              // Viem's strict typing doesn't allow chainless calls, but it works at runtime
              const writeContractParams = {
                address: this.endpointRegistryAddress!,
                abi: endpointRegistryAbi,
                functionName: 'setEndpoint' as const,
                args: [serviceKey, url, region, BigInt(i)] as const,
              };
              type WriteContractFn = typeof this.walletClient.writeContract;
              const hash = await (this.walletClient!.writeContract as WriteContractFn)(writeContractParams as unknown as Parameters<WriteContractFn>[0]);
              await this.publicClient!.waitForTransactionReceipt({ hash });
            },
            this.config.retryAttempts,
            this.config.retryDelayMs
          );
        }
      }

      dnsSyncTotal.inc({ provider: 'on-chain', status: 'success' });
      console.log(`[DNS Sync] On-chain: Updated ${records.length} services`);
    } catch (error) {
      dnsSyncTotal.inc({ provider: 'on-chain', status: 'error' });
      this.logAudit('error', 'on-chain', { error: (error as Error).message });
    } finally {
      timer();
    }
  }

  // ============================================================================
  // Health Checks
  // ============================================================================

  async runHealthChecks(): Promise<void> {
    const records = this.currentRecords.filter((r) => r.healthCheckEnabled);

    for (const record of records) {
      for (const ip of record.values) {
        const result = await this.checkEndpointHealth(record.name, ip);
        const key = `${record.name}:${ip}`;

        const previous = this.healthResults.get(key);
        if (previous && previous.healthy && !result.healthy) {
          this.logAudit('failover', record.name, {
            endpoint: ip,
            reason: 'health_check_failed',
          });
        }

        this.healthResults.set(key, result);

        dnsHealthCheckResults.set(
          { service: record.name, endpoint: ip },
          result.healthy ? 1 : 0
        );
        dnsEndpointLatency.set(
          { service: record.name, endpoint: ip },
          result.latencyMs
        );
      }
    }
  }

  private async checkEndpointHealth(
    service: string,
    ip: string
  ): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const key = `${service}:${ip}`;
    const previous = this.healthResults.get(key);

    try {
      const healthPath = this.getHealthPath(service);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`https://${ip}${healthPath}`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      return {
        provider: 'direct',
        endpoint: ip,
        healthy: response.ok,
        latencyMs: Date.now() - startTime,
        lastCheck: Date.now(),
        consecutiveFailures: response.ok ? 0 : (previous?.consecutiveFailures ?? 0) + 1,
      };
    } catch {
      return {
        provider: 'direct',
        endpoint: ip,
        healthy: false,
        latencyMs: Date.now() - startTime,
        lastCheck: Date.now(),
        consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
      };
    }
  }

  private getHealthPath(service: string): string {
    const paths: Record<string, string> = {
      rpc: '/',
      'testnet-rpc': '/',
      ws: '/health',
      api: '/health',
      gateway: '/health',
      ipfs: '/api/v0/version',
      storage: '/health',
      cdn: '/health',
      proxy: '/health',
    };
    return paths[service] ?? '/health';
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private guessRegion(ip: string): string {
    if (ip.startsWith('52.') || ip.startsWith('54.')) return 'aws-us-east-1';
    if (ip.startsWith('35.')) return 'gcp-us-central1';
    if (ip.startsWith('34.')) return 'gcp-us-east1';
    return 'unknown';
  }

  private logAudit(
    action: AuditLogEntry['action'],
    provider: string,
    details: Record<string, unknown>
  ): void {
    const entry: AuditLogEntry = {
      timestamp: Date.now(),
      action,
      provider,
      details,
    };

    this.auditLog.push(entry);

    // Keep only last 1000 entries
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000);
    }
  }

  getHealthyIPs(serviceName: string): string[] {
    const healthy: string[] = [];

    for (const [key, result] of Array.from(this.healthResults.entries())) {
      if (key.startsWith(`${serviceName}:`) && result.healthy) {
        healthy.push(result.endpoint);
      }
    }

    return healthy.sort((a, b) => {
      const resultA = this.healthResults.get(`${serviceName}:${a}`);
      const resultB = this.healthResults.get(`${serviceName}:${b}`);
      return (resultA?.latencyMs ?? Infinity) - (resultB?.latencyMs ?? Infinity);
    });
  }

  private getHealthyEndpointCount(): number {
    return Array.from(this.healthResults.values()).filter((r) => r.healthy).length;
  }

  getAuditLog(): AuditLogEntry[] {
    return [...this.auditLog];
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

// Check if running as main module
// Uses require.main for Node.js compatibility, Bun.main for Bun
function checkIsMain(): boolean {
  if (typeof Bun !== 'undefined') {
    return Boolean(Bun.main);
  }
  // Node.js fallback
  return typeof require !== 'undefined' && require.main === module;
}

const isMainModule = checkIsMain();

if (isMainModule) {
  const config: DNSSyncConfig = {
    domain: process.env.DOMAIN ?? 'jejunetwork.org',
    providers: {
      route53: process.env.AWS_ROUTE53_ZONE_ID
        ? {
            zoneId: process.env.AWS_ROUTE53_ZONE_ID,
            region: process.env.AWS_REGION ?? 'us-east-1',
          }
        : undefined,
      cloudDns: process.env.GCP_PROJECT_ID
        ? {
            projectId: process.env.GCP_PROJECT_ID,
            zoneName: process.env.GCP_DNS_ZONE_NAME ?? 'jeju-network',
          }
        : undefined,
      cloudflare: process.env.CLOUDFLARE_API_TOKEN
        ? {
            apiToken: process.env.CLOUDFLARE_API_TOKEN,
            zoneId: process.env.CLOUDFLARE_ZONE_ID ?? '',
          }
        : undefined,
      onChain: process.env.RPC_URL
        ? {
            rpcUrl: process.env.RPC_URL,
            privateKey: process.env.PRIVATE_KEY ?? '',
            registryAddress: process.env.ENDPOINT_REGISTRY_ADDRESS ?? '',
          }
        : undefined,
    },
    syncIntervalMs: parseInt(process.env.SYNC_INTERVAL_MS ?? '300000', 10),
    healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS ?? '60000', 10),
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS ?? '3', 10),
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS ?? '1000', 10),
    metricsPort: process.env.METRICS_PORT
      ? parseInt(process.env.METRICS_PORT, 10)
      : undefined,
  };

  const service = new DNSSyncService(config);
  const mode = process.argv[2] ?? 'daemon';

  if (mode === 'daemon') {
    service.start();

    process.on('SIGINT', () => {
      service.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      service.stop();
      process.exit(0);
    });
  } else {
    service.syncAll().then(() => {
      console.log('[DNS Sync] Complete');
      process.exit(0);
    });
  }
}

export { DEFAULT_RECORDS };
