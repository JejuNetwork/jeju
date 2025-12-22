#!/usr/bin/env bun

/**
 * Terraform wrapper for infrastructure management
 *
 * Usage:
 *   NETWORK=testnet bun run scripts/terraform.ts plan
 *   NETWORK=testnet bun run scripts/terraform.ts apply
 *   NETWORK=mainnet bun run scripts/terraform.ts destroy
 */

import { join } from 'node:path'
import { $ } from 'bun'
import {
  createCommandValidator,
  getRequiredNetwork,
  type NetworkType,
} from './shared'

const ROOT = join(import.meta.dir, '..')

const VALID_COMMANDS = ['init', 'plan', 'apply', 'destroy', 'output'] as const
type ValidCommand = (typeof VALID_COMMANDS)[number]

const getRequiredCommand = createCommandValidator(
  VALID_COMMANDS,
  'terraform.ts',
)

const NETWORK: NetworkType = getRequiredNetwork()
const COMMAND: ValidCommand = getRequiredCommand()

async function runTerraform(
  tfDir: string,
  command: ValidCommand,
): Promise<{ exitCode: number }> {
  switch (command) {
    case 'init':
      return $`cd ${tfDir} && terraform init`.nothrow()
    case 'plan':
      return $`cd ${tfDir} && terraform plan -out=tfplan`.nothrow()
    case 'apply':
      return $`cd ${tfDir} && terraform apply -auto-approve tfplan`.nothrow()
    case 'destroy':
      console.log('⚠️  This will destroy all infrastructure!')
      return $`cd ${tfDir} && terraform destroy -auto-approve`.nothrow()
    case 'output':
      return $`cd ${tfDir} && terraform output -json`.nothrow()
  }
}

async function main(): Promise<void> {
  const tfDir = join(ROOT, 'terraform/environments', NETWORK)
  console.log(`🏗️  Terraform ${COMMAND} for ${NETWORK}\n`)

  if (COMMAND !== 'init') {
    await $`cd ${tfDir} && terraform init`.quiet()
  }

  const result = await runTerraform(tfDir, COMMAND)

  if (result.exitCode !== 0) {
    console.error(`\n❌ Terraform ${COMMAND} failed`)
    process.exit(1)
  }

  console.log(`\n✅ Terraform ${COMMAND} complete\n`)
}

main()
