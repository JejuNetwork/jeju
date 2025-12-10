'use client';

import { Shield, Vote, Server } from 'lucide-react';

export function Hero() {
  return (
    <section className="py-16 md:py-24 text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-800/50 border border-zinc-700 text-sm text-zinc-400 mb-6">
        <span className="w-2 h-2 rounded-full bg-jeju-500 animate-pulse" />
        Token Presale Live
      </div>
      
      <h1 className="text-4xl md:text-6xl font-bold mb-4">
        <span className="gradient-text">Jeju Token</span>
      </h1>
      
      <p className="text-xl text-zinc-400 max-w-2xl mx-auto mb-8">
        Governance and utility token for the Jeju Network.
      </p>
      
      <div className="flex flex-wrap justify-center gap-4 mb-12">
        <Feature icon={<Vote className="w-5 h-5" />} text="Governance" />
        <Feature icon={<Shield className="w-5 h-5" />} text="Moderation Staking" />
        <Feature icon={<Server className="w-5 h-5" />} text="Network Utility" />
      </div>
      
      <div className="flex flex-wrap justify-center gap-6 text-sm text-zinc-500">
        <Stat label="Max Supply" value="10B JEJU" />
        <Stat label="Presale Allocation" value="10%" />
        <Stat label="Initial Price" value="$0.15" />
      </div>
    </section>
  );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
      <span className="text-jeju-500">{icon}</span>
      <span className="text-sm">{text}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-white font-semibold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}
