/** TEE genesis ceremony with hardware-rooted key derivation */

import {
  bytesToHex,
  decryptAesGcm,
  deriveKeyScrypt,
  encryptAesGcm,
  hash256,
  randomBytes,
} from '@jejunetwork/shared'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

export interface TeeKeyConfig {
  name: string
  address: string
  privateKey: string
  role: string
  derivationPath: string
}

export interface TeeAttestation {
  quote: string
  eventLog: string
  tcbInfo: Record<string, string>
  measurementHash: string
}

export interface TeeCeremonyResult {
  network: string
  timestamp: string
  attestation: TeeAttestation
  encryptedKeys: string // Base64 encrypted
  publicAddresses: Record<string, string>
  genesisConfig: Record<string, string>
}

const OPERATOR_ROLES = [
  {
    name: 'Sequencer',
    path: '/jeju/genesis/sequencer',
    desc: 'Produces L2 blocks',
  },
  {
    name: 'Batcher',
    path: '/jeju/genesis/batcher',
    desc: 'Submits transaction batches to L1',
  },
  {
    name: 'Proposer',
    path: '/jeju/genesis/proposer',
    desc: 'Submits L2 output roots to L1',
  },
  {
    name: 'Challenger',
    path: '/jeju/genesis/challenger',
    desc: 'Challenges invalid output roots',
  },
  {
    name: 'Admin',
    path: '/jeju/genesis/admin',
    desc: 'Proxy admin and system owner',
  },
  {
    name: 'FeeRecipient',
    path: '/jeju/genesis/fee-recipient',
    desc: 'Receives sequencer fees',
  },
  {
    name: 'Guardian',
    path: '/jeju/genesis/guardian',
    desc: 'Superchain config guardian',
  },
]

interface TeeClientType {
  getKey?(
    path: string,
    purpose: string,
    algorithm: string,
  ): Promise<{ key: Uint8Array }>
  getQuote?(reportData: Buffer): Promise<{ quote: string; event_log: string }>
  deriveKey?(
    path?: string,
    subject?: string,
    altNames?: string[],
  ): Promise<{ asUint8Array: (len?: number) => Uint8Array }>
  tdxQuote?(
    reportData: string | Buffer | Uint8Array,
    hashAlgorithm?: string,
  ): Promise<{ quote: string; event_log: string }>
  info(): Promise<{
    app_id: string
    instance_id: string
    tcb_info: Record<string, unknown>
  }>
}

export async function runTeeCeremony(
  network: 'testnet' | 'mainnet',
  passwordHash: string,
): Promise<TeeCeremonyResult> {
  if (process.env.DSTACK_SIMULATOR_ENDPOINT) {
    // SECURITY: Never allow simulated ceremony for mainnet
    if (network === 'mainnet') {
      throw new Error(
        'SECURITY ERROR: Simulated TEE ceremony is NOT allowed for mainnet.\n' +
          'Mainnet keys MUST be derived from real TEE hardware.\n' +
          'Remove DSTACK_SIMULATOR_ENDPOINT and run in actual TEE environment.',
      )
    }
    console.log('[TEE-SIM] Running in simulator mode')
    console.log(
      '[TEE-SIM] WARNING: This is for TESTNET ONLY - keys are NOT secure',
    )
    return runSimulatedCeremony(network, passwordHash)
  }

  let client: TeeClientType
  let useNewApi = false

  try {
    const dstackModule = await import('@phala/dstack-sdk')

    const mod = dstackModule as Record<string, unknown>

    if ('DstackClient' in mod && typeof mod.DstackClient === 'function') {
      const DstackClient = mod.DstackClient as new () => TeeClientType
      client = new DstackClient()
      useNewApi = true
    } else if ('TappdClient' in mod && typeof mod.TappdClient === 'function') {
      const TappdClient = mod.TappdClient as new () => TeeClientType
      client = new TappdClient()
      useNewApi = false
    } else {
      throw new Error('No compatible client found in @phala/dstack-sdk')
    }
  } catch (error) {
    const err = error as Error

    throw new Error(
      'dstack SDK not available. Install with: bun add @phala/dstack-sdk\n' +
        'Or set DSTACK_SIMULATOR_ENDPOINT for testing.\n' +
        'Original error: ' +
        err.message,
    )
  }

  console.log('[TEE] Genesis ceremony starting...')
  console.log('[TEE] Network:', network)
  console.log('[TEE] Verifying TEE environment...')

  // Get TEE info for attestation
  const info = await client.info()
  console.log('[TEE] App ID:', info.app_id)
  console.log('[TEE] Instance ID:', info.instance_id)

  console.log('[TEE] Deriving operator keys from hardware root...')

  const keys: TeeKeyConfig[] = []
  const addresses: Record<string, string> = {}

  for (const role of OPERATOR_ROLES) {
    const keyPath = `${role.path}/${network}`

    let privateKeyHex: string

    if (useNewApi && client.getKey) {
      // New DstackClient API
      const keyResult = await client.getKey(
        keyPath,
        'ethereum-signing',
        'secp256k1',
      )
      privateKeyHex = Buffer.from(keyResult.key).toString('hex')
    } else if (client.deriveKey) {
      // Legacy TappdClient API
      const keyResult = await client.deriveKey(keyPath, role.name)
      privateKeyHex = Buffer.from(keyResult.asUint8Array(32)).toString('hex')
    } else {
      throw new Error('No key derivation method available')
    }

    const pk = `0x${privateKeyHex}` as `0x${string}`
    const account = privateKeyToAccount(pk)

    const keyConfig: TeeKeyConfig = {
      name: role.name,
      address: account.address,
      privateKey: pk,
      role: role.desc,
      derivationPath: keyPath,
    }

    keys.push(keyConfig)
    addresses[role.name.toLowerCase()] = account.address

    console.log(`[TEE] Derived ${role.name}: ${account.address}`)
  }

  console.log('[TEE] Generating attestation quote...')

  const timestamp = new Date().toISOString()
  const measurementData = JSON.stringify({
    network,
    timestamp,
    addresses,
  })
  const measurementHash = bytesToHex(hash256(measurementData))

  let quote: { quote: string; event_log: string }

  if (useNewApi && client.getQuote) {
    // New DstackClient API
    quote = await client.getQuote(Buffer.from(measurementHash, 'hex'))
  } else if (client.tdxQuote) {
    // Legacy TappdClient API
    quote = await client.tdxQuote(Buffer.from(measurementHash, 'hex'), 'raw')
  } else {
    throw new Error('No attestation method available')
  }

  console.log('[TEE] Attestation quote generated')

  console.log('[TEE] Encrypting keys...')

  const encryptedBundle = await encryptKeys(keys, passwordHash)

  for (const key of keys) {
    key.privateKey = `0x${'0'.repeat(64)}`
  }

  console.log('[TEE] Keys encrypted and cleared from memory')

  const genesisConfig: Record<string, string> = {
    SystemOwner: addresses.admin,
    Sequencer: addresses.sequencer,
    Batcher: addresses.batcher,
    Proposer: addresses.proposer,
    Challenger: addresses.challenger,
    Guardian: addresses.guardian,
    BaseFeeVaultRecipient: addresses.feerecipient,
    L1FeeVaultRecipient: addresses.feerecipient,
    SequencerFeeVaultRecipient: addresses.feerecipient,
  }

  console.log('[TEE] Genesis ceremony complete')

  return {
    network,
    timestamp,
    attestation: {
      quote: quote.quote,
      eventLog: quote.event_log,
      tcbInfo: info.tcb_info as Record<string, string>,
      measurementHash,
    },
    encryptedKeys: encryptedBundle,
    publicAddresses: addresses,
    genesisConfig,
  }
}

async function runSimulatedCeremony(
  network: 'testnet' | 'mainnet',
  passwordHash: string,
): Promise<TeeCeremonyResult> {
  // SECURITY: Double-check - simulated ceremony must never run for mainnet
  if (network === 'mainnet') {
    throw new Error('SECURITY: Simulated ceremony cannot be used for mainnet')
  }

  console.log('[TEE-SIM] WARNING: Running simulated ceremony')
  console.log('[TEE-SIM] This is for TESTNET ONLY - NOT FOR PRODUCTION')

  const keys: TeeKeyConfig[] = []
  const addresses: Record<string, string> = {}
  const timestamp = new Date().toISOString()

  for (const role of OPERATOR_ROLES) {
    const pk = generatePrivateKey()
    const account = privateKeyToAccount(pk)

    keys.push({
      name: role.name,
      address: account.address,
      privateKey: pk,
      role: role.desc,
      derivationPath: `${role.path}/${network}`,
    })

    addresses[role.name.toLowerCase()] = account.address
  }

  const measurementData = JSON.stringify({ network, timestamp, addresses })
  const measurementHash = bytesToHex(hash256(measurementData))

  const encryptedBundle = await encryptKeys(keys, passwordHash)

  for (const key of keys) {
    key.privateKey = `0x${'0'.repeat(64)}`
  }

  return {
    network,
    timestamp,
    attestation: {
      quote: `SIMULATED_QUOTE_${bytesToHex(randomBytes(32))}`,
      eventLog: JSON.stringify([{ event: 'simulated', data: 'test' }]),
      tcbInfo: { simulated: 'true' },
      measurementHash,
    },
    encryptedKeys: encryptedBundle,
    publicAddresses: addresses,
    genesisConfig: {
      SystemOwner: addresses.admin,
      Sequencer: addresses.sequencer,
      Batcher: addresses.batcher,
      Proposer: addresses.proposer,
      Challenger: addresses.challenger,
      Guardian: addresses.guardian,
      BaseFeeVaultRecipient: addresses.feerecipient,
      L1FeeVaultRecipient: addresses.feerecipient,
      SequencerFeeVaultRecipient: addresses.feerecipient,
    },
  }
}

async function encryptKeys(
  keys: TeeKeyConfig[],
  passwordHash: string,
): Promise<string> {
  const salt = randomBytes(32)
  const encryptionKey = await deriveKeyScrypt(passwordHash, salt, { dkLen: 32 })

  const keysJson = JSON.stringify(keys)
  const data = new TextEncoder().encode(keysJson)
  const { ciphertext, iv, tag } = await encryptAesGcm(data, encryptionKey)

  // Combine: salt + iv + authTag + encrypted
  const bundle = new Uint8Array(
    salt.length + iv.length + tag.length + ciphertext.length,
  )
  bundle.set(salt, 0)
  bundle.set(iv, salt.length)
  bundle.set(tag, salt.length + iv.length)
  bundle.set(ciphertext, salt.length + iv.length + tag.length)

  encryptionKey.fill(0)

  return btoa(String.fromCharCode(...bundle))
}

export async function verifyAttestation(result: TeeCeremonyResult): Promise<{
  valid: boolean
  details: string
}> {
  if (result.attestation.quote.startsWith('SIMULATED_')) {
    return {
      valid: false,
      details: 'SIMULATED attestation - NOT valid for production',
    }
  }

  if (!result.attestation.quote || result.attestation.quote.length < 100) {
    return { valid: false, details: 'Invalid or missing attestation quote' }
  }

  // Verify measurement hash matches addresses
  const expectedMeasurement = bytesToHex(
    hash256(
      JSON.stringify({
        network: result.network,
        timestamp: result.timestamp,
        addresses: result.publicAddresses,
      }),
    ),
  )

  if (result.attestation.measurementHash !== expectedMeasurement) {
    return { valid: false, details: 'Measurement hash mismatch' }
  }

  return {
    valid: true,
    details: 'Attestation verified',
  }
}

export async function decryptCeremonyKeys(
  encryptedKeys: string,
  password: string,
): Promise<TeeKeyConfig[]> {
  const passwordHash = bytesToHex(hash256(password))
  const encrypted = new Uint8Array(
    atob(encryptedKeys)
      .split('')
      .map((c) => c.charCodeAt(0)),
  )

  const salt = encrypted.subarray(0, 32)
  const iv = encrypted.subarray(32, 48)
  const tag = encrypted.subarray(48, 64)
  const data = encrypted.subarray(64)

  const key = await deriveKeyScrypt(passwordHash, salt, { dkLen: 32 })

  const decrypted = await decryptAesGcm(data, key, iv, tag)

  key.fill(0)

  return JSON.parse(new TextDecoder().decode(decrypted))
}

export const TEE_COMPOSE_TEMPLATE = `
version: '3'
services:
  genesis-ceremony:
    image: ghcr.io/jejunetwork/genesis-ceremony:latest
    environment:
      - NETWORK=\${NETWORK}
      - PASSWORD_HASH=\${PASSWORD_HASH}
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock
    ports:
      - "8080:8080"
`
