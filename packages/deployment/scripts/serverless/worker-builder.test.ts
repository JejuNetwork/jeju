/**
 * Worker Builder Security Tests
 *
 * Validates that worker-builder does NOT embed secrets at build time.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Patterns that indicate embedded secrets - these should NEVER appear
// (Defined here for documentation/future use in more comprehensive tests)
export const SECRET_PATTERNS = [
  /PRIVATE_KEY.*=.*['"][^'"]{20,}['"]/g,
  /API_KEY.*=.*['"][^'"]{20,}['"]/g,
  /SECRET.*=.*['"][^'"]{20,}['"]/g,
  /PASSWORD.*=.*['"][^'"]{20,}['"]/g,
  /0x[a-fA-F0-9]{64}/g, // Private keys
  /sk-[a-zA-Z0-9]{32,}/g, // OpenAI keys
]

// Safe patterns - these are allowed because they read at RUNTIME
export const SAFE_PATTERNS = [/process\.env\./g, /env\./g, /FROM_ENVIRONMENT/g]

describe('Worker Builder Security', () => {
  const builderPath = join(import.meta.dir, 'worker-builder.ts')

  test('should exist', () => {
    const content = readFileSync(builderPath, 'utf-8')
    expect(content.length).toBeGreaterThan(0)
  })

  test('wrapper templates should NOT embed hardcoded values', () => {
    const content = readFileSync(builderPath, 'utf-8')

    // Check for hardcoded network values in templates
    // The old pattern was: NETWORK: '${getCurrentNetwork()}'
    // This is BAD because getCurrentNetwork() is called at BUILD time
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing for template literal pattern
    expect(content).not.toContain("NETWORK: '${getCurrentNetwork()}'")

    // The new pattern should be: process.env.JEJU_NETWORK
    // This is GOOD because it reads at RUNTIME
    expect(content).toContain('process.env.JEJU_NETWORK')
  })

  test('capnp config should use FROM_ENVIRONMENT bindings', () => {
    const content = readFileSync(builderPath, 'utf-8')

    // Check that capnp generation uses fromEnvironment, not hardcoded text
    expect(content).toContain('fromEnvironment')
  })

  test('should have security comments in wrapper templates', () => {
    const content = readFileSync(builderPath, 'utf-8')

    // Should have explicit security comments
    expect(content).toContain('SECURITY')
    expect(content).toContain('No secrets')
  })

  test('should include KMS configuration in env template', () => {
    const content = readFileSync(builderPath, 'utf-8')

    // Workers need these to fetch secrets from KMS
    expect(content).toContain('KMS_ENDPOINT')
    expect(content).toContain('KMS_SECRET_IDS')
  })

  test('should NOT call getCurrentNetwork at build time in templates', () => {
    const content = readFileSync(builderPath, 'utf-8')

    // Find the wrapper template strings (between backticks after 'wrapper = `')
    const templateMatches = content.match(/wrapper\s*=\s*`[^`]+`/g) ?? []

    for (const template of templateMatches) {
      // Inside templates, ${getCurrentNetwork()} is evaluated at BUILD time - BAD
      // process.env.NETWORK is read at RUNTIME - GOOD
      expect(template).not.toContain('getCurrentNetwork()')
    }
  })
})

describe('Capnp Config Security', () => {
  const builderPath = join(import.meta.dir, 'worker-builder.ts')

  test('should use fromEnvironment for sensitive bindings', () => {
    const content = readFileSync(builderPath, 'utf-8')

    // These should be fromEnvironment, not hardcoded text
    // Pattern in the file is: fromEnvironment = "JEJU_NETWORK"
    const expectedFromEnv = [
      'JEJU_NETWORK',
      'TEE_MODE',
      'TEE_REGION',
      'KMS_ENDPOINT',
    ]

    for (const envVar of expectedFromEnv) {
      // Should have fromEnvironment = "VAR_NAME" pattern
      expect(content).toContain(`fromEnvironment = "${envVar}"`)
    }
  })

  test('should NOT embed secrets as text bindings', () => {
    const content = readFileSync(builderPath, 'utf-8')

    // Find the capnp generation section
    const capnpSection = content.match(
      /generateCapnpConfig[\s\S]*?writeFileSync/,
    )?.[0]

    if (capnpSection) {
      // Should NOT have text = "some_value" for secrets
      expect(capnpSection).not.toMatch(/text\s*=\s*"[^"]{20,}"/)
    }
  })
})

describe('Wrangler Config Security', () => {
  const builderPath = join(import.meta.dir, 'worker-builder.ts')

  test('should use env var references in wrangler.toml', () => {
    const content = readFileSync(builderPath, 'utf-8')

    // The wrangler.toml template uses $VAR_NAME references for runtime values
    // Not hardcoded strings - this ensures values are read at deployment/runtime
    expect(content).toContain('JEJU_NETWORK = "$JEJU_NETWORK"')
    expect(content).toContain('TEE_MODE = "$TEE_MODE"')
    expect(content).toContain('KMS_ENDPOINT = "$KMS_ENDPOINT"')
  })

  test('should document KMS for secrets in wrangler.toml', () => {
    const content = readFileSync(builderPath, 'utf-8')

    // Wrangler config should mention KMS for secrets
    expect(content).toContain('KMS')
    expect(content).toContain('runtime')
  })
})
