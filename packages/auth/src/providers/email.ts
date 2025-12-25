/**
 * Email Authentication Provider
 *
 * Secure email authentication with:
 * - Magic link (passwordless)
 * - Email + Password with secure hashing
 * - OTP verification
 * - Email verification status tracking
 */

import { type Hex, keccak256, toBytes, toHex } from 'viem'
import { generateOTP } from '../validation.js'

export interface EmailAuthConfig {
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPassword?: string
  fromEmail: string
  fromName: string
  magicLinkBaseUrl: string
  magicLinkExpiryMinutes?: number
  otpExpiryMinutes?: number
  otpLength?: number
  /** If true, skips actual email sending (for testing) */
  devMode?: boolean
}

export interface EmailUser {
  id: string
  email: string
  emailVerified: boolean
  passwordHash?: Hex
  createdAt: number
  lastLoginAt: number
}

export interface MagicLinkToken {
  token: Hex
  email: string
  expiresAt: number
  used: boolean
  createdAt: number
}

export interface OTPToken {
  code: string
  email: string
  expiresAt: number
  attempts: number
  maxAttempts: number
  createdAt: number
}

export interface EmailAuthResult {
  success: boolean
  user?: EmailUser
  error?: string
  requiresVerification?: boolean
}

const DEFAULT_MAGIC_LINK_EXPIRY = 15 // minutes
const DEFAULT_OTP_EXPIRY = 10 // minutes
const DEFAULT_OTP_LENGTH = 6
const MAX_OTP_ATTEMPTS = 3
const MAX_PENDING_TOKENS = 10000 // Maximum pending tokens before cleanup
const CLEANUP_INTERVAL = 60000 // Run cleanup every minute

export class EmailProvider {
  private config: EmailAuthConfig
  private pendingMagicLinks = new Map<string, MagicLinkToken>()
  private pendingOTPs = new Map<string, OTPToken>()
  private users = new Map<string, EmailUser>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: EmailAuthConfig) {
    this.config = {
      ...config,
      magicLinkExpiryMinutes:
        config.magicLinkExpiryMinutes ?? DEFAULT_MAGIC_LINK_EXPIRY,
      otpExpiryMinutes: config.otpExpiryMinutes ?? DEFAULT_OTP_EXPIRY,
      otpLength: config.otpLength ?? DEFAULT_OTP_LENGTH,
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

    // Clean expired magic links
    for (const [token, data] of this.pendingMagicLinks.entries()) {
      if (now > data.expiresAt || data.used) {
        this.pendingMagicLinks.delete(token)
      }
    }

    // Clean expired OTPs
    for (const [email, data] of this.pendingOTPs.entries()) {
      if (now > data.expiresAt) {
        this.pendingOTPs.delete(email)
      }
    }

    // Enforce size limits - remove oldest entries if over limit
    if (this.pendingMagicLinks.size > MAX_PENDING_TOKENS) {
      const entries = Array.from(this.pendingMagicLinks.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt,
      )
      const toRemove = entries.slice(0, entries.length - MAX_PENDING_TOKENS)
      for (const [token] of toRemove) {
        this.pendingMagicLinks.delete(token)
      }
    }

    if (this.pendingOTPs.size > MAX_PENDING_TOKENS) {
      const entries = Array.from(this.pendingOTPs.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt,
      )
      const toRemove = entries.slice(0, entries.length - MAX_PENDING_TOKENS)
      for (const [email] of toRemove) {
        this.pendingOTPs.delete(email)
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
   * Initiate magic link authentication
   */
  async sendMagicLink(
    email: string,
  ): Promise<{ token: Hex; magicLink: string }> {
    this.validateEmail(email)

    const tokenBytes = crypto.getRandomValues(new Uint8Array(32))
    const token = toHex(tokenBytes)
    const expiresAt =
      Date.now() +
      (this.config.magicLinkExpiryMinutes ?? DEFAULT_MAGIC_LINK_EXPIRY) *
        60 *
        1000

    const magicLinkToken: MagicLinkToken = {
      token,
      email: email.toLowerCase(),
      expiresAt,
      used: false,
      createdAt: Date.now(),
    }

    this.pendingMagicLinks.set(token, magicLinkToken)

    const magicLink = `${this.config.magicLinkBaseUrl}?token=${token}`

    await this.sendEmail(
      email,
      'Sign in to your account',
      this.getMagicLinkEmailTemplate(magicLink),
    )

    return { token, magicLink }
  }

  /**
   * Verify magic link token and authenticate user
   */
  async verifyMagicLink(token: Hex): Promise<EmailAuthResult> {
    const magicLinkToken = this.pendingMagicLinks.get(token)

    if (!magicLinkToken) {
      return { success: false, error: 'Invalid or expired magic link' }
    }

    if (magicLinkToken.used) {
      return { success: false, error: 'Magic link already used' }
    }

    if (Date.now() > magicLinkToken.expiresAt) {
      this.pendingMagicLinks.delete(token)
      return { success: false, error: 'Magic link expired' }
    }

    // Mark as used
    magicLinkToken.used = true

    // Get or create user
    const user = await this.getOrCreateUser(magicLinkToken.email)
    user.emailVerified = true
    user.lastLoginAt = Date.now()

    // Clean up
    this.pendingMagicLinks.delete(token)

    return { success: true, user }
  }

  /**
   * Send OTP for email verification
   */
  async sendOTP(email: string): Promise<{ sent: boolean }> {
    this.validateEmail(email)

    const otpLength = this.config.otpLength ?? DEFAULT_OTP_LENGTH
    const code = generateOTP(otpLength)
    const expiresAt =
      Date.now() +
      (this.config.otpExpiryMinutes ?? DEFAULT_OTP_EXPIRY) * 60 * 1000

    const otpToken: OTPToken = {
      code,
      email: email.toLowerCase(),
      expiresAt,
      attempts: 0,
      maxAttempts: MAX_OTP_ATTEMPTS,
      createdAt: Date.now(),
    }

    this.pendingOTPs.set(email.toLowerCase(), otpToken)

    await this.sendEmail(
      email,
      'Your verification code',
      this.getOTPEmailTemplate(code),
    )

    return { sent: true }
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
   * Verify OTP code
   * SECURITY: Uses timing-safe comparison to prevent timing attacks
   */
  async verifyOTP(email: string, code: string): Promise<EmailAuthResult> {
    const normalizedEmail = email.toLowerCase()
    const otpToken = this.pendingOTPs.get(normalizedEmail)

    if (!otpToken) {
      return { success: false, error: 'No pending verification for this email' }
    }

    if (Date.now() > otpToken.expiresAt) {
      this.pendingOTPs.delete(normalizedEmail)
      return { success: false, error: 'Verification code expired' }
    }

    otpToken.attempts++

    if (otpToken.attempts > otpToken.maxAttempts) {
      this.pendingOTPs.delete(normalizedEmail)
      return {
        success: false,
        error: 'Too many attempts. Please request a new code.',
      }
    }

    // SECURITY: Use timing-safe comparison to prevent timing attacks
    if (!this.timingSafeCompare(otpToken.code, code)) {
      return { success: false, error: 'Invalid verification code' }
    }

    // Get or create user
    const user = await this.getOrCreateUser(normalizedEmail)
    user.emailVerified = true
    user.lastLoginAt = Date.now()

    // Clean up
    this.pendingOTPs.delete(normalizedEmail)

    return { success: true, user }
  }

  /**
   * Register with email and password
   */
  async register(email: string, password: string): Promise<EmailAuthResult> {
    this.validateEmail(email)
    this.validatePassword(password)

    const normalizedEmail = email.toLowerCase()
    const existingUser = this.users.get(normalizedEmail)

    if (existingUser?.passwordHash) {
      return { success: false, error: 'Email already registered' }
    }

    const passwordHash = await this.hashPassword(password)

    const user: EmailUser = existingUser ?? {
      id: this.generateUserId(normalizedEmail),
      email: normalizedEmail,
      emailVerified: false,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    }

    user.passwordHash = passwordHash
    this.users.set(normalizedEmail, user)

    // Send verification email
    await this.sendOTP(normalizedEmail)

    return { success: true, user, requiresVerification: true }
  }

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<EmailAuthResult> {
    const normalizedEmail = email.toLowerCase()
    const user = this.users.get(normalizedEmail)

    if (!user || !user.passwordHash) {
      return { success: false, error: 'Invalid email or password' }
    }

    const passwordValid = await this.verifyPassword(password, user.passwordHash)

    if (!passwordValid) {
      return { success: false, error: 'Invalid email or password' }
    }

    if (!user.emailVerified) {
      return {
        success: false,
        error: 'Email not verified',
        requiresVerification: true,
      }
    }

    user.lastLoginAt = Date.now()

    return { success: true, user }
  }

  /**
   * Change password
   */
  async changePassword(
    email: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<EmailAuthResult> {
    const normalizedEmail = email.toLowerCase()
    const user = this.users.get(normalizedEmail)

    if (!user || !user.passwordHash) {
      return { success: false, error: 'User not found' }
    }

    const passwordValid = await this.verifyPassword(
      currentPassword,
      user.passwordHash,
    )

    if (!passwordValid) {
      return { success: false, error: 'Current password is incorrect' }
    }

    this.validatePassword(newPassword)
    user.passwordHash = await this.hashPassword(newPassword)

    return { success: true, user }
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email: string): Promise<{ token: Hex }> {
    this.validateEmail(email)
    return this.sendMagicLink(email)
  }

  /**
   * Reset password with magic link token
   */
  async resetPassword(
    token: Hex,
    newPassword: string,
  ): Promise<EmailAuthResult> {
    const magicLinkToken = this.pendingMagicLinks.get(token)

    if (
      !magicLinkToken ||
      magicLinkToken.used ||
      Date.now() > magicLinkToken.expiresAt
    ) {
      return { success: false, error: 'Invalid or expired reset link' }
    }

    this.validatePassword(newPassword)

    const user = this.users.get(magicLinkToken.email)
    if (!user) {
      return { success: false, error: 'User not found' }
    }

    user.passwordHash = await this.hashPassword(newPassword)
    magicLinkToken.used = true

    return { success: true, user }
  }

  /**
   * Get user by email
   */
  getUser(email: string): EmailUser | null {
    return this.users.get(email.toLowerCase()) ?? null
  }

  /**
   * Get user by ID
   */
  getUserById(id: string): EmailUser | null {
    for (const user of this.users.values()) {
      if (user.id === id) return user
    }
    return null
  }

  private async getOrCreateUser(email: string): Promise<EmailUser> {
    const normalizedEmail = email.toLowerCase()
    let user = this.users.get(normalizedEmail)

    if (!user) {
      user = {
        id: this.generateUserId(normalizedEmail),
        email: normalizedEmail,
        emailVerified: false,
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
      }
      this.users.set(normalizedEmail, user)
    }

    return user
  }

  private generateUserId(email: string): string {
    return keccak256(
      toBytes(`email:${email}:${Date.now()}:${Math.random()}`),
    ).slice(0, 18)
  }

  private validateEmail(email: string): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email address')
    }
  }

  private validatePassword(password: string): void {
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters')
    }
    if (!/[A-Z]/.test(password)) {
      throw new Error('Password must contain at least one uppercase letter')
    }
    if (!/[a-z]/.test(password)) {
      throw new Error('Password must contain at least one lowercase letter')
    }
    if (!/[0-9]/.test(password)) {
      throw new Error('Password must contain at least one number')
    }
  }

  private async hashPassword(password: string): Promise<Hex> {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const encoder = new TextEncoder()
    const passwordData = encoder.encode(password)

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordData,
      'PBKDF2',
      false,
      ['deriveBits'],
    )

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256,
    )

    // Store salt + hash
    const result = new Uint8Array(salt.length + derivedBits.byteLength)
    result.set(salt)
    result.set(new Uint8Array(derivedBits), salt.length)

    return toHex(result)
  }

  private async verifyPassword(
    password: string,
    storedHash: Hex,
  ): Promise<boolean> {
    const stored = toBytes(storedHash)
    const salt = stored.slice(0, 16)
    const expectedHash = stored.slice(16)

    const encoder = new TextEncoder()
    const passwordData = encoder.encode(password)

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordData,
      'PBKDF2',
      false,
      ['deriveBits'],
    )

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256,
    )

    const derivedArray = new Uint8Array(derivedBits)

    if (derivedArray.length !== expectedHash.length) return false

    // SECURITY: Use constant-time comparison to prevent timing attacks
    // XOR all bytes and accumulate result - compare all bytes regardless of mismatches
    let result = 0
    for (let i = 0; i < derivedArray.length; i++) {
      const a = derivedArray[i] ?? 0
      const b = expectedHash[i] ?? 0
      result |= a ^ b
    }

    return result === 0
  }

  private async sendEmail(
    _to: string,
    _subject: string,
    _html: string,
  ): Promise<void> {
    if (
      this.config.devMode ||
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'test'
    ) {
      return
    }

    const smtpConfig = {
      host: this.config.smtpHost ?? process.env.SMTP_HOST,
      port:
        this.config.smtpPort ?? parseInt(process.env.SMTP_PORT ?? '587', 10),
      user: this.config.smtpUser ?? process.env.SMTP_USER,
      password: this.config.smtpPassword ?? process.env.SMTP_PASSWORD,
    }

    if (!smtpConfig.host || !smtpConfig.user || !smtpConfig.password) {
      throw new Error(
        'SMTP configuration required for production email sending',
      )
    }

    throw new Error(
      'Email provider not configured. Set SMTP_* environment variables.',
    )
  }

  private getMagicLinkEmailTemplate(magicLink: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Sign in to your account</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Sign in to your account</h1>
          <p>Click the button below to sign in:</p>
          <a href="${magicLink}" style="display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
            Sign In
          </a>
          <p style="color: #666; font-size: 14px;">This link expires in ${this.config.magicLinkExpiryMinutes} minutes.</p>
          <p style="color: #666; font-size: 14px;">If you didn't request this email, you can safely ignore it.</p>
        </div>
      </body>
      </html>
    `
  }

  private getOTPEmailTemplate(code: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Your verification code</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Your verification code</h1>
          <p>Enter this code to verify your email:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 20px; background: #f3f4f6; border-radius: 8px; text-align: center; margin: 20px 0;">
            ${code}
          </div>
          <p style="color: #666; font-size: 14px;">This code expires in ${this.config.otpExpiryMinutes} minutes.</p>
          <p style="color: #666; font-size: 14px;">If you didn't request this code, you can safely ignore it.</p>
        </div>
      </body>
      </html>
    `
  }
}

export function createEmailProvider(config: EmailAuthConfig): EmailProvider {
  return new EmailProvider(config)
}
