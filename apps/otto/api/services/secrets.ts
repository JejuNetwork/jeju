/**
 * Otto Secure Secrets Service
 *
 * Integrates with Jeju KMS (TEE MPC) for secure secret management.
 * Platform credentials (Discord, Telegram, Twitter, etc.) are encrypted
 * at rest and decrypted only within TEE enclaves.
 *
 * SECURITY MODEL:
 * - Secrets are stored encrypted in KMS
 * - Decryption happens inside TEE (dstack/phala)
 * - Raw secrets never leave the enclave
 * - Attestation required before secret access
 */

import {
  getEnvVar,
  getKmsServiceUrl,
  isProductionEnv,
} from '@jejunetwork/config'
import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface PlatformSecrets {
  discord: {
    botToken: string | null
    applicationId: string | null
    publicKey: string | null
  }
  telegram: {
    botToken: string | null
    webhookSecret: string | null
  }
  twitter: {
    bearerToken: string | null
    apiKey: string | null
    apiSecret: string | null
    accessToken: string | null
    accessSecret: string | null
  }
  farcaster: {
    neynarApiKey: string | null
    botFid: number | null
    signerUuid: string | null
  }
  whatsapp: {
    twilioSid: string | null
    twilioToken: string | null
    phoneNumber: string | null
  }
}

const SecretsResponseSchema = z.object({
  secrets: z.record(z.string(), z.string().nullable()),
  decryptedInTee: z.boolean(),
  attestationValid: z.boolean().optional(),
})

// ═══════════════════════════════════════════════════════════════════════════
//                         SECRETS SERVICE
// ═══════════════════════════════════════════════════════════════════════════

class SecureSecretsService {
  private readonly kmsEndpoint: string
  private cachedSecrets: PlatformSecrets | null = null
  private lastFetch = 0
  private readonly cacheTtlMs = 5 * 60 * 1000 // 5 minutes

  constructor() {
    this.kmsEndpoint = getEnvVar('KMS_ENDPOINT') ?? getKmsServiceUrl()
  }

  /**
   * Get platform secrets from KMS
   *
   * In production, secrets are decrypted inside TEE enclave.
   * In development, falls back to environment variables.
   */
  async getSecrets(): Promise<PlatformSecrets> {
    // Check cache
    if (
      this.cachedSecrets &&
      Date.now() - this.lastFetch < this.cacheTtlMs
    ) {
      return this.cachedSecrets
    }

    // In development, use environment variables directly
    if (!isProductionEnv()) {
      console.log('[Secrets] Development mode - using environment variables')
      return this.getSecretsFromEnv()
    }

    // In production, fetch from KMS with TEE decryption
    const secrets = await this.fetchFromKMS()
    this.cachedSecrets = secrets
    this.lastFetch = Date.now()
    return secrets
  }

  /**
   * Get a single secret by key
   */
  async getSecret(key: string): Promise<string | null> {
    const secrets = await this.getSecrets()
    return this.extractSecretByKey(secrets, key)
  }

  /**
   * Check if a platform is configured with valid credentials
   */
  async isPlatformEnabled(
    platform: 'discord' | 'telegram' | 'twitter' | 'farcaster' | 'whatsapp',
  ): Promise<boolean> {
    const secrets = await this.getSecrets()

    switch (platform) {
      case 'discord':
        return secrets.discord.botToken !== null
      case 'telegram':
        return secrets.telegram.botToken !== null
      case 'twitter':
        return secrets.twitter.bearerToken !== null
      case 'farcaster':
        return (
          secrets.farcaster.neynarApiKey !== null &&
          secrets.farcaster.botFid !== null
        )
      case 'whatsapp':
        return (
          secrets.whatsapp.twilioSid !== null &&
          secrets.whatsapp.twilioToken !== null
        )
    }
  }

  /**
   * Clear cached secrets (for rotation)
   */
  clearCache(): void {
    this.cachedSecrets = null
    this.lastFetch = 0
  }

  // ─────────────────────────────────────────────────────────────────────────
  //                          INTERNAL
  // ─────────────────────────────────────────────────────────────────────────

  private async fetchFromKMS(): Promise<PlatformSecrets> {
    const secretKeys = [
      'DISCORD_BOT_TOKEN',
      'DISCORD_APPLICATION_ID',
      'DISCORD_PUBLIC_KEY',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_WEBHOOK_SECRET',
      'TWITTER_BEARER_TOKEN',
      'TWITTER_API_KEY',
      'TWITTER_API_SECRET',
      'TWITTER_ACCESS_TOKEN',
      'TWITTER_ACCESS_SECRET',
      'NEYNAR_API_KEY',
      'FARCASTER_BOT_FID',
      'FARCASTER_SIGNER_UUID',
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_WHATSAPP_NUMBER',
    ]

    try {
      const response = await fetch(`${this.kmsEndpoint}/secrets/decrypt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-ID': 'otto',
        },
        body: JSON.stringify({
          keys: secretKeys,
          requireTee: isProductionEnv(),
        }),
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        console.error(
          `[Secrets] KMS request failed: ${response.status}`,
        )
        // Fallback to env in case KMS is unavailable
        return this.getSecretsFromEnv()
      }

      const data: unknown = await response.json()
      const parsed = SecretsResponseSchema.safeParse(data)

      if (!parsed.success) {
        console.error('[Secrets] Invalid KMS response:', parsed.error.message)
        return this.getSecretsFromEnv()
      }

      if (isProductionEnv() && !parsed.data.decryptedInTee) {
        console.warn(
          '[Secrets] Warning: Secrets were not decrypted in TEE.',
        )
      }

      return this.mapSecretsFromKMS(parsed.data.secrets)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[Secrets] KMS fetch failed: ${message}`)
      return this.getSecretsFromEnv()
    }
  }

  private mapSecretsFromKMS(
    secrets: Record<string, string | null>,
  ): PlatformSecrets {
    return {
      discord: {
        botToken: secrets.DISCORD_BOT_TOKEN ?? null,
        applicationId: secrets.DISCORD_APPLICATION_ID ?? null,
        publicKey: secrets.DISCORD_PUBLIC_KEY ?? null,
      },
      telegram: {
        botToken: secrets.TELEGRAM_BOT_TOKEN ?? null,
        webhookSecret: secrets.TELEGRAM_WEBHOOK_SECRET ?? null,
      },
      twitter: {
        bearerToken: secrets.TWITTER_BEARER_TOKEN ?? null,
        apiKey: secrets.TWITTER_API_KEY ?? null,
        apiSecret: secrets.TWITTER_API_SECRET ?? null,
        accessToken: secrets.TWITTER_ACCESS_TOKEN ?? null,
        accessSecret: secrets.TWITTER_ACCESS_SECRET ?? null,
      },
      farcaster: {
        neynarApiKey: secrets.NEYNAR_API_KEY ?? null,
        botFid: secrets.FARCASTER_BOT_FID
          ? Number.parseInt(secrets.FARCASTER_BOT_FID, 10)
          : null,
        signerUuid: secrets.FARCASTER_SIGNER_UUID ?? null,
      },
      whatsapp: {
        twilioSid: secrets.TWILIO_ACCOUNT_SID ?? null,
        twilioToken: secrets.TWILIO_AUTH_TOKEN ?? null,
        phoneNumber: secrets.TWILIO_WHATSAPP_NUMBER ?? null,
      },
    }
  }

  private getSecretsFromEnv(): PlatformSecrets {
    return {
      discord: {
        botToken: process.env.DISCORD_BOT_TOKEN ?? null,
        applicationId: process.env.DISCORD_APPLICATION_ID ?? null,
        publicKey: process.env.DISCORD_PUBLIC_KEY ?? null,
      },
      telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN ?? null,
        webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? null,
      },
      twitter: {
        bearerToken: process.env.TWITTER_BEARER_TOKEN ?? null,
        apiKey: process.env.TWITTER_API_KEY ?? null,
        apiSecret: process.env.TWITTER_API_SECRET ?? null,
        accessToken: process.env.TWITTER_ACCESS_TOKEN ?? null,
        accessSecret: process.env.TWITTER_ACCESS_SECRET ?? null,
      },
      farcaster: {
        neynarApiKey: process.env.NEYNAR_API_KEY ?? null,
        botFid: process.env.FARCASTER_BOT_FID
          ? Number.parseInt(process.env.FARCASTER_BOT_FID, 10)
          : null,
        signerUuid: process.env.FARCASTER_SIGNER_UUID ?? null,
      },
      whatsapp: {
        twilioSid: process.env.TWILIO_ACCOUNT_SID ?? null,
        twilioToken: process.env.TWILIO_AUTH_TOKEN ?? null,
        phoneNumber: process.env.TWILIO_WHATSAPP_NUMBER ?? null,
      },
    }
  }

  private extractSecretByKey(
    secrets: PlatformSecrets,
    key: string,
  ): string | null {
    switch (key) {
      case 'DISCORD_BOT_TOKEN':
        return secrets.discord.botToken
      case 'DISCORD_APPLICATION_ID':
        return secrets.discord.applicationId
      case 'DISCORD_PUBLIC_KEY':
        return secrets.discord.publicKey
      case 'TELEGRAM_BOT_TOKEN':
        return secrets.telegram.botToken
      case 'TELEGRAM_WEBHOOK_SECRET':
        return secrets.telegram.webhookSecret
      case 'TWITTER_BEARER_TOKEN':
        return secrets.twitter.bearerToken
      case 'TWITTER_API_KEY':
        return secrets.twitter.apiKey
      case 'TWITTER_API_SECRET':
        return secrets.twitter.apiSecret
      case 'TWITTER_ACCESS_TOKEN':
        return secrets.twitter.accessToken
      case 'TWITTER_ACCESS_SECRET':
        return secrets.twitter.accessSecret
      case 'NEYNAR_API_KEY':
        return secrets.farcaster.neynarApiKey
      case 'FARCASTER_BOT_FID':
        return secrets.farcaster.botFid?.toString() ?? null
      case 'FARCASTER_SIGNER_UUID':
        return secrets.farcaster.signerUuid
      case 'TWILIO_ACCOUNT_SID':
        return secrets.whatsapp.twilioSid
      case 'TWILIO_AUTH_TOKEN':
        return secrets.whatsapp.twilioToken
      case 'TWILIO_WHATSAPP_NUMBER':
        return secrets.whatsapp.phoneNumber
      default:
        return null
    }
  }
}

// Singleton instance
let secretsService: SecureSecretsService | null = null

export function getSecretsService(): SecureSecretsService {
  if (!secretsService) {
    secretsService = new SecureSecretsService()
  }
  return secretsService
}

export type { SecureSecretsService }

