/**
 * Phone/SMS Authentication Provider
 *
 * Secure phone authentication with:
 * - SMS OTP verification
 * - Rate limiting
 * - Phone number validation
 */

import {
  getAwsAccessKeyId,
  getAwsRegion,
  getAwsSecretAccessKey,
  getAwsSnsSenderId,
  getTwilioAccountSid,
  getTwilioAuthToken,
  getTwilioPhoneNumber,
  isDevMode,
  isTestMode,
} from '@jejunetwork/config'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
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
  awsRegion?: string
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
  awsSenderId?: string
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
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours
const RATE_LIMIT_TTL_SECONDS = 24 * 60 * 60 // 24 hours

// Distributed caches for phone auth state
let otpCache: CacheClient | null = null
let userCache: CacheClient | null = null
let rateLimitCache: CacheClient | null = null

function getOtpCache(): CacheClient {
  if (!otpCache) {
    otpCache = getCacheClient('phone-auth-otp')
  }
  return otpCache
}

function getUserCache(): CacheClient {
  if (!userCache) {
    userCache = getCacheClient('phone-auth-users')
  }
  return userCache
}

function getRateLimitCache(): CacheClient {
  if (!rateLimitCache) {
    rateLimitCache = getCacheClient('phone-auth-ratelimit')
  }
  return rateLimitCache
}

export class PhoneProvider {
  private config: PhoneAuthConfig

  constructor(config: PhoneAuthConfig = {}) {
    this.config = {
      ...config,
      otpExpiryMinutes: config.otpExpiryMinutes ?? DEFAULT_OTP_EXPIRY,
      otpLength: config.otpLength ?? DEFAULT_OTP_LENGTH,
      maxDailyAttempts: config.maxDailyAttempts ?? DEFAULT_MAX_DAILY_ATTEMPTS,
      smsProvider: config.smsProvider ?? 'twilio',
    }
  }

  /**
   * Stop cleanup interval (for testing/cleanup) - no-op with distributed cache
   */
  destroy(): void {
    // Distributed cache handles TTL automatically
  }

  /**
   * Send OTP to phone number
   */
  async sendOTP(phone: string): Promise<{ sent: boolean; expiresAt: number }> {
    const normalizedPhone = this.normalizePhone(phone)
    this.validatePhone(normalizedPhone)

    // Check rate limits
    const rateLimitCheck = await this.checkRateLimit(normalizedPhone)
    if (!rateLimitCheck.allowed) {
      throw new Error(rateLimitCheck.reason ?? 'Rate limit exceeded')
    }

    const otpLength = this.config.otpLength ?? DEFAULT_OTP_LENGTH
    const code = generateOTP(otpLength)
    const otpExpiryMinutes = this.config.otpExpiryMinutes ?? DEFAULT_OTP_EXPIRY
    const expiresAt = Date.now() + otpExpiryMinutes * 60 * 1000

    const otp: PhoneOTP = {
      code,
      phone: normalizedPhone,
      expiresAt,
      attempts: 0,
      maxAttempts: MAX_OTP_ATTEMPTS,
      createdAt: Date.now(),
    }

    // Store OTP in distributed cache with TTL
    const cache = getOtpCache()
    await cache.set(
      `otp:${normalizedPhone}`,
      JSON.stringify(otp),
      otpExpiryMinutes * 60,
    )
    await this.updateRateLimit(normalizedPhone)

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
    const cache = getOtpCache()
    const cacheKey = `otp:${normalizedPhone}`
    const cached = await cache.get(cacheKey)

    if (!cached) {
      return {
        success: false,
        error: 'No pending verification for this phone number',
      }
    }

    const otp: PhoneOTP = JSON.parse(cached)

    if (Date.now() > otp.expiresAt) {
      await cache.delete(cacheKey)
      return { success: false, error: 'Verification code expired' }
    }

    otp.attempts++

    if (otp.attempts > otp.maxAttempts) {
      await cache.delete(cacheKey)
      return {
        success: false,
        error: 'Too many attempts. Please request a new code.',
      }
    }

    // Update attempts in cache
    const remainingTtl = Math.ceil((otp.expiresAt - Date.now()) / 1000)
    await cache.set(cacheKey, JSON.stringify(otp), remainingTtl)

    // SECURITY: Use timing-safe comparison to prevent timing attacks
    if (!this.timingSafeCompare(otp.code, code)) {
      return { success: false, error: 'Invalid verification code' }
    }

    // Get or create user
    const user = await this.getOrCreateUser(normalizedPhone)
    user.phoneVerified = true
    user.lastLoginAt = Date.now()

    // Clean up and save user
    await cache.delete(cacheKey)
    const userCacheInstance = getUserCache()
    await userCacheInstance.set(`user:${normalizedPhone}`, JSON.stringify(user))

    return { success: true, user }
  }

  /**
   * Get user by phone
   */
  async getUser(phone: string): Promise<PhoneUser | null> {
    const cache = getUserCache()
    const cached = await cache.get(`user:${this.normalizePhone(phone)}`)
    if (cached) {
      return JSON.parse(cached)
    }
    return null
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string): Promise<PhoneUser | null> {
    const cache = getUserCache()
    const cached = await cache.get(`user-by-id:${id}`)
    if (cached) {
      return JSON.parse(cached)
    }
    return null
  }

  private async getOrCreateUser(phone: string): Promise<PhoneUser> {
    const cache = getUserCache()
    const cached = await cache.get(`user:${phone}`)

    if (cached) {
      return JSON.parse(cached)
    }

    const parsed = this.parsePhone(phone)
    const user: PhoneUser = {
      id: this.generateUserId(phone),
      phone,
      phoneVerified: false,
      countryCode: parsed.countryCode,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    }

    // Store user by phone and by ID for lookups
    await cache.set(`user:${phone}`, JSON.stringify(user))
    await cache.set(`user-by-id:${user.id}`, JSON.stringify(user))

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

  private async checkRateLimit(
    phone: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const cache = getRateLimitCache()
    const cacheKey = `ratelimit:${phone}`
    const cached = await cache.get(cacheKey)

    if (!cached) {
      return { allowed: true }
    }

    const limit: PhoneRateLimit = JSON.parse(cached)

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
    if (Date.now() - limit.lastAttempt > RATE_LIMIT_WINDOW_MS) {
      await cache.delete(cacheKey)
      return { allowed: true }
    }

    // Check daily limit
    const maxAttempts =
      this.config.maxDailyAttempts ?? DEFAULT_MAX_DAILY_ATTEMPTS
    if (limit.dailyAttempts >= maxAttempts) {
      limit.blockedUntil = limit.lastAttempt + RATE_LIMIT_WINDOW_MS
      await cache.set(cacheKey, JSON.stringify(limit), RATE_LIMIT_TTL_SECONDS)
      return {
        allowed: false,
        reason: 'Daily SMS limit reached. Please try again tomorrow.',
      }
    }

    return { allowed: true }
  }

  private async updateRateLimit(phone: string): Promise<void> {
    const cache = getRateLimitCache()
    const cacheKey = `ratelimit:${phone}`
    const cached = await cache.get(cacheKey)

    let limit: PhoneRateLimit
    if (cached) {
      limit = JSON.parse(cached)
      // Reset if window has passed
      if (Date.now() - limit.lastAttempt > RATE_LIMIT_WINDOW_MS) {
        limit.dailyAttempts = 0
      }
    } else {
      limit = {
        phone,
        dailyAttempts: 0,
        lastAttempt: Date.now(),
      }
    }

    limit.dailyAttempts++
    limit.lastAttempt = Date.now()
    await cache.set(cacheKey, JSON.stringify(limit), RATE_LIMIT_TTL_SECONDS)
  }

  private async sendSMS(phone: string, message: string): Promise<void> {
    // Use custom sender if provided
    if (this.config.customSmsSender) {
      return this.config.customSmsSender(phone, message)
    }

    // Dev mode or test environment - log to console
    if (this.config.devMode || isDevMode() || isTestMode()) {
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
    const accountSid = this.config.twilioAccountSid ?? getTwilioAccountSid()
    const authToken = this.config.twilioAuthToken ?? getTwilioAuthToken()
    const fromPhone = this.config.twilioPhoneNumber ?? getTwilioPhoneNumber()

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

  private async sendViaAwsSns(phone: string, message: string): Promise<void> {
    const region = this.config.awsRegion ?? getAwsRegion()
    const accessKeyId = this.config.awsAccessKeyId ?? getAwsAccessKeyId()
    const secretAccessKey =
      this.config.awsSecretAccessKey ?? getAwsSecretAccessKey()
    const senderId = this.config.awsSenderId ?? getAwsSnsSenderId()

    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        'AWS credentials required. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.',
      )
    }

    // Build AWS SNS Publish request
    const host = `sns.${region}.amazonaws.com`
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
    const date = timestamp.slice(0, 8)

    // Create canonical request for AWS Signature Version 4
    const params = new URLSearchParams({
      Action: 'Publish',
      PhoneNumber: phone,
      Message: message,
      'MessageAttributes.entry.1.Name': 'AWS.SNS.SMS.SenderID',
      'MessageAttributes.entry.1.Value.DataType': 'String',
      'MessageAttributes.entry.1.Value.StringValue': senderId,
      'MessageAttributes.entry.2.Name': 'AWS.SNS.SMS.SMSType',
      'MessageAttributes.entry.2.Value.DataType': 'String',
      'MessageAttributes.entry.2.Value.StringValue': 'Transactional',
      Version: '2010-03-31',
    })

    const body = params.toString()
    const bodyHash = await this.sha256Hash(body)

    const canonicalRequest = [
      'POST',
      '/',
      '',
      `host:${host}`,
      `x-amz-date:${timestamp}`,
      '',
      'host;x-amz-date',
      bodyHash,
    ].join('\n')

    const canonicalRequestHash = await this.sha256Hash(canonicalRequest)

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      timestamp,
      `${date}/${region}/sns/aws4_request`,
      canonicalRequestHash,
    ].join('\n')

    // Create signing key
    const kDate = await this.hmacSha256(`AWS4${secretAccessKey}`, date)
    const kRegion = await this.hmacSha256Raw(kDate, region)
    const kService = await this.hmacSha256Raw(kRegion, 'sns')
    const kSigning = await this.hmacSha256Raw(kService, 'aws4_request')
    const signature = await this.hmacSha256Raw(kSigning, stringToSign)
    const signatureHex = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${date}/${region}/sns/aws4_request, SignedHeaders=host;x-amz-date, Signature=${signatureHex}`

    const response = await fetch(`https://${host}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Host: host,
        'X-Amz-Date': timestamp,
        Authorization: authorization,
      },
      body,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`AWS SNS error: ${response.status} - ${errorText}`)
    }
  }

  private async sha256Hash(data: string): Promise<string> {
    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(data),
    )
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async hmacSha256(key: string, data: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(key)
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
  }

  private async hmacSha256Raw(
    key: ArrayBuffer,
    data: string,
  ): Promise<ArrayBuffer> {
    const encoder = new TextEncoder()
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
  }
}

export function createPhoneProvider(
  config: PhoneAuthConfig = {},
): PhoneProvider {
  return new PhoneProvider(config)
}
