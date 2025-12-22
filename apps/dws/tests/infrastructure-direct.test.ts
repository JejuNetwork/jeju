/**
 * Direct Infrastructure Tests
 * Tests infrastructure modules using Elysia
 */

import { describe, test, expect } from 'bun:test'
import { Elysia } from 'elysia'
import {
  createK3sRouter,
  createHelmProviderRouter,
  createTerraformProviderRouter,
  createIngressRouter,
  createServiceMeshRouter,
  getIngressController,
  getServiceMesh,
} from '../src/infrastructure'

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

// Create a clean Elysia app with infrastructure routes
function createInfrastructureApp() {
  return new Elysia()
    .use(new Elysia({ prefix: '/k3s' }).use(createK3sRouter()))
    .use(new Elysia({ prefix: '/helm' }).use(createHelmProviderRouter()))
    .use(new Elysia({ prefix: '/terraform' }).use(createTerraformProviderRouter()))
    .use(new Elysia({ prefix: '/ingress' }).use(createIngressRouter(getIngressController())))
    .use(new Elysia({ prefix: '/mesh' }).use(createServiceMeshRouter(getServiceMesh())))
}

const app = createInfrastructureApp()

async function request(path: string, options?: RequestInit) {
  return app.handle(new Request(`http://localhost${path}`, options))
}

describe('K3s Provider Direct', () => {
  test('health check', async () => {
    const res = await request('/k3s/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('healthy')
  })

  test('list clusters', async () => {
    const res = await request('/k3s/clusters')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { clusters: Array<{ name: string }> }
    expect(body.clusters).toBeInstanceOf(Array)
  })

  test('list providers', async () => {
    const res = await request('/k3s/providers')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      providers: Array<{ name: string; available: boolean }>
    }
    expect(body.providers).toBeInstanceOf(Array)
    expect(body.providers.length).toBeGreaterThan(0)
  })
})

describe('Helm Provider Direct', () => {
  test('health check', async () => {
    const res = await request('/helm/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('healthy')
  })

  test('list deployments', async () => {
    const res = await request('/helm/deployments', {
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deployments: Array<{ id: string }> }
    expect(body.deployments).toBeInstanceOf(Array)
  })

  test('apply ConfigMap manifest', async () => {
    const res = await request('/helm/apply', {
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
        release: 'test-config-release',
        namespace: 'default',
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      id: string
      name: string
      status: string
    }
    expect(body.id).toBeDefined()
    expect(body.name).toBe('test-config-release')
    expect(body.status).toBe('running')
  })

  test('apply Deployment manifest', async () => {
    const res = await request('/helm/apply', {
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
            metadata: { name: 'nginx', namespace: 'default' },
            spec: {
              replicas: 2,
              selector: { matchLabels: { app: 'nginx' } },
              template: {
                metadata: { labels: { app: 'nginx' } },
                spec: {
                  containers: [
                    {
                      name: 'nginx',
                      image: 'nginx:latest',
                      ports: [{ containerPort: 80 }],
                    },
                  ],
                },
              },
            },
          },
        ],
        release: 'nginx-deployment',
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; workers: number }
    expect(body.id).toBeDefined()
    expect(body.workers).toBeGreaterThan(0)
  })
})

describe('Terraform Provider Direct', () => {
  test('get schema', async () => {
    const res = await request('/terraform/v1/schema')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      resource_schemas: Record<string, object>
    }
    expect(body.resource_schemas).toBeDefined()
    expect(body.resource_schemas.dws_worker).toBeDefined()
    expect(body.resource_schemas.dws_container).toBeDefined()
  })

  test('create worker resource', async () => {
    const res = await request('/terraform/v1/resources/dws_worker', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'tf-worker',
        code_cid: 'QmTest123',
        memory_mb: 128,
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; name: string }
    expect(body.id).toBeDefined()
    expect(body.name).toBe('tf-worker')
  })

  test('create container resource', async () => {
    const res = await request('/terraform/v1/resources/dws_container', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'tf-container',
        image: 'nginx:latest',
        memory_mb: 256,
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; name: string }
    expect(body.id).toBeDefined()
    expect(body.name).toBe('tf-container')
  })

  test('list nodes data source', async () => {
    const res = await request('/terraform/v1/data/dws_nodes')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { nodes: Array<{ id: string }> }
    expect(body.nodes).toBeInstanceOf(Array)
  })
})

describe('Ingress Controller Direct', () => {
  test('health check', async () => {
    const res = await request('/ingress/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('healthy')
  })

  test('list rules', async () => {
    const res = await request('/ingress/rules', {
      headers: { 'x-jeju-address': TEST_ADDRESS },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rules: Array<{ id: string }> }
    expect(body.rules).toBeInstanceOf(Array)
  })

  test('create ingress rule', async () => {
    const res = await request('/ingress/rules', {
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
              type: 'worker',
              workerId: 'test-worker-id',
            },
          },
        ],
        tls: { enabled: true, mode: 'auto' },
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      id: string
      name: string
      status: string
    }
    expect(body.id).toBeDefined()
    expect(body.name).toBe('test-ingress')
    expect(body.status).toBe('active')
  })
})

describe('Service Mesh Direct', () => {
  test('health check', async () => {
    const res = await request('/mesh/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('healthy')
  })

  test('register service', async () => {
    const res = await request('/mesh/services', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'test-service',
        namespace: 'default',
        publicKey: '0x' + '00'.repeat(32),
        endpoints: ['http://localhost:3001'],
        tags: ['api'],
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; name: string }
    expect(body.id).toBeDefined()
    expect(body.name).toBe('test-service')
  })

  test('list services', async () => {
    const res = await request('/mesh/services')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { services: Array<{ name: string }> }
    expect(body.services).toBeInstanceOf(Array)
  })

  test('create access policy', async () => {
    const res = await request('/mesh/policies/access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        name: 'test-policy',
        source: { namespace: 'default' },
        destination: { namespace: 'default' },
        action: 'allow',
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; name: string }
    expect(body.id).toBeDefined()
    expect(body.name).toBe('test-policy')
  })

  test('list policies', async () => {
    const res = await request('/mesh/policies/access')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { policies: Array<{ name: string }> }
    expect(body.policies).toBeInstanceOf(Array)
  })
})
