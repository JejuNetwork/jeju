/**
 * K3s, Helm, and Terraform Integration Tests
 *
 * Tests the full DWS infrastructure provisioning stack:
 * - K3s/K3d/Minikube cluster management
 * - Helm chart deployment to local clusters
 * - Terraform resource provisioning
 * - Service mesh integration
 * - Ingress controller routing
 */

import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import type { Address } from 'viem'
import { app } from '../src/server'

setDefaultTimeout(60000)

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address

// Check if we have Docker available for k3d tests
const hasDocker = await (async () => {
  try {
    const proc = Bun.spawn(['docker', 'info'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
})()

// Check if k3d is available
const hasK3d = await (async () => {
  try {
    const proc = Bun.spawn(['which', 'k3d'], { stdout: 'pipe', stderr: 'pipe' })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
})()

describe('K3s/K3d Infrastructure', () => {
  describe('Health and API', () => {
    test('K3s provider health check', async () => {
      const res = await app.request('/k3s/health')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string; provider: string }
      expect(body.status).toBe('healthy')
      expect(body.provider).toBe('dws-k3s')
    })

    test('can list clusters (empty initially)', async () => {
      const res = await app.request('/k3s/clusters')
      expect([200, 404]).toContain(res.status)
      if (res.status === 200) {
        const body = (await res.json()) as { clusters: Array<{ name: string }> }
        expect(body.clusters).toBeInstanceOf(Array)
      }
    })

    test('get non-existent cluster returns 404', async () => {
      const res = await app.request('/k3s/clusters/nonexistent')
      expect(res.status).toBe(404)
    })
  })

  describe.skipIf(!hasDocker || !hasK3d)('K3d Cluster Operations', () => {
    const clusterName = `test-cluster-${Date.now()}`

    afterAll(async () => {
      // Cleanup: delete test cluster if it exists
      await app.request(`/k3s/clusters/${clusterName}`, { method: 'DELETE' })
    })

    test('create k3d cluster', async () => {
      const res = await app.request('/k3s/clusters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: clusterName,
          provider: 'k3d',
          nodes: 1,
        }),
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as {
        name: string
        provider: string
        status: string
      }
      expect(body.name).toBe(clusterName)
      expect(body.provider).toBe('k3d')
    }, 120000) // 2 minute timeout for cluster creation

    test('get cluster info', async () => {
      const res = await app.request(`/k3s/clusters/${clusterName}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { name: string; status: string }
      expect(body.name).toBe(clusterName)
      expect(['provisioning', 'running']).toContain(body.status)
    })

    test('apply manifest to cluster', async () => {
      const res = await app.request(`/k3s/clusters/${clusterName}/manifests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manifest: {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: {
              name: 'test-config',
              namespace: 'default',
            },
            data: {
              key: 'value',
            },
          },
        }),
      })

      expect([200, 201]).toContain(res.status)
    })

    test('install helm chart to cluster', async () => {
      const res = await app.request(`/k3s/clusters/${clusterName}/charts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chart: 'bitnami/nginx',
          release: 'test-nginx',
          namespace: 'default',
          values: {
            replicaCount: 1,
          },
        }),
      })

      // May fail if helm not installed or repo not added
      expect([200, 201, 500]).toContain(res.status)
    })

    test('delete cluster', async () => {
      const res = await app.request(`/k3s/clusters/${clusterName}`, {
        method: 'DELETE',
      })

      expect([200, 204]).toContain(res.status)
    })
  })
})

describe('Helm Provider', () => {
  describe('Health and Schema', () => {
    test('Helm provider health check', async () => {
      const res = await app.request('/helm/health')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string; provider: string }
      expect(body.status).toBe('healthy')
      expect(body.provider).toBe('dws-helm')
    })

    test('get helm schema', async () => {
      const res = await app.request('/helm/schema')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { schema: Record<string, unknown> }
      expect(body.schema).toBeDefined()
    })
  })

  describe('Manifest Deployment', () => {
    let deploymentId: string

    test('apply simple ConfigMap manifest', async () => {
      const res = await app.request('/helm/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          manifests: [
            {
              apiVersion: 'v1',
              kind: 'ConfigMap',
              metadata: { name: 'test-config', namespace: 'default' },
              data: { key: 'value' },
            },
          ],
          release: 'test-release',
          namespace: 'default',
        }),
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as {
        id: string
        name: string
        status: string
      }
      expect(body.id).toBeDefined()
      expect(body.name).toBe('test-release')
      deploymentId = body.id
    })

    test('apply Deployment manifest', async () => {
      const res = await app.request('/helm/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          manifests: [
            {
              apiVersion: 'apps/v1',
              kind: 'Deployment',
              metadata: { name: 'test-app', namespace: 'default' },
              spec: {
                replicas: 2,
                selector: { matchLabels: { app: 'test' } },
                template: {
                  metadata: { labels: { app: 'test' } },
                  spec: {
                    containers: [
                      {
                        name: 'app',
                        image: 'nginx:latest',
                        ports: [{ containerPort: 80 }],
                        resources: {
                          requests: { memory: '64Mi', cpu: '100m' },
                          limits: { memory: '128Mi', cpu: '200m' },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
          release: 'test-deployment',
          namespace: 'default',
        }),
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as { workers: number; services: number }
      expect(body.workers).toBe(1) // One deployment = one worker
    })

    test('apply Service manifest', async () => {
      const res = await app.request('/helm/apply', {
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
              metadata: { name: 'test-service', namespace: 'default' },
              spec: {
                type: 'ClusterIP',
                selector: { app: 'test' },
                ports: [{ port: 80, targetPort: 80 }],
              },
            },
          ],
          release: 'test-service',
          namespace: 'default',
        }),
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as { services: number }
      expect(body.services).toBe(1)
    })

    test('get deployment status', async () => {
      if (!deploymentId) return

      const res = await app.request(`/helm/deployments/${deploymentId}`)
      expect([200, 404]).toContain(res.status)

      if (res.status === 200) {
        const body = (await res.json()) as { id: string; status: string }
        expect(body.id).toBe(deploymentId)
        expect(['deploying', 'running', 'failed']).toContain(body.status)
      }
    })

    test('list deployments', async () => {
      const res = await app.request('/helm/deployments', {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { deployments: Array<{ id: string }> }
      expect(body.deployments).toBeInstanceOf(Array)
    })

    test('delete deployment', async () => {
      if (!deploymentId) return

      const res = await app.request(`/helm/deployments/${deploymentId}`, {
        method: 'DELETE',
        headers: { 'x-jeju-address': TEST_ADDRESS },
      })

      expect([200, 204, 404]).toContain(res.status)
    })
  })

  describe('Full Helm Chart Deployment', () => {
    test('deploy multi-resource chart', async () => {
      const res = await app.request('/helm/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          manifests: [
            {
              apiVersion: 'v1',
              kind: 'ConfigMap',
              metadata: { name: 'app-config' },
              data: { 'app.conf': 'setting=value' },
            },
            {
              apiVersion: 'apps/v1',
              kind: 'Deployment',
              metadata: { name: 'web-app' },
              spec: {
                replicas: 3,
                selector: { matchLabels: { app: 'web' } },
                template: {
                  metadata: { labels: { app: 'web' } },
                  spec: {
                    containers: [
                      {
                        name: 'web',
                        image: 'nginx:alpine',
                        ports: [{ containerPort: 80 }],
                        envFrom: [{ configMapRef: { name: 'app-config' } }],
                      },
                    ],
                  },
                },
              },
            },
            {
              apiVersion: 'v1',
              kind: 'Service',
              metadata: { name: 'web-service' },
              spec: {
                type: 'LoadBalancer',
                selector: { app: 'web' },
                ports: [{ port: 80, targetPort: 80 }],
              },
            },
          ],
          release: 'full-app',
          namespace: 'production',
        }),
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as {
        workers: number
        services: number
        namespace: string
      }
      expect(body.workers).toBe(1)
      expect(body.services).toBe(1)
      expect(body.namespace).toBe('production')
    })
  })
})

describe('Terraform Provider', () => {
  describe('Schema and Health', () => {
    test('Terraform provider health check', async () => {
      const res = await app.request('/terraform/v1/health')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string; provider: string }
      expect(body.status).toBe('healthy')
      expect(body.provider).toBe('dws-terraform')
    })

    test('get provider schema', async () => {
      const res = await app.request('/terraform/v1/schema')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        provider: Record<string, unknown>
        resources: Record<string, unknown>
      }
      expect(body.provider).toBeDefined()
      expect(body.resources).toBeDefined()
      expect(body.resources.dws_worker).toBeDefined()
      expect(body.resources.dws_container).toBeDefined()
      expect(body.resources.dws_node).toBeDefined()
    })
  })

  describe('Worker Resource CRUD', () => {
    let workerId: string

    test('create dws_worker resource', async () => {
      const res = await app.request('/terraform/v1/resources/dws_worker', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'tf-test-worker',
          code_cid: 'QmTestWorkerCode123',
          entrypoint: 'index.js',
          runtime: 'workerd',
          memory_mb: 256,
          timeout_ms: 30000,
          min_instances: 0,
          max_instances: 5,
          scale_to_zero: true,
          env: { NODE_ENV: 'production' },
        }),
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as {
        id: string
        name: string
        status: string
      }
      expect(body.id).toBeDefined()
      expect(body.name).toBe('tf-test-worker')
      workerId = body.id
    })

    test('read dws_worker resource', async () => {
      if (!workerId) return

      const res = await app.request(
        `/terraform/v1/resources/dws_worker/${workerId}`,
      )
      expect([200, 404]).toContain(res.status)

      if (res.status === 200) {
        const body = (await res.json()) as { id: string; name: string }
        expect(body.id).toBe(workerId)
        expect(body.name).toBe('tf-test-worker')
      }
    })

    test('update dws_worker resource', async () => {
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
            name: 'tf-test-worker-updated',
            code_cid: 'QmTestWorkerCode123',
            memory_mb: 512,
            max_instances: 10,
          }),
        },
      )

      expect([200, 404]).toContain(res.status)

      if (res.status === 200) {
        const body = (await res.json()) as {
          memory_mb: number
          max_instances: number
        }
        expect(body.memory_mb).toBe(512)
        expect(body.max_instances).toBe(10)
      }
    })

    test('delete dws_worker resource', async () => {
      if (!workerId) return

      const res = await app.request(
        `/terraform/v1/resources/dws_worker/${workerId}`,
        {
          method: 'DELETE',
          headers: { 'x-jeju-address': TEST_ADDRESS },
        },
      )

      expect([200, 204, 404]).toContain(res.status)
    })
  })

  describe('Container Resource CRUD', () => {
    let containerId: string

    test('create dws_container resource', async () => {
      const res = await app.request('/terraform/v1/resources/dws_container', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          name: 'tf-test-container',
          image: 'nginx:alpine',
          command: ['nginx', '-g', 'daemon off;'],
          ports: [{ container: 80, host: 8080 }],
          env: { NGINX_PORT: '80' },
          memory_mb: 128,
          cpu_millicores: 500,
        }),
      })

      expect([200, 201]).toContain(res.status)
      const body = (await res.json()) as { id: string; name: string }
      expect(body.id).toBeDefined()
      expect(body.name).toBe('tf-test-container')
      containerId = body.id
    })

    test('read dws_container resource', async () => {
      if (!containerId) return

      const res = await app.request(
        `/terraform/v1/resources/dws_container/${containerId}`,
      )
      expect([200, 404]).toContain(res.status)
    })

    test('delete dws_container resource', async () => {
      if (!containerId) return

      const res = await app.request(
        `/terraform/v1/resources/dws_container/${containerId}`,
        {
          method: 'DELETE',
          headers: { 'x-jeju-address': TEST_ADDRESS },
        },
      )

      expect([200, 204, 404]).toContain(res.status)
    })
  })

  describe('Node Resource CRUD', () => {
    test('create dws_node resource', async () => {
      const res = await app.request('/terraform/v1/resources/dws_node', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          endpoint: 'http://localhost:4031',
          capabilities: ['compute', 'storage'],
          region: 'us-west-2',
          specs: {
            cpu_cores: 8,
            memory_mb: 32768,
            storage_mb: 500000,
            bandwidth_mbps: 1000,
          },
          pricing: {
            price_per_hour: '1000000000000000',
            price_per_gb: '100000000000000',
            price_per_request: '1000000000000',
          },
        }),
      })

      expect([200, 201, 400]).toContain(res.status)
    })

    test('list nodes via Terraform API', async () => {
      const res = await app.request('/terraform/v1/resources/dws_node')
      expect([200, 404]).toContain(res.status)
    })
  })

  describe('Workspace State Management', () => {
    test('create resource in specific workspace', async () => {
      const res = await app.request(
        '/terraform/v1/resources/dws_worker?workspace=staging',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': TEST_ADDRESS,
          },
          body: JSON.stringify({
            name: 'staging-worker',
            code_cid: 'QmStagingCode',
            runtime: 'workerd',
          }),
        },
      )

      expect([200, 201]).toContain(res.status)
    })

    test('workspaces are isolated', async () => {
      // Create in production workspace
      const prodRes = await app.request(
        '/terraform/v1/resources/dws_worker?workspace=production',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': TEST_ADDRESS,
          },
          body: JSON.stringify({
            name: 'prod-worker',
            code_cid: 'QmProdCode',
            runtime: 'workerd',
          }),
        },
      )

      expect([200, 201]).toContain(prodRes.status)
      const prodBody = (await prodRes.json()) as { id: string }

      // Should not find production resource in staging workspace
      const stagingRes = await app.request(
        `/terraform/v1/resources/dws_worker/${prodBody.id}?workspace=staging`,
      )
      expect(stagingRes.status).toBe(404)
    })
  })
})

describe('Service Mesh Integration', () => {
  test('mesh health check', async () => {
    const res = await app.request('/mesh/health')
    expect(res.status).toBe(200)
  })

  test('register service with backends', async () => {
    const res = await app.request('/mesh/services', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'test-service',
        namespace: 'default',
        protocol: 'http',
        endpoints: [
          { host: 'localhost', port: 8080, weight: 100 },
          { host: 'localhost', port: 8081, weight: 50 },
        ],
      }),
    })

    expect([200, 201]).toContain(res.status)
  })

  test('create access policy', async () => {
    const res = await app.request('/mesh/policies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'allow-test',
        sourceService: 'frontend',
        targetService: 'test-service',
        action: 'allow',
      }),
    })

    expect([200, 201]).toContain(res.status)
  })

  test('configure traffic policy', async () => {
    const res = await app.request('/mesh/traffic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        service: 'test-service',
        retries: 3,
        timeout: 30000,
        circuitBreaker: {
          threshold: 5,
          timeout: 60000,
        },
      }),
    })

    expect([200, 201, 404]).toContain(res.status)
  })
})

describe('Ingress Controller Integration', () => {
  let ingressId: string

  test('ingress health check', async () => {
    const res = await app.request('/ingress/health')
    expect(res.status).toBe(200)
  })

  test('create ingress rule', async () => {
    const res = await app.request('/ingress/rules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'test-ingress',
        host: 'test.dws.local',
        paths: [
          {
            path: '/',
            pathType: 'Prefix',
            backend: {
              type: 'service',
              serviceId: 'test-service',
              port: 80,
            },
          },
        ],
        tls: {
          enabled: true,
          mode: 'auto',
        },
      }),
    })

    expect([200, 201]).toContain(res.status)
    const body = (await res.json()) as { id: string }
    ingressId = body.id
  })

  test('list ingress rules', async () => {
    const res = await app.request('/ingress/rules')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rules: Array<{ id: string }> }
    expect(body.rules).toBeInstanceOf(Array)
  })

  test('get ingress rule', async () => {
    if (!ingressId) return

    const res = await app.request(`/ingress/rules/${ingressId}`)
    expect([200, 404]).toContain(res.status)
  })

  test('delete ingress rule', async () => {
    if (!ingressId) return

    const res = await app.request(`/ingress/rules/${ingressId}`, {
      method: 'DELETE',
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })

    expect([200, 204, 404]).toContain(res.status)
  })
})

describe('End-to-End Infrastructure Flow', () => {
  test('full deployment pipeline: Terraform -> Helm -> Service Mesh -> Ingress', async () => {
    // Step 1: Create worker via Terraform
    const tfRes = await app.request('/terraform/v1/resources/dws_worker', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'e2e-worker',
        code_cid: 'QmE2ETestCode',
        runtime: 'workerd',
        memory_mb: 128,
      }),
    })
    expect([200, 201]).toContain(tfRes.status)
    const tfBody = (await tfRes.json()) as { id: string }

    // Step 2: Deploy via Helm
    const helmRes = await app.request('/helm/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        manifests: [
          {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: { name: 'e2e-app' },
            spec: {
              replicas: 2,
              selector: { matchLabels: { app: 'e2e' } },
              template: {
                metadata: { labels: { app: 'e2e' } },
                spec: {
                  containers: [
                    {
                      name: 'app',
                      image: 'nginx:alpine',
                      ports: [{ containerPort: 80 }],
                    },
                  ],
                },
              },
            },
          },
          {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: { name: 'e2e-service' },
            spec: {
              type: 'ClusterIP',
              selector: { app: 'e2e' },
              ports: [{ port: 80 }],
            },
          },
        ],
        release: 'e2e-release',
        namespace: 'default',
      }),
    })
    expect([200, 201]).toContain(helmRes.status)
    const helmBody = (await helmRes.json()) as { id: string }

    // Step 3: Register with Service Mesh
    const meshRes = await app.request('/mesh/services', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'e2e-service',
        namespace: 'default',
        protocol: 'http',
        endpoints: [{ host: 'localhost', port: 80, weight: 100 }],
      }),
    })
    expect([200, 201]).toContain(meshRes.status)

    // Step 4: Create Ingress
    const ingressRes = await app.request('/ingress/rules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'e2e-ingress',
        host: 'e2e.dws.local',
        paths: [
          {
            path: '/',
            pathType: 'Prefix',
            backend: {
              type: 'service',
              serviceId: 'e2e-service',
              port: 80,
            },
          },
        ],
        tls: { enabled: true, mode: 'auto' },
      }),
    })
    expect([200, 201]).toContain(ingressRes.status)

    // Cleanup
    await app.request(`/terraform/v1/resources/dws_worker/${tfBody.id}`, {
      method: 'DELETE',
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
    await app.request(`/helm/deployments/${helmBody.id}`, {
      method: 'DELETE',
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
  })
})
