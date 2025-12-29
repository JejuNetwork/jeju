import { WalletButton as DecentralizedWalletButton } from '@jejunetwork/ui/wallet'

export function WalletButton() {
  return (
    <DecentralizedWalletButton
      connectLabel="Connect Wallet"
      className="hover:bg-factory-700 transition-colors"
    />
  )
}
