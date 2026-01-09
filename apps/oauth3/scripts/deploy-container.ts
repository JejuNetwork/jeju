#!/usr/bin/env bun
/**
 * OAuth3 DWS Container Deployment
 *
 * Deploys OAuth3 as a DWS-managed container service with:
 * - MPC threshold signing (2-of-3 for testnet)
 * - TEE support (SGX/TDX when available)
 * - Automatic scaling and health monitoring
 * - IPFS-backed persistent storage
 *
 * This replaces K8s deployment with DWS container provisioning.
 *
 * Architecture:
 *   User → DWS Ingress → DWS App Router → DWS Container Provisioner → OAuth3 Container(s)
 *                                                ↓
 *                                         MPC Cluster (2-of-3)
 *                                                ↓
 *                                         KMS for sealed secrets
 */

import { getCoreAppUrl, getCurrentNetwork } from '@jejunetwork/config'
import { z } from 'zod'

const network = process.env.NETWORK ?? getCurrentNetwork()

function getDwsUrl(): string {
  if (network === 'testnet') {
    return 'https://dws.testnet.jejunetwork.org'
  }
  if (network === 'mainnet') {
    return 'https://dws.jejunetwork.org'
  }
  return getCoreAppUrl('DWS_API')
}

const DWS_URL = getDwsUrl()

// Response schemas
const OAuth3ServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  namespace: z.string(),
  status: z.enum(['creating', 'initializing', 'ready', 'failed']),
  endpoints: z.object({
    api: z.string(),
    mpc: z.string(),
  }),
  mpcClusterId: z.string(),
  thresholdPublicKey: z.string().nullable(),
  replicas: z.number(),
})

interface DeployConfig {
  name: string
  replicas: number
  mpcThreshold: number
  providers: Array<'google' | 'github' | 'twitter' | 'discord' | 'farcaster'>
  teeRequired: boolean
  owner: string
}

async function deployOAuth3(config: DeployConfig): Promise<void> {
  console.log('OAuth3 DWS Container Deployment')
  console.log('='.repeat(50))
  console.log(`Network: ${network}`)
  console.log(`DWS URL: ${DWS_URL}`)
  console.log(`Name: ${config.name}`)
  console.log(`Replicas: ${config.replicas}`)
  console.log(`MPC Threshold: ${config.mpcThreshold}-of-${config.replicas}`)
  console.log(`TEE Required: ${config.teeRequired}`)
  console.log(`Providers: ${config.providers.join(', ')}`)
  console.log('')

  // Step 1: Check if service already exists
  console.log('[1/3] Checking existing services...')
  const listResponse = await fetch(
    `${DWS_URL}/dws-services/oauth3?owner=${config.owner}`,
  )

  if (listResponse.ok) {
    const listData = (await listResponse.json()) as {
      services: Array<{ name: string; id: string; status: string }>
    }
    const existing = listData.services.find((s) => s.name === config.name)

    if (existing) {
      console.log(
        `  Found existing service: ${existing.id} (${existing.status})`,
      )

      if (existing.status === 'ready') {
        console.log('  Service already running. Use scale or terminate first.')
        return
      }

      // Terminate failed service
      if (existing.status === 'failed') {
        console.log('  Terminating failed service...')
        await fetch(`${DWS_URL}/dws-services/oauth3/${existing.id}`, {
          method: 'DELETE',
          headers: {
            'x-jeju-address': config.owner,
          },
        })
      }
    }
  }
  console.log('  No existing service found')

  // Step 2: Deploy OAuth3 container service
  console.log('\n[2/3] Deploying OAuth3 container service...')

  const deployRequest = {
    name: config.name,
    replicas: config.replicas,
    mpcThreshold: config.mpcThreshold,
    providers: config.providers,
    teeRequired: config.teeRequired,
  }

  const deployResponse = await fetch(`${DWS_URL}/dws-services/oauth3`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': config.owner,
    },
    body: JSON.stringify(deployRequest),
  })

  if (!deployResponse.ok) {
    const error = await deployResponse.text()
    throw new Error(`Deployment failed: ${error}`)
  }

  const deployData = (await deployResponse.json()) as {
    service: z.infer<typeof OAuth3ServiceSchema>
  }
  const service = deployData.service

  console.log(`  Service ID: ${service.id}`)
  console.log(`  Status: ${service.status}`)
  console.log(`  MPC Cluster: ${service.mpcClusterId}`)
  console.log(`  API Endpoint: ${service.endpoints.api}`)

  // Step 3: Wait for service to be ready
  console.log('\n[3/3] Waiting for service to be ready...')

  let ready = false
  let attempts = 0
  const maxAttempts = 60 // 5 minutes

  while (!ready && attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 5000))
    attempts++

    const statusResponse = await fetch(
      `${DWS_URL}/dws-services/oauth3/${service.id}`,
    )
    if (statusResponse.ok) {
      const statusData = (await statusResponse.json()) as {
        service: z.infer<typeof OAuth3ServiceSchema>
      }

      if (statusData.service.status === 'ready') {
        ready = true
        console.log('  Service is ready')
        console.log(
          `  Threshold Public Key: ${statusData.service.thresholdPublicKey}`,
        )
      } else if (statusData.service.status === 'failed') {
        throw new Error('Service deployment failed')
      } else {
        console.log(
          `  Status: ${statusData.service.status} (attempt ${attempts}/${maxAttempts})`,
        )
      }
    }
  }

  if (!ready) {
    throw new Error('Service did not become ready within timeout')
  }

  // Step 4: Update DWS app router to point to new container service
  console.log('\n[4/4] Updating DWS app routing...')

  const appUpdateResponse = await fetch(`${DWS_URL}/apps/deployed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-jeju-address': config.owner,
    },
    body: JSON.stringify({
      name: 'oauth3',
      jnsName: 'auth.jeju',
      // Remove K8s endpoint, use DWS service discovery
      backendEndpoint: null,
      // Point to DWS-managed service
      backendWorkerId: null,
      // Use DWS internal service discovery
      dwsServiceId: service.id,
      apiPaths: [
        '/api',
        '/oauth',
        '/wallet',
        '/session',
        '/farcaster',
        '/client',
        '/auth',
        '/callback',
        '/health',
        '/.well-known',
      ],
      spa: true,
      enabled: true,
    }),
  })

  if (!appUpdateResponse.ok) {
    console.warn(
      `  Warning: App routing update failed: ${await appUpdateResponse.text()}`,
    )
  } else {
    console.log('  App routing updated')
  }

  console.log(`\n${'='.repeat(50)}`)
  console.log('Deployment complete')
  console.log('')
  console.log('OAuth3 is now running as a DWS container service:')
  console.log(`  Service ID: ${service.id}`)
  console.log(
    `  API: https://oauth3.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`,
  )
  console.log(`  MPC Cluster: ${service.mpcClusterId}`)
  console.log('')
  console.log('Management commands:')
  console.log(
    `  Scale:     curl -X POST ${DWS_URL}/dws-services/oauth3/${service.id}/scale -d '{"replicas":5}'`,
  )
  console.log(`  Status:    curl ${DWS_URL}/dws-services/oauth3/${service.id}`)
  console.log(
    `  MPC Sign:  curl -X POST ${DWS_URL}/dws-services/oauth3/${service.id}/mpc/sign -d '{"message":"0x..."}'`,
  )
  console.log(
    `  Terminate: curl -X DELETE ${DWS_URL}/dws-services/oauth3/${service.id}`,
  )
}

// Default testnet configuration
const testnetConfig: DeployConfig = {
  name: 'oauth3',
  replicas: 3,
  mpcThreshold: 2, // 2-of-3
  providers: ['github', 'google'],
  teeRequired: false, // Use simulated TEE for testnet
  owner:
    process.env.DEPLOYER_ADDRESS ??
    '0x0000000000000000000000000000000000000000',
}

// Parse CLI args
const args = process.argv.slice(2)
const config = { ...testnetConfig }

for (let i = 0; i < args.length; i += 2) {
  const key = args[i]?.replace('--', '')
  const value = args[i + 1]

  if (key === 'replicas') config.replicas = parseInt(value, 10)
  if (key === 'threshold') config.mpcThreshold = parseInt(value, 10)
  if (key === 'tee') config.teeRequired = value === 'true'
  if (key === 'owner') config.owner = value
  if (key === 'name') config.name = value
}

deployOAuth3(config).catch((err) => {
  console.error('Deployment failed:', err)
  process.exit(1)
})
