/**
 * Test Environment Setup
 *
 * Ensures all required dependencies are available before tests run.
 * Tests should NEVER skip - if dependencies are missing, fail with clear instructions.
 *
 * Required for tests:
 * - Docker (for container tests)
 * - EQLite (for database tests)
 * - Chain (for on-chain tests)
 * - AI providers (for inference tests)
 */

import { getEQLiteBlockProducerUrl, getJejuRpcUrl } from '@jejunetwork/config'

export interface TestEnvironment {
  docker: boolean
  eqlite: boolean
  chain: boolean
  openai: boolean
  anthropic: boolean
  groq: boolean
}

/**
 * Check if Docker is available
 */
async function checkDocker(): Promise<boolean> {
  try {
    const result = Bun.spawnSync(['docker', 'info'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    return result.exitCode === 0
  } catch {
    return false
  }
}

/**
 * Check if EQLite is available
 */
async function checkEQLite(): Promise<boolean> {
  const url =
    process.env.EQLITE_BLOCK_PRODUCER_ENDPOINT ?? getEQLiteBlockProducerUrl()
  if (!url) return false

  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Check if Jeju chain is running
 */
async function checkChain(): Promise<boolean> {
  const rpcUrl = getJejuRpcUrl()
  if (!rpcUrl) return false

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Detect available test environment
 */
export async function detectEnvironment(): Promise<TestEnvironment> {
  const [docker, eqlite, chain] = await Promise.all([
    checkDocker(),
    checkEQLite(),
    checkChain(),
  ])

  return {
    docker,
    eqlite,
    chain,
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
  }
}

/**
 * Require a dependency to be available, fail with instructions if not
 */
export function requireDependency(
  name: string,
  available: boolean,
  instructions: string,
): void {
  if (!available) {
    throw new Error(
      `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `TEST ENVIRONMENT ERROR: ${name} is not available\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `\n` +
        `${instructions}\n` +
        `\n` +
        `Tests MUST NOT be skipped. Fix the environment and retry.\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
    )
  }
}

/**
 * Setup instructions for each dependency
 */
export const SETUP_INSTRUCTIONS = {
  docker: `
To enable Docker tests:
  1. Install Docker: https://docs.docker.com/get-docker/
  2. Start Docker daemon: sudo systemctl start docker
  3. Verify: docker info`,

  eqlite: `
To enable EQLite tests:
  1. Start EQLite: bun run jeju start eqlite
  2. Or set: export EQLITE_BLOCK_PRODUCER_ENDPOINT=http://localhost:4444
  3. Verify: curl http://localhost:4444/health`,

  chain: `
To enable chain tests:
  1. Start local chain: bun run jeju chain start
  2. Or use testnet: export JEJU_NETWORK=testnet
  3. Verify: curl -X POST http://localhost:8545 -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'`,

  openai: `
To enable OpenAI tests:
  1. Get API key from https://platform.openai.com
  2. Set: export OPENAI_API_KEY=sk-...`,

  anthropic: `
To enable Anthropic tests:
  1. Get API key from https://console.anthropic.com
  2. Set: export ANTHROPIC_API_KEY=sk-ant-...`,

  groq: `
To enable Groq tests:
  1. Get API key from https://console.groq.com
  2. Set: export GROQ_API_KEY=gsk_...`,
}

/**
 * Require all dependencies for full test suite
 */
export async function requireFullEnvironment(): Promise<TestEnvironment> {
  const env = await detectEnvironment()

  requireDependency('Docker', env.docker, SETUP_INSTRUCTIONS.docker)
  requireDependency('EQLite', env.eqlite, SETUP_INSTRUCTIONS.eqlite)
  requireDependency('Jeju Chain', env.chain, SETUP_INSTRUCTIONS.chain)

  // AI providers - at least one must be available
  const hasAnyAI = env.openai || env.anthropic || env.groq
  if (!hasAnyAI) {
    requireDependency(
      'AI Provider (OpenAI/Anthropic/Groq)',
      false,
      `${SETUP_INSTRUCTIONS.openai}\n\nOR\n${SETUP_INSTRUCTIONS.anthropic}\n\nOR\n${SETUP_INSTRUCTIONS.groq}`,
    )
  }

  return env
}
