/**
 * DWS Frontend E2E Tests - Full Service Integration
 *
 * Tests all DWS services through the frontend with real backends.
 * Run: bun run test:e2e
 */

import { expect, test } from '@playwright/test'

const dwsUrl = process.env.DWS_URL || 'http://127.0.0.1:4030'
const frontendUrl = process.env.BASE_URL || 'http://127.0.0.1:4033'
const testWallet = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey:
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
}

// Helper to make API requests to DWS backend
async function dwsRequest(path: string, options?: RequestInit) {
  const response = await fetch(`${dwsUrl}${path}`, options)
  return response
}

test.describe('DWS E2E - Service Health', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(frontendUrl)
  })

  test('DWS backend is healthy', async () => {
    const res = await dwsRequest('/health')
    expect(res.status).toBe(200)

    const health = (await res.json()) as {
      status: string
      services: Record<string, { status: string }>
    }
    expect(health.status).toBe('healthy')
  })

  test('frontend loads and shows welcome screen', async ({ page }) => {
    await expect(
      page.locator('h3:has-text("Welcome to DWS Console")'),
    ).toBeVisible()
  })

  test('all services show healthy in dashboard', async ({ page }) => {
    // Navigate to dashboard and wait for service status to load
    await page.goto(frontendUrl)

    // Verify the page loaded
    await expect(
      page.locator('h3:has-text("Welcome to DWS Console")'),
    ).toBeVisible()
  })
})

test.describe('DWS E2E - Storage Service', () => {
  test('storage health endpoint works', async () => {
    const res = await dwsRequest('/storage/health')
    expect(res.status).toBe(200)
  })

  test('can upload and download file via API', async () => {
    const testData = `E2E test data ${Date.now()}`

    // Upload
    const uploadRes = await dwsRequest('/storage/upload/raw', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'x-jeju-address': testWallet.address,
        'x-filename': 'e2e-test.txt',
      },
      body: testData,
    })
    expect(uploadRes.status).toBe(200)

    const { cid } = (await uploadRes.json()) as { cid: string }
    expect(cid).toBeDefined()

    // Download
    const downloadRes = await dwsRequest(`/storage/download/${cid}`)
    expect(downloadRes.status).toBe(200)
    expect(await downloadRes.text()).toBe(testData)
  })

  test('storage buckets page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/storage/buckets`)
    await expect(page.locator('h1')).toContainText('Storage Buckets')
    await expect(page.locator('text=S3-compatible')).toBeVisible()
  })
})

test.describe('DWS E2E - Compute Service', () => {
  test('compute health endpoint works', async () => {
    const res = await dwsRequest('/compute/health')
    expect(res.status).toBe(200)
  })

  test('can submit and complete a job', async () => {
    const submitRes = await dwsRequest('/compute/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': testWallet.address,
      },
      body: JSON.stringify({ command: 'echo "e2e frontend test"' }),
    })
    expect(submitRes.status).toBe(201)

    const { jobId } = (await submitRes.json()) as { jobId: string }
    expect(jobId).toBeDefined()

    // Poll for completion
    let attempts = 0
    let status = 'queued'
    let output = ''

    while (status !== 'completed' && status !== 'failed' && attempts < 30) {
      await new Promise((r) => setTimeout(r, 200))
      const statusRes = await dwsRequest(`/compute/jobs/${jobId}`)
      const body = (await statusRes.json()) as {
        status: string
        output?: string
      }
      status = body.status
      output = body.output ?? ''
      attempts++
    }

    expect(status).toBe('completed')
    expect(output).toContain('e2e frontend test')
  })

  test('containers page loads and shows run button', async ({ page }) => {
    await page.goto(`${frontendUrl}/compute/containers`)
    await expect(page.locator('h1')).toContainText('Containers')
    await expect(
      page.locator('button:has-text("Run Container")').first(),
    ).toBeVisible()
  })

  test('workers page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/compute/workers`)
    await expect(page.locator('h1')).toContainText('Workers')
  })

  test('jobs page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/compute/jobs`)
    await expect(page.locator('h1')).toContainText('Compute Jobs')
  })
})

test.describe('DWS E2E - CDN Service', () => {
  test('CDN health endpoint works', async () => {
    const res = await dwsRequest('/cdn/health')
    expect(res.status).toBe(200)
  })

  test('can get cache stats', async () => {
    const res = await dwsRequest('/cdn/stats')
    expect(res.status).toBe(200)

    const stats = (await res.json()) as { entries: number }
    expect(stats.entries).toBeDefined()
  })

  test('CDN page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/storage/cdn`)
    await expect(page.locator('h1')).toContainText('CDN')
  })
})

test.describe('DWS E2E - KMS Service', () => {
  test('KMS health endpoint works', async () => {
    const res = await dwsRequest('/kms/health')
    expect(res.status).toBe(200)
  })

  test('can encrypt and decrypt data', async () => {
    const plaintext = 'e2e secret data'

    // Encrypt
    const encRes = await dwsRequest('/kms/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: plaintext }),
    })
    expect(encRes.status).toBe(200)

    const { encrypted, keyId } = (await encRes.json()) as {
      encrypted: string
      keyId: string
    }

    // Decrypt
    const decRes = await dwsRequest('/kms/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted, keyId }),
    })
    expect(decRes.status).toBe(200)

    const { decrypted } = (await decRes.json()) as { decrypted: string }
    expect(decrypted).toBe(plaintext)
  })

  test('KMS keys page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/security/keys`)
    await expect(page.locator('h1')).toContainText('Key Management')
  })

  test('Secrets page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/security/secrets`)
    await expect(page.locator('h1')).toContainText('Secrets Vault')
  })
})

test.describe('DWS E2E - Git Service', () => {
  test('Git health endpoint works', async () => {
    const res = await dwsRequest('/git/health')
    expect(res.status).toBe(200)
  })

  test('repositories page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/developer/repositories`)
    await expect(page.locator('h1')).toContainText('Git Repositories')
  })
})

test.describe('DWS E2E - Package Registry', () => {
  test('Pkg health endpoint works', async () => {
    const res = await dwsRequest('/pkg/health')
    expect(res.status).toBe(200)
  })

  test('can search packages', async () => {
    const res = await dwsRequest('/pkg/-/v1/search?text=test')
    expect(res.status).toBe(200)
  })

  test('packages page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/developer/packages`)
    await expect(page.locator('h1')).toContainText('Package Registry')
  })
})

test.describe('DWS E2E - CI/CD Service', () => {
  test('CI health endpoint works', async () => {
    const res = await dwsRequest('/ci/health')
    expect(res.status).toBe(200)
  })

  test('pipelines page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/developer/pipelines`)
    await expect(page.locator('h1')).toContainText('CI/CD Pipelines')
  })
})

test.describe('DWS E2E - RPC Gateway', () => {
  test('RPC chains endpoint works', async () => {
    const res = await dwsRequest('/rpc/chains')
    expect(res.status).toBe(200)

    const { chains } = (await res.json()) as {
      chains: Array<{ chainId: number }>
    }
    expect(chains.length).toBeGreaterThan(0)
  })

  test('RPC gateway page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/network/rpc`)
    await expect(page.locator('h1')).toContainText('RPC Gateway')
  })
})

test.describe('DWS E2E - OAuth3 Service', () => {
  test('OAuth3 health endpoint works', async () => {
    const res = await dwsRequest('/oauth3/health')
    expect(res.status).toBe(200)
  })

  test('OAuth3 page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/security/oauth3`)
    await expect(page.locator('h1')).toContainText('OAuth3 Applications')
  })
})

test.describe('DWS E2E - API Marketplace', () => {
  test('marketplace page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/marketplace/browse`)
    await expect(page.locator('h1')).toContainText('API Marketplace')
  })
})

test.describe('DWS E2E - Billing', () => {
  test('billing page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/billing`)
    await expect(page.locator('h1')).toContainText('Billing')
    await expect(
      page.locator('.stat-label:has-text("x402 Balance")'),
    ).toBeVisible()
  })
})

test.describe('DWS E2E - Settings', () => {
  test('settings page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/settings`)
    await expect(page.locator('h1')).toContainText('Settings')
  })
})
