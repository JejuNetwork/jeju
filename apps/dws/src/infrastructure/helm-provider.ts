/**
 * Helm/Kubernetes Provider for DWS
 *
 * Allows deploying Kubernetes workloads to the DWS decentralized network.
 * Translates K8s manifests to DWS resources:
 *
 * - Deployment -> Multiple DWS workers/containers
 * - Service -> DWS ingress/routing
 * - ConfigMap -> DWS secrets/config
 * - PersistentVolume -> DWS storage
 * - Ingress -> JNS domain
 * - Job -> DWS job
 *
 * Limitations:
 * - No direct pod scheduling (uses DWS decentralized scheduling)
 * - StatefulSets have eventual consistency
 * - DaemonSets deploy to all registered nodes
 * - Networking is abstracted via DWS routing
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'

// ============================================================================
// Kubernetes Manifest Types
// ============================================================================

interface KubeManifest {
  apiVersion: string
  kind: string
  metadata: {
    name: string
    namespace?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
  spec?: Record<string, unknown>
  // ConfigMap and Secret have data directly on manifest
  data?: Record<string, string>
  // Secret type field
  type?: string
}

interface DeploymentSpec {
  replicas?: number
  selector: { matchLabels: Record<string, string> }
  template: {
    metadata: { labels: Record<string, string> }
    spec: PodSpec
  }
}

interface PodSpec {
  containers: ContainerSpec[]
  initContainers?: ContainerSpec[]
  volumes?: VolumeSpec[]
  nodeSelector?: Record<string, string>
  tolerations?: Toleration[]
  affinity?: Affinity
}

interface ContainerSpec {
  name: string
  image: string
  command?: string[]
  args?: string[]
  env?: EnvVar[]
  envFrom?: EnvFromSource[]
  ports?: ContainerPort[]
  resources?: ResourceRequirements
  volumeMounts?: VolumeMount[]
  livenessProbe?: Probe
  readinessProbe?: Probe
}

interface EnvVar {
  name: string
  value?: string
  valueFrom?: EnvVarSource
}

interface EnvFromSource {
  configMapRef?: { name: string }
  secretRef?: { name: string }
}

interface EnvVarSource {
  configMapKeyRef?: { name: string; key: string }
  secretKeyRef?: { name: string; key: string }
}

interface ContainerPort {
  name?: string
  containerPort: number
  protocol?: string
}

interface ResourceRequirements {
  requests?: { cpu?: string; memory?: string; 'nvidia.com/gpu'?: string }
  limits?: { cpu?: string; memory?: string; 'nvidia.com/gpu'?: string }
}

interface VolumeSpec {
  name: string
  configMap?: { name: string }
  secret?: { secretName: string }
  persistentVolumeClaim?: { claimName: string }
  emptyDir?: Record<string, unknown>
}

interface VolumeMount {
  name: string
  mountPath: string
  readOnly?: boolean
}

interface Probe {
  httpGet?: { path: string; port: number }
  tcpSocket?: { port: number }
  exec?: { command: string[] }
  initialDelaySeconds?: number
  periodSeconds?: number
}

interface Toleration {
  key: string
  operator: string
  value?: string
  effect: string
}

interface Affinity {
  nodeAffinity?: Record<string, unknown>
  podAffinity?: Record<string, unknown>
  podAntiAffinity?: Record<string, unknown>
}

// ============================================================================
// DWS Mapping
// ============================================================================

interface DWSDeployment {
  id: string
  name: string
  namespace: string
  workers: DWSWorkerConfig[]
  services: DWSServiceConfig[]
  configMaps: DWSConfigMap[]
  secrets: DWSSecret[]
  storage: DWSStorage[]
  status: 'pending' | 'deploying' | 'running' | 'failed'
  createdAt: number
}

interface DWSWorkerConfig {
  id: string
  name: string
  image: string
  replicas: number
  resources: {
    cpuMillis: number
    memoryMb: number
    gpuCount?: number
  }
  env: Record<string, string>
  ports: number[]
  healthCheck?: {
    path: string
    port: number
    intervalMs: number
  }
}

interface DWSServiceConfig {
  id: string
  name: string
  selector: Record<string, string>
  ports: { port: number; targetPort: number; name?: string }[]
  type: 'ClusterIP' | 'LoadBalancer' | 'NodePort'
}

interface DWSConfigMap {
  id: string
  name: string
  data: Record<string, string>
}

interface DWSSecret {
  id: string
  name: string
  data: Record<string, string>
}

interface DWSStorage {
  id: string
  name: string
  sizeGb: number
  storageClass: string
}

// ============================================================================
// Manifest Parser
// ============================================================================

class ManifestParser {
  private configMaps = new Map<string, DWSConfigMap>()
  private secrets = new Map<string, DWSSecret>()

  parseManifests(manifests: KubeManifest[]): DWSDeployment {
    const deployment: DWSDeployment = {
      id: `helm-${Date.now()}`,
      name: '',
      namespace: 'default',
      workers: [],
      services: [],
      configMaps: [],
      secrets: [],
      storage: [],
      status: 'pending',
      createdAt: Date.now(),
    }

    // First pass: collect ConfigMaps and Secrets
    for (const manifest of manifests) {
      if (manifest.kind === 'ConfigMap') {
        const cm = this.parseConfigMap(manifest)
        this.configMaps.set(cm.name, cm)
        deployment.configMaps.push(cm)
      } else if (manifest.kind === 'Secret') {
        const secret = this.parseSecret(manifest)
        this.secrets.set(secret.name, secret)
        deployment.secrets.push(secret)
      }
    }

    // Second pass: process workloads
    for (const manifest of manifests) {
      switch (manifest.kind) {
        case 'Deployment': {
          const workers = this.parseDeployment(manifest)
          deployment.workers.push(...workers)
          if (!deployment.name) {
            deployment.name = manifest.metadata.name
            deployment.namespace = manifest.metadata.namespace ?? 'default'
          }
          break
        }

        case 'Service': {
          const service = this.parseService(manifest)
          deployment.services.push(service)
          break
        }

        case 'PersistentVolumeClaim': {
          const storage = this.parsePVC(manifest)
          deployment.storage.push(storage)
          break
        }

        case 'Job':
        case 'CronJob':
          // Jobs are handled differently
          break
      }
    }

    return deployment
  }

  private parseConfigMap(manifest: KubeManifest): DWSConfigMap {
    // ConfigMaps have data directly, not in spec
    const specData = manifest.spec?.data as Record<string, string> | undefined
    const data = manifest.data ?? specData ?? {}
    return {
      id: `cm-${manifest.metadata.name}-${Date.now()}`,
      name: manifest.metadata.name,
      data,
    }
  }

  private parseSecret(manifest: KubeManifest): DWSSecret {
    // Secrets have data directly, not in spec
    const specData = manifest.spec?.data as Record<string, string> | undefined
    const data = manifest.data ?? specData ?? {}
    // Decode base64 values
    const decoded: Record<string, string> = {}
    for (const [key, value] of Object.entries(data)) {
      decoded[key] = Buffer.from(value, 'base64').toString()
    }
    return {
      id: `secret-${manifest.metadata.name}-${Date.now()}`,
      name: manifest.metadata.name,
      data: decoded,
    }
  }

  private parseDeployment(manifest: KubeManifest): DWSWorkerConfig[] {
    const spec = manifest.spec as unknown as DeploymentSpec
    const workers: DWSWorkerConfig[] = []

    for (const container of spec.template.spec.containers) {
      const worker = this.parseContainer(
        container,
        manifest.metadata.name,
        spec.replicas ?? 1,
      )
      workers.push(worker)
    }

    return workers
  }

  private parseContainer(
    container: ContainerSpec,
    deploymentName: string,
    replicas: number,
  ): DWSWorkerConfig {
    // Parse resources
    const cpuRequest = container.resources?.requests?.cpu ?? '100m'
    const memoryRequest = container.resources?.requests?.memory ?? '128Mi'
    const gpuCount = container.resources?.limits?.['nvidia.com/gpu']

    // Build env from various sources
    const env: Record<string, string> = {}

    if (container.env) {
      for (const envVar of container.env) {
        if (envVar.value) {
          env[envVar.name] = envVar.value
        } else if (envVar.valueFrom?.configMapKeyRef) {
          const cm = this.configMaps.get(envVar.valueFrom.configMapKeyRef.name)
          if (cm) {
            env[envVar.name] =
              cm.data[envVar.valueFrom.configMapKeyRef.key] ?? ''
          }
        } else if (envVar.valueFrom?.secretKeyRef) {
          const secret = this.secrets.get(envVar.valueFrom.secretKeyRef.name)
          if (secret) {
            env[envVar.name] =
              secret.data[envVar.valueFrom.secretKeyRef.key] ?? ''
          }
        }
      }
    }

    if (container.envFrom) {
      for (const source of container.envFrom) {
        if (source.configMapRef) {
          const cm = this.configMaps.get(source.configMapRef.name)
          if (cm) {
            Object.assign(env, cm.data)
          }
        }
        if (source.secretRef) {
          const secret = this.secrets.get(source.secretRef.name)
          if (secret) {
            Object.assign(env, secret.data)
          }
        }
      }
    }

    // Parse ports
    const ports = container.ports?.map((p) => p.containerPort) ?? []

    // Parse health check
    let healthCheck: DWSWorkerConfig['healthCheck']
    if (container.readinessProbe?.httpGet) {
      healthCheck = {
        path: container.readinessProbe.httpGet.path,
        port: container.readinessProbe.httpGet.port,
        intervalMs: (container.readinessProbe.periodSeconds ?? 10) * 1000,
      }
    }

    return {
      id: `worker-${deploymentName}-${container.name}-${Date.now()}`,
      name: `${deploymentName}-${container.name}`,
      image: container.image,
      replicas,
      resources: {
        cpuMillis: this.parseCPU(cpuRequest),
        memoryMb: this.parseMemory(memoryRequest),
        gpuCount: gpuCount ? parseInt(gpuCount, 10) : undefined,
      },
      env,
      ports,
      healthCheck,
    }
  }

  private parseService(manifest: KubeManifest): DWSServiceConfig {
    const spec = manifest.spec as {
      selector?: Record<string, string>
      ports?: Array<{ port: number; targetPort?: number; name?: string }>
      type?: string
    }

    return {
      id: `svc-${manifest.metadata.name}-${Date.now()}`,
      name: manifest.metadata.name,
      selector: spec.selector ?? {},
      ports:
        spec.ports?.map((p) => ({
          port: p.port,
          targetPort: p.targetPort ?? p.port,
          name: p.name,
        })) ?? [],
      type: (spec.type as DWSServiceConfig['type']) ?? 'ClusterIP',
    }
  }

  private parsePVC(manifest: KubeManifest): DWSStorage {
    const spec = manifest.spec as {
      resources?: { requests?: { storage?: string } }
      storageClassName?: string
    }

    const sizeStr = spec.resources?.requests?.storage ?? '1Gi'
    const sizeGb = this.parseStorage(sizeStr)

    return {
      id: `pvc-${manifest.metadata.name}-${Date.now()}`,
      name: manifest.metadata.name,
      sizeGb,
      storageClass: spec.storageClassName ?? 'standard',
    }
  }

  private parseCPU(cpu: string): number {
    if (cpu.endsWith('m')) {
      return parseInt(cpu.slice(0, -1), 10)
    }
    return parseFloat(cpu) * 1000
  }

  private parseMemory(memory: string): number {
    const value = parseInt(memory, 10)
    if (memory.endsWith('Gi')) return value * 1024
    if (memory.endsWith('Mi')) return value
    if (memory.endsWith('Ki')) return Math.ceil(value / 1024)
    if (memory.endsWith('G')) return value * 1000
    if (memory.endsWith('M')) return value
    return value / (1024 * 1024) // bytes to MB
  }

  private parseStorage(storage: string): number {
    const value = parseInt(storage, 10)
    if (storage.endsWith('Ti')) return value * 1024
    if (storage.endsWith('Gi')) return value
    if (storage.endsWith('Mi')) return Math.ceil(value / 1024)
    return value
  }
}

// ============================================================================
// Helm Provider Router
// ============================================================================

const ManifestsBody = t.Object({
  manifests: t.Array(
    t.Object({
      apiVersion: t.String(),
      kind: t.String(),
      metadata: t.Object({
        name: t.String(),
        namespace: t.Optional(t.String()),
        labels: t.Optional(t.Record(t.String(), t.String())),
        annotations: t.Optional(t.Record(t.String(), t.String())),
      }),
      // spec is optional - ConfigMaps/Secrets use data, other resources use spec
      spec: t.Optional(t.Record(t.String(), t.Unknown())),
      data: t.Optional(t.Record(t.String(), t.String())),
      stringData: t.Optional(t.Record(t.String(), t.String())),
      type: t.Optional(t.String()),
    }),
  ),
  release: t.Optional(t.String()),
  namespace: t.Optional(t.String()),
  values: t.Optional(t.Record(t.String(), t.Unknown())),
})

const deployments = new Map<string, DWSDeployment>()

export function createHelmProviderRouter() {
  const parser = new ManifestParser()

  return new Elysia({ prefix: '' })
    .get('/health', () => ({ status: 'healthy', provider: 'dws-helm' }))
    .post(
      '/apply',
      async ({ body, headers }) => {
        const owner = headers['x-jeju-address'] as Address
        void owner // Used for future owner validation

        const deployment = parser.parseManifests(
          body.manifests as KubeManifest[],
        )
        deployment.name = body.release ?? deployment.name
        deployment.namespace = body.namespace ?? deployment.namespace
        deployment.status = 'deploying'

        deployments.set(deployment.id, deployment)

        deployToNetwork(deployment).catch((err) => {
          console.error(`[Helm] Deployment ${deployment.id} failed:`, err)
          deployment.status = 'failed'
        })

        return {
          id: deployment.id,
          name: deployment.name,
          namespace: deployment.namespace,
          workers: deployment.workers.length,
          services: deployment.services.length,
          status: deployment.status,
        }
      },
      { body: ManifestsBody },
    )
    .get(
      '/deployments/:id',
      ({ params, set }) => {
        const deployment = deployments.get(params.id)
        if (!deployment) {
          set.status = 404
          return { error: 'Deployment not found' }
        }

        return {
          id: deployment.id,
          name: deployment.name,
          namespace: deployment.namespace,
          workers: deployment.workers.map((w) => ({
            id: w.id,
            name: w.name,
            replicas: w.replicas,
            image: w.image,
          })),
          services: deployment.services.map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            ports: s.ports,
          })),
          status: deployment.status,
          createdAt: deployment.createdAt,
        }
      },
      { params: t.Object({ id: t.String() }) },
    )
    .get('/deployments', () => {
      const list = Array.from(deployments.values()).map((d) => ({
        id: d.id,
        name: d.name,
        namespace: d.namespace,
        status: d.status,
        createdAt: d.createdAt,
      }))

      return { deployments: list }
    })
    .delete(
      '/deployments/:id',
      async ({ params, set }) => {
        const deployment = deployments.get(params.id)
        if (!deployment) {
          set.status = 404
          return { error: 'Deployment not found' }
        }

        await cleanupDeployment(deployment)
        deployments.delete(params.id)

        return { success: true, id: params.id }
      },
      { params: t.Object({ id: t.String() }) },
    )
    .post(
      '/deployments/:id/scale',
      ({ params, body, set }) => {
        const deployment = deployments.get(params.id)
        if (!deployment) {
          set.status = 404
          return { error: 'Deployment not found' }
        }

        const worker = deployment.workers.find((w) => w.name === body.worker)
        if (!worker) {
          set.status = 404
          return { error: 'Worker not found' }
        }

        worker.replicas = body.replicas

        return {
          success: true,
          worker: worker.name,
          replicas: body.replicas,
        }
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          worker: t.String(),
          replicas: t.Number({ minimum: 0, maximum: 100 }),
        }),
      },
    )
}

// ============================================================================
// Deployment Logic
// ============================================================================

async function deployToNetwork(deployment: DWSDeployment): Promise<void> {
  console.log(`[Helm] Deploying ${deployment.name} to DWS network`)

  // Deploy workers
  for (const worker of deployment.workers) {
    console.log(
      `[Helm] Deploying worker ${worker.name} (${worker.replicas} replicas)`,
    )

    // In production, this would:
    // 1. Find qualified nodes
    // 2. Pull container image
    // 3. Convert to workerd if possible, or run as container
    // 4. Start instances
    // 5. Register with service mesh
  }

  // Configure services
  for (const service of deployment.services) {
    console.log(`[Helm] Configuring service ${service.name}`)

    // In production, this would:
    // 1. Set up routing rules
    // 2. Configure load balancing
    // 3. Register with JNS if external
  }

  deployment.status = 'running'
  console.log(`[Helm] Deployment ${deployment.name} complete`)
}

async function cleanupDeployment(deployment: DWSDeployment): Promise<void> {
  console.log(`[Helm] Cleaning up deployment ${deployment.name}`)

  // Stop workers
  for (const worker of deployment.workers) {
    console.log(`[Helm] Stopping worker ${worker.name}`)
  }

  // Remove services
  for (const service of deployment.services) {
    console.log(`[Helm] Removing service ${service.name}`)
  }

  // Delete storage (if requested)
  for (const storage of deployment.storage) {
    console.log(`[Helm] Deleting storage ${storage.name}`)
  }
}
