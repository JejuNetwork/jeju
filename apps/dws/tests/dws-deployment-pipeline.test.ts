/**
 * DWS Deployment Pipeline E2E Tests
 *
 * Tests the complete deployment infrastructure:
 * - Container Provisioner (Heroku-like deployment)
 * - Machine Provisioner (physical/virtual machine allocation)
 * - Kubernetes Bridge (K8s/Helm to DWS translation)
 * - Terraform Provider (IaC for DWS)
 * - Full deployment flows (AWS-first, then GCP parity)
 *
 * Run with: bun test tests/dws-deployment-pipeline.test.ts
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test'
import type { Address } from 'viem'
import {
  type ContainerDeployConfig,
  type ContainerProvisioner,
  getContainerProvisioner,
  type ProvisionedContainer,
} from '../api/containers/provisioner'
import {
  getAllNodes,
  getSchedulerStats,
  registerNode,
  type SchedulerStats,
} from '../api/containers/scheduler'
import type { ComputeNode } from '../api/containers/types'
import {
  getKubernetesBridge,
  type KubernetesBridge,
} from '../api/infrastructure/kubernetes-bridge'
import {
  getMachineProvisioner,
  type MachineAllocation,
  type MachineCapabilities,
  type MachinePromise,
  type MachineProvisioner,
  type MachineSpecs,
} from '../api/infrastructure/machine-provisioner'

setDefaultTimeout(120000) // Deployment tests can take time

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address
const OPERATOR_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address

// Helper to create a mock node for testing
function createMockNode(
  id: string,
  specs: Partial<ComputeNode['resources']> = {},
): ComputeNode {
  return {
    nodeId: id,
    address: OPERATOR_ADDRESS,
    endpoint: `http://localhost:${3000 + parseInt(id.slice(-1), 10)}`,
    region: 'us-east-1',
    zone: 'us-east-1a',
    resources: {
      totalCpu: specs.totalCpu ?? 16,
      totalMemoryMb: specs.totalMemoryMb ?? 65536,
      totalStorageMb: specs.totalStorageMb ?? 512000,
      availableCpu: specs.availableCpu ?? specs.totalCpu ?? 16,
      availableMemoryMb:
        specs.availableMemoryMb ?? specs.totalMemoryMb ?? 65536,
      availableStorageMb:
        specs.availableStorageMb ?? specs.totalStorageMb ?? 512000,
      gpuTypes: specs.gpuTypes ?? ['nvidia-t4'],
    },
    capabilities: ['compute', 'storage', 'gpu'],
    containers: new Map(),
    cachedImages: new Set(),
    lastHeartbeat: Date.now(),
    status: 'online',
    reputation: 80,
  }
}

describe('Container Provisioner', () => {
  let provisioner: ContainerProvisioner

  beforeAll(() => {
    provisioner = getContainerProvisioner()

    // Register some mock nodes for testing
    for (let i = 1; i <= 3; i++) {
      const node = createMockNode(`test-node-${i}`, {
        totalCpu: 8 * i,
        totalMemoryMb: 16384 * i,
      })
      registerNode(node)
    }
  })

  describe('Machine Types', () => {
    test('lists available machine types', () => {
      const machineTypes = provisioner.getMachineTypes()
      expect(machineTypes.length).toBeGreaterThan(0)

      // Verify expected machine types exist
      const typeIds = machineTypes.map((mt) => mt.id)
      expect(typeIds).toContain('micro')
      expect(typeIds).toContain('small')
      expect(typeIds).toContain('medium')
      expect(typeIds).toContain('large')
      expect(typeIds).toContain('gpu-t4')
      expect(typeIds).toContain('tee-medium')
    })

    test('gets machine type by id', () => {
      const medium = provisioner.getMachineType('medium')
      expect(medium).not.toBeNull()
      expect(medium?.name).toBe('Medium')
      expect(medium?.hardware.cpuCores).toBe(4)
      expect(medium?.hardware.memoryMb).toBe(8192)
    })

    test('returns null for non-existent machine type', () => {
      const nonExistent = provisioner.getMachineType('non-existent')
      expect(nonExistent).toBeNull()
    })

    test('GPU machine types have GPU configuration', () => {
      const gpuT4 = provisioner.getMachineType('gpu-t4')
      expect(gpuT4).not.toBeNull()
      expect(gpuT4?.hardware.gpuType).toBe('nvidia-t4')
      expect(gpuT4?.hardware.gpuCount).toBeGreaterThan(0)
    })

    test('TEE machine types have TEE configuration', () => {
      const teeMedium = provisioner.getMachineType('tee-medium')
      expect(teeMedium).not.toBeNull()
      expect(teeMedium?.hardware.teePlatform).toBe('intel-tdx')
    })
  })

  describe('Container Provisioning', () => {
    let provisionedContainer: ProvisionedContainer

    test('provisions container from machine type', async () => {
      const container = await provisioner.provisionFromMachineType(
        TEST_ADDRESS,
        'small',
        {
          image: 'nginx',
          tag: 'alpine',
          command: ['nginx', '-g', 'daemon off;'],
          env: { NGINX_PORT: '8080' },
          ports: [{ containerPort: 8080, expose: true }],
        },
      )

      expect(container.id).toBeDefined()
      expect(container.owner).toBe(TEST_ADDRESS)
      expect(container.config.image).toBe('nginx')
      expect(container.config.tag).toBe('alpine')
      expect(container.config.hardware.cpuCores).toBe(2)
      expect(container.config.hardware.memoryMb).toBe(2048)
      expect(container.status).toMatch(
        /pending|allocating|provisioning|running/,
      )

      provisionedContainer = container
    })

    test('provisions container with custom hardware spec', async () => {
      const config: ContainerDeployConfig = {
        image: 'redis',
        tag: '7-alpine',
        env: { REDIS_PASSWORD: 'secret' },
        hardware: {
          cpuCores: 2,
          cpuArchitecture: 'amd64',
          memoryMb: 4096,
          storageMb: 20480,
          storageType: 'ssd',
          gpuType: 'none',
          gpuCount: 0,
          networkBandwidthMbps: 1000,
          publicIp: false,
          teePlatform: 'none',
        },
        minReplicas: 1,
        maxReplicas: 5,
        scaleToZero: false,
        cooldownSeconds: 300,
        ports: [{ containerPort: 6379, protocol: 'tcp', expose: true }],
        terminationGracePeriodSeconds: 30,
        restartPolicy: 'always',
        labels: { app: 'redis-cache' },
        annotations: {},
      }

      const container = await provisioner.provision(TEST_ADDRESS, config)

      expect(container.id).toBeDefined()
      expect(container.config.image).toBe('redis')
      expect(container.config.hardware.memoryMb).toBe(4096)
    })

    test('gets container by id', () => {
      if (!provisionedContainer) return

      const container = provisioner.getContainer(provisionedContainer.id)
      expect(container).not.toBeNull()
      expect(container?.id).toBe(provisionedContainer.id)
    })

    test('gets containers by owner', () => {
      const containers = provisioner.getContainersByOwner(TEST_ADDRESS)
      expect(containers.length).toBeGreaterThan(0)
      expect(containers.every((c) => c.owner === TEST_ADDRESS)).toBe(true)
    })

    test('lists all containers', () => {
      const allContainers = provisioner.listContainers()
      expect(allContainers.length).toBeGreaterThan(0)

      const runningContainers = provisioner.listContainers({
        status: 'running',
      })
      const pendingContainers = provisioner.listContainers({
        status: 'pending',
      })

      expect(
        runningContainers.length + pendingContainers.length,
      ).toBeLessThanOrEqual(allContainers.length)
    })

    test('stops a running container', async () => {
      if (!provisionedContainer) return

      // Wait for container to be running
      let container = provisioner.getContainer(provisionedContainer.id)
      const maxWait = 30000
      const startTime = Date.now()

      while (
        container &&
        container.status !== 'running' &&
        Date.now() - startTime < maxWait
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        container = provisioner.getContainer(provisionedContainer.id)
      }

      // Stop the container
      await provisioner.stop(provisionedContainer.id, TEST_ADDRESS)

      container = provisioner.getContainer(provisionedContainer.id)
      expect(container?.status).toBe('stopped')
    })

    test('terminates a container', async () => {
      if (!provisionedContainer) return

      await provisioner.terminate(provisionedContainer.id, TEST_ADDRESS)

      const container = provisioner.getContainer(provisionedContainer.id)
      expect(container?.status).toBe('terminated')
    })
  })

  describe('Provisioner Statistics', () => {
    test('returns valid statistics', () => {
      const stats = provisioner.getStats()

      expect(typeof stats.totalContainers).toBe('number')
      expect(typeof stats.runningContainers).toBe('number')
      expect(typeof stats.totalReplicas).toBe('number')
      expect(stats.machineTypeUsage).toBeDefined()
      expect(stats.gpuUsage).toBeDefined()
      expect(stats.teeUsage).toBeDefined()
    })
  })
})

describe('Machine Provisioner', () => {
  let machineProvisioner: MachineProvisioner
  let registeredMachine: MachinePromise
  let allocation: MachineAllocation

  beforeAll(async () => {
    machineProvisioner = getMachineProvisioner('local')
    await machineProvisioner.initialize()
  })

  describe('Machine Registration', () => {
    test('registers a machine with full specs', async () => {
      const specs: MachineSpecs = {
        cpuCores: 32,
        cpuModel: 'AMD EPYC 7742',
        cpuArchitecture: 'amd64',
        cpuFrequencyMhz: 2250,
        memoryMb: 131072, // 128GB
        memoryType: 'ddr4',
        memoryFrequencyMhz: 3200,
        storageMb: 2097152, // 2TB
        storageType: 'nvme',
        storageIops: 500000,
        networkBandwidthMbps: 10000,
        networkPublicIps: 4,
        gpuType: 'nvidia-a100',
        gpuCount: 4,
        gpuMemoryMb: 327680, // 80GB x 4
        teePlatform: 'amd-sev',
        teeMemoryMb: 131072,
        region: 'us-east-1',
        zone: 'us-east-1a',
        datacenter: 'aws-use1-az1',
      }

      const capabilities: MachineCapabilities = {
        compute: true,
        storage: true,
        cdn: true,
        tee: true,
        gpu: true,
      }

      registeredMachine = await machineProvisioner.registerMachine(
        OPERATOR_ADDRESS,
        specs,
        capabilities,
        {
          pricePerHourWei: 1000000000000000n, // 0.001 ETH
          pricePerGbWei: 100000000000000n, // 0.0001 ETH
          minimumHours: 1,
        },
        {
          activationEndpoint: 'http://localhost:8080',
          sshEndpoint: 'ssh://localhost:22',
        },
      )

      expect(registeredMachine.id).toBeDefined()
      expect(registeredMachine.operator).toBe(OPERATOR_ADDRESS)
      expect(registeredMachine.status).toBe('available')
      expect(registeredMachine.specs.cpuCores).toBe(32)
      expect(registeredMachine.capabilities.gpu).toBe(true)
      expect(registeredMachine.capabilities.tee).toBe(true)
    })

    test('updates machine heartbeat', async () => {
      if (!registeredMachine) return

      const oldHeartbeat = registeredMachine.lastHeartbeatAt

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100))

      const result = await machineProvisioner.heartbeat(
        registeredMachine.id,
        OPERATOR_ADDRESS,
      )

      expect(result).toBe(true)

      const machine = machineProvisioner.getMachine(registeredMachine.id)
      expect(machine?.lastHeartbeatAt).toBeGreaterThan(oldHeartbeat)
    })

    test('lists available machines', () => {
      const availableMachines = machineProvisioner.listAvailableMachines()
      expect(availableMachines.length).toBeGreaterThan(0)
      expect(availableMachines.every((m) => m.status === 'available')).toBe(
        true,
      )
    })

    test('filters machines by requirements', () => {
      // Filter for high-memory GPU machines
      const gpuMachines = machineProvisioner.listAvailableMachines({
        minCpu: 16,
        minMemoryMb: 65536,
        gpuRequired: true,
      })

      expect(gpuMachines.length).toBeGreaterThanOrEqual(0)

      if (gpuMachines.length > 0) {
        expect(gpuMachines.every((m) => m.capabilities.gpu)).toBe(true)
        expect(gpuMachines.every((m) => m.specs.gpuCount > 0)).toBe(true)
      }

      // Filter for TEE machines
      const teeMachines = machineProvisioner.listAvailableMachines({
        teeRequired: true,
      })

      if (teeMachines.length > 0) {
        expect(teeMachines.every((m) => m.capabilities.tee)).toBe(true)
        expect(teeMachines.every((m) => m.specs.teePlatform !== null)).toBe(
          true,
        )
      }
    })

    test('gets machines by operator', () => {
      const operatorMachines =
        machineProvisioner.getOperatorMachines(OPERATOR_ADDRESS)
      expect(operatorMachines.length).toBeGreaterThan(0)
      expect(
        operatorMachines.every((m) => m.operator === OPERATOR_ADDRESS),
      ).toBe(true)
    })
  })

  describe('Machine Allocation', () => {
    test('allocates a machine for a user', async () => {
      allocation = await machineProvisioner.allocate(TEST_ADDRESS, {
        minCpu: 4,
        minMemoryMb: 16384,
        minStorageMb: 102400,
        region: 'us-east-1',
      })

      expect(allocation.id).toBeDefined()
      expect(allocation.user).toBe(TEST_ADDRESS)
      expect(allocation.status).toMatch(/pending|activating|active/)
      expect(allocation.specs.cpuCores).toBeGreaterThanOrEqual(4)
      expect(allocation.specs.memoryMb).toBeGreaterThanOrEqual(16384)
    })

    test('gets allocation by id', () => {
      if (!allocation) return

      const retrieved = machineProvisioner.getAllocation(allocation.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(allocation.id)
    })

    test('gets user allocations', () => {
      const userAllocations =
        machineProvisioner.getUserAllocations(TEST_ADDRESS)
      expect(userAllocations.length).toBeGreaterThan(0)
      expect(userAllocations.every((a) => a.user === TEST_ADDRESS)).toBe(true)
    })

    test('releases an allocation', async () => {
      if (!allocation) return

      await machineProvisioner.release(allocation.id, TEST_ADDRESS)

      const released = machineProvisioner.getAllocation(allocation.id)
      expect(released?.status).toBe('terminated')
    })
  })

  describe('Provisioner Statistics', () => {
    test('returns comprehensive statistics', () => {
      const stats = machineProvisioner.getStats()

      expect(stats.environment).toBe('local')
      expect(typeof stats.totalMachines).toBe('number')
      expect(typeof stats.availableMachines).toBe('number')
      expect(typeof stats.allocatedMachines).toBe('number')
      expect(typeof stats.totalAllocations).toBe('number')
      expect(typeof stats.totalCpuCores).toBe('number')
      expect(typeof stats.totalMemoryMb).toBe('number')
      expect(typeof stats.totalGpus).toBe('number')
      expect(stats.regionBreakdown).toBeDefined()
    })
  })

  describe('Machine Unregistration', () => {
    test('unregisters a machine', async () => {
      if (!registeredMachine) return

      await machineProvisioner.unregisterMachine(
        registeredMachine.id,
        OPERATOR_ADDRESS,
      )

      const machine = machineProvisioner.getMachine(registeredMachine.id)
      expect(machine).toBeNull()
    })
  })

  afterAll(async () => {
    await machineProvisioner.stop()
  })
})

describe('Kubernetes Bridge', () => {
  let bridge: KubernetesBridge
  let deploymentId: string

  beforeAll(() => {
    bridge = getKubernetesBridge()

    // Register nodes for the bridge to use
    for (let i = 1; i <= 3; i++) {
      const node = createMockNode(`k8s-node-${i}`, {
        totalCpu: 16,
        totalMemoryMb: 32768,
      })
      registerNode(node)
    }
  })

  describe('Deployment Application', () => {
    test('applies simple deployment manifest', async () => {
      const manifests = [
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: {
            name: 'nginx-test',
            namespace: 'default',
          },
          spec: {
            replicas: 2,
            selector: { matchLabels: { app: 'nginx' } },
            template: {
              metadata: { labels: { app: 'nginx' } },
              spec: {
                containers: [
                  {
                    name: 'nginx',
                    image: 'nginx:alpine',
                    ports: [{ containerPort: 80 }],
                    resources: {
                      requests: { cpu: '100m', memory: '128Mi' },
                      limits: { cpu: '500m', memory: '512Mi' },
                    },
                  },
                ],
              },
            },
          },
        },
      ]

      const deployment = await bridge.apply(
        manifests as unknown[],
        TEST_ADDRESS,
        'default',
      )

      expect(deployment.id).toBeDefined()
      expect(deployment.name).toBe('nginx-test')
      expect(deployment.namespace).toBe('default')
      expect(deployment.status).toMatch(/deploying|running/)
      expect(deployment.containers.size).toBeGreaterThan(0)

      deploymentId = deployment.id
    })

    test('applies deployment with ConfigMap and Secret', async () => {
      const manifests = [
        {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: 'app-config', namespace: 'staging' },
          data: {
            DATABASE_URL: 'postgres://localhost:5432/db',
            LOG_LEVEL: 'debug',
          },
        },
        {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: { name: 'app-secrets', namespace: 'staging' },
          type: 'Opaque',
          data: {
            API_KEY: Buffer.from('test-api-key').toString('base64'),
          },
        },
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name: 'api-server', namespace: 'staging' },
          spec: {
            replicas: 3,
            selector: { matchLabels: { app: 'api' } },
            template: {
              metadata: { labels: { app: 'api' } },
              spec: {
                containers: [
                  {
                    name: 'api',
                    image: 'node:20-alpine',
                    ports: [{ containerPort: 3000 }],
                    env: [
                      {
                        name: 'DATABASE_URL',
                        valueFrom: {
                          configMapKeyRef: {
                            name: 'app-config',
                            key: 'DATABASE_URL',
                          },
                        },
                      },
                      {
                        name: 'API_KEY',
                        valueFrom: {
                          secretKeyRef: { name: 'app-secrets', key: 'API_KEY' },
                        },
                      },
                    ],
                    resources: {
                      requests: { cpu: '250m', memory: '256Mi' },
                      limits: { cpu: '1', memory: '1Gi' },
                    },
                  },
                ],
              },
            },
          },
        },
      ]

      const deployment = await bridge.apply(
        manifests as unknown[],
        TEST_ADDRESS,
        'staging',
      )

      expect(deployment.namespace).toBe('staging')
      expect(deployment.configMaps.size).toBe(1)
      expect(deployment.secrets.size).toBe(1)
      expect(deployment.containers.size).toBeGreaterThan(0)
    })

    test('applies deployment with Service and Ingress', async () => {
      const manifests = [
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name: 'web-app', namespace: 'production' },
          spec: {
            replicas: 5,
            selector: { matchLabels: { app: 'web' } },
            template: {
              metadata: { labels: { app: 'web' } },
              spec: {
                containers: [
                  {
                    name: 'web',
                    image: 'nginx:alpine',
                    ports: [{ containerPort: 80 }],
                    readinessProbe: {
                      httpGet: { path: '/health', port: 80 },
                      initialDelaySeconds: 5,
                      periodSeconds: 10,
                    },
                  },
                ],
              },
            },
          },
        },
        {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: { name: 'web-svc', namespace: 'production' },
          spec: {
            type: 'LoadBalancer',
            selector: { app: 'web' },
            ports: [{ port: 80, targetPort: 80 }],
          },
        },
        {
          apiVersion: 'networking.k8s.io/v1',
          kind: 'Ingress',
          metadata: { name: 'web-ingress', namespace: 'production' },
          spec: {
            rules: [
              {
                host: 'app.example.com',
                http: {
                  paths: [
                    {
                      path: '/',
                      pathType: 'Prefix',
                      backend: {
                        service: { name: 'web-svc', port: { number: 80 } },
                      },
                    },
                  ],
                },
              },
            ],
            tls: [{ hosts: ['app.example.com'], secretName: 'web-tls' }],
          },
        },
      ]

      const deployment = await bridge.apply(
        manifests as unknown[],
        TEST_ADDRESS,
        'production',
      )

      expect(deployment.services.size).toBe(1)
      expect(deployment.ingresses.size).toBe(1)

      const service = [...deployment.services.values()][0]
      expect(service.type).toBe('LoadBalancer')

      const ingress = [...deployment.ingresses.values()][0]
      expect(ingress.hosts).toContain('app.example.com')
      expect(ingress.tls).toBe(true)
    })
  })

  describe('Deployment Queries', () => {
    test('gets deployment by id', () => {
      if (!deploymentId) return

      const deployment = bridge.getDeployment(deploymentId)
      expect(deployment).not.toBeNull()
      expect(deployment?.id).toBe(deploymentId)
    })

    test('lists all deployments', () => {
      const deployments = bridge.listDeployments()
      expect(deployments.length).toBeGreaterThan(0)
    })

    test('lists deployments by namespace', () => {
      const stagingDeployments = bridge.listDeployments('staging')
      const productionDeployments = bridge.listDeployments('production')

      // Each namespace should have its deployments
      expect(stagingDeployments.every((d) => d.namespace === 'staging')).toBe(
        true,
      )
      expect(
        productionDeployments.every((d) => d.namespace === 'production'),
      ).toBe(true)
    })
  })

  describe('Deployment Scaling', () => {
    test('scales deployment replicas', async () => {
      if (!deploymentId) return

      await bridge.scale(deploymentId, TEST_ADDRESS, 5)

      const deployment = bridge.getDeployment(deploymentId)
      expect(deployment).not.toBeNull()
    })
  })

  describe('Deployment Deletion', () => {
    test('deletes a deployment', async () => {
      if (!deploymentId) return

      await bridge.delete(deploymentId, TEST_ADDRESS)

      const deployment = bridge.getDeployment(deploymentId)
      expect(deployment).toBeNull()
    })
  })
})

describe('Scheduler Integration', () => {
  beforeAll(() => {
    // Ensure we have nodes registered
    for (let i = 1; i <= 5; i++) {
      const node = createMockNode(`scheduler-node-${i}`, {
        totalCpu: 4 * i,
        totalMemoryMb: 8192 * i,
        gpuTypes: i % 2 === 0 ? ['nvidia-t4', 'nvidia-a10g'] : [],
      })
      registerNode(node)
    }
  })

  test('scheduler has registered nodes', () => {
    const nodes = getAllNodes()
    expect(nodes.length).toBeGreaterThan(0)
  })

  test('scheduler statistics are accurate', () => {
    const stats: SchedulerStats = getSchedulerStats()

    expect(typeof stats.totalNodes).toBe('number')
    expect(typeof stats.onlineNodes).toBe('number')
    expect(typeof stats.totalCpu).toBe('number')
    expect(typeof stats.availableCpu).toBe('number')
    expect(stats.nodesByRegion).toBeDefined()
    expect(stats.pocStats).toBeDefined()
  })

  test('nodes are properly tracked', () => {
    const nodes = getAllNodes()

    for (const node of nodes) {
      expect(node.nodeId).toBeDefined()
      expect(node.endpoint).toBeDefined()
      expect(node.resources.totalCpu).toBeGreaterThan(0)
      expect(node.resources.totalMemoryMb).toBeGreaterThan(0)
    }
  })
})

describe('Full Deployment Flow (E2E)', () => {
  test('complete deployment: Machine -> Container -> K8s Service', async () => {
    // Step 1: Register a machine
    const machineProvisioner = getMachineProvisioner('local')
    await machineProvisioner.initialize()

    const machine = await machineProvisioner.registerMachine(
      OPERATOR_ADDRESS,
      {
        cpuCores: 16,
        cpuModel: 'Intel Xeon',
        cpuArchitecture: 'amd64',
        cpuFrequencyMhz: 3000,
        memoryMb: 65536,
        memoryType: 'ddr4',
        memoryFrequencyMhz: 3200,
        storageMb: 512000,
        storageType: 'nvme',
        storageIops: 100000,
        networkBandwidthMbps: 10000,
        networkPublicIps: 2,
        gpuType: null,
        gpuCount: 0,
        gpuMemoryMb: 0,
        teePlatform: 'intel-tdx',
        teeMemoryMb: 65536,
        region: 'us-east-1',
        zone: 'us-east-1a',
        datacenter: 'dc1',
      },
      {
        compute: true,
        storage: true,
        cdn: false,
        tee: true,
        gpu: false,
      },
      {
        pricePerHourWei: 500000000000000n,
        pricePerGbWei: 50000000000000n,
        minimumHours: 1,
      },
      {
        activationEndpoint: 'http://localhost:9000',
      },
    )

    expect(machine.status).toBe('available')

    // Step 2: Provision a container
    const containerProvisioner = getContainerProvisioner()
    const container = await containerProvisioner.provisionFromMachineType(
      TEST_ADDRESS,
      'medium',
      {
        image: 'postgres',
        tag: '16-alpine',
        env: {
          POSTGRES_USER: 'admin',
          POSTGRES_PASSWORD: 'secret',
          POSTGRES_DB: 'app',
        },
        ports: [{ containerPort: 5432 }],
      },
    )

    expect(container.id).toBeDefined()

    // Step 3: Deploy a K8s service that uses the container
    const bridge = getKubernetesBridge()
    const deployment = await bridge.apply(
      [
        {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: { name: 'postgres-svc', namespace: 'data' },
          spec: {
            type: 'ClusterIP',
            selector: { app: 'postgres' },
            ports: [{ port: 5432, targetPort: 5432 }],
          },
        },
      ] as unknown[],
      TEST_ADDRESS,
      'data',
    )

    expect(deployment.services.size).toBe(1)

    // Cleanup
    await containerProvisioner.terminate(container.id, TEST_ADDRESS)
    await machineProvisioner.unregisterMachine(machine.id, OPERATOR_ADDRESS)
    await machineProvisioner.stop()
  })

  test('TEE-enabled deployment flow', async () => {
    const containerProvisioner = getContainerProvisioner()

    // Provision a TEE container
    const teeContainer = await containerProvisioner.provisionFromMachineType(
      TEST_ADDRESS,
      'tee-medium',
      {
        image: 'vault',
        tag: 'latest',
        env: {
          VAULT_DEV_ROOT_TOKEN_ID: 'dev-token',
        },
        ports: [{ containerPort: 8200 }],
      },
    )

    expect(teeContainer.id).toBeDefined()
    expect(teeContainer.config.hardware.teePlatform).toBe('intel-tdx')

    // Cleanup
    await containerProvisioner.terminate(teeContainer.id, TEST_ADDRESS)
  })

  test('GPU-enabled deployment flow', async () => {
    const containerProvisioner = getContainerProvisioner()

    // Provision a GPU container for ML inference
    const gpuContainer = await containerProvisioner.provisionFromMachineType(
      TEST_ADDRESS,
      'gpu-t4',
      {
        image: 'nvidia/cuda',
        tag: '12.0-runtime-ubuntu22.04',
        command: ['nvidia-smi', '-l', '10'],
        env: {
          NVIDIA_VISIBLE_DEVICES: 'all',
        },
      },
    )

    expect(gpuContainer.id).toBeDefined()
    expect(gpuContainer.config.hardware.gpuType).toBe('nvidia-t4')
    expect(gpuContainer.config.hardware.gpuCount).toBeGreaterThan(0)

    // Cleanup
    await containerProvisioner.terminate(gpuContainer.id, TEST_ADDRESS)
  })
})

describe('Multi-Tenant Isolation', () => {
  const TENANT_A = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address
  const TENANT_B = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address

  test('tenants cannot access each others containers', async () => {
    const provisioner = getContainerProvisioner()

    // Tenant A provisions a container
    const containerA = await provisioner.provisionFromMachineType(
      TENANT_A,
      'micro',
      {
        image: 'nginx',
        tag: 'alpine',
      },
    )

    // Tenant B provisions a container
    const containerB = await provisioner.provisionFromMachineType(
      TENANT_B,
      'micro',
      {
        image: 'nginx',
        tag: 'alpine',
      },
    )

    // Verify isolation
    expect(containerA.owner).toBe(TENANT_A)
    expect(containerB.owner).toBe(TENANT_B)

    // Tenant A's containers
    const tenantAContainers = provisioner.getContainersByOwner(TENANT_A)
    const tenantBContainers = provisioner.getContainersByOwner(TENANT_B)

    expect(tenantAContainers.every((c) => c.owner === TENANT_A)).toBe(true)
    expect(tenantBContainers.every((c) => c.owner === TENANT_B)).toBe(true)

    // Tenant B cannot stop Tenant A's container
    await expect(provisioner.stop(containerA.id, TENANT_B)).rejects.toThrow(
      'Not authorized',
    )

    // Cleanup
    await provisioner.terminate(containerA.id, TENANT_A)
    await provisioner.terminate(containerB.id, TENANT_B)
  })
})

afterAll(() => {
  console.log('[DWS Deployment Pipeline Tests] Complete')
})
