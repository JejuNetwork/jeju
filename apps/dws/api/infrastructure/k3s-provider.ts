/**
 * K3s/K3d Provider for DWS
 *
 * Bootstraps local Kubernetes clusters for mini-k8s deployments.
 * Supports:
 * - k3s (single binary, production-like)
 * - k3d (k3s in Docker, faster for dev)
 * - minikube fallback
 *
 * All operations via DWS storage/exec APIs - no Node.js fs required.
 */

import { getLocalhostHost } from '@jejunetwork/config'
import { Elysia, t } from 'elysia'
import type { Hex } from 'viem'
import { z } from 'zod'

// Config injected at startup from central config
export interface K3sProviderConfig {
  k3sDir: string
  storageUrl: string
  execUrl: string
}

const getDefaultConfig = (): K3sProviderConfig => {
  const host = getLocalhostHost()
  return {
    k3sDir: '/tmp/dws-k3s',
    storageUrl: `http://${host}:4020/storage`,
    execUrl: `http://${host}:4020/exec`,
  }
}
let config: K3sProviderConfig = getDefaultConfig()

export function configureK3sProvider(c: Partial<K3sProviderConfig>): void {
  config = { ...config, ...c }
}

// Types

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
  processId?: string
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

// DWS Exec API - runs commands on the DWS node

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function exec(
  command: string[],
  options?: { env?: Record<string, string>; stdin?: string },
): Promise<ExecResult> {
  const response = await fetch(config.execUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, ...options }),
  })
  if (!response.ok) {
    throw new Error(`Exec API error: ${response.status}`)
  }
  return response.json() as Promise<ExecResult>
}

async function writeFile(path: string, content: string): Promise<void> {
  await exec(['sh', '-c', `cat > "${path}"`], { stdin: content })
}

async function readFile(path: string): Promise<string> {
  const result = await exec(['cat', path])
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read ${path}: ${result.stderr}`)
  }
  return result.stdout
}

async function fileExists(path: string): Promise<boolean> {
  const result = await exec(['test', '-e', path])
  return result.exitCode === 0
}

async function mkdir(path: string): Promise<void> {
  await exec(['mkdir', '-p', path])
}

async function rm(path: string): Promise<void> {
  await exec(['rm', '-rf', path])
}

async function findBinary(name: string): Promise<string | null> {
  const result = await exec(['which', name])
  if (result.exitCode === 0) {
    return result.stdout.trim()
  }
  return null
}

async function detectProvider(): Promise<{
  provider: ClusterProvider
  binary: string
} | null> {
  const k3d = await findBinary('k3d')
  if (k3d) return { provider: 'k3d', binary: k3d }

  const k3s = await findBinary('k3s')
  if (k3s) return { provider: 'k3s', binary: k3s }

  const minikube = await findBinary('minikube')
  if (minikube) return { provider: 'minikube', binary: minikube }

  return null
}

// Cluster Management

export async function createCluster(
  clusterConfig: K3sClusterConfig,
): Promise<K3sCluster> {
  const detection = await detectProvider()
  if (!detection) {
    throw new Error('No k8s provider found. Install k3d, k3s, or minikube.')
  }

  const { provider, binary } = detection
  const resolvedProvider = clusterConfig.provider || provider

  await mkdir(config.k3sDir)
  const kubeconfigPath = `${config.k3sDir}/${clusterConfig.name}.kubeconfig`

  const cluster: K3sCluster = {
    name: clusterConfig.name,
    provider: resolvedProvider,
    kubeconfig: kubeconfigPath,
    apiEndpoint: '',
    status: 'creating',
    nodes: [],
    createdAt: Date.now(),
  }

  clusters.set(clusterConfig.name, cluster)

  switch (resolvedProvider) {
    case 'k3d':
      await createK3dCluster(binary, clusterConfig, cluster)
      break
    case 'k3s':
      await createK3sCluster(binary, clusterConfig, cluster)
      break
    case 'minikube':
      await createMinikubeCluster(binary, clusterConfig, cluster)
      break
  }

  cluster.status = 'running'
  return cluster
}

async function createK3dCluster(
  binary: string,
  clusterConfig: K3sClusterConfig,
  cluster: K3sCluster,
): Promise<void> {
  const args = [
    'cluster',
    'create',
    clusterConfig.name,
    '--agents',
    String(Math.max(0, clusterConfig.nodes - 1)),
    '--kubeconfig-switch-context',
    '--kubeconfig-update-default',
  ]

  if (clusterConfig.disableTraefik) {
    args.push('--k3s-arg', '--disable=traefik@server:*')
  }
  if (clusterConfig.disableServiceLB) {
    args.push('--k3s-arg', '--disable=servicelb@server:*')
  }
  if (clusterConfig.apiPort) {
    args.push('--api-port', String(clusterConfig.apiPort))
  }
  if (clusterConfig.clusterCidr) {
    args.push(
      '--k3s-arg',
      `--cluster-cidr=${clusterConfig.clusterCidr}@server:*`,
    )
  }

  const result = await exec([binary, ...args], {
    env: { KUBECONFIG: cluster.kubeconfig },
  })
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create k3d cluster: ${result.stderr}`)
  }

  // Get kubeconfig
  const kubeconfigResult = await exec([
    binary,
    'kubeconfig',
    'get',
    clusterConfig.name,
  ])
  await writeFile(cluster.kubeconfig, kubeconfigResult.stdout)

  // Parse API endpoint
  const apiMatch = kubeconfigResult.stdout.match(
    /server:\s*(https?:\/\/[^\s]+)/,
  )
  const host = getLocalhostHost()
  cluster.apiEndpoint = apiMatch?.[1] ?? `https://${host}:6443`

  cluster.nodes = await getK3dNodes(binary, clusterConfig.name)
}

const K3dNodeSchema = z.object({
  name: z.string(),
  role: z.string(),
  state: z.object({ running: z.boolean() }).optional(),
  IP: z.object({ IP: z.string() }).optional(),
})

async function getK3dNodes(
  binary: string,
  clusterName: string,
): Promise<K3sNode[]> {
  const result = await exec([binary, 'node', 'list', '-o', 'json'])
  const parsed: unknown = JSON.parse(result.stdout)
  const nodes = z.array(K3dNodeSchema).parse(parsed)

  return nodes
    .filter((n) => n.name.includes(clusterName))
    .map((n) => ({
      name: n.name,
      role: n.role.includes('server')
        ? ('server' as const)
        : ('agent' as const),
      ip: n.IP?.IP ?? 'unknown',
      status: n.state?.running ? ('ready' as const) : ('not-ready' as const),
      resources: { cpuCores: 2, memoryMb: 2048, storageMb: 10240 },
    }))
}

async function createK3sCluster(
  binary: string,
  clusterConfig: K3sClusterConfig,
  cluster: K3sCluster,
): Promise<void> {
  const dataDir =
    clusterConfig.dataDir ?? `${config.k3sDir}/${clusterConfig.name}`
  await mkdir(dataDir)

  const args = [
    'server',
    `--data-dir=${dataDir}`,
    `--write-kubeconfig=${cluster.kubeconfig}`,
    '--write-kubeconfig-mode=644',
  ]

  if (clusterConfig.disableTraefik) args.push('--disable=traefik')
  if (clusterConfig.clusterCidr)
    args.push(`--cluster-cidr=${clusterConfig.clusterCidr}`)
  if (clusterConfig.serviceCidr)
    args.push(`--service-cidr=${clusterConfig.serviceCidr}`)

  // Start k3s (background via exec API)
  const result = await exec([binary, ...args])
  if (result.exitCode !== 0) {
    throw new Error(`Failed to start k3s: ${result.stderr}`)
  }

  // Wait for kubeconfig
  await waitForFile(cluster.kubeconfig, 30000)

  const kubeconfig = await readFile(cluster.kubeconfig)
  const apiMatch = kubeconfig.match(/server:\s*(https?:\/\/[^\s]+)/)
  const host = getLocalhostHost()
  cluster.apiEndpoint = apiMatch?.[1] ?? `https://${host}:6443`

  await waitForKubeApi(cluster.kubeconfig)

  cluster.nodes = [
    {
      name: `${clusterConfig.name}-server`,
      role: 'server',
      ip: '127.0.0.1',
      status: 'ready',
      resources: {
        cpuCores: clusterConfig.cpuCores ?? 4,
        memoryMb: clusterConfig.memoryMb ?? 4096,
        storageMb: 102400,
      },
    },
  ]
}

async function createMinikubeCluster(
  binary: string,
  clusterConfig: K3sClusterConfig,
  cluster: K3sCluster,
): Promise<void> {
  const args = [
    'start',
    '--profile',
    clusterConfig.name,
    '--nodes',
    String(clusterConfig.nodes),
  ]
  if (clusterConfig.cpuCores)
    args.push('--cpus', String(clusterConfig.cpuCores))
  if (clusterConfig.memoryMb)
    args.push('--memory', String(clusterConfig.memoryMb))

  const result = await exec([binary, ...args])
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create minikube cluster: ${result.stderr}`)
  }

  // Get kubeconfig
  const kubeconfigResult = await exec([
    binary,
    'kubectl',
    '-p',
    clusterConfig.name,
    '--',
    'config',
    'view',
    '--raw',
  ])
  await writeFile(cluster.kubeconfig, kubeconfigResult.stdout)

  const apiMatch = kubeconfigResult.stdout.match(
    /server:\s*(https?:\/\/[^\s]+)/,
  )
  cluster.apiEndpoint = apiMatch?.[1] ?? 'https://192.168.49.2:8443'

  cluster.nodes = [
    {
      name: clusterConfig.name,
      role: 'server',
      ip: '192.168.49.2',
      status: 'ready',
      resources: {
        cpuCores: clusterConfig.cpuCores ?? 2,
        memoryMb: clusterConfig.memoryMb ?? 2048,
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

  const detection = await detectProvider()
  if (!detection) return

  const { binary } = detection

  switch (cluster.provider) {
    case 'k3d':
      await exec([binary, 'cluster', 'delete', name])
      break
    case 'k3s': {
      const killScript = await findBinary('k3s-killall.sh')
      if (killScript) await exec([killScript])
      await rm(`${config.k3sDir}/${name}`)
      break
    }
    case 'minikube':
      await exec([binary, 'delete', '--profile', name])
      break
  }

  if (await fileExists(cluster.kubeconfig)) {
    await rm(cluster.kubeconfig)
  }

  clusters.delete(name)
}

export function getCluster(name: string): K3sCluster | undefined {
  return clusters.get(name)
}

export function listClusters(): K3sCluster[] {
  return Array.from(clusters.values())
}

// Helm & Kubectl

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
  if (!cluster) throw new Error(`Cluster ${clusterName} not found`)

  const helm = await findBinary('helm')
  if (!helm) throw new Error('helm binary not found')

  const args = [
    'install',
    params.release,
    params.chart,
    '--kubeconfig',
    cluster.kubeconfig,
  ]

  if (params.namespace)
    args.push('--namespace', params.namespace, '--create-namespace')

  if (params.values) {
    const valuesPath = `${config.k3sDir}/${params.release}-values.yaml`
    await writeFile(valuesPath, JSON.stringify(params.values))
    args.push('-f', valuesPath)
  }

  if (params.valuesFile) args.push('-f', params.valuesFile)
  if (params.set) {
    for (const [key, value] of Object.entries(params.set)) {
      args.push('--set', `${key}=${value}`)
    }
  }
  if (params.wait) args.push('--wait')
  if (params.timeout) args.push('--timeout', params.timeout)

  const result = await exec([helm, ...args])
  return {
    success: result.exitCode === 0,
    output: result.exitCode === 0 ? result.stdout : result.stderr,
  }
}

export async function applyManifest(
  clusterName: string,
  manifest: string | object,
): Promise<{ success: boolean; output: string }> {
  const cluster = clusters.get(clusterName)
  if (!cluster) throw new Error(`Cluster ${clusterName} not found`)

  const kubectl = await findBinary('kubectl')
  if (!kubectl) throw new Error('kubectl binary not found')

  const manifestStr =
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest)
  const result = await exec(
    [kubectl, 'apply', '-f', '-', '--kubeconfig', cluster.kubeconfig],
    {
      stdin: manifestStr,
    },
  )

  return {
    success: result.exitCode === 0,
    output: result.exitCode === 0 ? result.stdout : result.stderr,
  }
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
  if (!cluster) throw new Error(`Cluster ${clusterName} not found`)

  // Create namespace
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

  // Deploy DWS agent DaemonSet
  const env = [
    { name: 'DWS_NODE_ENDPOINT', value: params.nodeEndpoint },
    {
      name: 'DWS_CAPABILITIES',
      value: (params.capabilities ?? ['compute']).join(','),
    },
  ]
  if (params.privateKey)
    env.push({ name: 'DWS_PRIVATE_KEY', value: params.privateKey })
  if (params.pricing) {
    env.push({ name: 'DWS_PRICE_PER_HOUR', value: params.pricing.pricePerHour })
    env.push({ name: 'DWS_PRICE_PER_GB', value: params.pricing.pricePerGb })
    env.push({
      name: 'DWS_PRICE_PER_REQUEST',
      value: params.pricing.pricePerRequest,
    })
  }

  const result = await applyManifest(clusterName, {
    apiVersion: 'apps/v1',
    kind: 'DaemonSet',
    metadata: { name: 'dws-node-agent', namespace: 'dws-system' },
    spec: {
      selector: { matchLabels: { app: 'dws-node-agent' } },
      template: {
        metadata: { labels: { app: 'dws-node-agent' } },
        spec: {
          containers: [
            {
              name: 'agent',
              image: 'jeju/dws-node-agent:latest',
              env,
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
  })

  if (!result.success) {
    throw new Error(`Failed to install DWS agent: ${result.output}`)
  }
}

// Helpers

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fileExists(path)) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Timeout waiting for ${path}`)
}

async function waitForKubeApi(
  kubeconfigPath: string,
  timeoutMs = 60000,
): Promise<void> {
  const kubectl = await findBinary('kubectl')
  if (!kubectl) throw new Error('kubectl not found')

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await exec([
      kubectl,
      'get',
      'nodes',
      '--kubeconfig',
      kubeconfigPath,
    ])
    if (result.exitCode === 0) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('Timeout waiting for Kubernetes API')
}

// Elysia Router

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
  return new Elysia({ prefix: '/k3s' })
    .get('/health', () => ({
      status: 'healthy',
      clusters: clusters.size,
      supportedProviders: ['k3d', 'k3s', 'minikube'],
    }))
    .get('/clusters', () => ({
      clusters: listClusters().map((cl) => ({
        name: cl.name,
        provider: cl.provider,
        status: cl.status,
        apiEndpoint: cl.apiEndpoint,
        nodes: cl.nodes.length,
        createdAt: cl.createdAt,
      })),
    }))
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
        providers.push({ name, available: !!path, path: path ?? undefined })
      }
      return { providers }
    })
}
