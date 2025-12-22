import { useState } from 'react';
import { ChevronDown, Check, Wifi, Zap } from 'lucide-react';
import type { VPNNode } from '../api/schemas';
import { VPNNodeSchema } from '../api/schemas';
import { z } from 'zod';
import { findBestClientNode } from '../shared/utils';

interface RegionSelectorProps {
  nodes: VPNNode[];
  selectedNode: VPNNode | null;
  onSelectNode: (node: VPNNode) => void;
  disabled?: boolean;
}

const COUNTRY_FLAGS: Record<string, string> = {
  US: '🇺🇸',
  NL: '🇳🇱',
  DE: '🇩🇪',
  JP: '🇯🇵',
  GB: '🇬🇧',
  CA: '🇨🇦',
  AU: '🇦🇺',
  SG: '🇸🇬',
  FR: '🇫🇷',
  CH: '🇨🇭',
  SE: '🇸🇪',
  KR: '🇰🇷',
  BR: '🇧🇷',
};

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  NL: 'Netherlands',
  DE: 'Germany',
  JP: 'Japan',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  SG: 'Singapore',
  FR: 'France',
  CH: 'Switzerland',
  SE: 'Sweden',
  KR: 'South Korea',
  BR: 'Brazil',
};

export function RegionSelector({ nodes, selectedNode, onSelectNode, disabled }: RegionSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Validate nodes array
  const validatedNodes = z.array(VPNNodeSchema).parse(nodes);
  
  // Validate selectedNode if present
  const validatedSelectedNode = selectedNode ? VPNNodeSchema.parse(selectedNode) : null;

  // Group nodes by country
  const nodesByCountry = validatedNodes.reduce((acc: Record<string, VPNNode[]>, node: VPNNode) => {
    if (!acc[node.country_code]) {
      acc[node.country_code] = [];
    }
    acc[node.country_code].push(node);
    return acc;
  }, {} as Record<string, VPNNode[]>);

  const getLatencyColor = (latency: number) => {
    if (latency < 50) return 'text-[#00ff88]';
    if (latency < 100) return 'text-yellow-500';
    return 'text-orange-500';
  };

  const getLoadColor = (load: number) => {
    if (load < 40) return 'bg-[#00ff88]';
    if (load < 70) return 'bg-yellow-500';
    return 'bg-orange-500';
  };

  return (
    <div className="relative">
      {/* Selected Region Button */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full card-hover flex items-center justify-between ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">
            {validatedSelectedNode ? COUNTRY_FLAGS[validatedSelectedNode.country_code] || '🌍' : '🌍'}
          </span>
          <div className="text-left">
            <div className="font-medium">
              {validatedSelectedNode 
                ? COUNTRY_NAMES[validatedSelectedNode.country_code] || validatedSelectedNode.country_code
                : 'Select Region'}
            </div>
            {validatedSelectedNode && (
              <div className="flex items-center gap-2 text-xs text-[#606070]">
                <span className={getLatencyColor(validatedSelectedNode.latency_ms)}>
                  {validatedSelectedNode.latency_ms}ms
                </span>
                <span>•</span>
                <span>{validatedSelectedNode.region}</span>
              </div>
            )}
          </div>
        </div>
        <ChevronDown className={`w-5 h-5 text-[#606070] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#12121a] border border-[#2a2a35] rounded-2xl overflow-hidden z-50 max-h-80 overflow-y-auto">
          {/* Auto Select Option */}
          <button
            onClick={() => {
              const best = findBestClientNode(validatedNodes);
              onSelectNode(best);
              setIsOpen(false);
            }}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1a1a25] transition-colors border-b border-[#2a2a35]"
          >
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-[#00ff88]" />
              <span className="font-medium">Fastest Server</span>
            </div>
          </button>

          {/* Countries */}
          {Object.entries(nodesByCountry).map(([countryCode, countryNodes]: [string, VPNNode[]]) => {
            if (countryNodes.length === 0) {
              return null;
            }
            const bestNode = findBestClientNode(countryNodes);
            const isSelected = validatedSelectedNode?.country_code === countryCode;

            return (
              <button
                key={countryCode}
                onClick={() => {
                  onSelectNode(bestNode);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-4 py-3 hover:bg-[#1a1a25] transition-colors ${
                  isSelected ? 'bg-[#1a1a25]' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{COUNTRY_FLAGS[countryCode] || '🌍'}</span>
                  <div className="text-left">
                    <div className="font-medium">{COUNTRY_NAMES[countryCode] || countryCode}</div>
                    <div className="text-xs text-[#606070]">
                      {countryNodes.length} server{countryNodes.length > 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <Wifi className={`w-4 h-4 ${getLatencyColor(bestNode.latency_ms)}`} />
                    <span className={`text-sm ${getLatencyColor(bestNode.latency_ms)}`}>
                      {bestNode.latency_ms}ms
                    </span>
                  </div>
                  <div className="w-12 h-1.5 bg-[#2a2a35] rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${getLoadColor(bestNode.load)} rounded-full`}
                      style={{ width: `${bestNode.load}%` }}
                    />
                  </div>
                  {isSelected && (
                    <Check className="w-5 h-5 text-[#00ff88]" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Overlay to close dropdown */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}

