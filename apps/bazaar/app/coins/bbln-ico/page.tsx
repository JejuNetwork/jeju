import { Metadata } from 'next'
import { BBLNPresaleCard } from '@/components/ico'

export const metadata: Metadata = {
  title: 'Babylon Token Sale | BBLN CCA Auction',
  description: 'Participate in the Babylon (BBLN) token sale via Continuous Clearing Auction. Fair price discovery, ELIZA holder bonus, instant liquidity at TGE.',
  openGraph: {
    title: 'Babylon Token Sale | BBLN',
    description: 'Join the BBLN CCA auction - 100M tokens available',
    images: ['/og/bbln-ico.png'],
  },
}

export default function BBLNICOPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-950/30 via-black to-orange-950/30">
      {/* Hero */}
      <section className="relative overflow-hidden py-20">
        <div className="absolute inset-0 bg-[url('/patterns/grid.svg')] opacity-5" />
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-4 py-2 text-sm text-amber-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              CCA Auction Live
            </div>
            <h1 className="mb-6 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 bg-clip-text text-5xl font-bold text-transparent md:text-6xl">
              Babylon Token Sale
            </h1>
            <p className="mb-8 text-lg text-amber-100/70 md:text-xl">
              100 million BBLN tokens available via Continuous Clearing Auction.
              <br />
              Fair price discovery. Same clearing price for all. ELIZA holder bonus.
            </p>
            
            {/* Key stats */}
            <div className="mx-auto grid max-w-2xl grid-cols-3 gap-4 text-center">
              <div className="rounded-xl bg-amber-950/30 p-4">
                <div className="text-2xl font-bold text-amber-100">100M</div>
                <div className="text-sm text-amber-300/50">Tokens Available</div>
              </div>
              <div className="rounded-xl bg-amber-950/30 p-4">
                <div className="text-2xl font-bold text-amber-100">10%</div>
                <div className="text-sm text-amber-300/50">Total Supply</div>
              </div>
              <div className="rounded-xl bg-amber-950/30 p-4">
                <div className="text-2xl font-bold text-amber-100">1.5x</div>
                <div className="text-sm text-amber-300/50">ELIZA Bonus</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Presale Card */}
            <div>
              <BBLNPresaleCard />
            </div>

            {/* Info Panels */}
            <div className="space-y-6">
              {/* How CCA Works */}
              <div className="rounded-2xl border border-amber-500/20 bg-black/40 p-6">
                <h2 className="mb-4 text-xl font-bold text-amber-100">How CCA Auction Works</h2>
                <ol className="space-y-3 text-sm text-amber-100/70">
                  <li className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-400">1</span>
                    <span>Price starts high and decreases over time (reverse Dutch auction)</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-400">2</span>
                    <span>Place your bid with an optional maximum price limit</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-400">3</span>
                    <span>When auction ends, final clearing price is calculated</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-400">4</span>
                    <span>All successful bidders pay the same clearing price</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-400">5</span>
                    <span>Tokens are distributed immediately - 100% liquid at TGE</span>
                  </li>
                </ol>
              </div>

              {/* Tokenomics Summary */}
              <div className="rounded-2xl border border-amber-500/20 bg-black/40 p-6">
                <h2 className="mb-4 text-xl font-bold text-amber-100">BBLN Tokenomics</h2>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between border-b border-amber-500/10 pb-2">
                    <span className="text-amber-300/70">Total Supply</span>
                    <span className="font-medium text-amber-100">1,000,000,000 BBLN</span>
                  </div>
                  <div className="flex justify-between border-b border-amber-500/10 pb-2">
                    <span className="text-amber-300/70">Public Sale</span>
                    <span className="font-medium text-amber-100">10% (100M)</span>
                  </div>
                  <div className="flex justify-between border-b border-amber-500/10 pb-2">
                    <span className="text-amber-300/70">Babylon Labs</span>
                    <span className="font-medium text-amber-100">20% (4yr vest)</span>
                  </div>
                  <div className="flex justify-between border-b border-amber-500/10 pb-2">
                    <span className="text-amber-300/70">Airdrop</span>
                    <span className="font-medium text-amber-100">10%</span>
                  </div>
                  <div className="flex justify-between border-b border-amber-500/10 pb-2">
                    <span className="text-amber-300/70">Liquidity</span>
                    <span className="font-medium text-amber-100">10%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-amber-300/70">Treasury</span>
                    <span className="font-medium text-amber-100">50% (10yr unlock)</span>
                  </div>
                </div>
              </div>

              {/* ELIZA Bonus */}
              <div className="rounded-2xl border border-green-500/20 bg-green-950/10 p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-500/20 text-xl">
                    ✓
                  </div>
                  <div>
                    <h3 className="mb-2 font-bold text-green-400">ELIZA Holder Bonus</h3>
                    <p className="text-sm text-green-100/70">
                      Hold ELIZA OS tokens to receive a 1.5x allocation bonus on your BBLN purchase.
                      Early bird bidders during the priority window also receive additional benefits.
                    </p>
                  </div>
                </div>
              </div>

              {/* Cross-Chain */}
              <div className="rounded-2xl border border-amber-500/20 bg-black/40 p-6">
                <h2 className="mb-4 text-xl font-bold text-amber-100">Cross-Chain Ready</h2>
                <p className="mb-4 text-sm text-amber-100/70">
                  BBLN is deployed on Ethereum mainnet with native support for bridging to:
                </p>
                <div className="flex flex-wrap gap-2">
                  {['Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche', 'BSC', 'Solana'].map((chain) => (
                    <span
                      key={chain}
                      className="rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-300"
                    >
                      {chain}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-8 text-center text-2xl font-bold text-amber-100">FAQ</h2>
            <div className="space-y-4">
              {[
                {
                  q: 'What is a CCA auction?',
                  a: 'Continuous Clearing Auction is a fair price discovery mechanism where the price decreases over time. All successful bidders pay the same final clearing price, ensuring fairness.',
                },
                {
                  q: 'When do I receive my tokens?',
                  a: 'BBLN tokens from the public sale are 100% liquid at TGE (Token Generation Event). You can claim immediately after the auction clears.',
                },
                {
                  q: 'How does the ELIZA bonus work?',
                  a: 'If you hold ELIZA OS tokens, your bid receives a 1.5x allocation multiplier. For example, a bid that would normally receive 1000 BBLN would instead receive 1500 BBLN.',
                },
                {
                  q: 'What if my max price is below the clearing price?',
                  a: 'If you set a max price and the clearing price ends up higher, your bid will not be filled and your ETH will be fully refunded.',
                },
                {
                  q: 'Can I bid from multiple chains?',
                  a: 'Yes! Cross-chain bids are supported from Ethereum, Base, and Arbitrum. Funds are bridged via Hyperlane for settlement on Ethereum mainnet.',
                },
              ].map((faq, i) => (
                <div key={i} className="rounded-xl border border-amber-500/10 bg-black/30 p-4">
                  <h3 className="mb-2 font-medium text-amber-100">{faq.q}</h3>
                  <p className="text-sm text-amber-100/60">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
