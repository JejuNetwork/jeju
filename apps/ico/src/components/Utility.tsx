'use client';

import { Vote, Shield, Server, Users } from 'lucide-react';

const UTILITIES = [
  {
    icon: <Vote className="w-5 h-5" />,
    title: 'Governance',
    description: 'Vote on protocol upgrades',
  },
  {
    icon: <Shield className="w-5 h-5" />,
    title: 'Moderation',
    description: 'Stake in moderation marketplace',
  },
  {
    icon: <Server className="w-5 h-5" />,
    title: 'Services',
    description: 'Pay for compute and storage',
  },
  {
    icon: <Users className="w-5 h-5" />,
    title: 'Council',
    description: 'Revenue funds operations',
  },
];

export function Utility() {
  return (
    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-6">
      <h2 className="text-xl font-semibold mb-6">Token Utility</h2>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {UTILITIES.map((item, index) => (
          <div key={index} className="bg-zinc-800/50 rounded-lg p-4">
            <div className="text-jeju-500 mb-2">{item.icon}</div>
            <div className="font-medium text-white text-sm mb-1">{item.title}</div>
            <p className="text-xs text-zinc-400">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
