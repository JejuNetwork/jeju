import { z } from 'zod'
import type { WalletSetupFunction } from '../defineWalletSetup'

// Use z.any() for the function since z.function().output() doesn't work in Zod 4
// The function signature is validated at runtime when it's called
const WalletSetupModule = z.object({
  default: z.object({
    hash: z.string(),
    fn: z.any()
  })
})

export async function importWalletSetupFile(walletSetupFilePath: string) {
  const walletSetupModule = await import(walletSetupFilePath)

  const result = WalletSetupModule.safeParse(walletSetupModule)
  if (!result.success) {
    throw new Error(
      [
        `[ImportWalletSetupFile] Invalid wallet setup function at ${walletSetupFilePath}`,
        'Remember that all wallet setup files must export the wallet setup function as a default export!'
      ].join('\n')
    )
  }

  const { hash, fn } = result.data.default

  // Validate fn is a function at runtime
  if (typeof fn !== 'function') {
    throw new Error(
      `[ImportWalletSetupFile] Expected a function, got ${typeof fn} at ${walletSetupFilePath}`
    )
  }

  return {
    hash,
    fn: fn as WalletSetupFunction
  }
}
