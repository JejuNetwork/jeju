/**
 * DNS Sync Service
 * 
 * Keeps DNS records in sync across multiple providers:
 * - AWS Route53
 * - GCP Cloud DNS
 * - Cloudflare
 * 
 * Also updates on-chain endpoint registry for decentralized fallback.
 */

import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
  type ResourceRecordSet,
} from '@aws-sdk/client-route-53';
import { DNS } from '@google-cloud/dns';
import { ethers } from 'ethers';

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

export interface DNSProviderConfig {
  route53?: {
    zoneId: string;
    region: string;
  };
  cloudDns?: {
    projectId: string;
    zoneName: string;
  };
  cloudflare?: {
    apiToken: string;
    zoneId: string;
  };
  onChain?: {
    rpcUrl: string;
    privateKey: string;
    registryAddress: string;
  };
}

export interface HealthCheckResult {
  provider: string;
  endpoint: string;
  healthy: boolean;
  latencyMs: number;
  lastCheck: number;
}

// ============================================================================
// DNS Records Configuration
// ============================================================================

const DEFAULT_RECORDS: DNSRecord[] = [
  // RPC endpoints
  { name: 'rpc', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
  { name: 'testnet-rpc', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
  
  // WebSocket endpoints
  { name: 'ws', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
  { name: 'testnet-ws', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
  
  // API endpoints
  { name: 'api', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
  
  // Gateway
  { name: 'gateway', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
  
  // Storage/IPFS
  { name: 'ipfs', type: 'A', ttl: 300, values: [], healthCheckEnabled: true },
  { name: 'storage', type: 'A', ttl: 300, values: [], healthCheckEnabled: true },
  
  // CDN edge (Cloudflare-proxied or direct)
  { name: 'cdn', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
  
  // Proxy coordinator
  { name: 'proxy', type: 'A', ttl: 60, values: [], healthCheckEnabled: true },
];

// ============================================================================
// Endpoint Registry ABI
// ============================================================================

const ENDPOINT_REGISTRY_ABI = [
  'function setEndpoint(bytes32 service, string url, string region, uint256 priority) external',
  'function removeEndpoint(bytes32 service, string url) external',
  'function getEndpoints(bytes32 service) view returns (tuple(string url, string region, uint256 priority, bool active)[])',
  'event EndpointUpdated(bytes32 indexed service, string url, string region, uint256 priority)',
];

// ============================================================================
// DNS Sync Service
// ============================================================================

export class DNSSyncService {
  private config: DNSProviderConfig;
  private domain: string;
  private route53Client: Route53Client | null = null;
  private cloudDnsClient: DNS | null = null;
  private endpointRegistry: ethers.Contract | null = null;
  private healthCheckResults: Map<string, HealthCheckResult> = new Map();
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(domain: string, config: DNSProviderConfig) {
    this.domain = domain;
    this.config = config;

    // Initialize clients
    if (config.route53) {
      this.route53Client = new Route53Client({ region: config.route53.region });
    }

    if (config.cloudDns) {
      this.cloudDnsClient = new DNS({ projectId: config.cloudDns.projectId });
    }

    if (config.onChain) {
      const provider = new ethers.JsonRpcProvider(config.onChain.rpcUrl);
      const wallet = new ethers.Wallet(config.onChain.privateKey, provider);
      this.endpointRegistry = new ethers.Contract(
        config.onChain.registryAddress,
        ENDPOINT_REGISTRY_ABI,
        wallet
      );
    }
  }

  /**
   * Start the sync service
   */
  async start(intervalMs = 300000): Promise<void> {
    console.log('[DNS Sync] Starting service...');

    // Initial sync
    await this.syncAll();

    // Periodic sync
    this.syncInterval = setInterval(async () => {
      await this.syncAll();
    }, intervalMs);

    console.log(`[DNS Sync] Running, interval: ${intervalMs}ms`);
  }

  /**
   * Stop the sync service
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    console.log('[DNS Sync] Stopped');
  }

  /**
   * Sync all DNS records across providers
   */
  async syncAll(): Promise<void> {
    console.log('[DNS Sync] Starting sync...');

    // Get current records from primary (Route53)
    const primaryRecords = await this.getRecordsFromRoute53();

    // Sync to other providers
    await Promise.all([
      this.syncToCloudDns(primaryRecords),
      this.syncToCloudflare(primaryRecords),
      this.syncToOnChain(primaryRecords),
    ]);

    console.log('[DNS Sync] Sync complete');
  }

  /**
   * Health check all endpoints
   */
  async runHealthChecks(records: DNSRecord[]): Promise<Map<string, HealthCheckResult[]>> {
    const results = new Map<string, HealthCheckResult[]>();

    for (const record of records) {
      if (!record.healthCheckEnabled) continue;

      const endpointResults: HealthCheckResult[] = [];

      for (const ip of record.values) {
        const result = await this.checkEndpointHealth(record.name, ip);
        endpointResults.push(result);
        this.healthCheckResults.set(`${record.name}:${ip}`, result);
      }

      results.set(record.name, endpointResults);
    }

    return results;
  }

  /**
   * Get healthy IPs for a service
   */
  getHealthyIPs(serviceName: string): string[] {
    const healthy: string[] = [];

    for (const [key, result] of this.healthCheckResults) {
      if (key.startsWith(`${serviceName}:`) && result.healthy) {
        healthy.push(result.endpoint);
      }
    }

    // Sort by latency
    return healthy.sort((a, b) => {
      const resultA = this.healthCheckResults.get(`${serviceName}:${a}`);
      const resultB = this.healthCheckResults.get(`${serviceName}:${b}`);
      return (resultA?.latencyMs ?? Infinity) - (resultB?.latencyMs ?? Infinity);
    });
  }

  // ============================================================================
  // Route53
  // ============================================================================

  private async getRecordsFromRoute53(): Promise<DNSRecord[]> {
    if (!this.route53Client || !this.config.route53) {
      return [];
    }

    const records: DNSRecord[] = [];

    // This is simplified - in production, use ListResourceRecordSets
    // and paginate through all records

    return records;
  }

  private async syncToRoute53(records: DNSRecord[]): Promise<void> {
    if (!this.route53Client || !this.config.route53) return;

    const changes = records.map((record) => ({
      Action: 'UPSERT' as const,
      ResourceRecordSet: {
        Name: `${record.name}.${this.domain}`,
        Type: record.type,
        TTL: record.ttl,
        ResourceRecords: record.values.map((v) => ({ Value: v })),
      },
    }));

    if (changes.length === 0) return;

    await this.route53Client.send(
      new ChangeResourceRecordSetsCommand({
        HostedZoneId: this.config.route53.zoneId,
        ChangeBatch: { Changes: changes },
      })
    );

    console.log(`[DNS Sync] Route53: Updated ${changes.length} records`);
  }

  // ============================================================================
  // Cloud DNS
  // ============================================================================

  private async syncToCloudDns(records: DNSRecord[]): Promise<void> {
    if (!this.cloudDnsClient || !this.config.cloudDns) return;

    const zone = this.cloudDnsClient.zone(this.config.cloudDns.zoneName);

    for (const record of records) {
      const gcloudRecord = zone.record(record.type.toLowerCase() as 'a' | 'aaaa' | 'cname', {
        name: `${record.name}.${this.domain}.`,
        ttl: record.ttl,
        data: record.values,
      });

      await zone.addRecords(gcloudRecord).catch((err: Error) => {
        // Record might already exist, try to modify
        return zone.replaceRecords(record.type.toLowerCase() as 'a' | 'aaaa' | 'cname', gcloudRecord);
      });
    }

    console.log(`[DNS Sync] Cloud DNS: Updated ${records.length} records`);
  }

  // ============================================================================
  // Cloudflare
  // ============================================================================

  private async syncToCloudflare(records: DNSRecord[]): Promise<void> {
    if (!this.config.cloudflare) return;

    const { apiToken, zoneId } = this.config.cloudflare;

    for (const record of records) {
      // Get existing record
      const listResponse = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${record.name}.${this.domain}&type=${record.type}`,
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const listData = await listResponse.json() as { result: Array<{ id: string }> };
      const existingRecord = listData.result[0];

      // For A records with multiple IPs, Cloudflare needs separate records
      // For simplicity, using first IP here
      const recordData = {
        type: record.type,
        name: record.name,
        content: record.values[0],
        ttl: record.ttl,
        proxied: record.name === 'cdn', // Only proxy CDN
      };

      if (existingRecord) {
        // Update existing
        await fetch(
          `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${existingRecord.id}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(recordData),
          }
        );
      } else {
        // Create new
        await fetch(
          `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(recordData),
          }
        );
      }
    }

    console.log(`[DNS Sync] Cloudflare: Updated ${records.length} records`);
  }

  // ============================================================================
  // On-Chain Registry
  // ============================================================================

  private async syncToOnChain(records: DNSRecord[]): Promise<void> {
    if (!this.endpointRegistry) return;

    for (const record of records) {
      const serviceKey = ethers.id(record.name);

      for (let i = 0; i < record.values.length; i++) {
        const ip = record.values[i];
        const url = record.type === 'A' 
          ? `https://${ip}` 
          : ip;
        
        // Determine region from IP (simplified)
        const region = this.guessRegion(ip);

        await this.endpointRegistry.setEndpoint(
          serviceKey,
          url,
          region,
          i // Priority based on order
        );
      }
    }

    console.log(`[DNS Sync] On-chain: Updated ${records.length} service endpoints`);
  }

  // ============================================================================
  // Health Checks
  // ============================================================================

  private async checkEndpointHealth(
    service: string,
    ip: string
  ): Promise<HealthCheckResult> {
    const startTime = Date.now();
    let healthy = false;

    const healthPath = this.getHealthPath(service);
    const url = `https://${ip}${healthPath}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
        // Skip SSL verification for direct IP access
        // In production, use proper certificates
      });

      healthy = response.ok;
    } catch {
      healthy = false;
    }

    return {
      provider: 'direct',
      endpoint: ip,
      healthy,
      latencyMs: Date.now() - startTime,
      lastCheck: Date.now(),
    };
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

  private guessRegion(ip: string): string {
    // In production, use GeoIP database
    // For now, return based on IP range patterns
    if (ip.startsWith('52.') || ip.startsWith('54.')) return 'aws-us-east-1';
    if (ip.startsWith('35.')) return 'gcp-us-central1';
    if (ip.startsWith('34.')) return 'gcp-us-east1';
    return 'unknown';
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.main) {
  const domain = process.env.DOMAIN ?? 'jejunetwork.org';
  
  const config: DNSProviderConfig = {
    route53: process.env.AWS_ROUTE53_ZONE_ID ? {
      zoneId: process.env.AWS_ROUTE53_ZONE_ID,
      region: process.env.AWS_REGION ?? 'us-east-1',
    } : undefined,
    cloudDns: process.env.GCP_PROJECT_ID ? {
      projectId: process.env.GCP_PROJECT_ID,
      zoneName: process.env.GCP_DNS_ZONE_NAME ?? 'jeju-network',
    } : undefined,
    cloudflare: process.env.CLOUDFLARE_API_TOKEN ? {
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      zoneId: process.env.CLOUDFLARE_ZONE_ID ?? '',
    } : undefined,
    onChain: process.env.RPC_URL ? {
      rpcUrl: process.env.RPC_URL,
      privateKey: process.env.PRIVATE_KEY ?? '',
      registryAddress: process.env.ENDPOINT_REGISTRY_ADDRESS ?? '',
    } : undefined,
  };

  const service = new DNSSyncService(domain, config);

  // Run once or start daemon
  const mode = process.argv[2] ?? 'once';

  if (mode === 'daemon') {
    service.start(parseInt(process.env.SYNC_INTERVAL_MS ?? '300000'));

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

