import { describe, expect, it } from 'bun:test'
import {
  DeploymentStatusSchema,
  WorkerStatusSchema,
  CloudProviderSchema,
  AWSConfigSchema,
  KubernetesNamespaceSchema,
  HelmReleaseSchema,
  PrometheusConfigSchema,
  GrafanaConfigSchema,
  LokiConfigSchema,
  VaultConfigSchema,
  SubsquidConfigSchema,
  MonitoringAlertsSchema,
} from '../infrastructure'

describe('Infrastructure Types', () => {
  describe('DeploymentStatusSchema', () => {
    it('validates all deployment statuses', () => {
      const statuses = ['pending', 'building', 'deploying', 'running', 'stopped', 'error']
      for (const status of statuses) {
        expect(DeploymentStatusSchema.parse(status)).toBe(status)
      }
    })
  })

  describe('WorkerStatusSchema', () => {
    it('validates all worker statuses', () => {
      const statuses = ['pending', 'deploying', 'active', 'inactive', 'error']
      for (const status of statuses) {
        expect(WorkerStatusSchema.parse(status)).toBe(status)
      }
    })
  })

  describe('CloudProviderSchema', () => {
    it('validates all cloud providers', () => {
      const providers = ['aws', 'gcp', 'azure']
      for (const provider of providers) {
        expect(CloudProviderSchema.parse(provider)).toBe(provider)
      }
    })
  })

  describe('AWSConfigSchema', () => {
    it('validates AWS configuration', () => {
      const config = {
        region: 'us-east-1',
        accountId: '123456789012',
        vpcCidr: '10.0.0.0/16',
        availabilityZones: ['us-east-1a', 'us-east-1b', 'us-east-1c'],
        eksClusterName: 'jeju-cluster',
        eksVersion: '1.28',
        nodeGroups: [
          {
            name: 'default',
            instanceType: 'm5.large',
            minSize: 2,
            maxSize: 10,
            desiredSize: 3,
            diskSize: 100,
            labels: { role: 'worker' },
            taints: [
              { key: 'dedicated', value: 'compute', effect: 'NoSchedule' },
            ],
          },
        ],
        rdsConfig: {
          instanceClass: 'db.r5.large',
          engine: 'postgres',
          engineVersion: '15.3',
          allocatedStorage: 100,
          maxAllocatedStorage: 500,
          multiAz: true,
        },
        kmsKeyAlias: 'alias/jeju-key',
      }
      expect(() => AWSConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('KubernetesNamespaceSchema', () => {
    it('validates Kubernetes namespace', () => {
      const namespace = {
        name: 'production',
        labels: { env: 'prod', team: 'platform' },
        annotations: { description: 'Production namespace' },
        resourceQuota: {
          requests: { cpu: '10', memory: '20Gi' },
          limits: { cpu: '20', memory: '40Gi' },
        },
      }
      expect(() => KubernetesNamespaceSchema.parse(namespace)).not.toThrow()
    })

    it('validates minimal namespace', () => {
      const namespace = {
        name: 'test',
      }
      expect(() => KubernetesNamespaceSchema.parse(namespace)).not.toThrow()
    })
  })

  describe('HelmReleaseSchema', () => {
    it('validates Helm release', () => {
      const release = {
        name: 'nginx-ingress',
        namespace: 'ingress',
        chart: 'ingress-nginx',
        version: '4.7.1',
        repository: 'https://kubernetes.github.io/ingress-nginx',
        values: {
          controller: {
            replicas: 3,
            metrics: { enabled: true },
          },
          serviceType: 'LoadBalancer',
        },
        dependencies: ['cert-manager'],
      }
      expect(() => HelmReleaseSchema.parse(release)).not.toThrow()
    })

    it('validates Helm release with nested values', () => {
      const release = {
        name: 'prometheus',
        namespace: 'monitoring',
        chart: 'prometheus',
        version: '15.0.0',
        values: {
          server: {
            retention: '15d',
            resources: {
              requests: { cpu: '500m', memory: '1Gi' },
              limits: { cpu: '1000m', memory: '2Gi' },
            },
          },
          alertmanager: { enabled: true },
          pushgateway: { enabled: false },
        },
      }
      expect(() => HelmReleaseSchema.parse(release)).not.toThrow()
    })
  })

  describe('PrometheusConfigSchema', () => {
    it('validates Prometheus configuration', () => {
      const config = {
        retention: '30d',
        scrapeInterval: '15s',
        scrapeTimeout: '10s',
        replicas: 2,
        storageSize: '100Gi',
        resources: {
          requests: { cpu: '500m', memory: '2Gi' },
          limits: { cpu: '1000m', memory: '4Gi' },
        },
      }
      expect(() => PrometheusConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('GrafanaConfigSchema', () => {
    it('validates Grafana configuration', () => {
      const config = {
        adminPassword: 'secure-password',
        replicas: 2,
        persistence: true,
        storageSize: '10Gi',
        datasources: [
          {
            name: 'Prometheus',
            type: 'prometheus',
            url: 'http://prometheus:9090',
            access: 'proxy',
            isDefault: true,
          },
          {
            name: 'Loki',
            type: 'loki',
            url: 'http://loki:3100',
            access: 'proxy',
            isDefault: false,
          },
        ],
      }
      expect(() => GrafanaConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('LokiConfigSchema', () => {
    it('validates Loki configuration', () => {
      const config = {
        replicas: 3,
        retention: '7d',
        storageSize: '50Gi',
        resources: {
          requests: { cpu: '250m', memory: '512Mi' },
          limits: { cpu: '500m', memory: '1Gi' },
        },
      }
      expect(() => LokiConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('VaultConfigSchema', () => {
    it('validates Vault configuration', () => {
      const config = {
        replicas: 3,
        storage: 'raft',
        transitEnabled: true,
        kmsSealEnabled: true,
        policies: [
          {
            name: 'app-secrets',
            path: 'secret/data/app/*',
            capabilities: ['read', 'list'],
          },
          {
            name: 'admin',
            path: 'secret/*',
            capabilities: ['create', 'read', 'update', 'delete', 'list'],
          },
        ],
      }
      expect(() => VaultConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('SubsquidConfigSchema', () => {
    it('validates Subsquid configuration', () => {
      const config = {
        database: {
          host: 'postgres.default.svc.cluster.local',
          port: 5432,
          name: 'squid',
          username: 'squid',
        },
        rpcUrl: 'https://eth-mainnet.example.com',
        wsUrl: 'wss://eth-mainnet.example.com',
        startBlock: 17000000,
        batchSize: 500,
        replicas: {
          processor: 2,
          api: 3,
        },
        resources: {
          processor: {
            requests: { cpu: '500m', memory: '1Gi' },
            limits: { cpu: '1000m', memory: '2Gi' },
          },
          api: {
            requests: { cpu: '250m', memory: '512Mi' },
            limits: { cpu: '500m', memory: '1Gi' },
          },
        },
      }
      expect(() => SubsquidConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('MonitoringAlertsSchema', () => {
    it('validates monitoring alerts configuration', () => {
      const alerts = {
        sequencerDown: {
          enabled: true,
          threshold: '5m',
          severity: 'critical',
          channels: ['pagerduty', 'slack-oncall'],
        },
        batcherLag: {
          enabled: true,
          thresholdSeconds: 300,
          severity: 'warning',
          channels: ['slack-alerts'],
        },
        proposerGap: {
          enabled: true,
          thresholdEpochs: 2,
          severity: 'critical',
          channels: ['pagerduty'],
        },
        rpcLatency: {
          enabled: true,
          p95ThresholdMs: 500,
          severity: 'warning',
          channels: ['slack-alerts'],
        },
        chainlinkStaleness: {
          enabled: true,
          thresholdMultiplier: 2,
          severity: 'critical',
          channels: ['pagerduty', 'slack-oncall'],
        },
      }
      expect(() => MonitoringAlertsSchema.parse(alerts)).not.toThrow()
    })

    it('validates alerts with info severity', () => {
      const alerts = {
        sequencerDown: {
          enabled: false,
          threshold: '10m',
          severity: 'info',
          channels: [],
        },
        batcherLag: {
          enabled: false,
          thresholdSeconds: 600,
          severity: 'info',
          channels: [],
        },
        proposerGap: {
          enabled: false,
          thresholdEpochs: 5,
          severity: 'info',
          channels: [],
        },
        rpcLatency: {
          enabled: false,
          p95ThresholdMs: 1000,
          severity: 'info',
          channels: [],
        },
        chainlinkStaleness: {
          enabled: false,
          thresholdMultiplier: 3,
          severity: 'info',
          channels: [],
        },
      }
      expect(() => MonitoringAlertsSchema.parse(alerts)).not.toThrow()
    })
  })
})

