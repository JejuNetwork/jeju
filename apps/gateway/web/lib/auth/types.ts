export const AuthProvider = {
  WALLET: 'wallet',
  FARCASTER: 'farcaster',
  GOOGLE: 'google',
  APPLE: 'apple',
  TWITTER: 'twitter',
  GITHUB: 'github',
  DISCORD: 'discord',
  EMAIL: 'email',
  PHONE: 'phone',
} as const
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider]
