'use client';

import { TOKENOMICS } from '@/config/tokenomics';

const COLORS = {
  presale: '#22c55e',
  ecosystem: '#3b82f6',
  agentCouncil: '#8b5cf6',
  team: '#f59e0b',
  liquidity: '#06b6d4',
  community: '#ec4899',
};

export function Tokenomics() {
  const allocations = Object.entries(TOKENOMICS.allocation);
  
  // Calculate pie chart segments
  let currentAngle = 0;
  const segments = allocations.map(([key, value]) => {
    const angle = (value.percent / 100) * 360;
    const startAngle = currentAngle;
    currentAngle += angle;
    return {
      key,
      ...value,
      color: COLORS[key as keyof typeof COLORS],
      startAngle,
      endAngle: currentAngle,
    };
  });
  
  return (
    <section className="py-16" id="tokenomics">
      <h2 className="text-3xl font-bold text-center mb-12">Tokenomics</h2>
      
      <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
        {/* Chart */}
        <div className="flex justify-center">
          <div className="relative w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              {segments.map((segment, index) => {
                const startAngle = (segment.startAngle * Math.PI) / 180;
                const endAngle = (segment.endAngle * Math.PI) / 180;
                const largeArc = segment.percent > 50 ? 1 : 0;
                
                const x1 = 50 + 45 * Math.cos(startAngle);
                const y1 = 50 + 45 * Math.sin(startAngle);
                const x2 = 50 + 45 * Math.cos(endAngle);
                const y2 = 50 + 45 * Math.sin(endAngle);
                
                const path = `M 50 50 L ${x1} ${y1} A 45 45 0 ${largeArc} 1 ${x2} ${y2} Z`;
                
                return (
                  <path
                    key={segment.key}
                    d={path}
                    fill={segment.color}
                    className="hover:opacity-80 transition-opacity cursor-pointer"
                  />
                );
              })}
              <circle cx="50" cy="50" r="25" fill="#18181b" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl font-bold text-white">10B</div>
                <div className="text-sm text-zinc-400">Max Supply</div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Legend */}
        <div className="space-y-4">
          {segments.map((segment) => (
            <div key={segment.key} className="flex items-center gap-4 p-4 rounded-lg bg-zinc-900 border border-zinc-800">
              <div 
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: segment.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white capitalize">
                    {segment.key.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                  <span className="text-jeju-400 font-semibold">{segment.percent}%</span>
                </div>
                <p className="text-sm text-zinc-400 truncate">{segment.description}</p>
                <div className="text-xs text-zinc-500 mt-1">
                  {segment.vesting.tgePercent}% at TGE · {segment.vesting.cliff > 0 ? `${segment.vesting.cliff / (24 * 60 * 60)} day cliff` : 'No cliff'} · {segment.vesting.duration > 0 ? `${Math.round(segment.vesting.duration / (365 * 24 * 60 * 60))}yr vesting` : 'Fully unlocked'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
