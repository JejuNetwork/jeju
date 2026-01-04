import { WalletButton as DecentralizedWalletButton } from '@jejunetwork/ui/wallet'

export function WalletButton() {
  return (
    <DecentralizedWalletButton
      connectLabel="Connect Wallet"
      className="hover:shadow-glow transition-all [clip-path:polygon(8px_0,100%_0,calc(100%-8px)_100%,0_100%)] uppercase tracking-wider font-semibold"
    />
  )
}
