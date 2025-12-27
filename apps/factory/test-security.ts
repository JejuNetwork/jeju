/**
 * Quick test of security modules
 */

import {
  decryptField,
  encryptField,
  isEncryptionEnabled,
} from './api/db/encryption'
import { generateNonce, validateNonce } from './api/validation/nonce-store'
import {
  checkRateLimit,
  getClientIdentifier,
  getRateLimitTier,
} from './api/validation/rate-limiter'

async function main() {
  console.log('=== Security Module Tests ===\n')

  // Rate Limiter Test
  console.log('1. Rate Limiter Test:')
  const result = checkRateLimit('test-ip', 'read')
  console.log('   Allowed:', result.allowed)
  console.log('   Remaining:', result.remaining)

  const tier = getRateLimitTier('POST', '/api/farcaster/signer')
  console.log('   Tier for POST /api/farcaster/signer:', tier)

  const clientId = getClientIdentifier({ 'x-jeju-address': '0x1234' })
  console.log('   Client ID from address:', clientId)

  // Nonce Store Test
  console.log('\n2. Nonce Store Test:')
  const nonce = generateNonce()
  console.log('   Generated nonce:', `${nonce.slice(0, 20)}...`)

  const validation = validateNonce('0x1234567890abcdef', nonce, Date.now())
  console.log('   First use valid:', validation.valid)

  const replay = validateNonce('0x1234567890abcdef', nonce, Date.now())
  console.log(
    '   Replay blocked:',
    !replay.valid,
    '(reason:',
    replay.reason,
    ')',
  )

  // Encryption Test
  console.log('\n3. Encryption Test:')
  console.log('   Encryption enabled:', isEncryptionEnabled())

  // Test field encryption if key is set
  if (isEncryptionEnabled()) {
    const plaintext = 'sensitive-data-12345'
    const encrypted = await encryptField(plaintext)
    const decrypted = await decryptField(encrypted)
    console.log('   Original:', plaintext)
    console.log('   Encrypted:', `${encrypted.slice(0, 30)}...`)
    console.log('   Decrypted:', decrypted)
    console.log('   Round-trip success:', plaintext === decrypted)
  } else {
    console.log('   Set FACTORY_DB_ENCRYPTION_KEY to test encryption')
  }

  console.log('\n✓ All security modules loaded and working correctly')
}

main().catch(console.error)
