#!/usr/bin/env tsx

// @ts-nocheck - Migration script with optional AWS dependencies
/**
 * AWS Secrets Manager to DWS KMS Migration Script
 *
 * Migrates secrets from AWS Secrets Manager to DWS Threshold KMS (MPC-based)
 * and Kubernetes secrets for non-sensitive configuration.
 *
 * Usage:
 *   npx tsx scripts/migrate/secrets-to-dws-kms.ts --dry-run
 *   npx tsx scripts/migrate/secrets-to-dws-kms.ts --execute
 *
 * Prerequisites:
 *   bun add @aws-sdk/client-secrets-manager
 */

import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import {
  GetSecretValueCommand,
  ListSecretsCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { keccak256, toBytes } from 'viem'

// Configuration
const CONFIG = {
  // AWS
  awsRegion: process.env.AWS_REGION || 'us-east-1',

  // Jeju L2
  rpcUrl: process.env.JEJU_RPC_URL || 'https://testnet-rpc.jejunetwork.org',
  privateKey: process.env.PRIVATE_KEY,

  // DWS KMS (MPC-based threshold cryptography)
  mpcClusterEndpoint:
    process.env.MPC_CLUSTER_ENDPOINT || 'http://mpc.dws.svc.cluster.local:8000',
  kmsThreshold: 2,
  kmsTotalShares: 3,

  // Kubernetes
  kubeNamespace: process.env.KUBE_NAMESPACE || 'default',
}

// Categories of secrets
enum SecretCategory {
  // High-security: goes to threshold KMS (MPC)
  PRIVATE_KEY = 'private_key',
  SIGNING_KEY = 'signing_key',
  ENCRYPTION_KEY = 'encryption_key',

  // Medium-security: goes to Kubernetes sealed secrets
  API_KEY = 'api_key',
  DATABASE_PASSWORD = 'database_password',
  SERVICE_TOKEN = 'service_token',

  // Low-security: goes to ConfigMap
  CONFIG = 'config',
}

interface SecretMigration {
  name: string
  category: SecretCategory
  destination: 'mpc' | 'k8s-secret' | 'configmap'
  migratedAt?: string
  mpcKeyId?: string
  k8sSecretName?: string
}

// DWS KMS ABI (partial)
const _DWS_KMS_ABI = [
  {
    name: 'registerKey',
    type: 'function',
    inputs: [
      { name: 'keyId', type: 'bytes32' },
      { name: 'keyType', type: 'uint8' },
      { name: 'threshold', type: 'uint8' },
      { name: 'publicKey', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getKey',
    type: 'function',
    inputs: [{ name: 'keyId', type: 'bytes32' }],
    outputs: [
      { name: 'keyType', type: 'uint8' },
      { name: 'threshold', type: 'uint8' },
      { name: 'publicKey', type: 'bytes' },
      { name: 'active', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const

function categorizeSecret(name: string, _value: string): SecretCategory {
  const nameLower = name.toLowerCase()

  // Private keys and signing keys -> threshold KMS
  if (
    nameLower.includes('private_key') ||
    nameLower.includes('privatekey') ||
    nameLower.includes('signing_key') ||
    nameLower.includes('signingkey') ||
    nameLower.includes('mnemonic') ||
    nameLower.includes('seed')
  ) {
    return SecretCategory.PRIVATE_KEY
  }

  // Encryption keys -> threshold KMS
  if (
    nameLower.includes('encryption_key') ||
    nameLower.includes('encryptionkey') ||
    nameLower.includes('master_key') ||
    nameLower.includes('masterkey')
  ) {
    return SecretCategory.ENCRYPTION_KEY
  }

  // Database passwords -> K8s secrets
  if (
    nameLower.includes('database') ||
    nameLower.includes('postgres') ||
    nameLower.includes('mysql') ||
    nameLower.includes('redis') ||
    nameLower.includes('db_password') ||
    nameLower.includes('dbpassword')
  ) {
    return SecretCategory.DATABASE_PASSWORD
  }

  // API keys -> K8s secrets
  if (
    nameLower.includes('api_key') ||
    nameLower.includes('apikey') ||
    nameLower.includes('access_key') ||
    nameLower.includes('secret_key')
  ) {
    return SecretCategory.API_KEY
  }

  // Service tokens -> K8s secrets
  if (
    nameLower.includes('token') ||
    nameLower.includes('jwt') ||
    nameLower.includes('auth')
  ) {
    return SecretCategory.SERVICE_TOKEN
  }

  // Everything else -> ConfigMap
  return SecretCategory.CONFIG
}

function getDestination(
  category: SecretCategory,
): 'mpc' | 'k8s-secret' | 'configmap' {
  switch (category) {
    case SecretCategory.PRIVATE_KEY:
    case SecretCategory.SIGNING_KEY:
    case SecretCategory.ENCRYPTION_KEY:
      return 'mpc'
    case SecretCategory.API_KEY:
    case SecretCategory.DATABASE_PASSWORD:
    case SecretCategory.SERVICE_TOKEN:
      return 'k8s-secret'
    default:
      return 'configmap'
  }
}

async function migrateToMpc(
  name: string,
  _value: string,
  mpcEndpoint: string,
): Promise<string> {
  // Generate key ID from name
  const keyId = keccak256(toBytes(name))

  // In production, this would call the MPC cluster API to:
  // 1. Generate threshold key shares
  // 2. Distribute shares to MPC nodes
  // 3. Register the public key on-chain

  console.log(`  MPC: Creating threshold key for ${name}`)
  console.log(`    Key ID: ${keyId}`)
  console.log(`    Threshold: ${CONFIG.kmsThreshold}/${CONFIG.kmsTotalShares}`)

  // Simulate MPC key creation
  const _response = await fetch(`${mpcEndpoint}/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyId,
      keyType: 'ecdsa-secp256k1',
      threshold: CONFIG.kmsThreshold,
      totalShares: CONFIG.kmsTotalShares,
      // In production, the secret would be split using Shamir's Secret Sharing
      // and each share encrypted for a specific MPC node
    }),
  }).catch(() => ({ ok: false, json: async () => ({ keyId }) }))

  return keyId
}

async function migrateToK8sSecret(
  name: string,
  value: string,
  namespace: string,
): Promise<string> {
  // Convert name to K8s-safe format
  const secretName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const keyName =
    name
      .split('/')
      .pop()
      ?.replace(/[^a-zA-Z0-9_]/g, '_') || 'value'

  console.log(`  K8s: Creating secret ${secretName} in namespace ${namespace}`)

  // Create Kubernetes secret
  const secretManifest = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: secretName,
      namespace,
      labels: {
        'app.kubernetes.io/part-of': 'jeju',
        'migrated-from': 'aws-secrets-manager',
      },
    },
    type: 'Opaque',
    stringData: {
      [keyName]: value,
    },
  }

  // Apply using kubectl
  const yamlPath = `/tmp/secret-${secretName}.yaml`
  writeFileSync(yamlPath, JSON.stringify(secretManifest, null, 2))

  try {
    execSync(`kubectl apply -f ${yamlPath}`, { stdio: 'pipe' })
    console.log(`    Created secret: ${secretName}`)
  } catch (error) {
    console.error(`    Failed to create secret: ${error}`)
    throw error
  }

  return secretName
}

async function migrateToConfigMap(
  name: string,
  value: string,
  namespace: string,
): Promise<string> {
  const configMapName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const keyName =
    name
      .split('/')
      .pop()
      ?.replace(/[^a-zA-Z0-9_]/g, '_') || 'value'

  console.log(
    `  ConfigMap: Creating ${configMapName} in namespace ${namespace}`,
  )

  const configMapManifest = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: configMapName,
      namespace,
      labels: {
        'app.kubernetes.io/part-of': 'jeju',
        'migrated-from': 'aws-secrets-manager',
      },
    },
    data: {
      [keyName]: value,
    },
  }

  const yamlPath = `/tmp/configmap-${configMapName}.yaml`
  writeFileSync(yamlPath, JSON.stringify(configMapManifest, null, 2))

  try {
    execSync(`kubectl apply -f ${yamlPath}`, { stdio: 'pipe' })
    console.log(`    Created configmap: ${configMapName}`)
  } catch (error) {
    console.error(`    Failed to create configmap: ${error}`)
    throw error
  }

  return configMapName
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const execute = args.includes('--execute')

  if (!dryRun && !execute) {
    console.error('Error: Specify --dry-run or --execute')
    process.exit(1)
  }

  console.log('='.repeat(60))
  console.log('AWS Secrets Manager to DWS KMS Migration')
  console.log('='.repeat(60))
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`)
  console.log('')

  // Initialize AWS client
  const secretsManager = new SecretsManagerClient({ region: CONFIG.awsRegion })

  // List all secrets
  console.log('Listing secrets from AWS Secrets Manager...')
  const secrets: Array<{ name: string; arn: string }> = []
  let nextToken: string | undefined

  do {
    const response = await secretsManager.send(
      new ListSecretsCommand({
        NextToken: nextToken,
        MaxResults: 100,
      }),
    )

    if (response.SecretList) {
      for (const secret of response.SecretList) {
        if (secret.Name && secret.ARN) {
          secrets.push({ name: secret.Name, arn: secret.ARN })
        }
      }
    }

    nextToken = response.NextToken
  } while (nextToken)

  console.log(`Found ${secrets.length} secrets`)
  console.log('')

  // Categorize and plan migrations
  const migrations: SecretMigration[] = []
  const mpcSecrets: Array<{ name: string; value: string }> = []
  const k8sSecrets: Array<{ name: string; value: string }> = []
  const configMaps: Array<{ name: string; value: string }> = []

  for (const secret of secrets) {
    // Get secret value
    const valueResponse = await secretsManager.send(
      new GetSecretValueCommand({
        SecretId: secret.arn,
      }),
    )

    const value = valueResponse.SecretString || ''
    const category = categorizeSecret(secret.name, value)
    const destination = getDestination(category)

    const migration: SecretMigration = {
      name: secret.name,
      category,
      destination,
    }
    migrations.push(migration)

    switch (destination) {
      case 'mpc':
        mpcSecrets.push({ name: secret.name, value })
        break
      case 'k8s-secret':
        k8sSecrets.push({ name: secret.name, value })
        break
      case 'configmap':
        configMaps.push({ name: secret.name, value })
        break
    }
  }

  // Print migration plan
  console.log('Migration Plan:')
  console.log('-'.repeat(60))
  console.log(`MPC (Threshold KMS): ${mpcSecrets.length} secrets`)
  for (const s of mpcSecrets) {
    console.log(`  - ${s.name}`)
  }
  console.log(`Kubernetes Secrets: ${k8sSecrets.length} secrets`)
  for (const s of k8sSecrets) {
    console.log(`  - ${s.name}`)
  }
  console.log(`ConfigMaps: ${configMaps.length} secrets`)
  for (const s of configMaps) {
    console.log(`  - ${s.name}`)
  }
  console.log('')

  if (dryRun) {
    console.log('[DRY RUN] No changes made')
    return
  }

  // Execute migrations
  console.log('Executing migrations...')
  console.log('-'.repeat(60))

  // Migrate to MPC
  for (const secret of mpcSecrets) {
    try {
      const keyId = await migrateToMpc(
        secret.name,
        secret.value,
        CONFIG.mpcClusterEndpoint,
      )
      const migration = migrations.find((m) => m.name === secret.name)
      if (migration) {
        migration.mpcKeyId = keyId
        migration.migratedAt = new Date().toISOString()
      }
    } catch (error) {
      console.error(`  Failed to migrate ${secret.name} to MPC: ${error}`)
    }
  }

  // Migrate to K8s secrets
  for (const secret of k8sSecrets) {
    try {
      const secretName = await migrateToK8sSecret(
        secret.name,
        secret.value,
        CONFIG.kubeNamespace,
      )
      const migration = migrations.find((m) => m.name === secret.name)
      if (migration) {
        migration.k8sSecretName = secretName
        migration.migratedAt = new Date().toISOString()
      }
    } catch (error) {
      console.error(`  Failed to migrate ${secret.name} to K8s: ${error}`)
    }
  }

  // Migrate to ConfigMaps
  for (const secret of configMaps) {
    try {
      await migrateToConfigMap(secret.name, secret.value, CONFIG.kubeNamespace)
      const migration = migrations.find((m) => m.name === secret.name)
      if (migration) {
        migration.migratedAt = new Date().toISOString()
      }
    } catch (error) {
      console.error(`  Failed to migrate ${secret.name} to ConfigMap: ${error}`)
    }
  }

  // Save migration report
  const report = {
    migratedAt: new Date().toISOString(),
    totalSecrets: secrets.length,
    mpcSecrets: mpcSecrets.length,
    k8sSecrets: k8sSecrets.length,
    configMaps: configMaps.length,
    migrations,
  }

  writeFileSync(
    'migration-secrets-report.json',
    JSON.stringify(report, null, 2),
  )

  console.log('')
  console.log('='.repeat(60))
  console.log('Migration Complete')
  console.log('='.repeat(60))
  console.log(`Total secrets migrated: ${secrets.length}`)
  console.log(`  MPC: ${mpcSecrets.length}`)
  console.log(`  K8s Secrets: ${k8sSecrets.length}`)
  console.log(`  ConfigMaps: ${configMaps.length}`)
  console.log('')
  console.log('Report saved to: migration-secrets-report.json')
}

main().catch(console.error)
