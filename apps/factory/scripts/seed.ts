#!/usr/bin/env bun

/**
 * Factory Seeder (localnet/testnet)
 *
 * Seeds Factory with minimal data needed for E2E flows.
 * Requires a signer for Factory auth headers.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDWSUrl } from '@jejunetwork/config'
import { getTestConfig } from '@jejunetwork/config/test-config'
import { JsonValueSchema } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

const NetworkSchema = z.enum(['localnet', 'testnet'])
const PrivateKeySchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/)
  .transform((value) => value as Hex)

const DeployerConfigSchema = z.object({
  address: z.string(),
  privateKey: PrivateKeySchema,
})

type JsonValue = z.infer<typeof JsonValueSchema>

const DEFAULT_LOCALNET_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

function resolveNetwork(): 'localnet' | 'testnet' {
  const envNetwork = process.env.NETWORK || process.env.JEJU_NETWORK
  if (envNetwork) {
    return NetworkSchema.parse(envNetwork)
  }
  return 'localnet'
}

function loadTestnetDeployerKey(): Hex {
  const keyPath = join(
    import.meta.dir,
    '../../../packages/deployment/.keys/testnet-deployer.json',
  )
  if (!existsSync(keyPath)) {
    throw new Error(`Missing testnet deployer key at ${keyPath}`)
  }
  const raw = readFileSync(keyPath, 'utf-8')
  const config = DeployerConfigSchema.parse(JSON.parse(raw))
  return config.privateKey
}

function resolvePrivateKey(network: 'localnet' | 'testnet'): Hex {
  const envKey = process.env.FACTORY_SEED_PRIVATE_KEY
  if (envKey) {
    return PrivateKeySchema.parse(envKey)
  }
  if (network === 'testnet') {
    return loadTestnetDeployerKey()
  }
  return DEFAULT_LOCALNET_PRIVATE_KEY as Hex
}

function buildAuthMessage(timestamp: number, nonce: string): string {
  return `Factory Auth\nTimestamp: ${timestamp}\nNonce: ${nonce}`
}

async function buildAuthHeaders(
  account: ReturnType<typeof privateKeyToAccount>,
): Promise<Record<string, string>> {
  const timestamp = Date.now()
  const nonce = crypto.randomUUID()
  const message = buildAuthMessage(timestamp, nonce)
  const signature = await account.signMessage({ message })

  return {
    'x-jeju-address': account.address,
    'x-jeju-timestamp': `${timestamp}`,
    'x-jeju-signature': signature,
    'x-jeju-nonce': nonce,
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>,
  options?: { allowNotFound?: boolean },
): Promise<T | null> {
  const response = await fetch(url, init)
  if (!response.ok) {
    if (options?.allowNotFound && response.status === 404) {
      return null
    }
    const body = await response.text()
    throw new Error(`${init.method || 'GET'} ${url} failed: ${body}`)
  }
  const parsed = schema.safeParse(await response.json())
  if (!parsed.success) {
    throw new Error(`Invalid JSON response from ${url}`)
  }
  return parsed.data
}

async function getJson(
  url: string,
  options?: { allowNotFound?: boolean },
): Promise<JsonValue | null> {
  return requestJson(url, { method: 'GET' }, JsonValueSchema, options)
}

async function postJson(
  url: string,
  body: Record<string, JsonValue>,
  account: ReturnType<typeof privateKeyToAccount>,
): Promise<JsonValue | null> {
  const authHeaders = await buildAuthHeaders(account)
  return requestJson(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(body),
    },
    JsonValueSchema,
  )
}

function hasListItems(result: JsonValue, key: string): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return false
  }
  const record = result as Record<string, JsonValue>
  const list = record[key]
  if (!Array.isArray(list)) return false
  return list.length > 0
}

async function seedBounties(
  apiUrl: string,
  account: ReturnType<typeof privateKeyToAccount>,
): Promise<void> {
  const list = await getJson(`${apiUrl}/api/bounties`)
  if (hasListItems(list, 'bounties')) {
    console.log('Bounties already seeded')
    return
  }
  const deadline = Date.now() + 7 * 24 * 60 * 60 * 1000
  await postJson(
    `${apiUrl}/api/bounties`,
    {
      title: 'Security audit for DWS worker sandbox',
      description:
        'Review worker sandbox permissions and propose hardening steps.',
      reward: '2500',
      currency: 'JEJU',
      skills: ['security', 'workers', 'typescript'],
      deadline,
      milestones: [
        {
          name: 'Audit report',
          description: 'Deliver report with findings and mitigations.',
          reward: '1500',
          currency: 'JEJU',
          deadline,
        },
      ],
    },
    account,
  )
  console.log('Seeded bounties')
}

async function seedJobs(
  apiUrl: string,
  account: ReturnType<typeof privateKeyToAccount>,
): Promise<void> {
  const list = await getJson(`${apiUrl}/api/jobs`)
  if (hasListItems(list, 'jobs')) {
    console.log('Jobs already seeded')
    return
  }
  await postJson(
    `${apiUrl}/api/jobs`,
    {
      title: 'Senior Solidity Engineer',
      company: 'Jeju Network',
      type: 'full-time',
      remote: true,
      location: 'Remote',
      skills: ['solidity', 'evm', 'security'],
      description: 'Build core protocol contracts and audit tooling.',
      salary: {
        min: 180,
        max: 250,
        currency: 'USD',
        period: 'hour',
      },
    },
    account,
  )
  console.log('Seeded jobs')
}

async function seedModels(
  apiUrl: string,
  account: ReturnType<typeof privateKeyToAccount>,
): Promise<void> {
  const list = await getJson(`${apiUrl}/api/models`)
  if (hasListItems(list, 'models')) {
    console.log('Models already seeded')
    return
  }
  await postJson(
    `${apiUrl}/api/models`,
    {
      name: 'llama-3-jeju-ft',
      organization: 'jeju',
      description: 'Jeju fine-tuned Llama 3 for smart contract analysis.',
      type: 'llm',
      fileUri: 'ipfs://bafybeigdyr6modelseed',
    },
    account,
  )
  console.log('Seeded models')
}

async function seedProjects(
  apiUrl: string,
  account: ReturnType<typeof privateKeyToAccount>,
): Promise<void> {
  const list = await getJson(`${apiUrl}/api/projects`, {
    allowNotFound: true,
  })
  if (!list) {
    console.log('Projects endpoint not available, skipping')
    return
  }
  if (hasListItems(list, 'projects')) {
    console.log('Projects already seeded')
    return
  }
  const created = await postJson(
    `${apiUrl}/api/projects`,
    {
      name: 'Factory Launch Checklist',
      description: 'Prepare Factory launch tasks for testnet rollout.',
      visibility: 'public',
    },
    account,
  )
  if (!created) {
    console.log('Projects endpoint not available, skipping')
    return
  }
  if (
    created &&
    typeof created === 'object' &&
    !Array.isArray(created) &&
    typeof (created as Record<string, JsonValue>).id === 'string'
  ) {
    const projectId = (created as Record<string, JsonValue>).id as string
    await postJson(
      `${apiUrl}/api/projects/${projectId}/tasks`,
      {
        title: 'Confirm testnet data availability',
      },
      account,
    )
  }
  console.log('Seeded projects')
}

async function seedCI(
  apiUrl: string,
  account: ReturnType<typeof privateKeyToAccount>,
  repoRef: string,
): Promise<void> {
  const list = await getJson(`${apiUrl}/api/ci`)
  if (hasListItems(list, 'runs')) {
    console.log('CI already seeded')
    return
  }
  await postJson(
    `${apiUrl}/api/ci`,
    {
      workflow: 'deploy',
      repo: repoRef,
      branch: 'main',
    },
    account,
  )
  console.log('Seeded CI runs')
}

async function seedIssuesAndPulls(
  apiUrl: string,
  account: ReturnType<typeof privateKeyToAccount>,
  repoRef: string,
): Promise<void> {
  await postJson(
    `${apiUrl}/api/issues`,
    {
      repo: repoRef,
      title: 'Fix SQLit initialization on testnet',
      body: 'Ensure SQLit DBs are initialized after provisioning.',
      labels: ['bug', 'sqlit'],
    },
    account,
  )
  await postJson(
    `${apiUrl}/api/pulls`,
    {
      repo: repoRef,
      title: 'Improve worker env propagation',
      body: 'Adds explicit env injection on deploy.',
      sourceBranch: 'env-fix',
      targetBranch: 'main',
      isDraft: false,
    },
    account,
  )
  console.log('Seeded issues and pulls')
}

async function createDwsRepository(
  dwsUrl: string,
  account: ReturnType<typeof privateKeyToAccount>,
): Promise<{
  owner: string
  name: string
}> {
  const response = await fetch(`${dwsUrl}/git/repos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': account.address,
    },
    body: JSON.stringify({
      name: 'factory',
      description: 'Factory testnet seed repository',
      isPrivate: false,
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    if (body.includes('already exists')) {
      return { owner: account.address, name: 'factory' }
    }
    throw new Error(`DWS repo create failed: ${body}`)
  }
  const parsed = JsonValueSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new Error('Invalid DWS repo response')
  }
  const repo = parsed.data as Record<string, JsonValue>
  const owner = typeof repo.owner === 'string' ? repo.owner : 'jeju'
  const name = typeof repo.name === 'string' ? repo.name : 'factory'
  return { owner, name }
}

async function publishDwsPackage(dwsUrl: string): Promise<void> {
  const tempDir = join(import.meta.dir, '.seed-package')
  const packageDir = join(tempDir, 'package')
  await Bun.$`rm -rf ${tempDir}`
  await Bun.$`mkdir -p ${packageDir}`

  const pkg = {
    name: '@jejunetwork/sdk',
    version: '1.0.0',
    description: 'Seeded SDK package for testnet',
    main: 'index.js',
  }
  await Bun.write(join(packageDir, 'package.json'), JSON.stringify(pkg, null, 2))
  await Bun.write(join(packageDir, 'README.md'), '# Jeju SDK\nSeed package')
  await Bun.write(join(packageDir, 'index.js'), 'export const seed = true\n')

  const tarballPath = join(tempDir, 'package.tgz')
  await Bun.$`tar -czf ${tarballPath} -C ${tempDir} package`

  const tarball = Bun.file(tarballPath)
  const formData = new FormData()
  formData.append('tarball', tarball)
  formData.append(
    'metadata',
    JSON.stringify({ name: pkg.name, version: pkg.version }),
  )

  const response = await fetch(`${dwsUrl}/pkg`, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    const body = await response.text()
    if (response.status === 404 || body.includes('NOT_FOUND')) {
      console.log('DWS package registry not available, skipping')
      return
    }
    throw new Error(`DWS package publish failed: ${body}`)
  }
  console.log('Seeded DWS package registry')
}

async function main(): Promise<void> {
  const network = resolveNetwork()
  if (network !== 'localnet' && network !== 'testnet') {
    throw new Error(`Unsupported network: ${network}`)
  }

  const config = getTestConfig('factory', network)
  const apiUrl = process.env.FACTORY_API_URL || config.apiURL
  const dwsUrl = process.env.DWS_URL || getDWSUrl(network)

  const privateKey = resolvePrivateKey(network)
  const account = privateKeyToAccount(privateKey)
  console.log(`Seeding Factory on ${network}`)
  console.log(`Factory API: ${apiUrl}`)
  console.log(`DWS URL: ${dwsUrl}`)
  console.log(`Signer: ${account.address}`)

  await seedBounties(apiUrl, account)
  await seedJobs(apiUrl, account)
  await seedModels(apiUrl, account)
  await seedProjects(apiUrl, account)

  const repo = await createDwsRepository(dwsUrl, account)
  const repoRef = `${repo.owner}/${repo.name}`
  await seedIssuesAndPulls(apiUrl, account, repoRef)
  await seedCI(apiUrl, account, repoRef)

  await publishDwsPackage(dwsUrl)
  console.log('Factory seeding complete')
}

main().catch((error: Error) => {
  console.error(error.message)
  process.exit(1)
})
