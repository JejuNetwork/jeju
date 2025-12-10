import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { FileText, Shield, Vote, Server, Users, Scale } from 'lucide-react';

export const metadata = {
  title: 'Jeju Token Whitepaper',
  description: 'Technical whitepaper for the Jeju Network token with MiCA compliance information',
};

export default function WhitepaperPage() {
  return (
    <main className="min-h-screen">
      <Header />
      
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-12">
          <div className="flex items-center gap-2 text-jeju-500 mb-4">
            <FileText className="w-5 h-5" />
            <span className="text-sm font-medium">Whitepaper v1.0</span>
          </div>
          <h1 className="text-4xl font-bold mb-4">Jeju Token Whitepaper</h1>
          <p className="text-xl text-zinc-400">
            Technical documentation for JEJU, the governance and utility token of the Jeju Network.
          </p>
        </div>
        
        {/* Table of Contents */}
        <nav className="mb-12 p-6 rounded-xl bg-zinc-900 border border-zinc-800">
          <h2 className="font-semibold mb-4">Contents</h2>
          <ul className="space-y-2 text-sm">
            <li><a href="#abstract" className="text-zinc-400 hover:text-white transition-colors">1. Abstract</a></li>
            <li><a href="#network" className="text-zinc-400 hover:text-white transition-colors">2. Jeju Network Overview</a></li>
            <li><a href="#token" className="text-zinc-400 hover:text-white transition-colors">3. Token Utility</a></li>
            <li><a href="#tokenomics" className="text-zinc-400 hover:text-white transition-colors">4. Tokenomics</a></li>
            <li><a href="#governance" className="text-zinc-400 hover:text-white transition-colors">5. Governance</a></li>
            <li><a href="#moderation" className="text-zinc-400 hover:text-white transition-colors">6. Moderation Marketplace</a></li>
            <li><a href="#compliance" className="text-zinc-400 hover:text-white transition-colors">7. Regulatory Compliance (MiCA)</a></li>
            <li><a href="#risks" className="text-zinc-400 hover:text-white transition-colors">8. Risk Factors</a></li>
            <li><a href="#team" className="text-zinc-400 hover:text-white transition-colors">9. Team & Contact</a></li>
          </ul>
        </nav>
        
        {/* Abstract */}
        <Section id="abstract" title="1. Abstract">
          <p>
            Jeju Network is an OP-Stack L2 with 200ms Flashblocks. JEJU is the governance and utility token.
          </p>
          <p>
            Any token can be used for payments via paymaster. JEJU provides exclusive access to governance 
            and moderation.
          </p>
        </Section>
        
        {/* Network Overview */}
        <Section id="network" title="2. Jeju Network Overview">
          <h3 className="text-lg font-semibold mt-6 mb-3">2.1 Architecture</h3>
          <ul className="list-disc pl-6 space-y-2 mt-4">
            <li><strong>200ms Flashblocks</strong></li>
            <li><strong>ERC-4337 Account Abstraction</strong></li>
            <li><strong>EIL Cross-chain Bridging</strong></li>
            <li><strong>ERC-7683 Intents</strong></li>
          </ul>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">2.2 Services</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Compute:</strong> Inference with x402 micropayments</li>
            <li><strong>Storage:</strong> IPFS-compatible pinning</li>
            <li><strong>Bazaar:</strong> NFT marketplace</li>
            <li><strong>Identity:</strong> On-chain registry</li>
          </ul>
        </Section>
        
        {/* Token Utility */}
        <Section id="token" title="3. Token Utility">
          <div className="grid md:grid-cols-2 gap-4 my-6">
            <UtilityCard icon={<Vote className="w-5 h-5" />} title="Governance" description="Vote on proposals" />
            <UtilityCard icon={<Shield className="w-5 h-5" />} title="Moderation" description="Stake in moderation marketplace" />
            <UtilityCard icon={<Server className="w-5 h-5" />} title="Services" description="Pay via paymaster (any token)" />
            <UtilityCard icon={<Users className="w-5 h-5" />} title="Council" description="Revenue funds operations" />
          </div>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">3.1 Token Policy</h3>
          <p>Any registered token with a paymaster can be used for payments. JEJU is exclusive for:</p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li><strong>Governance:</strong> Voting on proposals</li>
            <li><strong>Moderation:</strong> Staking in ModerationMarketplace</li>
          </ul>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">3.2 Ban Enforcement</h3>
          <p>
            Banned users cannot transfer JEJU but can deposit to ModerationMarketplace to appeal (conviction lock).
          </p>
        </Section>
        
        {/* Tokenomics */}
        <Section id="tokenomics" title="4. Tokenomics">
          <div className="overflow-x-auto my-6">
            <table className="w-full text-sm">
              <thead className="bg-zinc-800">
                <tr>
                  <th className="px-4 py-3 text-left">Allocation</th>
                  <th className="px-4 py-3 text-right">%</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Vesting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                <tr>
                  <td className="px-4 py-3">Presale</td>
                  <td className="px-4 py-3 text-right">10%</td>
                  <td className="px-4 py-3 text-right">1,000,000,000</td>
                  <td className="px-4 py-3">20% TGE, 180-day linear</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Ecosystem</td>
                  <td className="px-4 py-3 text-right">30%</td>
                  <td className="px-4 py-3 text-right">3,000,000,000</td>
                  <td className="px-4 py-3">1-year cliff, 4-year linear</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Agent Council</td>
                  <td className="px-4 py-3 text-right">25%</td>
                  <td className="px-4 py-3 text-right">2,500,000,000</td>
                  <td className="px-4 py-3">5% TGE, 6-month cliff, 5-year linear</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Team</td>
                  <td className="px-4 py-3 text-right">15%</td>
                  <td className="px-4 py-3 text-right">1,500,000,000</td>
                  <td className="px-4 py-3">1-year cliff, 4-year linear</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Liquidity</td>
                  <td className="px-4 py-3 text-right">10%</td>
                  <td className="px-4 py-3 text-right">1,000,000,000</td>
                  <td className="px-4 py-3">100% at TGE</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Community</td>
                  <td className="px-4 py-3 text-right">10%</td>
                  <td className="px-4 py-3 text-right">1,000,000,000</td>
                  <td className="px-4 py-3">10% TGE, 3-year linear</td>
                </tr>
              </tbody>
              <tfoot className="bg-zinc-800">
                <tr>
                  <td className="px-4 py-3 font-semibold">Total</td>
                  <td className="px-4 py-3 text-right font-semibold">100%</td>
                  <td className="px-4 py-3 text-right font-semibold">10,000,000,000</td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">4.1 Initial Supply</h3>
          <p>
            1B JEJU at TGE. 10B max supply. Minting controlled by Agent Council multi-sig.
          </p>
        </Section>
        
        {/* Governance */}
        <Section id="governance" title="5. Governance">
          <p>Futarchy-based governance via prediction markets.</p>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">5.1 Agent Council</h3>
          <p>Multi-sig treasury receiving network revenue:</p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>Protocol development</li>
            <li>Infrastructure</li>
            <li>Grants</li>
            <li>Emergency response</li>
          </ul>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">5.2 Proposals</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Parameters:</strong> Fees, staking requirements</li>
            <li><strong>Treasury:</strong> Grants, partnerships</li>
            <li><strong>Upgrades:</strong> Contract changes</li>
            <li><strong>Elections:</strong> Guardian selection</li>
          </ul>
        </Section>
        
        {/* Moderation */}
        <Section id="moderation" title="6. Moderation Marketplace">
          <p>Futarchy-based ban decisions via prediction markets.</p>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">6.1 Conviction Lock</h3>
          <p>Banned users&apos; JEJU stakes are locked until appeal resolved:</p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>Stakers earn from successful moderation</li>
            <li>Banned users stake to appeal</li>
            <li>False reporters lose stake</li>
          </ul>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">6.2 Fees</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>90% to winners</li>
            <li>5% to treasury</li>
            <li>5% to market makers</li>
          </ul>
        </Section>
        
        {/* MiCA Compliance */}
        <Section id="compliance" title="7. Regulatory Compliance (MiCA)">
          <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700 my-6">
            <div className="flex items-center gap-2 mb-2">
              <Scale className="w-5 h-5 text-jeju-500" />
              <span className="font-semibold">MiCA Compliance</span>
            </div>
            <p className="text-sm text-zinc-400">
              JEJU is a utility token under MiCA Article 3(1)(5).
            </p>
          </div>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">7.1 Classification</h3>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li>Governance access</li>
            <li>Moderation participation</li>
            <li>Service payments</li>
            <li>No ownership/debt rights</li>
          </ul>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">7.2 Issuer</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Entity:</strong> Jeju Network Foundation</li>
            <li><strong>Contact:</strong> legal@jeju.network</li>
          </ul>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">7.3 Withdrawal</h3>
          <p>14-day withdrawal right. Auto-refund if soft cap not reached.</p>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">7.4 Environment</h3>
          <p>L2 on PoS Ethereum. &lt;0.01 kg CO2/tx.</p>
        </Section>
        
        {/* Risks */}
        <Section id="risks" title="8. Risk Factors">
          <div className="p-4 rounded-lg bg-red-900/20 border border-red-900/50 my-6">
            <p className="text-sm text-red-300">
              <strong>Warning:</strong> You may lose your entire investment.
            </p>
          </div>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">8.1 Technical</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>Smart contract vulnerabilities</li>
            <li>L1 dependency</li>
            <li>Network downtime</li>
            <li>Bridge failures</li>
          </ul>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">8.2 Market</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>Price volatility</li>
            <li>Liquidity constraints</li>
            <li>Competition</li>
          </ul>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">8.3 Regulatory</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>Regulation changes</li>
            <li>Classification changes</li>
            <li>Geographic restrictions</li>
          </ul>
          
          <h3 className="text-lg font-semibold mt-6 mb-3">8.4 Operational</h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>Key person risk</li>
            <li>Governance attacks</li>
            <li>Low adoption</li>
          </ul>
        </Section>
        
        {/* Team */}
        <Section id="team" title="9. Contact">
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Code:</strong> <a href="https://github.com/elizaos/jeju" className="text-jeju-400 hover:underline">github.com/elizaos/jeju</a></li>
            <li><strong>Security:</strong> security@jeju.network</li>
            <li><strong>Legal:</strong> legal@jeju.network</li>
            <li><strong>Audits:</strong> <a href="https://docs.jeju.network/audits" className="text-jeju-400 hover:underline">docs.jeju.network/audits</a></li>
          </ul>
        </Section>
        
        {/* Disclaimer */}
        <div className="mt-12 p-6 rounded-xl bg-zinc-800/50 border border-zinc-700">
          <h2 className="font-semibold mb-4">Disclaimer</h2>
          <p className="text-sm text-zinc-400">
            Not financial advice. JEJU is a utility token with no ownership rights. 
            You may lose your entire investment.
          </p>
          <p className="text-sm text-zinc-500 mt-4">
            Updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>
      
      <Footer />
    </main>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-12 scroll-mt-24">
      <h2 className="text-2xl font-bold mb-4">{title}</h2>
      <div className="prose prose-invert prose-zinc max-w-none">
        {children}
      </div>
    </section>
  );
}

function UtilityCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
      <div className="text-jeju-500 mb-2">{icon}</div>
      <h4 className="font-semibold mb-1">{title}</h4>
      <p className="text-sm text-zinc-400">{description}</p>
    </div>
  );
}
