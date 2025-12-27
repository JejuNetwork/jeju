/**
 * Farcaster Client Factory
 *
 * Factory functions that automatically select between KMS-backed (secure)
 * and local (development-only) implementations based on environment.
 *
 * USAGE:
 * ```typescript
 * import { createFarcasterClient } from '@jejunetwork/messaging/farcaster/factory'
 *
 * // In production: automatically uses KMS
 * // In development: automatically uses local keys with warnings
 * const client = await createFarcasterClient(config)
 * ```
 */

import { createLogger } from '@jejunetwork/shared'
import {
  detectEnvironment,
  getRecommendedSecurityConfig,
  validateSecurityConfig,
} from '../security'
import { DirectCastClient } from './dc/client'
import type { DCClientConfig } from './dc/types'
import {
  KMSDirectCastClient,
  type DCKMSEncryptionProvider,
  type DCKMSSigner,
  type KMSDCClientConfig,
} from './dc/kms-client'
import { FarcasterPoster, type FarcasterPosterConfig } from './hub/poster'
import { KMSFarcasterPoster } from './hub/kms-poster'
import type { KMSPosterSigner } from './hub/kms-poster'
import { FarcasterSignerManager, type SignerManagerConfig } from './signer/manager'
import {
  KMSFarcasterSignerManager,
  type KMSProvider,
  type KMSSignerManagerConfig,
} from './signer/kms-manager'

const log = createLogger('farcaster-factory')

/**
 * Unified Farcaster client configuration
 */
export interface FarcasterClientConfig {
  fid: number
  hubUrl: string
  relayUrl?: string
  network?: 'mainnet' | 'testnet' | 'devnet'

  // KMS configuration (required for production)
  kmsSigner?: DCKMSSigner
  kmsEncryption?: DCKMSEncryptionProvider
  kmsProvider?: KMSProvider

  // Local key configuration (development only)
  signerPrivateKey?: Uint8Array

  // Optional overrides
  persistenceEnabled?: boolean
  persistencePath?: string
  timeoutMs?: number
}

/**
 * Create a Direct Cast client with automatic mode selection
 *
 * - Production/Staging: Requires KMS configuration
 * - Development/Test: Falls back to local keys with warnings
 */
export async function createDirectCastClient(
  config: FarcasterClientConfig,
): Promise<DirectCastClient | KMSDirectCastClient> {
  const env = detectEnvironment()
  const securityConfig = getRecommendedSecurityConfig()
  validateSecurityConfig(securityConfig)

  // Try KMS first
  if (config.kmsSigner && config.kmsEncryption) {
    log.info('Creating KMS-backed DirectCastClient', { fid: config.fid, env })

    const kmsConfig: KMSDCClientConfig = {
      fid: config.fid,
      hubUrl: config.hubUrl,
      relayUrl: config.relayUrl,
      persistenceEnabled: config.persistenceEnabled,
      persistencePath: config.persistencePath,
      kmsSigner: config.kmsSigner,
      kmsEncryption: config.kmsEncryption,
    }

    const client = new KMSDirectCastClient(kmsConfig)
    await client.initialize()
    return client
  }

  // Fall back to local keys (development only - will throw in production)
  if (config.signerPrivateKey) {
    log.warn('Creating local DirectCastClient - development mode only', {
      fid: config.fid,
      env,
    })

    const localConfig: DCClientConfig = {
      fid: config.fid,
      signerPrivateKey: config.signerPrivateKey,
      hubUrl: config.hubUrl,
      relayUrl: config.relayUrl,
      persistenceEnabled: config.persistenceEnabled,
      persistencePath: config.persistencePath,
    }

    const client = new DirectCastClient(localConfig)
    await client.initialize()
    return client
  }

  throw new Error(
    'No key configuration provided. ' +
    (env === 'production' || env === 'staging'
      ? 'Provide kmsSigner and kmsEncryption for production.'
      : 'Provide either KMS configuration or signerPrivateKey.')
  )
}

/**
 * Create a Farcaster Poster with automatic mode selection
 */
export function createFarcasterPoster(
  config: FarcasterClientConfig,
): FarcasterPoster | KMSFarcasterPoster {
  const env = detectEnvironment()
  const securityConfig = getRecommendedSecurityConfig()
  validateSecurityConfig(securityConfig)

  // Try KMS first - adapt DCKMSSigner to KMSPosterSigner
  if (config.kmsSigner) {
    log.info('Creating KMS-backed FarcasterPoster', { fid: config.fid, env })

    // The KMSPosterSigner interface is compatible with DCKMSSigner
    const posterSigner: KMSPosterSigner = {
      publicKey: config.kmsSigner.publicKey,
      sign: (message: Uint8Array) => config.kmsSigner!.sign(message),
    }

    return new KMSFarcasterPoster({
      fid: config.fid,
      kmsSigner: posterSigner,
      hubUrl: config.hubUrl,
      network: config.network,
      timeoutMs: config.timeoutMs,
    })
  }

  // Fall back to local keys (development only - will throw in production)
  if (config.signerPrivateKey) {
    log.warn('Creating local FarcasterPoster - development mode only', {
      fid: config.fid,
      env,
    })

    const posterConfig: FarcasterPosterConfig = {
      fid: config.fid,
      signerPrivateKey: config.signerPrivateKey,
      hubUrl: config.hubUrl,
      network: config.network,
      timeoutMs: config.timeoutMs,
    }

    return new FarcasterPoster(posterConfig)
  }

  throw new Error(
    'No key configuration provided. ' +
    (env === 'production' || env === 'staging'
      ? 'Provide kmsSigner for production.'
      : 'Provide either KMS configuration or signerPrivateKey.')
  )
}

/**
 * Create a Farcaster Signer Manager with automatic mode selection
 */
export function createSignerManager(
  config: Partial<FarcasterClientConfig> & {
    storagePath?: string
    encryptionPassword?: string
    onSignerEvent?: KMSSignerManagerConfig['onSignerEvent']
  },
): FarcasterSignerManager | KMSFarcasterSignerManager {
  const env = detectEnvironment()
  const securityConfig = getRecommendedSecurityConfig()
  validateSecurityConfig(securityConfig)

  // Try KMS first
  if (config.kmsProvider) {
    log.info('Creating KMS-backed FarcasterSignerManager', { env })

    return new KMSFarcasterSignerManager({
      kmsProvider: config.kmsProvider,
      onSignerEvent: config.onSignerEvent,
    })
  }

  // Fall back to local keys (development only - will throw in production)
  log.warn('Creating local FarcasterSignerManager - development mode only', {
    env,
  })

  const managerConfig: SignerManagerConfig = {
    storage: config.storagePath ? 'file' : 'memory',
    storagePath: config.storagePath,
    encryptionPassword: config.encryptionPassword,
  }

  return new FarcasterSignerManager(managerConfig)
}

/**
 * Complete Farcaster client bundle
 */
export interface FarcasterClientBundle {
  poster: FarcasterPoster | KMSFarcasterPoster
  dcClient: DirectCastClient | KMSDirectCastClient
  signerManager: FarcasterSignerManager | KMSFarcasterSignerManager
  isSecureMode: boolean
}

/**
 * Create a complete Farcaster client bundle with automatic mode selection
 *
 * This is the recommended entry point for Farcaster integration.
 */
export async function createFarcasterClient(
  config: FarcasterClientConfig & {
    storagePath?: string
    encryptionPassword?: string
    onSignerEvent?: KMSSignerManagerConfig['onSignerEvent']
  },
): Promise<FarcasterClientBundle> {
  const poster = createFarcasterPoster(config)
  const dcClient = await createDirectCastClient(config)
  const signerManager = createSignerManager(config)

  const isSecureMode =
    poster instanceof KMSFarcasterPoster &&
    dcClient instanceof KMSDirectCastClient &&
    signerManager instanceof KMSFarcasterSignerManager

  log.info('Farcaster client bundle created', {
    fid: config.fid,
    network: config.network ?? 'mainnet',
    isSecureMode,
  })

  return {
    poster,
    dcClient,
    signerManager,
    isSecureMode,
  }
}

/**
 * Quick setup for production (requires KMS)
 */
export async function createProductionFarcasterClient(
  config: Required<Pick<FarcasterClientConfig, 'fid' | 'hubUrl' | 'kmsSigner' | 'kmsEncryption' | 'kmsProvider'>> &
    Partial<FarcasterClientConfig>,
): Promise<FarcasterClientBundle> {
  return createFarcasterClient({
    ...config,
    network: config.network ?? 'mainnet',
  })
}

/**
 * Quick setup for development (local keys, with security warnings)
 */
export async function createDevFarcasterClient(
  config: Required<Pick<FarcasterClientConfig, 'fid' | 'hubUrl' | 'signerPrivateKey'>> &
    Partial<FarcasterClientConfig>,
): Promise<FarcasterClientBundle> {
  return createFarcasterClient({
    ...config,
    network: config.network ?? 'devnet',
  })
}
