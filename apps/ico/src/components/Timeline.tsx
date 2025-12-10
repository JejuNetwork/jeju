'use client';

import { CheckCircle2, Circle, Clock } from 'lucide-react';

const TIMELINE = [
  {
    title: 'Whitelist Registration',
    date: 'Week 1',
    status: 'completed' as const,
    description: 'Register for whitelist',
  },
  {
    title: 'Whitelist Sale',
    date: 'Week 2',
    status: 'active' as const,
    description: '10% bonus',
  },
  {
    title: 'Public Sale',
    date: 'Week 3-4',
    status: 'upcoming' as const,
    description: 'Open with volume bonuses',
  },
  {
    title: 'TGE',
    date: 'Week 5',
    status: 'upcoming' as const,
    description: '20% unlock, vesting starts',
  },
  {
    title: 'DEX Listing',
    date: 'Week 5',
    status: 'upcoming' as const,
    description: 'JEJU/ETH trading begins',
  },
];

export function Timeline() {
  return (
    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-6">
      <h2 className="text-xl font-semibold mb-6">Timeline</h2>
      
      <div className="space-y-4">
        {TIMELINE.map((item, index) => (
          <div key={index} className="flex gap-4">
            <div className="flex flex-col items-center">
              {item.status === 'completed' ? (
                <CheckCircle2 className="w-6 h-6 text-jeju-500" />
              ) : item.status === 'active' ? (
                <Clock className="w-6 h-6 text-blue-500 animate-pulse" />
              ) : (
                <Circle className="w-6 h-6 text-zinc-600" />
              )}
              {index < TIMELINE.length - 1 && (
                <div className={`w-0.5 h-full mt-2 ${
                  item.status === 'completed' ? 'bg-jeju-500' : 'bg-zinc-700'
                }`} />
              )}
            </div>
            <div className="pb-6">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-white">{item.title}</span>
                <span className="text-xs text-zinc-500">{item.date}</span>
              </div>
              <p className="text-sm text-zinc-400">{item.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
