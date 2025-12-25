/**
 * K3s/K3d Provider for DWS
 *
 * Bootstraps local Kubernetes clusters for mini-k8s deployments.
 * Supports:
 * - k3s (single binary, production-like)
 * - k3d (k3s in Docker, faster for dev)
 * - minikube fallback
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Hex } from 'viem'
import { z } from 'zod'

export type ClusterProvider = 'k3s' | 'k3d' | 'minikube'

export interface K3sClusterConfig {
  name: string
  provider: ClusterProvider
  nodes: number
  cpuCores?: number
  memoryMb?: number
  clusterCidr?: string
  serviceCidr?: string
  disableTraefik?: boolean
  disableServiceLB?: boolean
  exposeApi?: boolean
  apiPort?: number
  dataDir?: string
}

export interface K3sCluster {
  name: string
  provider: ClusterProvider
  kubeconfig: string
  apiEndpoint: string
  status: 'creating' | 'running' | 'stopped' | 'error'
  nodes: K3sNode[]
  createdAt: number
  process?: ReturnType<typeof Bun.spawn>
}

export interface K3sNode {
  name: string
  role: 'server' | 'agent'
  ip: string
  status: 'ready' | 'not-ready'
  resources: {
    cpuCores: number
    memoryMb: number
    storageMb: number
  }
}

const clusters = new Map<string, K3sCluster>()
const DWS_K3S_DIR = process.env.DWS_K3S_DIR || '/tmp/dws-k3s'

async function findBinary(name: string): Promise<string | null> {
  const paths = [
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    join(process.env.HOME || '', '.local', 'bin', name),
    join(process.env.HOME || '', 'bin', name),
  ]

  for (const p of paths) {
    if (existsSync(p)) return p
  }

  // Try which
  const proc = Bun.spawn(['which', name], { stdout: 'pipe', stderr: 'pipe' })
  const exitCode = await proc.exited
  if (exitCode === 0) {
    const path = await new Response(proc.stdout).text()
    return path.trim()
  }

  return null
}

async function detectProvider(): Promise<{
  provider: ClusterProvider
  binary: string
} | null> {
  // Prefer k3d (faster, Docker-based)
  const k3d = await findBinary('k3d')
  if (k3d) return { provider: 'k3d', binary: k3d }

  // Then k3s (real k8s, needs root or rootless setup)
  const k3s = await findBinary('k3s')
  if (k3s) return { provider: 'k3s', binary: k3s }

  // Fallback to minikube
  const minikube = await findBinary('minikube')
  if (minikube) return { provider: 'minikube', binary: minikube }

  return null
}

export async function createCluster(
  config: K3sClusterConfig,
): Promise<K3sCluster> {
  const detection = await detectProvider()
  if (!detection) {
    throw new Error('No k8s provider found. Install k3d, k3s, or minikube.')
  }

  const { provider, binary } = detection
  const resolvedProvider = config.provider || provider

  await mkdir(DWS_K3S_DIR, { recursive: true })
  const kubeconfigPath = join(DWS_K3S_DIR, `${config.name}.kubeconfig`)

  const cluster: K3sCluster = {
    name: config.name,
    provider: resolvedProvider,
    kubeconfig: kubeconfigPath,
    apiEndpoint: '',
    status: 'creating',
    nodes: [],
    createdAt: Date.now(),
  }

  clusters.set(config.name, cluster)

  switch (resolvedProvider) {
    case 'k3d':
      await createK3dCluster(binary, config, cluster)
      break
    case 'k3s':
      await createK3sCluster(binary, config, cluster)
      break
    case 'minikube':
      await createMinikubeCluster(binary, config, cluster)
      break
  }

  cluster.status = 'running'

  return cluster
}

async function createK3dCluster(
  binary: string,
  config: K3sClusterConfig,
  cluster: K3sCluster,
): Promise<void> {
  const args = [
    'cluster',
    'create',
    config.name,
    '--agents',
    String(Math.max(0, config.nodes - 1)),
    '--kubeconfig-switch-context',
    '--kubeconfig-update-default',
  ]

  if (config.disableTraefik) {
    args.push('--k3s-arg', '--disable=traefik@server:*')
  }

  if (config.disableServiceLB) {
    args.push('--k3s-arg', '--disable=servicelb@server:*')
  }

  if (config.apiPort) {
    args.push('--api-port', String(config.apiPort))
  }

  if (config.clusterCidr) {
    args.push('--k3s-arg', `--cluster-cidr=${config.clusterCidr}@server:*`)
  }

  const proc = Bun.spawn([binary, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, KUBECONFIG: cluster.kubeconfig },
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`Failed to create k3d cluster: ${stderr}`)
  }

  // Get kubeconfig
  const kubeconfigProc = Bun.spawn([binary, 'kubeconfig', 'get', config.name], {
    stdout: 'pipe',
  })
  await kubeconfigProc.exited
  const kubeconfig = await new Response(kubeconfigProc.stdout).text()
  await writeFile(cluster.kubeconfig, kubeconfig)

  // Parse API endpoint from kubeconfig
  const apiMatch = kubeconfig.match(/server:\s*(https?:\/\/[^\s]+)/)
  cluster.apiEndpoint = apiMatch?.[1] ?? 'https://localhost:6443'

  // List nodes
  cluster.nodes = await getK3dNodes(binary, config.name)
}

const K3dNodeSchema = z.object({
  name: z.string(),
  role: z.string(),
  state: z.object({ running: z.boolean() }).optional(),
  IP: z.object({ IP: z.string() }).optional(),
})

const K3dNodeListSchema = z.array(K3dNodeSchema)

async function getK3dNodes(
  binary: string,
  clusterName: string,
): Promise<K3sNode[]> {
  const proc = Bun.spawn([binary, 'node', 'list', '-o', 'json'], {
    stdout: 'pipe',
  })
  await proc.exited

  const output = await new Response(proc.stdout).text()
  const parsed: unknown = JSON.parse(output)
  const result = K3dNodeListSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Invalid k3d node list response: ${result.error.message}`)
  }
  const allNodes = result.data

  return allNodes
    .filter((n) => n.name.includes(clusterName))
    .map((n) => ({
      name: n.name,
      role: n.role.includes('server')
        ? ('server' as const)
        : ('agent' as const),
      ip: n.IP?.IP ?? 'unknown',
      status: n.state?.running ? ('ready' as const) : ('not-ready' as const),
      resources: {
        cpuCores: 2,
        memoryMb: 2048,
        storageMb: 10240,
      },
    }))
}

async function createK3sCluster(
  binary: string,
  config: K3sClusterConfig,
  cluster: K3sCluster,
): Promise<void> {
  const dataDir = config.dataDir || join(DWS_K3S_DIR, config.name)
  await mkdir(dataDir, { recursive: true })

  const args = [
    'server',
    `--data-dir=${dataDir}`,
    `--write-kubeconfig=${cluster.kubeconfig}`,
    '--write-kubeconfig-mode=644',
  ]

  if (config.disableTraefik) {
    args.push('--disable=traefik')
  }

  if (config.clusterCidr) {
    args.push(`--cluster-cidr=${config.clusterCidr}`)
  }

  if (config.serviceCidr) {
    args.push(`--service-cidr=${config.serviceCidr}`)
  }

  // Start k3s as background process
  const proc = Bun.spawn([binary, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  cluster.process = proc

  // Wait for kubeconfig to be written
  await waitForFile(cluster.kubeconfig, 30000)

  // Parse API endpoint
  const kubeconfig = await readFile(cluster.kubeconfig, 'utf-8')
  const apiMatch = kubeconfig.match(/server:\s*(https?:\/\/[^\s]+)/)
  cluster.apiEndpoint = apiMatch?.[1] ?? 'https://127.0.0.1:6443'

  // Wait for API server
  await waitForKubeApi(cluster.kubeconfig)

  cluster.nodes = [
    {
      name: `${config.name}-server`,
      role: 'server',
      ip: '127.0.0.1',
      status: 'ready',
      resources: {
        cpuCores: config.cpuCores ?? 4,
        memoryMb: config.memoryMb ?? 4096,
        storageMb: 102400,
      },
    },
  ]
}

async function createMinikubeCluster(
  binary: string,
  config: K3sClusterConfig,
  cluster: K3sCluster,
): Promise<void> {
  const args = [
    'start',
    '--profile',
    config.name,
    '--nodes',
    String(config.nodes),
  ]

  if (config.cpuCores) {
    args.push('--cpus', String(config.cpuCores))
  }

  if (config.memoryMb) {
    args.push('--memory', String(config.memoryMb))
  }

  const proc = Bun.spawn([binary, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`Failed to create minikube cluster: ${stderr}`)
  }

  // Get kubeconfig
  const kubeconfigProc = Bun.spawn(
    [binary, 'kubectl', '-p', config.name, '--', 'config', 'view', '--raw'],
    {
      stdout: 'pipe',
    },
  )
  await kubeconfigProc.exited
  const kubeconfig = await new Response(kubeconfigProc.stdout).text()
  await writeFile(cluster.kubeconfig, kubeconfig)

  const apiMatch = kubeconfig.match(/server:\s*(https?:\/\/[^\s]+)/)
  cluster.apiEndpoint = apiMatch?.[1] ?? 'https://192.168.49.2:8443'

  cluster.nodes = [
    {
      name: config.name,
      role: 'server',
      ip: '192.168.49.2',
      status: 'ready',
      resources: {
        cpuCores: config.cpuCores || 2,
        memoryMb: config.memoryMb || 2048,
        storageMb: 20480,
      },
    },
  ]
}

export async function deleteCluster(name: string): Promise<void> {
  const cluster = clusters.get(name)
  if (!cluster) {
    throw new Error(`Cluster ${name} not found`)
  }

  // Kill process if k3s
  if (cluster.process) {
    cluster.process.kill()
  }

  const detection = await detectProvider()
  if (!detection) return

  const { binary } = detection

  switch (cluster.provider) {
    case 'k3d': {
      const proc = Bun.spawn([binary, 'cluster', 'delete', name])
      await proc.exited
      break
    }
    case 'k3s': {
      // k3s-killall.sh if available
      const killScript = await findBinary('k3s-killall.sh')
      if (killScript) {
        const proc = Bun.spawn([killScript])
        await proc.exited
      }
      // Cleanup data dir
      const dataDir = join(DWS_K3S_DIR, name)
      await rm(dataDir, { recursive: true, force: true })
      break
    }
    case 'minikube': {
      const proc = Bun.spawn([binary, 'delete', '--profile', name])
      await proc.exited
      break
    }
  }

  // Remove kubeconfig
  if (existsSync(cluster.kubeconfig)) {
    await rm(cluster.kubeconfig, { force: true })
  }

  clusters.delete(name)
}

export function getCluster(name: string): K3sCluster | undefined {
  return clusters.get(name)
}

export function listClusters(): K3sCluster[] {
  return Array.from(clusters.values())
}

export async function installHelmChart(
  clusterName: string,
  params: {
    chart: string
    release: string
    namespace?: string
    values?: Record<string, unknown>
    valuesFile?: string
    set?: Record<string, string>
    wait?: boolean
    timeout?: string
  },
): Promise<{ success: boolean; output: string }> {
  const cluster = clusters.get(clusterName)
  if (!cluster) {
    throw new Error(`Cluster ${clusterName} not found`)
  }

  const helm = await findBinary('helm')
  if (!helm) {
    throw new Error('helm binary not found')
  }

  const args = [
    'install',
    params.release,
    params.chart,
    '--kubeconfig',
    cluster.kubeconfig,
  ]

  if (params.namespace) {
    args.push('--namespace', params.namespace, '--create-namespace')
  }

  if (params.values) {
    const valuesPath = join(DWS_K3S_DIR, `${params.release}-values.yaml`)
    await writeFile(valuesPath, JSON.stringify(params.values))
    args.push('-f', valuesPath)
  }

  if (params.valuesFile) {
    args.push('-f', params.valuesFile)
  }

  if (params.set) {
    for (const [key, value] of Object.entries(params.set)) {
      args.push('--set', `${key}=${value}`)
    }
  }

  if (params.wait) {
    args.push('--wait')
  }

  if (params.timeout) {
    args.push('--timeout', params.timeout)
  }

  const proc = Bun.spawn([helm, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  if (exitCode !== 0) {
    return { success: false, output: stderr || stdout }
  }

  return { success: true, output: stdout }
}

export async function applyManifest(
  clusterName: string,
  manifest: string | object,
): Promise<{ success: boolean; output: string }> {
  const cluster = clusters.get(clusterName)
  if (!cluster) {
    throw new Error(`Cluster ${clusterName} not found`)
  }

  const kubectl = await findBinary('kubectl')
  if (!kubectl) {
    throw new Error('kubectl binary not found')
  }

  const manifestStr =
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest)

  const proc = Bun.spawn(
    [kubectl, 'apply', '-f', '-', '--kubeconfig', cluster.kubeconfig],
    {
      stdin: new TextEncoder().encode(manifestStr),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  if (exitCode !== 0) {
    return { success: false, output: stderr || stdout }
  }

  return { success: true, output: stdout }
}

export async function installDWSAgent(
  clusterName: string,
  params: {
    nodeEndpoint: string
    privateKey?: Hex
    capabilities?: string[]
    pricing?: {
      pricePerHour: string
      pricePerGb: string
      pricePerRequest: string
    }
  },
): Promise<void> {
  const cluster = clusters.get(clusterName)
  if (!cluster) {
    throw new Error(`Cluster ${clusterName} not found`)
  }

  // Deploy DWS agent as a DaemonSet
  const manifest = {
    apiVersion: 'apps/v1',
    kind: 'DaemonSet',
    metadata: {
      name: 'dws-node-agent',
      namespace: 'dws-system',
    },
    spec: {
      selector: {
        matchLabels: { app: 'dws-node-agent' },
      },
      template: {
        metadata: {
          labels: { app: 'dws-node-agent' },
        },
        spec: {
          containers: [
            {
              name: 'agent',
              image: 'jeju/dws-node-agent:latest',
              env: [
                { name: 'DWS_NODE_ENDPOINT', value: params.nodeEndpoint },
                {
                  name: 'DWS_CAPABILITIES',
                  value: (params.capabilities ?? ['compute']).join(','),
                },
                ...(params.privateKey
                  ? [{ name: 'DWS_PRIVATE_KEY', value: params.privateKey }]
                  : []),
                ...(params.pricing
                  ? [
                      {
                        name: 'DWS_PRICE_PER_HOUR',
                        value: params.pricing.pricePerHour,
                      },
                      {
                        name: 'DWS_PRICE_PER_GB',
                        value: params.pricing.pricePerGb,
                      },
                      {
                        name: 'DWS_PRICE_PER_REQUEST',
                        value: params.pricing.pricePerRequest,
                      },
                    ]
                  : []),
              ],
              ports: [{ containerPort: 4030 }],
              resources: {
                requests: { cpu: '100m', memory: '128Mi' },
                limits: { cpu: '500m', memory: '512Mi' },
              },
            },
          ],
          hostNetwork: true,
          serviceAccountName: 'dws-node-agent',
        },
      },
    },
  }

  // Create namespace first
  await applyManifest(clusterName, {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: { name: 'dws-system' },
  })

  // Create service account
  await applyManifest(clusterName, {
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: 'dws-node-agent', namespace: 'dws-system' },
  })

  // Deploy agent
  const result = await applyManifest(clusterName, manifest)
  if (!result.success) {
    throw new Error(`Failed to install DWS agent: ${result.output}`)
  }
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await new Promise((r) => setTimeout(r, 500))
  }

  throw new Error(`Timeout waiting for ${path}`)
}

async function waitForKubeApi(
  kubeconfigPath: string,
  timeoutMs = 60000,
): Promise<void> {
  const kubectl = await findBinary('kubectl')
  if (!kubectl) {
    throw new Error('kubectl not found')
  }

  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const proc = Bun.spawn(
      [kubectl, 'get', 'nodes', '--kubeconfig', kubeconfigPath],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    const exitCode = await proc.exited
    if (exitCode === 0) return

    await new Promise((r) => setTimeout(r, 1000))
  }

  throw new Error('Timeout waiting for Kubernetes API')
}

import { Elysia, t } from 'elysia'

const CreateClusterBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 63, pattern: '^[a-z0-9-]+$' }),
  provider: t.Optional(
    t.Union([t.Literal('k3s'), t.Literal('k3d'), t.Literal('minikube')]),
  ),
  nodes: t.Optional(t.Number({ minimum: 1, maximum: 10, default: 1 })),
  cpuCores: t.Optional(t.Number({ minimum: 1, maximum: 32 })),
  memoryMb: t.Optional(t.Number({ minimum: 512, maximum: 65536 })),
  disableTraefik: t.Optional(t.Boolean()),
  exposeApi: t.Optional(t.Boolean()),
  apiPort: t.Optional(t.Number()),
})

const InstallChartBody = t.Object({
  chart: t.String({ minLength: 1 }),
  release: t.String({ minLength: 1 }),
  namespace: t.Optional(t.String()),
  values: t.Optional(t.Record(t.String(), t.Unknown())),
  set: t.Optional(t.Record(t.String(), t.String())),
  wait: t.Optional(t.Boolean()),
  timeout: t.Optional(t.String()),
})

const DWSAgentBody = t.Object({
  nodeEndpoint: t.String(),
  privateKey: t.Optional(t.String()),
  capabilities: t.Optional(t.Array(t.String())),
})

const ClusterNameParams = t.Object({ name: t.String() })

export function createK3sRouter() {
  return new Elysia({ prefix: '' })
    .get('/health', () => ({
      status: 'healthy',
      clusters: clusters.size,
      supportedProviders: ['k3d', 'k3s', 'minikube'],
    }))
    .get('/clusters', () => {
      const clusterList = listClusters().map((cl) => ({
        name: cl.name,
        provider: cl.provider,
        status: cl.status,
        apiEndpoint: cl.apiEndpoint,
        nodes: cl.nodes.length,
        createdAt: cl.createdAt,
      }))
      return { clusters: clusterList }
    })
    .post(
      '/clusters',
      async ({ body, set }) => {
        const cluster = await createCluster({
          name: body.name,
          provider: body.provider ?? 'k3d',
          nodes: body.nodes ?? 1,
          cpuCores: body.cpuCores,
          memoryMb: body.memoryMb,
          disableTraefik: body.disableTraefik,
          exposeApi: body.exposeApi,
          apiPort: body.apiPort,
        })

        set.status = 201
        return {
          name: cluster.name,
          provider: cluster.provider,
          status: cluster.status,
          apiEndpoint: cluster.apiEndpoint,
          kubeconfig: cluster.kubeconfig,
          nodes: cluster.nodes,
        }
      },
      { body: CreateClusterBody },
    )
    .get(
      '/clusters/:name',
      ({ params, set }) => {
        const cluster = getCluster(params.name)

        if (!cluster) {
          set.status = 404
          return { error: 'Cluster not found' }
        }

        return {
          name: cluster.name,
          provider: cluster.provider,
          status: cluster.status,
          apiEndpoint: cluster.apiEndpoint,
          kubeconfig: cluster.kubeconfig,
          nodes: cluster.nodes,
          createdAt: cluster.createdAt,
        }
      },
      { params: ClusterNameParams },
    )
    .delete(
      '/clusters/:name',
      async ({ params }) => {
        await deleteCluster(params.name)
        return { success: true }
      },
      { params: ClusterNameParams },
    )
    .post(
      '/clusters/:name/helm',
      async ({ params, body, set }) => {
        const result = await installHelmChart(params.name, body)

        if (!result.success) {
          set.status = 500
          return { error: result.output }
        }

        return { success: true, output: result.output }
      },
      { params: ClusterNameParams, body: InstallChartBody },
    )
    .post(
      '/clusters/:name/apply',
      async ({ params, body, set }) => {
        const result = await applyManifest(
          params.name,
          body as string | Record<string, unknown>,
        )

        if (!result.success) {
          set.status = 500
          return { error: result.output }
        }

        return { success: true, output: result.output }
      },
      { params: ClusterNameParams, body: t.Unknown() },
    )
    .post(
      '/clusters/:name/dws-agent',
      async ({ params, body }) => {
        await installDWSAgent(params.name, {
          nodeEndpoint: body.nodeEndpoint,
          privateKey: body.privateKey as Hex | undefined,
          capabilities: body.capabilities,
        })
        return { success: true }
      },
      { params: ClusterNameParams, body: DWSAgentBody },
    )
    .get('/providers', async () => {
      const providers: Array<{
        name: ClusterProvider
        available: boolean
        path?: string
      }> = []

      for (const name of ['k3d', 'k3s', 'minikube'] as ClusterProvider[]) {
        const path = await findBinary(name)
        providers.push({ name, available: !!path, path: path || undefined })
      }

      return { providers }
    })
}
