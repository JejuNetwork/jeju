#!/usr/bin/env bun

/**
 * Helmfile wrapper for Kubernetes deployments
 *
 * Usage:
 *   NETWORK=testnet bun run scripts/helmfile.ts sync
 *   NETWORK=testnet bun run scripts/helmfile.ts diff
 *   NETWORK=mainnet bun run scripts/helmfile.ts destroy
 */

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

async function main(): Promise<void> {
  const helmfileDir = join(ROOT, 'kubernetes/helmfile')
  console.log(`☸️  Helmfile ${COMMAND} for ${NETWORK}\n`)

  const result =
    await $`cd ${helmfileDir} && helmfile -e ${NETWORK} ${COMMAND}`.nothrow()

  if (result.exitCode !== 0) {
    console.error(`\n❌ Helmfile ${COMMAND} failed`)
    process.exit(1)
  }

  console.log(`\n✅ Helmfile ${COMMAND} complete\n`)
}

main()
