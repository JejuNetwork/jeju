/**
 * Phone/SMS Authentication Provider
 *
 * Secure phone authentication with:
 * - SMS OTP verification
 * - Rate limiting
 * - Phone number validation
 */

import { keccak256, toBytes } from 'viem'
import {
  generateOTP,
  TwilioMessageResponseSchema,
  validateResponse,
} from '../validation.js'

export interface PhoneAuthConfig {
  twilioAccountSid?: string
  twilioAuthToken?: string
  twilioPhoneNumber?: string
  smsProvider?: 'twilio' | 'aws-sns' | 'custom'
  otpExpiryMinutes?: number
  otpLength?: number
  maxDailyAttempts?: number
  customSmsSender?: (phone: string, message: string) => Promise<void>
  /** If true, skips actual SMS sending (for testing) */
  devMode?: boolean
}

export interface PhoneUser {
  id: string
  phone: string
  phoneVerified: boolean
  countryCode: string
  createdAt: number
  lastLoginAt: number
}

export interface PhoneOTP {
  code: string
  phone: string
  expiresAt: number
  attempts: number
  maxAttempts: number
  createdAt: number
}

export interface PhoneAuthResult {
  success: boolean
  user?: PhoneUser
  error?: string
  requiresVerification?: boolean
}

export interface PhoneRateLimit {
  phone: string
  dailyAttempts: number
  lastAttempt: number
  blockedUntil?: number
}

const DEFAULT_OTP_EXPIRY = 5 // minutes
const DEFAULT_OTP_LENGTH = 6
const MAX_OTP_ATTEMPTS = 3
const DEFAULT_MAX_DAILY_ATTEMPTS = 5
const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000 // 24 hours
const MAX_PENDING_OTPS = 10000 // Maximum pending OTPs before cleanup
const CLEANUP_INTERVAL = 60000 // Run cleanup every minute

export class PhoneProvider {
  private config: PhoneAuthConfig
  private pendingOTPs = new Map<string, PhoneOTP>()
  private users = new Map<string, PhoneUser>()
  private rateLimits = new Map<string, PhoneRateLimit>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: PhoneAuthConfig = {}) {
    this.config = {
      ...config,
      otpExpiryMinutes: config.otpExpiryMinutes ?? DEFAULT_OTP_EXPIRY,
      otpLength: config.otpLength ?? DEFAULT_OTP_LENGTH,
      maxDailyAttempts: config.maxDailyAttempts ?? DEFAULT_MAX_DAILY_ATTEMPTS,
      smsProvider: config.smsProvider ?? 'twilio',
    }

    // SECURITY: Start periodic cleanup to prevent unbounded memory growth (DoS)
    this.startCleanup()
  }

  /**
   * Start periodic cleanup of expired tokens
   * SECURITY: Prevents unbounded memory growth from abandoned auth flows
   */
  private startCleanup(): void {
    if (this.cleanupInterval) return

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens()
    }, CLEANUP_INTERVAL)
  }

  /**
   * Clean up expired tokens and enforce size limits
   * SECURITY: Prevents DoS via memory exhaustion
   */
  private cleanupExpiredTokens(): void {
    const now = Date.now()

    // Clean expired OTPs
    for (const [phone, data] of this.pendingOTPs.entries()) {
      if (now > data.expiresAt) {
        this.pendingOTPs.delete(phone)
      }
    }

    // Clean expired rate limits (older than window)
    for (const [phone, data] of this.rateLimits.entries()) {
      if (now - data.lastAttempt > RATE_LIMIT_WINDOW) {
        this.rateLimits.delete(phone)
      }
    }

    // Enforce size limits - remove oldest entries if over limit
    if (this.pendingOTPs.size > MAX_PENDING_OTPS) {
      const entries = Array.from(this.pendingOTPs.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt,
      )
      const toRemove = entries.slice(0, entries.length - MAX_PENDING_OTPS)
      for (const [phone] of toRemove) {
        this.pendingOTPs.delete(phone)
      }
    }
  }

  /**
   * Stop cleanup interval (for testing/cleanup)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * Send OTP to phone number
   */
  async sendOTP(phone: string): Promise<{ sent: boolean; expiresAt: number }> {
    const normalizedPhone = this.normalizePhone(phone)
    this.validatePhone(normalizedPhone)

    // Check rate limits
    const rateLimitCheck = this.checkRateLimit(normalizedPhone)
    if (!rateLimitCheck.allowed) {
      throw new Error(rateLimitCheck.reason ?? 'Rate limit exceeded')
    }

    const otpLength = this.config.otpLength ?? DEFAULT_OTP_LENGTH
    const code = generateOTP(otpLength)
    const expiresAt =
      Date.now() +
      (this.config.otpExpiryMinutes ?? DEFAULT_OTP_EXPIRY) * 60 * 1000

    const otp: PhoneOTP = {
      code,
      phone: normalizedPhone,
      expiresAt,
      attempts: 0,
      maxAttempts: MAX_OTP_ATTEMPTS,
      createdAt: Date.now(),
    }

    this.pendingOTPs.set(normalizedPhone, otp)
    this.updateRateLimit(normalizedPhone)

    // Send SMS
    await this.sendSMS(normalizedPhone, `Your verification code is: ${code}`)

    return { sent: true, expiresAt }
  }

  /**
   * Timing-safe comparison of two strings
   * SECURITY: Prevents timing attacks by always comparing all characters
   */
  private timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }

  /**
   * Verify OTP and authenticate user
   * SECURITY: Uses timing-safe comparison to prevent timing attacks
   */
  async verifyOTP(phone: string, code: string): Promise<PhoneAuthResult> {
    const normalizedPhone = this.normalizePhone(phone)
    const otp = this.pendingOTPs.get(normalizedPhone)

    if (!otp) {
      return {
        success: false,
        error: 'No pending verification for this phone number',
      }
    }

    if (Date.now() > otp.expiresAt) {
      this.pendingOTPs.delete(normalizedPhone)
      return { success: false, error: 'Verification code expired' }
    }

    otp.attempts++

    if (otp.attempts > otp.maxAttempts) {
      this.pendingOTPs.delete(normalizedPhone)
      return {
        success: false,
        error: 'Too many attempts. Please request a new code.',
      }
    }

    // SECURITY: Use timing-safe comparison to prevent timing attacks
    if (!this.timingSafeCompare(otp.code, code)) {
      return { success: false, error: 'Invalid verification code' }
    }

    // Get or create user
    const user = await this.getOrCreateUser(normalizedPhone)
    user.phoneVerified = true
    user.lastLoginAt = Date.now()

    // Clean up
    this.pendingOTPs.delete(normalizedPhone)

    return { success: true, user }
  }

  /**
   * Get user by phone
   */
  getUser(phone: string): PhoneUser | null {
    return this.users.get(this.normalizePhone(phone)) ?? null
  }

  /**
   * Get user by ID
   */
  getUserById(id: string): PhoneUser | null {
    for (const user of this.users.values()) {
      if (user.id === id) return user
    }
    return null
  }

  private async getOrCreateUser(phone: string): Promise<PhoneUser> {
    let user = this.users.get(phone)

    if (!user) {
      const parsed = this.parsePhone(phone)
      user = {
        id: this.generateUserId(phone),
        phone,
        phoneVerified: false,
        countryCode: parsed.countryCode,
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
      }
      this.users.set(phone, user)
    }

    return user
  }

  private generateUserId(phone: string): string {
    return keccak256(
      toBytes(`phone:${phone}:${Date.now()}:${Math.random()}`),
    ).slice(0, 18)
  }

  private normalizePhone(phone: string): string {
    // Remove all non-digit characters except leading +
    let normalized = phone.replace(/[^\d+]/g, '')

    // Ensure it starts with +
    if (!normalized.startsWith('+')) {
      // Assume US if no country code
      if (normalized.length === 10) {
        normalized = `+1${normalized}`
      } else if (normalized.length === 11 && normalized.startsWith('1')) {
        normalized = `+${normalized}`
      } else {
        normalized = `+${normalized}`
      }
    }

    return normalized
  }

  private parsePhone(phone: string): {
    countryCode: string
    nationalNumber: string
  } {
    const normalized = this.normalizePhone(phone)

    // Simple parsing - in production use libphonenumber-js
    if (normalized.startsWith('+1')) {
      return { countryCode: 'US', nationalNumber: normalized.slice(2) }
    } else if (normalized.startsWith('+44')) {
      return { countryCode: 'GB', nationalNumber: normalized.slice(3) }
    } else if (normalized.startsWith('+86')) {
      return { countryCode: 'CN', nationalNumber: normalized.slice(3) }
    } else if (normalized.startsWith('+91')) {
      return { countryCode: 'IN', nationalNumber: normalized.slice(3) }
    } else if (normalized.startsWith('+82')) {
      return { countryCode: 'KR', nationalNumber: normalized.slice(3) }
    }

    return { countryCode: 'UNKNOWN', nationalNumber: normalized.slice(1) }
  }

  private validatePhone(phone: string): void {
    const normalized = this.normalizePhone(phone)

    // Basic validation
    if (normalized.length < 10 || normalized.length > 16) {
      throw new Error('Invalid phone number length')
    }

    if (!/^\+\d{10,15}$/.test(normalized)) {
      throw new Error('Invalid phone number format')
    }
  }

  private checkRateLimit(phone: string): { allowed: boolean; reason?: string } {
    const limit = this.rateLimits.get(phone)

    if (!limit) {
      return { allowed: true }
    }

    // Check if blocked
    if (limit.blockedUntil && Date.now() < limit.blockedUntil) {
      const remainingMinutes = Math.ceil(
        (limit.blockedUntil - Date.now()) / 60000,
      )
      return {
        allowed: false,
        reason: `Too many attempts. Please try again in ${remainingMinutes} minutes.`,
      }
    }

    // Reset if window has passed
    if (Date.now() - limit.lastAttempt > RATE_LIMIT_WINDOW) {
      this.rateLimits.delete(phone)
      return { allowed: true }
    }

    // Check daily limit
    const maxAttempts =
      this.config.maxDailyAttempts ?? DEFAULT_MAX_DAILY_ATTEMPTS
    if (limit.dailyAttempts >= maxAttempts) {
      limit.blockedUntil = limit.lastAttempt + RATE_LIMIT_WINDOW
      return {
        allowed: false,
        reason: 'Daily SMS limit reached. Please try again tomorrow.',
      }
    }

    return { allowed: true }
  }

  private updateRateLimit(phone: string): void {
    const limit = this.rateLimits.get(phone) ?? {
      phone,
      dailyAttempts: 0,
      lastAttempt: Date.now(),
    }

    // Reset if window has passed
    if (Date.now() - limit.lastAttempt > RATE_LIMIT_WINDOW) {
      limit.dailyAttempts = 0
    }

    limit.dailyAttempts++
    limit.lastAttempt = Date.now()
    this.rateLimits.set(phone, limit)
  }

  private async sendSMS(phone: string, message: string): Promise<void> {
    // Use custom sender if provided
    if (this.config.customSmsSender) {
      return this.config.customSmsSender(phone, message)
    }

    // Dev mode or test environment - log to console
    if (
      this.config.devMode ||
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'test'
    ) {
      console.log(`[Phone Provider] Sending SMS to ${phone}:`)
      console.log(`  Message: ${message}`)
      return
    }

    // Production SMS sending
    const provider = this.config.smsProvider ?? 'twilio'

    if (provider === 'twilio') {
      await this.sendViaTwilio(phone, message)
    } else if (provider === 'aws-sns') {
      await this.sendViaAwsSns(phone, message)
    } else {
      throw new Error(`Unknown SMS provider: ${provider}`)
    }
  }

  private async sendViaTwilio(phone: string, message: string): Promise<void> {
    const accountSid =
      this.config.twilioAccountSid ?? process.env.TWILIO_ACCOUNT_SID
    const authToken =
      this.config.twilioAuthToken ?? process.env.TWILIO_AUTH_TOKEN
    const fromPhone =
      this.config.twilioPhoneNumber ?? process.env.TWILIO_PHONE_NUMBER

    if (!accountSid || !authToken || !fromPhone) {
      throw new Error(
        'Twilio configuration required. Set TWILIO_* environment variables.',
      )
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        },
        body: new URLSearchParams({
          To: phone,
          From: fromPhone,
          Body: message,
        }),
      },
    )

    if (!response.ok) {
      const error = validateResponse(
        TwilioMessageResponseSchema,
        await response.json(),
        'Twilio error response',
      )
      throw new Error(
        `Twilio error: ${error.message ?? error.error_message ?? response.status}`,
      )
    }
  }

  private async sendViaAwsSns(_phone: string, _message: string): Promise<void> {
    throw new Error('AWS SNS not yet implemented. Use Twilio or custom sender.')
  }
}

export function createPhoneProvider(
  config: PhoneAuthConfig = {},
): PhoneProvider {
  return new PhoneProvider(config)
}
