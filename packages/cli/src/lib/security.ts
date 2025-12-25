/** Security utilities with input validation and path sanitization */

import { join, normalize, resolve } from 'node:path'

/** Valid network types */
const VALID_NETWORKS = ['localnet', 'testnet', 'mainnet'] as const
export type ValidNetwork = (typeof VALID_NETWORKS)[number]

/** Validate network parameter to prevent path traversal */
export function validateNetwork(network: string): ValidNetwork {
  if (!VALID_NETWORKS.includes(network as ValidNetwork)) {
    throw new Error(
      `Invalid network: ${network}. Must be one of: ${VALID_NETWORKS.join(', ')}`,
    )
  }
  return network as ValidNetwork
}

/** Safe filename pattern - alphanumeric, hyphens, underscores, dots */
const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** Validate filename to prevent path traversal */
export function validateFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Filename is required')
  }

  // Reject path traversal attempts
  if (
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\')
  ) {
    throw new Error('Invalid filename: path separators not allowed')
  }

  if (!SAFE_FILENAME_PATTERN.test(filename)) {
    throw new Error(
      'Invalid filename: must start with alphanumeric and contain only alphanumeric, dots, hyphens, underscores',
    )
  }

  return filename
}

/** Validate key/role name - alphanumeric and underscores only */
const SAFE_KEY_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/

export function validateKeyName(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('Key name is required')
  }

  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error('Invalid key name: path separators not allowed')
  }

  if (!SAFE_KEY_NAME_PATTERN.test(name)) {
    throw new Error(
      'Invalid key name: must start with letter and contain only alphanumeric, hyphens, underscores',
    )
  }

  return name
}

/**
 * Safely construct a path within a base directory.
 * Throws if the resulting path escapes the base directory.
 */
export function safePath(baseDir: string, ...segments: string[]): string {
  // Validate each segment for path traversal
  for (const segment of segments) {
    if (typeof segment !== 'string') {
      throw new Error('Path segment must be a string')
    }

    // Don't allow explicit parent directory references
    if (
      segment === '..' ||
      segment.includes('/../') ||
      segment.startsWith('../') ||
      segment.endsWith('/..')
    ) {
      throw new Error('Path traversal not allowed')
    }
  }

  const basePath = resolve(baseDir)
  const targetPath = normalize(join(basePath, ...segments))

  // Ensure target is within base directory
  if (!targetPath.startsWith(basePath)) {
    throw new Error('Path traversal detected: path escapes base directory')
  }

  return targetPath
}

/**
 * Validate and sanitize a directory path.
 * Returns resolved absolute path if valid.
 */
export function validateDirectory(path: string, mustExist = false): string {
  if (!path || typeof path !== 'string') {
    throw new Error('Directory path is required')
  }

  const resolved = resolve(path)

  // Basic sanity check - path shouldn't contain null bytes
  if (resolved.includes('\0')) {
    throw new Error('Invalid path: null bytes not allowed')
  }

  if (mustExist) {
    const { existsSync, statSync } = require('node:fs')
    if (!existsSync(resolved)) {
      throw new Error(`Directory does not exist: ${resolved}`)
    }
    const stat = statSync(resolved)
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolved}`)
    }
  }

  return resolved
}

/** Validate Ethereum address format */
const ETH_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/

export function validateAddress(address: string): `0x${string}` {
  if (!address || typeof address !== 'string') {
    throw new Error('Address is required')
  }

  if (!ETH_ADDRESS_PATTERN.test(address)) {
    throw new Error('Invalid Ethereum address format')
  }

  return address as `0x${string}`
}

/** Validate private key format (does NOT validate cryptographic validity) */
const PRIVATE_KEY_PATTERN = /^0x[a-fA-F0-9]{64}$/

export function validatePrivateKeyFormat(key: string): `0x${string}` {
  if (!key || typeof key !== 'string') {
    throw new Error('Private key is required')
  }

  if (!PRIVATE_KEY_PATTERN.test(key)) {
    throw new Error('Invalid private key format')
  }

  return key as `0x${string}`
}

/** Validate IPFS CID format */
const CID_V0_PATTERN = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/
const CID_V1_PATTERN = /^b[a-z2-7]{58}$/

export function validateCID(cid: string): string {
  if (!cid || typeof cid !== 'string') {
    throw new Error('CID is required')
  }

  // Remove any path traversal attempts
  if (cid.includes('..') || cid.includes('/') || cid.includes('\\')) {
    throw new Error('Invalid CID: path separators not allowed')
  }

  // Validate CID format
  if (!CID_V0_PATTERN.test(cid) && !CID_V1_PATTERN.test(cid)) {
    throw new Error('Invalid CID format')
  }

  return cid
}

/** Validate URL format for git remotes */
export function validateRemoteUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    throw new Error('Remote URL is required')
  }

  // Check for common URL formats
  const validPrefixes = [
    'http://',
    'https://',
    'git://',
    'ssh://',
    'jeju://',
    'git@',
  ]

  const hasValidPrefix = validPrefixes.some((prefix) => url.startsWith(prefix))

  if (!hasValidPrefix) {
    throw new Error('Invalid remote URL format')
  }

  // Reject URLs with obvious injection attempts
  if (
    url.includes('$(') ||
    url.includes('`') ||
    url.includes(';') ||
    url.includes('|') ||
    url.includes('\n')
  ) {
    throw new Error('Invalid characters in remote URL')
  }

  return url
}

/** Validate shell command (basic sanitization) */
export function validateShellCommand(command: string): string {
  if (!command || typeof command !== 'string') {
    throw new Error('Command is required')
  }

  // Reject commands with obvious injection attempts
  const dangerousPatterns = [
    /\$\(.*\)/, // Command substitution $(...)
    /`.*`/, // Backtick substitution
    /;\s*rm\s/i, // Chained rm command
    /;\s*curl\s/i, // Chained curl command
    /\|\s*sh\b/i, // Piping to shell
    /\|\s*bash\b/i, // Piping to bash
    />\s*\/etc\//, // Writing to /etc
    />\s*\/proc\//, // Writing to /proc
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      throw new Error('Potentially dangerous command pattern detected')
    }
  }

  return command
}

/** Validate app name for init command */
const APP_NAME_PATTERN = /^[a-z][a-z0-9-]*$/

export function validateAppName(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('App name is required')
  }

  if (name.length > 64) {
    throw new Error('App name too long (max 64 characters)')
  }

  if (!APP_NAME_PATTERN.test(name)) {
    throw new Error(
      'App name must be lowercase, start with a letter, and contain only letters, numbers, and hyphens',
    )
  }

  // Reject reserved names
  const reservedNames = [
    'node_modules',
    'dist',
    'build',
    'src',
    'test',
    'tests',
    'lib',
  ]
  if (reservedNames.includes(name)) {
    throw new Error(`App name "${name}" is reserved`)
  }

  return name
}

/** Validate hex string */
export function validateHex(value: string, expectedLength?: number): string {
  if (!value || typeof value !== 'string') {
    throw new Error('Hex value is required')
  }

  const hex = value.startsWith('0x') ? value.slice(2) : value

  if (!/^[a-fA-F0-9]+$/.test(hex)) {
    throw new Error('Invalid hex value')
  }

  if (expectedLength !== undefined && hex.length !== expectedLength) {
    throw new Error(
      `Hex value must be ${expectedLength} characters (got ${hex.length})`,
    )
  }

  return value.startsWith('0x') ? value : `0x${value}`
}

/** Validate port number */
export function validatePort(port: string | number): number {
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port

  if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error('Invalid port number (must be 1-65535)')
  }

  return portNum
}

/** Sanitize error message to remove sensitive data */
export function sanitizeErrorMessage(error: Error | string): string {
  const message = typeof error === 'string' ? error : error.message

  // Remove potential private keys and secrets from error messages
  // SECURITY: Multiple patterns to catch different key formats
  return (
    message
      // Ethereum private keys (64 hex chars after 0x)
      .replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_KEY]')
      // Generic private key patterns in various formats
      .replace(/private[kK]ey['":\s]+[^\s,}\]"']+/gi, 'privateKey: [REDACTED]')
      // API keys (common patterns)
      .replace(/['"]\s*[a-zA-Z0-9_-]{32,}['"]/g, '"[REDACTED_TOKEN]"')
      // Bearer tokens
      .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]')
      // Authorization headers
      .replace(
        /[Aa]uthorization['":\s]+[^\s,}\]"']+/g,
        'Authorization: [REDACTED]',
      )
      // Seed phrases (12-24 words)
      .replace(/\b([a-z]+\s+){11,23}[a-z]+\b/gi, '[REDACTED_SEED_PHRASE]')
      // Passwords in URLs
      .replace(/:\/\/[^:@]+:[^@]+@/g, '://[USER]:[REDACTED]@')
      // Base64 encoded secrets (common patterns like JWT)
      .replace(
        /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
        '[REDACTED_JWT]',
      )
  )
}
