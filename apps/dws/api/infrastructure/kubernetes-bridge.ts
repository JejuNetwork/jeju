/**
 * Kubernetes/Helm to DWS Bridge
 *
 * Allows deploying standard Kubernetes workloads to DWS:
 * - Accepts Kubernetes manifests and Helm charts
 * - Translates to DWS container/worker configurations
 * - Deploys to decentralized node network
 * - Provides kubectl-compatible API
 *
 * This enables developers to use familiar tools (kubectl, helm)
 * while deploying to a permissionless compute network.
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { z } from 'zod'
import {
  type ContainerDeployConfig,
  getContainerProvisioner,
  type HardwareSpec,
  type ProvisionedContainer,
} from '../containers/provisioner'

// Kubernetes Types

const KubeMetadataSchema = z.object({
  name: z.string(),
  namespace: z.string().default('default'),
  labels: z.record(z.string()).optional(),
  annotations: z.record(z.string()).optional(),
  uid: z.string().optional(),
  resourceVersion: z.string().optional(),
})

const KubeContainerPortSchema = z.object({
  name: z.string().optional(),
  containerPort: z.number(),
  protocol: z.enum(['TCP', 'UDP']).default('TCP'),
})

const KubeResourceRequirementsSchema = z.object({
  limits: z
    .object({
      cpu: z.string().optional(),
      memory: z.string().optional(),
      'nvidia.com/gpu': z.string().optional(),
      'amd.com/gpu': z.string().optional(),
    })
    .optional(),
  requests: z
    .object({
      cpu: z.string().optional(),
      memory: z.string().optional(),
      ephemeral_storage: z.string().optional(),
    })
    .optional(),
})

const KubeEnvVarSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
  valueFrom: z
    .object({
      secretKeyRef: z
        .object({
          name: z.string(),
          key: z.string(),
        })
        .optional(),
      configMapKeyRef: z
        .object({
          name: z.string(),
          key: z.string(),
        })
        .optional(),
    })
    .optional(),
})

const KubeProbeSchema = z.object({
  httpGet: z
    .object({
      path: z.string(),
      port: z.union([z.number(), z.string()]),
      scheme: z.enum(['HTTP', 'HTTPS']).optional(),
    })
    .optional(),
  tcpSocket: z
    .object({
      port: z.union([z.number(), z.string()]),
    })
    .optional(),
  exec: z
    .object({
      command: z.array(z.string()),
    })
    .optional(),
  initialDelaySeconds: z.number().optional(),
  periodSeconds: z.number().optional(),
  timeoutSeconds: z.number().optional(),
  failureThreshold: z.number().optional(),
  successThreshold: z.number().optional(),
})

const KubeContainerSchema = z.object({
  name: z.string(),
  image: z.string(),
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  env: z.array(KubeEnvVarSchema).optional(),
  ports: z.array(KubeContainerPortSchema).optional(),
  resources: KubeResourceRequirementsSchema.optional(),
  livenessProbe: KubeProbeSchema.optional(),
  readinessProbe: KubeProbeSchema.optional(),
  imagePullPolicy: z.enum(['Always', 'IfNotPresent', 'Never']).optional(),
})

const KubePodSpecSchema = z.object({
  containers: z.array(KubeContainerSchema),
  initContainers: z.array(KubeContainerSchema).optional(),
  nodeSelector: z.record(z.string()).optional(),
  tolerations: z
    .array(
      z.object({
        key: z.string().optional(),
        operator: z.enum(['Exists', 'Equal']).optional(),
        value: z.string().optional(),
        effect: z
          .enum(['NoSchedule', 'PreferNoSchedule', 'NoExecute'])
          .optional(),
      }),
    )
    .optional(),
  terminationGracePeriodSeconds: z.number().optional(),
  restartPolicy: z.enum(['Always', 'OnFailure', 'Never']).optional(),
  serviceAccountName: z.string().optional(),
})

const KubeDeploymentSpecSchema = z.object({
  replicas: z.number().optional(),
  selector: z.object({
    matchLabels: z.record(z.string()),
  }),
  template: z.object({
    metadata: KubeMetadataSchema.partial().optional(),
    spec: KubePodSpecSchema,
  }),
  strategy: z
    .object({
      type: z.enum(['RollingUpdate', 'Recreate']).optional(),
      rollingUpdate: z
        .object({
          maxSurge: z.union([z.number(), z.string()]).optional(),
          maxUnavailable: z.union([z.number(), z.string()]).optional(),
        })
        .optional(),
    })
    .optional(),
})

const KubeServicePortSchema = z.object({
  name: z.string().optional(),
  port: z.number(),
  targetPort: z.union([z.number(), z.string()]).optional(),
  protocol: z.enum(['TCP', 'UDP']).default('TCP'),
  nodePort: z.number().optional(),
})

const KubeServiceSpecSchema = z.object({
  type: z
    .enum(['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName'])
    .optional(),
  selector: z.record(z.string()).optional(),
  ports: z.array(KubeServicePortSchema),
  clusterIP: z.string().optional(),
  externalTrafficPolicy: z.enum(['Cluster', 'Local']).optional(),
})

const KubeIngressRuleSchema = z.object({
  host: z.string().optional(),
  http: z.object({
    paths: z.array(
      z.object({
        path: z.string(),
        pathType: z.enum(['Prefix', 'Exact', 'ImplementationSpecific']),
        backend: z.object({
          service: z.object({
            name: z.string(),
            port: z.object({
              number: z.number().optional(),
              name: z.string().optional(),
            }),
          }),
        }),
      }),
    ),
  }),
})

const KubeIngressSpecSchema = z.object({
  ingressClassName: z.string().optional(),
  rules: z.array(KubeIngressRuleSchema).optional(),
  tls: z
    .array(
      z.object({
        hosts: z.array(z.string()).optional(),
        secretName: z.string().optional(),
      }),
    )
    .optional(),
})

// Kubernetes Manifest Types

type KubeMetadata = z.infer<typeof KubeMetadataSchema>
type KubeDeploymentSpec = z.infer<typeof KubeDeploymentSpecSchema>
type KubeServiceSpec = z.infer<typeof KubeServiceSpecSchema>
type KubeIngressSpec = z.infer<typeof KubeIngressSpecSchema>
type KubeContainer = z.infer<typeof KubeContainerSchema>
type KubeResourceRequirements = z.infer<typeof KubeResourceRequirementsSchema>

interface KubeDeployment {
  apiVersion: string
  kind: 'Deployment'
  metadata: KubeMetadata
  spec: KubeDeploymentSpec
}

interface KubeService {
  apiVersion: string
  kind: 'Service'
  metadata: KubeMetadata
  spec: KubeServiceSpec
}

interface KubeIngress {
  apiVersion: string
  kind: 'Ingress'
  metadata: KubeMetadata
  spec: KubeIngressSpec
}

interface KubeConfigMap {
  apiVersion: string
  kind: 'ConfigMap'
  metadata: KubeMetadata
  data?: Record<string, string>
}

interface KubeSecret {
  apiVersion: string
  kind: 'Secret'
  metadata: KubeMetadata
  type?: string
  data?: Record<string, string>
  stringData?: Record<string, string>
}

type KubeManifest =
  | KubeDeployment
  | KubeService
  | KubeIngress
  | KubeConfigMap
  | KubeSecret

// DWS Mapping

interface DWSDeploymentState {
  id: string
  name: string
  namespace: string
  manifests: KubeManifest[]
  containers: Map<string, ProvisionedContainer>
  services: Map<string, DWSService>
  ingresses: Map<string, DWSIngress>
  configMaps: Map<string, Record<string, string>>
  secrets: Map<string, Record<string, string>>
  status: 'pending' | 'deploying' | 'running' | 'failed' | 'deleted'
  createdAt: number
  updatedAt: number
  owner: Address
}

interface DWSService {
  id: string
  name: string
  type: 'ClusterIP' | 'LoadBalancer' | 'NodePort'
  selector: Record<string, string>
  ports: Array<{
    port: number
    targetPort: number
    protocol: 'tcp' | 'udp'
  }>
  clusterIP: string
  externalIP?: string
}

interface DWSIngress {
  id: string
  name: string
  hosts: string[]
  paths: Array<{
    path: string
    serviceName: string
    servicePort: number
  }>
  tls: boolean
}

// Resource Parsing Utilities

function parseCPU(cpu: string): number {
  if (cpu.endsWith('m')) {
    return parseInt(cpu.slice(0, -1), 10) / 1000
  }
  return parseFloat(cpu)
}

function parseMemory(memory: string): number {
  const value = parseInt(memory, 10)
  if (memory.endsWith('Gi')) return value * 1024
  if (memory.endsWith('Mi')) return value
  if (memory.endsWith('Ki')) return Math.ceil(value / 1024)
  if (memory.endsWith('G')) return value * 1000
  if (memory.endsWith('M')) return value
  return Math.ceil(value / (1024 * 1024)) // bytes to MB
}

function parseStorage(storage: string): number {
  const value = parseInt(storage, 10)
  if (storage.endsWith('Ti')) return value * 1024 * 1024
  if (storage.endsWith('Gi')) return value * 1024
  if (storage.endsWith('Mi')) return value
  return Math.ceil(value / (1024 * 1024))
}

// Kubernetes to DWS Translator

export class KubernetesBridge {
  private deployments = new Map<string, DWSDeploymentState>()
  private namespaceDeployments = new Map<string, Set<string>>()

  /**
   * Apply Kubernetes manifests to DWS
   */
  async apply(
    manifests: KubeManifest[],
    owner: Address,
    namespace = 'default',
  ): Promise<DWSDeploymentState> {
    const deploymentId = `k8s-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const now = Date.now()

    // Parse and categorize manifests
    const configMaps = new Map<string, Record<string, string>>()
    const secrets = new Map<string, Record<string, string>>()
    const deploymentManifests: KubeDeployment[] = []
    const serviceManifests: KubeService[] = []
    const ingressManifests: KubeIngress[] = []

    for (const manifest of manifests) {
      switch (manifest.kind) {
        case 'ConfigMap': {
          const cm = manifest as KubeConfigMap
          configMaps.set(cm.metadata.name, cm.data ?? {})
          break
        }
        case 'Secret': {
          const secret = manifest as KubeSecret
          const data: Record<string, string> = {}
          // Decode base64 values
          for (const [key, value] of Object.entries(secret.data ?? {})) {
            data[key] = Buffer.from(value, 'base64').toString()
          }
          // stringData is already plain text
          for (const [key, value] of Object.entries(secret.stringData ?? {})) {
            data[key] = value
          }
          secrets.set(secret.metadata.name, data)
          break
        }
        case 'Deployment':
          deploymentManifests.push(manifest as KubeDeployment)
          break
        case 'Service':
          serviceManifests.push(manifest as KubeService)
          break
        case 'Ingress':
          ingressManifests.push(manifest as KubeIngress)
          break
      }
    }

    // Create deployment state
    const deploymentState: DWSDeploymentState = {
      id: deploymentId,
      name: deploymentManifests[0].metadata.name ?? deploymentId,
      namespace,
      manifests,
      containers: new Map(),
      services: new Map(),
      ingresses: new Map(),
      configMaps,
      secrets,
      status: 'deploying',
      createdAt: now,
      updatedAt: now,
      owner,
    }

    this.deployments.set(deploymentId, deploymentState)

    // Track by namespace
    const nsDeployments = this.namespaceDeployments.get(namespace) ?? new Set()
    nsDeployments.add(deploymentId)
    this.namespaceDeployments.set(namespace, nsDeployments)

    // Deploy workloads
    const _provisioner = getContainerProvisioner()

    for (const deploymentManifest of deploymentManifests) {
      const containers = await this.deployKubeDeployment(
        deploymentManifest,
        owner,
        configMaps,
        secrets,
      )
      for (const container of containers) {
        deploymentState.containers.set(container.id, container)
      }
    }

    // Create services
    for (const serviceManifest of serviceManifests) {
      const service = this.createDWSService(serviceManifest, deploymentState)
      deploymentState.services.set(service.id, service)
    }

    // Create ingresses
    for (const ingressManifest of ingressManifests) {
      const ingress = this.createDWSIngress(ingressManifest)
      deploymentState.ingresses.set(ingress.id, ingress)
    }

    deploymentState.status = 'running'
    deploymentState.updatedAt = Date.now()

    console.log(
      `[K8s Bridge] Deployed ${deploymentState.name} with ${deploymentState.containers.size} containers`,
    )

    return deploymentState
  }

  /**
   * Delete a Kubernetes deployment from DWS
   */
  async delete(deploymentId: string, owner: Address): Promise<void> {
    const deployment = this.deployments.get(deploymentId)
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`)
    }

    if (deployment.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized to delete this deployment')
    }

    const provisioner = getContainerProvisioner()

    // Terminate all containers
    for (const container of deployment.containers.values()) {
      await provisioner.terminate(container.id, owner)
    }

    deployment.status = 'deleted'
    deployment.updatedAt = Date.now()

    // Remove from namespace tracking
    const nsDeployments = this.namespaceDeployments.get(deployment.namespace)
    if (nsDeployments) {
      nsDeployments.delete(deploymentId)
    }

    this.deployments.delete(deploymentId)

    console.log(`[K8s Bridge] Deleted deployment ${deployment.name}`)
  }

  /**
   * Get deployment status
   */
  getDeployment(deploymentId: string): DWSDeploymentState | null {
    return this.deployments.get(deploymentId) ?? null
  }

  /**
   * List deployments in a namespace
   */
  listDeployments(namespace?: string): DWSDeploymentState[] {
    if (namespace) {
      const nsDeployments = this.namespaceDeployments.get(namespace)
      if (!nsDeployments) return []
      return [...nsDeployments]
        .map((id) => this.deployments.get(id))
        .filter((d): d is DWSDeploymentState => !!d)
    }
    return [...this.deployments.values()]
  }

  /**
   * Scale a deployment
   */
  async scale(
    deploymentId: string,
    owner: Address,
    replicas: number,
  ): Promise<void> {
    const deployment = this.deployments.get(deploymentId)
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`)
    }

    if (deployment.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized to scale this deployment')
    }

    const provisioner = getContainerProvisioner()

    // Scale all containers in the deployment
    for (const container of deployment.containers.values()) {
      await provisioner.scale(container.id, owner, replicas)
    }

    deployment.updatedAt = Date.now()
  }

  // Private methods

  private async deployKubeDeployment(
    manifest: KubeDeployment,
    owner: Address,
    configMaps: Map<string, Record<string, string>>,
    secrets: Map<string, Record<string, string>>,
  ): Promise<ProvisionedContainer[]> {
    const provisioner = getContainerProvisioner()
    const containers: ProvisionedContainer[] = []

    const podSpec = manifest.spec.template.spec
    const replicas = manifest.spec.replicas ?? 1

    for (const kubeContainer of podSpec.containers) {
      const config = this.translateContainer(
        kubeContainer,
        manifest,
        configMaps,
        secrets,
      )

      const container = await provisioner.provision(owner, config)
      containers.push(container)

      // Scale to requested replicas
      if (replicas > 1) {
        await provisioner.scale(container.id, owner, replicas)
      }
    }

    return containers
  }

  private translateContainer(
    kubeContainer: KubeContainer,
    manifest: KubeDeployment,
    configMaps: Map<string, Record<string, string>>,
    secrets: Map<string, Record<string, string>>,
  ): ContainerDeployConfig {
    // Parse image and tag
    const [imagePart, tagPart] = kubeContainer.image.split(':')
    const image = imagePart
    const tag = tagPart ?? 'latest'

    // Build environment variables
    const env: Record<string, string> = {}
    for (const envVar of kubeContainer.env ?? []) {
      if (envVar.value) {
        env[envVar.name] = envVar.value
      } else if (envVar.valueFrom?.configMapKeyRef) {
        const cmData = configMaps.get(envVar.valueFrom.configMapKeyRef.name)
        if (cmData) {
          env[envVar.name] = cmData[envVar.valueFrom.configMapKeyRef.key] ?? ''
        }
      } else if (envVar.valueFrom?.secretKeyRef) {
        const secretData = secrets.get(envVar.valueFrom.secretKeyRef.name)
        if (secretData) {
          env[envVar.name] = secretData[envVar.valueFrom.secretKeyRef.key] ?? ''
        }
      }
    }

    // Parse resources
    const hardware = this.translateResources(kubeContainer.resources)

    // Check for TEE requirements
    const nodeSelector = manifest.spec.template.spec.nodeSelector ?? {}
    if (nodeSelector['dws.jeju.network/tee'] === 'true') {
      hardware.teePlatform = 'intel-tdx'
    }

    // Parse ports
    const ports =
      kubeContainer.ports?.map((p) => ({
        containerPort: p.containerPort,
        protocol: p.protocol.toLowerCase() as 'tcp' | 'udp',
        expose: false,
      })) ?? []

    // Parse health check
    let healthCheck: ContainerDeployConfig['healthCheck']
    const probe = kubeContainer.readinessProbe ?? kubeContainer.livenessProbe
    if (probe) {
      if (probe.httpGet) {
        healthCheck = {
          type: 'http',
          path: probe.httpGet.path,
          port:
            typeof probe.httpGet.port === 'number'
              ? probe.httpGet.port
              : parseInt(probe.httpGet.port, 10),
          intervalSeconds: probe.periodSeconds ?? 10,
          timeoutSeconds: probe.timeoutSeconds ?? 1,
          failureThreshold: probe.failureThreshold ?? 3,
        }
      } else if (probe.tcpSocket) {
        healthCheck = {
          type: 'tcp',
          port:
            typeof probe.tcpSocket.port === 'number'
              ? probe.tcpSocket.port
              : parseInt(probe.tcpSocket.port, 10),
          intervalSeconds: probe.periodSeconds ?? 10,
          timeoutSeconds: probe.timeoutSeconds ?? 1,
          failureThreshold: probe.failureThreshold ?? 3,
        }
      } else if (probe.exec) {
        healthCheck = {
          type: 'exec',
          command: probe.exec.command,
          intervalSeconds: probe.periodSeconds ?? 10,
          timeoutSeconds: probe.timeoutSeconds ?? 1,
          failureThreshold: probe.failureThreshold ?? 3,
        }
      }
    }

    return {
      image,
      tag,
      command: kubeContainer.command,
      args: kubeContainer.args,
      env,
      hardware,
      minReplicas: 1,
      maxReplicas: 100,
      scaleToZero: false,
      cooldownSeconds: 300,
      healthCheck,
      ports,
      terminationGracePeriodSeconds:
        manifest.spec.template.spec.terminationGracePeriodSeconds ?? 30,
      restartPolicy: this.translateRestartPolicy(
        manifest.spec.template.spec.restartPolicy,
      ),
      labels: {
        'dws.k8s.deployment': manifest.metadata.name,
        'dws.k8s.namespace': manifest.metadata.namespace ?? 'default',
        'dws.k8s.container': kubeContainer.name,
        ...manifest.metadata.labels,
      },
      annotations: manifest.metadata.annotations ?? {},
    }
  }

  private translateResources(
    resources?: KubeResourceRequirements,
  ): HardwareSpec {
    const limits = resources?.limits ?? {}
    const requests = resources?.requests ?? {}

    // Parse CPU (use limits if available, otherwise requests, default to 1 core)
    const cpuStr = limits.cpu ?? requests.cpu ?? '1'
    const cpuCores = Math.max(1, Math.ceil(parseCPU(cpuStr)))

    // Parse memory (use limits if available, otherwise requests, default to 512Mi)
    const memStr = limits.memory ?? requests.memory ?? '512Mi'
    const memoryMb = Math.max(128, parseMemory(memStr))

    // Parse storage
    const storageStr = requests.ephemeral_storage ?? '10Gi'
    const storageMb = parseStorage(storageStr)

    // Check for GPU
    let gpuType: HardwareSpec['gpuType'] = 'none'
    let gpuCount = 0
    if (limits['nvidia.com/gpu']) {
      gpuType = 'nvidia-t4' // Default to T4, can be overridden by node selector
      gpuCount = parseInt(limits['nvidia.com/gpu'], 10)
    }
    if (limits['amd.com/gpu']) {
      gpuType = 'amd-mi250x'
      gpuCount = parseInt(limits['amd.com/gpu'], 10)
    }

    return {
      cpuCores,
      cpuArchitecture: 'amd64',
      memoryMb,
      storageMb,
      storageType: 'ssd',
      gpuType,
      gpuCount,
      networkBandwidthMbps: 1000,
      publicIp: false,
      teePlatform: 'none',
    }
  }

  private translateRestartPolicy(
    policy?: 'Always' | 'OnFailure' | 'Never',
  ): 'always' | 'on-failure' | 'never' {
    switch (policy) {
      case 'Always':
        return 'always'
      case 'OnFailure':
        return 'on-failure'
      case 'Never':
        return 'never'
      default:
        return 'always'
    }
  }

  private createDWSService(
    manifest: KubeService,
    deployment: DWSDeploymentState,
  ): DWSService {
    const serviceId = `svc-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

    // Assign internal IP
    const clusterIP = `10.0.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`

    const service: DWSService = {
      id: serviceId,
      name: manifest.metadata.name,
      type: (manifest.spec.type ?? 'ClusterIP') as DWSService['type'],
      selector: manifest.spec.selector ?? {},
      ports: manifest.spec.ports.map((p) => ({
        port: p.port,
        targetPort:
          typeof p.targetPort === 'number'
            ? p.targetPort
            : parseInt(p.targetPort ?? String(p.port), 10),
        protocol: p.protocol.toLowerCase() as 'tcp' | 'udp',
      })),
      clusterIP,
    }

    // For LoadBalancer type, find an external endpoint from containers
    if (service.type === 'LoadBalancer') {
      for (const container of deployment.containers.values()) {
        if (container.externalEndpoint) {
          service.externalIP = container.externalEndpoint
          break
        }
      }
    }

    return service
  }

  private createDWSIngress(manifest: KubeIngress): DWSIngress {
    const ingressId = `ing-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

    const hosts: string[] = []
    const paths: DWSIngress['paths'] = []

    for (const rule of manifest.spec.rules ?? []) {
      if (rule.host) {
        hosts.push(rule.host)
      }
      for (const path of rule.http.paths ?? []) {
        paths.push({
          path: path.path,
          serviceName: path.backend.service.name,
          servicePort: path.backend.service.port.number ?? 80,
        })
      }
    }

    return {
      id: ingressId,
      name: manifest.metadata.name,
      hosts,
      paths,
      tls: (manifest.spec.tls?.length ?? 0) > 0,
    }
  }
}

// Singleton

let kubernetesBridge: KubernetesBridge | null = null

export function getKubernetesBridge(): KubernetesBridge {
  if (!kubernetesBridge) {
    kubernetesBridge = new KubernetesBridge()
  }
  return kubernetesBridge
}

// HTTP API Router

export function createKubernetesBridgeRouter() {
  const bridge = getKubernetesBridge()

  return new Elysia({ prefix: '/k8s' })
    .get('/health', () => ({ status: 'healthy', provider: 'dws-k8s-bridge' }))
    .post(
      '/apply',
      async ({ body, headers }) => {
        const owner = headers['x-jeju-address'] as Address
        if (!owner) {
          return { error: 'Missing x-jeju-address header' }
        }

        const deployment = await bridge.apply(
          body.manifests as KubeManifest[],
          owner,
          body.namespace,
        )

        return {
          id: deployment.id,
          name: deployment.name,
          namespace: deployment.namespace,
          containers: deployment.containers.size,
          services: deployment.services.size,
          ingresses: deployment.ingresses.size,
          status: deployment.status,
        }
      },
      {
        body: t.Object({
          manifests: t.Array(t.Any()),
          namespace: t.Optional(t.String()),
        }),
      },
    )
    .get('/deployments', ({ query }) => {
      const deployments = bridge.listDeployments(query.namespace)
      return {
        deployments: deployments.map((d) => ({
          id: d.id,
          name: d.name,
          namespace: d.namespace,
          status: d.status,
          containers: d.containers.size,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        })),
      }
    })
    .get(
      '/deployments/:id',
      ({ params, set }) => {
        const deployment = bridge.getDeployment(params.id)
        if (!deployment) {
          set.status = 404
          return { error: 'Deployment not found' }
        }

        return {
          id: deployment.id,
          name: deployment.name,
          namespace: deployment.namespace,
          status: deployment.status,
          containers: [...deployment.containers.values()].map((c) => ({
            id: c.id,
            status: c.status,
            replicas: c.currentReplicas,
            endpoints: c.endpoints,
          })),
          services: [...deployment.services.values()].map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            clusterIP: s.clusterIP,
            externalIP: s.externalIP,
            ports: s.ports,
          })),
          ingresses: [...deployment.ingresses.values()].map((i) => ({
            id: i.id,
            name: i.name,
            hosts: i.hosts,
            paths: i.paths,
            tls: i.tls,
          })),
          createdAt: deployment.createdAt,
          updatedAt: deployment.updatedAt,
        }
      },
      { params: t.Object({ id: t.String() }) },
    )
    .delete(
      '/deployments/:id',
      async ({ params, headers, set }) => {
        const owner = headers['x-jeju-address'] as Address
        if (!owner) {
          set.status = 401
          return { error: 'Missing x-jeju-address header' }
        }

        await bridge.delete(params.id, owner)
        return { success: true, id: params.id }
      },
      { params: t.Object({ id: t.String() }) },
    )
    .post(
      '/deployments/:id/scale',
      async ({ params, body, headers, set }) => {
        const owner = headers['x-jeju-address'] as Address
        if (!owner) {
          set.status = 401
          return { error: 'Missing x-jeju-address header' }
        }

        await bridge.scale(params.id, owner, body.replicas)
        return { success: true, id: params.id, replicas: body.replicas }
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({ replicas: t.Number({ minimum: 0, maximum: 1000 }) }),
      },
    )
}
