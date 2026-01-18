/**
 * Deployment Verification Module
 *
 * Automatically verifies that deployed apps are working correctly.
 * Fails deployment if verification fails.
 */

import { z } from 'zod'

export interface VerificationConfig {
  name: string
  frontendUrl: string
  backendUrl: string
  healthEndpoint: string
  expectedService: string
  timeout: number
  retries: number
}

export interface VerificationResult {
  success: boolean
  frontend: { ok: boolean; error?: string }
  backend: { ok: boolean; status?: string; service?: string; error?: string }
  duration: number
}

const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'healthy']),
  service: z.string().optional(),
})

/**
 * Verify frontend returns HTML
 */
async function verifyFrontend(
  url: string,
  timeout: number,
): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` }
    }

    const text = await response.text()
    const hasHtml = text.includes('<!DOCTYPE html') || text.includes('<html')

    if (!hasHtml) {
      // Check if it's JSON (which means frontend is not serving correctly)
      try {
        JSON.parse(text)
        return { ok: false, error: 'Returned JSON instead of HTML' }
      } catch {
        return { ok: false, error: 'Invalid HTML response' }
      }
    }

    return { ok: true }
  } catch (error) {
    clearTimeout(timeoutId)
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

/**
 * Verify backend health endpoint returns JSON with status ok/healthy
 */
async function verifyBackend(
  url: string,
  expectedService: string,
  timeout: number,
): Promise<{ ok: boolean; status?: string; service?: string; error?: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` }
    }

    const contentType = response.headers.get('content-type')
    if (!contentType?.includes('application/json')) {
      return { ok: false, error: `Expected JSON, got ${contentType}` }
    }

    const json: unknown = await response.json()
    const parsed = HealthResponseSchema.safeParse(json)

    if (!parsed.success) {
      return {
        ok: false,
        error: `Invalid health response: ${JSON.stringify(json)}`,
      }
    }

    const { status, service } = parsed.data

    // Verify service name matches (if expected)
    if (
      expectedService &&
      service &&
      !service.toLowerCase().includes(expectedService.toLowerCase())
    ) {
      return {
        ok: false,
        status,
        service,
        error: `Service mismatch: expected ${expectedService}, got ${service}`,
      }
    }

    return { ok: true, status, service }
  } catch (error) {
    clearTimeout(timeoutId)
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

/**
 * Verify a deployed app with retries
 */
export async function verifyDeployment(
  config: VerificationConfig,
): Promise<VerificationResult> {
  const start = Date.now()

  console.log(`\n[Verify] Checking ${config.name}...`)

  let frontendResult: { ok: boolean; error?: string } = {
    ok: false,
    error: 'Not tested',
  }
  let backendResult: {
    ok: boolean
    status?: string
    service?: string
    error?: string
  } = {
    ok: false,
    error: 'Not tested',
  }

  // Retry loop
  for (let attempt = 1; attempt <= config.retries; attempt++) {
    if (attempt > 1) {
      console.log(`[Verify] Retry ${attempt}/${config.retries}...`)
      await new Promise((r) => setTimeout(r, 2000 * attempt)) // Exponential backoff
    }

    // Check frontend
    frontendResult = await verifyFrontend(config.frontendUrl, config.timeout)
    if (frontendResult.ok) {
      console.log(`   Frontend: OK`)
    } else {
      console.log(`   Frontend: FAIL - ${frontendResult.error}`)
    }

    // Check backend health
    backendResult = await verifyBackend(
      config.healthEndpoint,
      config.expectedService,
      config.timeout,
    )
    if (backendResult.ok) {
      console.log(`   Backend:  OK (${backendResult.service})`)
    } else {
      console.log(`   Backend:  FAIL - ${backendResult.error}`)
    }

    // If both pass, we're done
    if (frontendResult.ok && backendResult.ok) {
      break
    }
  }

  const duration = Date.now() - start

  return {
    success: frontendResult.ok && backendResult.ok,
    frontend: frontendResult,
    backend: backendResult,
    duration,
  }
}

/**
 * Verify deployment and throw if failed
 */
export async function verifyDeploymentOrFail(
  config: VerificationConfig,
): Promise<void> {
  const result = await verifyDeployment(config)

  if (!result.success) {
    const errors: string[] = []
    if (!result.frontend.ok) {
      errors.push(`Frontend: ${result.frontend.error}`)
    }
    if (!result.backend.ok) {
      errors.push(`Backend: ${result.backend.error}`)
    }
    throw new Error(`Deployment verification failed:\n  ${errors.join('\n  ')}`)
  }

  console.log(
    `[Verify] ${config.name} verified successfully (${result.duration}ms)`,
  )
}

/**
 * Create verification config for a standard app
 */
export function createVerificationConfig(
  name: string,
  network: 'localnet' | 'testnet' | 'mainnet',
  options?: {
    expectedService?: string
    timeout?: number
    retries?: number
    customPaths?: { frontend?: string; health?: string }
  },
): VerificationConfig {
  const domain =
    network === 'localnet'
      ? `${name}.local.jejunetwork.org`
      : network === 'testnet'
        ? `${name}.testnet.jejunetwork.org`
        : `${name}.jejunetwork.org`

  const baseUrl = `https://${domain}`

  return {
    name,
    frontendUrl: `${baseUrl}${options?.customPaths?.frontend ?? '/'}`,
    backendUrl: baseUrl,
    healthEndpoint: `${baseUrl}${options?.customPaths?.health ?? '/health'}`,
    expectedService: options?.expectedService ?? name,
    timeout: options?.timeout ?? 15000,
    retries: options?.retries ?? 3,
  }
}

/**
 * Verify all apps in a list
 */
export async function verifyAllApps(
  apps: Array<{ name: string; expectedService?: string }>,
  network: 'localnet' | 'testnet' | 'mainnet',
): Promise<{ allPassed: boolean; results: Map<string, VerificationResult> }> {
  const results = new Map<string, VerificationResult>()
  let allPassed = true

  for (const app of apps) {
    const config = createVerificationConfig(app.name, network, {
      expectedService: app.expectedService,
    })
    const result = await verifyDeployment(config)
    results.set(app.name, result)
    if (!result.success) {
      allPassed = false
    }
  }

  // Print summary
  console.log('\n==============================================')
  console.log('   DEPLOYMENT VERIFICATION SUMMARY')
  console.log('==============================================')
  for (const [name, result] of results) {
    const status = result.success ? 'OK' : 'FAIL'
    console.log(`   ${name.padEnd(12)}: [${status}]`)
  }
  console.log('==============================================')

  return { allPassed, results }
}
