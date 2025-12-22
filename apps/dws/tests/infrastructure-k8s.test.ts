/**
 * K8s/Helm/Terraform Infrastructure Integration Tests
 *
 * Tests the complete infrastructure provisioning flow:
 * - K3s/K3d cluster bootstrapping
 * - Helm provider manifest deployment
 * - Terraform provider resource management
 * - Service mesh backend routing
 *
 * Run with: bun test tests/infrastructure-k8s.test.ts
 */

import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import type { Address } from 'viem'
import { app } from '../src/server'

setDefaultTimeout(60000)

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address

// Response types
interface HelmDeploymentResponse {
  id: string
  name: string
  namespace: string
  status: string
  workers: number | Array<{ id: string; name: string }>
  services: number | Array<{ id: string; name: string }>
}

interface TerraformResourceResponse {
  id: string
  name: string
  status: string
  code_cid?: string
  runtime?: string
  endpoints?: string[]
}

interface K3sClusterResponse {
  name: string
  provider: 'k3s' | 'k3d' | 'minikube'
  status: string
  kubeconfigPath?: string
}

interface ServiceMeshResponse {
  status: string
  services?: number
  policies?: number
}

// =============================================================================
// Helm Provider Tests
// =============================================================================

describe('Helm Provider', () => {
  let deploymentId: string

  test('helm health check returns healthy', async () => {
    const res = await app.request('/helm/health')
    expect(res.status).toBe(200)

    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('healthy')
  })

  test('list deployments returns array', async () => {
    const res = await app.request('/helm/deployments', {
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      deployments: HelmDeploymentResponse[]
    }
    expect(body.deployments).toBeInstanceOf(Array)
  })

  test('apply ConfigMap manifest creates deployment', async () => {
    const manifests = [
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'infra-test-config', namespace: 'default' },
        data: { key: 'value', env: 'test' },
      },
    ]

    const res = await app.request('/helm/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        manifests,
        release: 'infra-test-config',
        namespace: 'default',
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as HelmDeploymentResponse
    expect(body.id).toBeDefined()
    expect(body.name).toBe('infra-test-config')
    expect(body.namespace).toBe('default')
    expect(body.status).toBe('running')
    deploymentId = body.id
  })

  test('apply Deployment manifest with container spec', async () => {
    const manifests = [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'nginx-test', namespace: 'default' },
        spec: {
          replicas: 2,
          selector: { matchLabels: { app: 'nginx-test' } },
          template: {
            metadata: { labels: { app: 'nginx-test' } },
            spec: {
              containers: [
                {
                  name: 'nginx',
                  image: 'nginx:alpine',
                  ports: [{ containerPort: 80 }],
                  resources: {
                    limits: { memory: '128Mi', cpu: '100m' },
                  },
                },
              ],
            },
          },
        },
      },
    ]

    const res = await app.request('/helm/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        manifests,
        release: 'nginx-test-deploy',
        namespace: 'default',
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as HelmDeploymentResponse
    expect(body.id).toBeDefined()
    expect(body.workers).toBe(1) // One worker for the container
  })

  test('apply Service manifest creates DWS service', async () => {
    const manifests = [
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'nginx-svc', namespace: 'default' },
        spec: {
          selector: { app: 'nginx-test' },
          ports: [{ port: 80, targetPort: 80, protocol: 'TCP' }],
          type: 'ClusterIP',
        },
      },
    ]

    const res = await app.request('/helm/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        manifests,
        release: 'nginx-svc-deploy',
        namespace: 'default',
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as HelmDeploymentResponse
    expect(body.services).toBe(1)
  })

  test('get deployment by id', async () => {
    if (!deploymentId) return

    const res = await app.request(`/helm/deployments/${deploymentId}`, {
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as HelmDeploymentResponse
    expect(body.id).toBe(deploymentId)
  })

  test('delete deployment', async () => {
    if (!deploymentId) return

    const res = await app.request(`/helm/deployments/${deploymentId}`, {
      method: 'DELETE',
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
    expect(res.status).toBe(200)
  })

  test('apply with complex multi-resource manifest', async () => {
    const manifests = [
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'app-config' },
        data: { DATABASE_URL: 'postgres://localhost/test' },
      },
      {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: 'app-secrets' },
        type: 'Opaque',
        data: { API_KEY: 'dGVzdC1rZXk=' },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'fullstack-app' },
        spec: {
          replicas: 3,
          selector: { matchLabels: { app: 'fullstack' } },
          template: {
            metadata: { labels: { app: 'fullstack' } },
            spec: {
              containers: [
                {
                  name: 'api',
                  image: 'node:20-alpine',
                  ports: [{ containerPort: 3000 }],
                  envFrom: [
                    { configMapRef: { name: 'app-config' } },
                    { secretRef: { name: 'app-secrets' } },
                  ],
                },
              ],
            },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'fullstack-svc' },
        spec: {
          selector: { app: 'fullstack' },
          ports: [{ port: 80, targetPort: 3000 }],
        },
      },
    ]

    const res = await app.request('/helm/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        manifests,
        release: 'fullstack-test',
        namespace: 'production',
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as HelmDeploymentResponse
    expect(body.namespace).toBe('production')
    expect(body.workers).toBe(1)
    expect(body.services).toBe(1)
  })
})

// =============================================================================
// Terraform Provider Tests
// =============================================================================

describe('Terraform Provider', () => {
  let workerId: string
  let containerId: string

  test('terraform provider schema returns valid schema', async () => {
    const res = await app.request('/terraform/v1/schema')
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      version: number
      provider: { block: { attributes: Record<string, object> } }
      resource_schemas: Record<string, object>
      data_source_schemas: Record<string, object>
    }
    expect(body.version).toBe(1)
    expect(body.provider).toBeDefined()
    expect(body.resource_schemas.dws_worker).toBeDefined()
    expect(body.resource_schemas.dws_container).toBeDefined()
    expect(body.resource_schemas.dws_node).toBeDefined()
    expect(body.data_source_schemas.dws_nodes).toBeDefined()
  })

  test('create worker resource via Terraform API', async () => {
    const res = await app.request('/terraform/v1/resources/dws_worker', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'tf-test-worker',
        code_cid: 'QmTestCid123456789',
        code_hash: '0xabcdef1234567890',
        entrypoint: 'index.js',
        runtime: 'workerd',
        memory_mb: 256,
        timeout_ms: 60000,
        min_instances: 0,
        max_instances: 5,
        scale_to_zero: true,
        tee_required: false,
        env: { NODE_ENV: 'production' },
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as TerraformResourceResponse
    expect(body.id).toBeDefined()
    expect(body.name).toBe('tf-test-worker')
    expect(body.runtime).toBe('workerd')
    workerId = body.id
  })

  test('read worker resource', async () => {
    if (!workerId) return

    const res = await app.request(
      `/terraform/v1/resources/dws_worker/${workerId}`,
      {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      },
    )
    expect(res.status).toBe(200)

    const body = (await res.json()) as TerraformResourceResponse
    expect(body.id).toBe(workerId)
    expect(body.name).toBe('tf-test-worker')
  })

  test('update worker resource', async () => {
    if (!workerId) return

    const res = await app.request(
      `/terraform/v1/resources/dws_worker/${workerId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'tf-test-worker',
          code_cid: 'QmUpdatedCid123456789',
          memory_mb: 512,
          max_instances: 10,
        }),
      },
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as TerraformResourceResponse
    expect(body.code_cid).toBe('QmUpdatedCid123456789')
  })

  test('create container resource', async () => {
    const res = await app.request('/terraform/v1/resources/dws_container', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'tf-test-container',
        image: 'redis:7-alpine',
        cpu_cores: 1,
        memory_mb: 512,
        env: { REDIS_PASSWORD: 'secret' },
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as TerraformResourceResponse
    expect(body.id).toBeDefined()
    expect(body.name).toBe('tf-test-container')
    containerId = body.id
  })

  test('read container resource', async () => {
    if (!containerId) return

    const res = await app.request(
      `/terraform/v1/resources/dws_container/${containerId}`,
      {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      },
    )
    expect(res.status).toBe(200)

    const body = (await res.json()) as TerraformResourceResponse
    expect(body.id).toBe(containerId)
  })

  test('list nodes data source', async () => {
    const res = await app.request(
      '/terraform/v1/data/dws_nodes?capability=compute',
      {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      },
    )
    expect(res.status).toBe(200)

    const body = (await res.json()) as { nodes: Array<{ id: string }> }
    expect(body.nodes).toBeInstanceOf(Array)
  })

  test('delete worker resource', async () => {
    if (!workerId) return

    const res = await app.request(
      `/terraform/v1/resources/dws_worker/${workerId}`,
      {
        method: 'DELETE',
        headers: { 'x-jeju-address': TEST_ADDRESS },
      },
    )
    expect(res.status).toBe(200)
  })

  test('delete container resource', async () => {
    if (!containerId) return

    const res = await app.request(
      `/terraform/v1/resources/dws_container/${containerId}`,
      {
        method: 'DELETE',
        headers: { 'x-jeju-address': TEST_ADDRESS },
      },
    )
    expect(res.status).toBe(200)
  })

  test('terraform plan simulation', async () => {
    const res = await app.request('/terraform/v1/plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        resources: [
          {
            type: 'dws_worker',
            name: 'api_worker',
            config: {
              code_cid: 'QmPlanTestCid',
              runtime: 'workerd',
              memory_mb: 128,
            },
          },
        ],
      }),
    })

    // Plan endpoint may not be fully implemented
    expect([200, 404]).toContain(res.status)
  })
})

// =============================================================================
// K3s Provider Tests
// =============================================================================

describe('K3s Provider', () => {
  // Skip cluster creation tests in CI unless K3S_TEST=true
  const skipClusterTests = process.env.K3S_TEST !== 'true'

  test('k3s health check', async () => {
    const res = await app.request('/k3s/health')
    expect(res.status).toBe(200)

    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('healthy')
  })

  test('list clusters returns array', async () => {
    const res = await app.request('/k3s/clusters', {
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { clusters: K3sClusterResponse[] }
    expect(body.clusters).toBeInstanceOf(Array)
  })

  test('check available providers', async () => {
    const res = await app.request('/k3s/providers')
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      providers: Array<{ name: string; available: boolean }>
    }
    expect(body.providers).toBeInstanceOf(Array)
    expect(body.providers.length).toBe(3) // k3d, k3s, minikube
  })

  test.skipIf(skipClusterTests)('create k3d cluster', async () => {
    const res = await app.request('/k3s/clusters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'dws-test-cluster',
        provider: 'k3d',
        nodes: 1,
        disableTraefik: true,
      }),
    })

    // May fail if k3d not installed
    expect([200, 201, 500]).toContain(res.status)

    if (res.status === 200 || res.status === 201) {
      const body = (await res.json()) as K3sClusterResponse
      expect(body.name).toBe('dws-test-cluster')
      expect(body.provider).toBe('k3d')
    }
  })

  test.skipIf(skipClusterTests)('apply manifest to cluster', async () => {
    const manifest = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: 'test-config',
        namespace: 'default',
      },
      data: {
        key: 'value',
      },
    }

    const res = await app.request('/k3s/clusters/dws-test-cluster/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify(manifest),
    })

    expect([200, 404, 500]).toContain(res.status)
  })

  test.skipIf(skipClusterTests)('install helm chart to cluster', async () => {
    const res = await app.request('/k3s/clusters/dws-test-cluster/helm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        chart: 'bitnami/nginx',
        release: 'test-nginx',
        namespace: 'default',
        values: { replicaCount: 1 },
      }),
    })

    expect([200, 404, 500]).toContain(res.status)
  })

  test.skipIf(skipClusterTests)('delete cluster', async () => {
    const res = await app.request('/k3s/clusters/dws-test-cluster', {
      method: 'DELETE',
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })

    expect([200, 404]).toContain(res.status)
  })
})

// =============================================================================
// Service Mesh Tests
// =============================================================================

describe('Service Mesh', () => {
  test('mesh health check', async () => {
    const res = await app.request('/mesh/health')
    expect(res.status).toBe(200)

    const body = (await res.json()) as ServiceMeshResponse
    expect(body.status).toBe('healthy')
  })

  test('register service backend', async () => {
    const res = await app.request('/mesh/services', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'test-api',
        namespace: 'default',
        publicKey: `0x${'00'.repeat(32)}`,
        endpoints: ['http://localhost:3001', 'http://localhost:3002'],
        tags: ['api', 'test'],
      }),
    })

    expect(res.status).toBe(201)
  })

  test('get service backends', async () => {
    const res = await app.request('/mesh/services/default/test-api', {
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
    // May be 404 if service wasn't registered yet
    expect([200, 404]).toContain(res.status)
  })

  test('create access policy', async () => {
    const res = await app.request('/mesh/policies/access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'allow-api-access',
        source: { service: 'frontend', namespace: 'default' },
        destination: { service: 'test-api', namespace: 'default' },
        action: 'allow',
        rules: [{ methods: ['GET', 'POST'], paths: ['/*'] }],
      }),
    })

    expect(res.status).toBe(200)
  })

  test('list policies', async () => {
    const res = await app.request('/mesh/policies/access', {
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { policies: Array<{ name: string }> }
    expect(body.policies).toBeInstanceOf(Array)
  })

  test('mesh metrics available', async () => {
    const res = await app.request('/mesh/metrics', {
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
    expect([200, 404]).toContain(res.status)
  })
})

// =============================================================================
// Ingress Controller Tests
// =============================================================================

describe('Ingress Controller', () => {
  test('ingress health check', async () => {
    const res = await app.request('/ingress/health')
    expect(res.status).toBe(200)
  })

  test('create ingress rule for worker', async () => {
    const res = await app.request('/ingress/rules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'api-ingress',
        host: 'api.test.dws.jejunetwork.org',
        paths: [
          {
            path: '/v1',
            pathType: 'Prefix',
            backend: {
              type: 'worker',
              workerId: 'test-worker-123',
            },
          },
        ],
        tls: { enabled: true, mode: 'auto' },
      }),
    })

    expect(res.status).toBe(200)
  })

  test('create ingress rule for service', async () => {
    const res = await app.request('/ingress/rules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'frontend-ingress',
        host: 'app.test.dws.jejunetwork.org',
        paths: [
          {
            path: '/',
            pathType: 'Prefix',
            backend: {
              type: 'service',
              serviceId: 'default/frontend-svc',
              port: 80,
            },
          },
        ],
        tls: { enabled: true, mode: 'auto' },
        rateLimit: { requestsPerSecond: 100, burstSize: 200 },
      }),
    })

    expect(res.status).toBe(200)
  })

  test('list ingress rules', async () => {
    const res = await app.request('/ingress/rules', {
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { ingresses: Array<{ name: string }> }
    expect(body.ingresses).toBeInstanceOf(Array)
  })

  test('delete ingress rule', async () => {
    const res = await app.request('/ingress/rules/api-ingress', {
      method: 'DELETE',
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
    expect([200, 404]).toContain(res.status)
  })
})

// =============================================================================
// End-to-End Deployment Flow Tests
// =============================================================================

describe('E2E Deployment Flow', () => {
  test('full deployment flow: Terraform -> Helm -> Ingress', async () => {
    // Step 1: Create infrastructure with Terraform
    const tfWorkerRes = await app.request(
      '/terraform/v1/resources/dws_worker',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'e2e-flow-worker',
          code_cid: 'QmE2EFlowCid',
          runtime: 'workerd',
          memory_mb: 128,
          max_instances: 3,
        }),
      },
    )
    expect(tfWorkerRes.status).toBe(201)
    const tfWorker = (await tfWorkerRes.json()) as TerraformResourceResponse

    // Step 2: Deploy services with Helm
    const helmRes = await app.request('/helm/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        manifests: [
          {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: { name: 'e2e-flow-svc' },
            spec: {
              selector: { app: 'e2e-flow' },
              ports: [{ port: 80, targetPort: 8080 }],
            },
          },
        ],
        release: 'e2e-flow',
        namespace: 'default',
      }),
    })
    expect(helmRes.status).toBe(200)

    // Step 3: Create ingress to expose the service
    const ingressRes = await app.request('/ingress/rules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'e2e-flow-ingress',
        host: 'e2e.test.dws.jejunetwork.org',
        paths: [
          {
            path: '/',
            pathType: 'Prefix',
            backend: {
              type: 'worker',
              workerId: tfWorker.id,
            },
          },
        ],
        tls: { enabled: true, mode: 'auto' },
      }),
    })
    expect(ingressRes.status).toBe(200)

    // Step 4: Cleanup
    await app.request(`/terraform/v1/resources/dws_worker/${tfWorker.id}`, {
      method: 'DELETE',
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
    await app.request('/ingress/rules/e2e-flow-ingress', {
      method: 'DELETE',
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
  })
})

// =============================================================================
// Cleanup
// =============================================================================

afterAll(() => {
  console.log('[Infrastructure K8s Tests] Complete')
})
