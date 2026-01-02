/**
 * Browser stub for server-side auth providers
 * These providers use KMS/server features and are not available in browser
 * Exported as classes since the SDK uses `new Provider(...)`
 */

export class FarcasterProvider {
  name = 'farcaster'
  constructor() {
    // No-op - Farcaster provider is server-side only
  }
  async authenticate(): Promise<never> {
    throw new Error('Farcaster auth requires server-side support')
  }
}

export class EmailProvider {
  name = 'email'
  constructor() {
    // No-op - Email provider is server-side only
  }
  async sendCode(): Promise<never> {
    throw new Error('Email auth requires server-side support')
  }
  async verify(): Promise<never> {
    throw new Error('Email auth requires server-side support')
  }
}

export class PhoneProvider {
  name = 'phone'
  constructor() {
    // No-op - Phone provider is server-side only
  }
  async sendCode(): Promise<never> {
    throw new Error('Phone auth requires server-side support')
  }
  async verify(): Promise<never> {
    throw new Error('Phone auth requires server-side support')
  }
}

export default {}
