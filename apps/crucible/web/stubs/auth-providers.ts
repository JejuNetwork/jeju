// Stub for auth providers that use server-side modules
export const farcasterProvider = null
export const emailProvider = null
export const phoneProvider = null

// Farcaster utils stubs
export function generateFarcasterSignInMessage() {
  return ''
}

export function verifyFarcasterSignature() {
  return Promise.resolve(false)
}

export function getFarcasterUserData() {
  return Promise.resolve(null)
}
