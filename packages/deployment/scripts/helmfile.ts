#!/usr/bin/env bun

/**
 * Helmfile wrapper for Kubernetes deployments
 *
 * Usage:
 *   NETWORK=testnet bun run scripts/helmfile.ts sync
 *   NETWORK=testnet bun run scripts/helmfile.ts diff
 *   NETWORK=mainnet bun run scripts/helmfile.ts destroy
 */

import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { $ } from 'bun'
import {
  createCommandValidator,
  getRequiredNetwork,
  type NetworkType,
} from './shared'

const ROOT = join(import.meta.dir, '..')

const VALID_COMMANDS = [
  'diff',
  'sync',
  'apply',
  'destroy',
  'status',
  'list',
] as const
type ValidCommand = (typeof VALID_COMMANDS)[number]

const getRequiredCommand = createCommandValidator(VALID_COMMANDS, 'helmfile.ts')

const NETWORK: NetworkType = getRequiredNetwork()
const COMMAND: ValidCommand = getRequiredCommand()

function getOrGenerateJwtSecret(): string {
  // Check for existing JWT secret in environment
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET
  }

  // Try to read from kubernetes secret if it exists
  const existingSecret = execSync(
    'kubectl get secret jwt-secret -n op-stack -o jsonpath="{.data.jwt-secret\\.txt}" 2>/dev/null | base64 -d || true',
    { encoding: 'utf-8' },
  ).trim()

  if (existingSecret && existingSecret.length === 64) {
    console.log('Using existing JWT secret from kubernetes')
    return existingSecret
  }

  // Generate new secret
  const newSecret = execSync('openssl rand -hex 32', { encoding: 'utf-8' }).trim()
  console.log('Generated new JWT secret')
  return newSecret
}

async function ensureJwtSecretsExist(jwtSecret: string): Promise<void> {
  const namespaces = ['l1', 'l2-base', 'l2-optimism', 'op-stack', 'execution', 'rpc']

  for (const ns of namespaces) {
    // Create namespace if it doesn't exist
    await $`kubectl create namespace ${ns} --dry-run=client -o yaml | kubectl apply -f - 2>&1`.nothrow()

    // Create or update the jwt secret
    await $`kubectl create secret generic jwt-secret --from-literal=jwt-secret.txt=${jwtSecret} -n ${ns} --dry-run=client -o yaml | kubectl apply -f - 2>&1`.nothrow()
  }
}

async function main(): Promise<void> {
  const helmfileDir = join(ROOT, 'kubernetes/helmfile')
  console.log(`☸️  Helmfile ${COMMAND} for ${NETWORK}\n`)

  // Generate or retrieve JWT secret
  const jwtSecret = getOrGenerateJwtSecret()

  // Ensure secrets exist in all namespaces
  if (COMMAND === 'sync' || COMMAND === 'apply') {
    console.log('Ensuring JWT secrets exist in all namespaces...')
    await ensureJwtSecretsExist(jwtSecret)
  }

  // Set JWT_SECRET environment variable for templating
  process.env.JWT_SECRET = jwtSecret

  // Run helmfile without global --set (secrets are in kubernetes secrets)
  const result = await $`cd ${helmfileDir} && JWT_SECRET=${jwtSecret} helmfile -e ${NETWORK} ${COMMAND}`.nothrow()

  if (result.exitCode !== 0) {
    console.error(`\n❌ Helmfile ${COMMAND} failed`)
    process.exit(1)
  }

  console.log(`\n✅ Helmfile ${COMMAND} complete\n`)
}

main()
