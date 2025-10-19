'use client'

interface ReputationBadgeProps {
  agentId?: number;
  labels?: string[];
  tier?: number;
  className?: string;
}

export function ReputationBadge({ agentId, labels = [], tier = 0, className = '' }: ReputationBadgeProps) {
  if (!agentId && labels.length === 0) return null;
  
  const hasHackerLabel = labels.includes('HACKER');
  const hasScammerLabel = labels.includes('SCAMMER');
  const hasTrustedLabel = labels.includes('TRUSTED');
  
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Tier badge */}
      {tier > 0 && (
        <span className={`px-2 py-1 rounded text-xs font-medium ${getTierColor(tier)}`}>
          {getTierName(tier)}
        </span>
      )}
      
      {/* Labels */}
      {hasHackerLabel && (
        <span className="px-2 py-1 rounded text-xs font-medium bg-red-600 text-white">
          ⚠️ HACKER
        </span>
      )}
      
      {hasScammerLabel && (
        <span className="px-2 py-1 rounded text-xs font-medium bg-orange-600 text-white">
          ⚠️ SCAMMER
        </span>
      )}
      
      {hasTrustedLabel && (
        <span className="px-2 py-1 rounded text-xs font-medium bg-green-600 text-white">
          ✓ TRUSTED
        </span>
      )}
    </div>
  );
}

function getTierColor(tier: number): string {
  const colors = [
    'bg-gray-600 text-gray-200',
    'bg-blue-600 text-white',
    'bg-purple-600 text-white',
    'bg-yellow-600 text-white',
  ];
  return colors[tier] || colors[0];
}

function getTierName(tier: number): string {
  const names = ['None', 'Small', 'Medium', 'High'];
  return names[tier] || 'None';
}

