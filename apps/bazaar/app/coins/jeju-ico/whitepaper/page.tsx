import Link from 'next/link'
import { JEJU_TOKENOMICS } from '@/config/jeju-tokenomics'

export const metadata = {
  title: 'Jeju Token Whitepaper',
  description: 'Technical whitepaper for the Jeju Network token',
}

export default function WhitepaperPage() {
  return (
    <div className="max-w-4xl mx-auto py-12">
      <div className="mb-12">
        <Link href="/coins/jeju-ico" className="text-bazaar-primary hover:underline text-sm mb-4 inline-block">
          ← Back to Jeju ICO
        </Link>
        <h1 className="text-4xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          Jeju Token Whitepaper
        </h1>
        <p className="text-xl" style={{ color: 'var(--text-secondary)' }}>
          Technical documentation for JEJU, the governance and utility token of the Jeju Network.
        </p>
      </div>
      
      {/* Table of Contents */}
      <nav className="card p-6 mb-12">
        <h2 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Contents</h2>
        <ul className="space-y-2 text-sm">
          {['Abstract', 'Network Overview', 'Token Utility', 'Tokenomics', 'Governance', 'Moderation', 'Compliance', 'Risks', 'Contact'].map((item, i) => (
            <li key={item}>
              <a href={`#section-${i + 1}`} className="hover:text-bazaar-primary transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                {i + 1}. {item}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      
      {/* Sections */}
      <Section id="section-1" title="1. Abstract">
        <p>
          Jeju Network is an OP-Stack L2 with 200ms Flashblocks. JEJU is the governance and utility token.
        </p>
        <p className="mt-4">
          Any token can be used for payments via paymaster. JEJU provides exclusive access to governance 
          and moderation staking.
        </p>
      </Section>
      
      <Section id="section-2" title="2. Jeju Network Overview">
        <h3 className="text-lg font-semibold mt-6 mb-3" style={{ color: 'var(--text-primary)' }}>Architecture</h3>
        <ul className="list-disc pl-6 space-y-2 mt-4" style={{ color: 'var(--text-secondary)' }}>
          <li><strong>200ms Flashblocks</strong> - Near-instant finality</li>
          <li><strong>ERC-4337 Account Abstraction</strong> - Gasless transactions</li>
          <li><strong>EIL Cross-chain Bridging</strong> - Ethereum Interop Layer</li>
          <li><strong>ERC-7683 Intents</strong> - Cross-chain execution</li>
        </ul>
        
        <h3 className="text-lg font-semibold mt-6 mb-3" style={{ color: 'var(--text-primary)' }}>Services</h3>
        <ul className="list-disc pl-6 space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <li><strong>Compute:</strong> Inference with x402 micropayments</li>
          <li><strong>Storage:</strong> IPFS-compatible pinning</li>
          <li><strong>Bazaar:</strong> NFT and token marketplace</li>
          <li><strong>Identity:</strong> On-chain registry (ERC-8004)</li>
        </ul>
      </Section>
      
      <Section id="section-3" title="3. Token Utility">
        <div className="grid md:grid-cols-2 gap-4 my-6">
          <UtilityCard title="🗳️ Governance" description="Vote on proposals" />
          <UtilityCard title="🛡️ Moderation" description="Stake in moderation marketplace" />
          <UtilityCard title="💻 Services" description="Pay via paymaster (any token)" />
          <UtilityCard title="👥 Council" description="Revenue funds operations" />
        </div>
        
        <h3 className="text-lg font-semibold mt-6 mb-3" style={{ color: 'var(--text-primary)' }}>Token Policy</h3>
        <p style={{ color: 'var(--text-secondary)' }}>
          Any registered token with a paymaster can be used for payments. JEJU is exclusive for governance and moderation staking.
        </p>
      </Section>
      
      <Section id="section-4" title="4. Tokenomics">
        <div className="overflow-x-auto my-6">
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <tr>
                <th className="px-4 py-3 text-left" style={{ color: 'var(--text-primary)' }}>Allocation</th>
                <th className="px-4 py-3 text-right" style={{ color: 'var(--text-primary)' }}>%</th>
                <th className="px-4 py-3 text-right" style={{ color: 'var(--text-primary)' }}>Amount</th>
                <th className="px-4 py-3 text-left" style={{ color: 'var(--text-primary)' }}>Vesting</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border-primary)' }}>
              {Object.entries(JEJU_TOKENOMICS.allocation).map(([key, value]) => (
                <tr key={key}>
                  <td className="px-4 py-3 capitalize" style={{ color: 'var(--text-primary)' }}>
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </td>
                  <td className="px-4 py-3 text-right" style={{ color: 'var(--text-secondary)' }}>{value.percent}%</td>
                  <td className="px-4 py-3 text-right" style={{ color: 'var(--text-secondary)' }}>
                    {(Number(value.amount) / 1e18 / 1e9).toFixed(1)}B
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-tertiary)' }}>
                    {value.vesting.tgePercent}% TGE
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <tr>
                <td className="px-4 py-3 font-semibold" style={{ color: 'var(--text-primary)' }}>Total</td>
                <td className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--text-primary)' }}>100%</td>
                <td className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--text-primary)' }}>10B</td>
                <td className="px-4 py-3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>
      
      <Section id="section-5" title="5. Governance">
        <p style={{ color: 'var(--text-secondary)' }}>
          Futarchy-based governance via prediction markets.
        </p>
        
        <h3 className="text-lg font-semibold mt-6 mb-3" style={{ color: 'var(--text-primary)' }}>Agent Council</h3>
        <p style={{ color: 'var(--text-secondary)' }}>Multi-sig treasury receiving network revenue for:</p>
        <ul className="list-disc pl-6 space-y-2 mt-2" style={{ color: 'var(--text-secondary)' }}>
          <li>Protocol development</li>
          <li>Infrastructure operations</li>
          <li>Ecosystem grants</li>
          <li>Emergency response</li>
        </ul>
      </Section>
      
      <Section id="section-6" title="6. Moderation Marketplace">
        <p style={{ color: 'var(--text-secondary)' }}>
          Futarchy-based ban decisions via prediction markets. Banned users JEJU stakes are locked until appeal resolved.
        </p>
        
        <h3 className="text-lg font-semibold mt-6 mb-3" style={{ color: 'var(--text-primary)' }}>Fee Distribution</h3>
        <ul className="list-disc pl-6 space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <li>90% to market winners</li>
          <li>5% to treasury</li>
          <li>5% to market makers</li>
        </ul>
      </Section>
      
      <Section id="section-7" title="7. Regulatory Compliance">
        <div className="card p-4 my-6 border-bazaar-primary/30 bg-bazaar-primary/5">
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>MiCA Compliance</span>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            JEJU is a utility token under MiCA Article 3(1)(5).
          </p>
        </div>
        
        <ul className="list-disc pl-6 space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <li>14-day withdrawal right</li>
          <li>Auto-refund if soft cap not reached</li>
          <li>L2 on PoS Ethereum (&lt;0.01 kg CO2/tx)</li>
        </ul>
      </Section>
      
      <Section id="section-8" title="8. Risk Factors">
        <div className="card p-4 my-6 border-bazaar-error/30 bg-bazaar-error/5">
          <p className="text-sm text-bazaar-error">
            <strong>Warning:</strong> You may lose your entire investment.
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 gap-4" style={{ color: 'var(--text-secondary)' }}>
          <div>
            <h4 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Technical</h4>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              <li>Smart contract vulnerabilities</li>
              <li>L1 dependency</li>
              <li>Network downtime</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Market</h4>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              <li>Price volatility</li>
              <li>Liquidity constraints</li>
              <li>Competition</li>
            </ul>
          </div>
        </div>
      </Section>
      
      <Section id="section-9" title="9. Contact">
        <ul className="list-disc pl-6 space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <li><strong>Code:</strong> <a href="https://github.com/elizaos/jeju" className="text-bazaar-primary hover:underline">github.com/elizaos/jeju</a></li>
          <li><strong>Security:</strong> security@jeju.network</li>
          <li><strong>Legal:</strong> legal@jeju.network</li>
        </ul>
      </Section>
      
      {/* Disclaimer */}
      <div className="card p-6 mt-12">
        <h2 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Disclaimer</h2>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Not financial advice. JEJU is a utility token with no ownership rights. 
          You may lose your entire investment.
        </p>
        <p className="text-sm mt-4" style={{ color: 'var(--text-tertiary)' }}>
          Updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
        </p>
      </div>
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-12 scroll-mt-24">
      <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <div>{children}</div>
    </section>
  )
}

function UtilityCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="card p-4">
      <h4 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</h4>
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
    </div>
  )
}
