import { z } from 'zod';
import { NetworkSchema, type NetworkType } from './chain';

// Re-export NetworkSchema as Environment for backward compatibility
export { NetworkSchema as EnvironmentSchema };
export type Environment = NetworkType;

// ============ Deployment & Infrastructure Status Types ============

/**
 * Deployment status for containers, workers, and infrastructure
 * Consolidates deployment status definitions across the codebase
 */
export const DeploymentStatusSchema = z.enum([
  'pending',    // Waiting to start
  'building',   // Building image/bundle
  'deploying',  // Deploying to infrastructure
  'running',    // Successfully running
  'stopped',    // Stopped (not failed)
  'error',      // Deployment failed
]);
export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>;

/**
 * Worker status (similar to DeploymentStatus but worker-specific)
 * Consolidates worker status definitions
 */
export const WorkerStatusSchema = z.enum([
  'pending',    // Waiting to start
  'deploying',  // Currently deploying
  'active',     // Running and accepting requests
  'inactive',   // Stopped but not failed
  'error',      // Worker failed
]);
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

// ============ Cloud Provider Types ============

export const CloudProviderSchema = z.enum(['aws', 'gcp', 'azure']);
export type CloudProvider = z.infer<typeof CloudProviderSchema>;

export const AWSConfigSchema = z.object({
  region: z.string(),
  accountId: z.string(),
  vpcCidr: z.string(),
  availabilityZones: z.array(z.string()),
  eksClusterName: z.string(),
  eksVersion: z.string(),
  nodeGroups: z.array(z.object({
    name: z.string(),
    instanceType: z.string(),
    minSize: z.number(),
    maxSize: z.number(),
    desiredSize: z.number(),
    diskSize: z.number(),
    labels: z.record(z.string(), z.string()).optional(),
    taints: z.array(z.object({
      key: z.string(),
      value: z.string(),
      effect: z.enum(['NoSchedule', 'PreferNoSchedule', 'NoExecute']),
    })).optional(),
  })),
  rdsConfig: z.object({
    instanceClass: z.string(),
    engine: z.string(),
    engineVersion: z.string(),
    allocatedStorage: z.number(),
    maxAllocatedStorage: z.number(),
    multiAz: z.boolean(),
  }),
  kmsKeyAlias: z.string(),
});
export type AWSConfig = z.infer<typeof AWSConfigSchema>;

export const KubernetesNamespaceSchema = z.object({
  name: z.string(),
  labels: z.record(z.string(), z.string()).optional(),
  annotations: z.record(z.string(), z.string()).optional(),
  resourceQuota: z.object({
    requests: z.object({
      cpu: z.string(),
      memory: z.string(),
    }).optional(),
    limits: z.object({
      cpu: z.string(),
      memory: z.string(),
    }).optional(),
  }).optional(),
});
export type KubernetesNamespace = z.infer<typeof KubernetesNamespaceSchema>;

/**
 * Helm chart value types - JSON-serializable values only
 * Supports nested objects but with strongly typed leaves
 */
const HelmValuePrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

// Define a recursive type for Helm values
type HelmValue = string | number | boolean | null | HelmValue[] | { [key: string]: HelmValue };

const HelmValueSchema: z.ZodType<HelmValue> = z.lazy(() =>
  z.union([
    HelmValuePrimitiveSchema,
    z.array(HelmValueSchema),
    z.record(z.string(), HelmValueSchema),
  ])
);

export const HelmReleaseSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  chart: z.string(),
  version: z.string(),
  repository: z.string().optional(),
  /** Helm chart values - supports nested objects/arrays with JSON-serializable leaves */
  values: z.record(z.string(), HelmValueSchema),
  dependencies: z.array(z.string()).optional(),
});
export type HelmRelease = z.infer<typeof HelmReleaseSchema>;

export const PrometheusConfigSchema = z.object({
  retention: z.string(),
  scrapeInterval: z.string(),
  scrapeTimeout: z.string(),
  replicas: z.number(),
  storageSize: z.string(),
  resources: z.object({
    requests: z.object({
      cpu: z.string(),
      memory: z.string(),
    }),
    limits: z.object({
      cpu: z.string(),
      memory: z.string(),
    }),
  }),
});
export type PrometheusConfig = z.infer<typeof PrometheusConfigSchema>;

export const GrafanaConfigSchema = z.object({
  adminPassword: z.string(),
  replicas: z.number(),
  persistence: z.boolean(),
  storageSize: z.string(),
  datasources: z.array(z.object({
    name: z.string(),
    type: z.string(),
    url: z.string(),
    access: z.string(),
    isDefault: z.boolean(),
  })),
});
export type GrafanaConfig = z.infer<typeof GrafanaConfigSchema>;

export const LokiConfigSchema = z.object({
  replicas: z.number(),
  retention: z.string(),
  storageSize: z.string(),
  resources: z.object({
    requests: z.object({
      cpu: z.string(),
      memory: z.string(),
    }),
    limits: z.object({
      cpu: z.string(),
      memory: z.string(),
    }),
  }),
});
export type LokiConfig = z.infer<typeof LokiConfigSchema>;

export const VaultConfigSchema = z.object({
  replicas: z.number(),
  storage: z.string(),
  transitEnabled: z.boolean(),
  kmsSealEnabled: z.boolean(),
  policies: z.array(z.object({
    name: z.string(),
    path: z.string(),
    capabilities: z.array(z.string()),
  })),
});
export type VaultConfig = z.infer<typeof VaultConfigSchema>;

export const SubsquidConfigSchema = z.object({
  database: z.object({
    host: z.string(),
    port: z.number(),
    name: z.string(),
    username: z.string(),
  }),
  rpcUrl: z.string(),
  wsUrl: z.string().optional(),
  startBlock: z.number(),
  batchSize: z.number(),
  replicas: z.object({
    processor: z.number(),
    api: z.number(),
  }),
  resources: z.object({
    processor: z.object({
      requests: z.object({
        cpu: z.string(),
        memory: z.string(),
      }),
      limits: z.object({
        cpu: z.string(),
        memory: z.string(),
      }),
    }),
    api: z.object({
      requests: z.object({
        cpu: z.string(),
        memory: z.string(),
      }),
      limits: z.object({
        cpu: z.string(),
        memory: z.string(),
      }),
    }),
  }),
});
export type SubsquidConfig = z.infer<typeof SubsquidConfigSchema>;

export const MonitoringAlertsSchema = z.object({
  sequencerDown: z.object({
    enabled: z.boolean(),
    threshold: z.string(),
    severity: z.enum(['critical', 'warning', 'info']),
    channels: z.array(z.string()),
  }),
  batcherLag: z.object({
    enabled: z.boolean(),
    thresholdSeconds: z.number(),
    severity: z.enum(['critical', 'warning', 'info']),
    channels: z.array(z.string()),
  }),
  proposerGap: z.object({
    enabled: z.boolean(),
    thresholdEpochs: z.number(),
    severity: z.enum(['critical', 'warning', 'info']),
    channels: z.array(z.string()),
  }),
  rpcLatency: z.object({
    enabled: z.boolean(),
    p95ThresholdMs: z.number(),
    severity: z.enum(['critical', 'warning', 'info']),
    channels: z.array(z.string()),
  }),
  chainlinkStaleness: z.object({
    enabled: z.boolean(),
    thresholdMultiplier: z.number(),
    severity: z.enum(['critical', 'warning', 'info']),
    channels: z.array(z.string()),
  }),
});
export type MonitoringAlerts = z.infer<typeof MonitoringAlertsSchema>;


