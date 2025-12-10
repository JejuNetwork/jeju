'use client';

import { useState, useEffect } from 'react';
import { formatEther, parseEther } from 'viem';
import { Wallet, Clock, Users, TrendingUp } from 'lucide-react';
import { TOKENOMICS } from '@/config/tokenomics';

type PresalePhase = 'NOT_STARTED' | 'WHITELIST' | 'PUBLIC' | 'ENDED' | 'FAILED' | 'DISTRIBUTED';

interface PresaleStats {
  raised: bigint;
  participants: number;
  tokensSold: bigint;
  softCap: bigint;
  hardCap: bigint;
  phase: PresalePhase;
}

export function PresaleCard() {
  const [amount, setAmount] = useState('');
  const [stats, setStats] = useState<PresaleStats>({
    raised: 0n,
    participants: 0,
    tokensSold: 0n,
    softCap: TOKENOMICS.presale.softCap,
    hardCap: TOKENOMICS.presale.hardCap,
    phase: 'PUBLIC',
  });
  
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0, secs: 0 });
  
  useEffect(() => {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14); // 14 days from now
    
    const timer = setInterval(() => {
      const now = new Date().getTime();
      const distance = endDate.getTime() - now;
      
      if (distance < 0) {
        clearInterval(timer);
        return;
      }
      
      setCountdown({
        days: Math.floor(distance / (1000 * 60 * 60 * 24)),
        hours: Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        mins: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
        secs: Math.floor((distance % (1000 * 60)) / 1000),
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, []);
  
  const tokenPrice = TOKENOMICS.presale.tokenPrice;
  const tokensReceived = amount ? (parseEther(amount) * 10n ** 18n) / tokenPrice : 0n;
  const bonus = stats.phase === 'WHITELIST' ? 10 : amount && parseFloat(amount) >= 10 ? 5 : amount && parseFloat(amount) >= 5 ? 3 : amount && parseFloat(amount) >= 1 ? 1 : 0;
  const bonusTokens = (tokensReceived * BigInt(bonus)) / 100n;
  
  const progress = Number((stats.raised * 100n) / stats.hardCap);
  
  const handleContribute = async () => {
    alert('Connect wallet to participate (testnet demo)');
  };
  
  return (
    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Participate</h2>
        <span className={`text-xs px-2 py-1 rounded-full ${
          stats.phase === 'PUBLIC' ? 'bg-jeju-500/20 text-jeju-400' :
          stats.phase === 'WHITELIST' ? 'bg-blue-500/20 text-blue-400' :
          'bg-zinc-700 text-zinc-400'
        }`}>
          {stats.phase === 'PUBLIC' ? 'Public Sale' : 
           stats.phase === 'WHITELIST' ? 'Whitelist Only' : 
           stats.phase}
        </span>
      </div>
      
      {/* Countdown */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        <CountdownUnit value={countdown.days} label="Days" />
        <CountdownUnit value={countdown.hours} label="Hours" />
        <CountdownUnit value={countdown.mins} label="Mins" />
        <CountdownUnit value={countdown.secs} label="Secs" />
      </div>
      
      {/* Progress */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-zinc-400">Progress</span>
          <span className="text-white">{progress.toFixed(1)}%</span>
        </div>
        <div className="h-3 rounded-full bg-zinc-800 overflow-hidden">
          <div 
            className="h-full rounded-full bg-gradient-to-r from-jeju-500 to-jeju-400 transition-all duration-500"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-zinc-500 mt-1">
          <span>{formatEther(stats.raised)} ETH raised</span>
          <span>{formatEther(stats.hardCap)} ETH goal</span>
        </div>
      </div>
      
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard icon={<Users className="w-4 h-4" />} value={stats.participants.toString()} label="Participants" />
        <StatCard icon={<TrendingUp className="w-4 h-4" />} value={`$0.15`} label="Price" />
        <StatCard icon={<Clock className="w-4 h-4" />} value="20%" label="TGE Unlock" />
      </div>
      
      {/* Input */}
      <div className="space-y-4">
        <div>
          <label className="text-sm text-zinc-400 mb-2 block">Contribution Amount (ETH)</label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-lg focus:outline-none focus:border-jeju-500 transition-colors"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2">
              <button 
                onClick={() => setAmount('0.1')}
                className="text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 transition-colors"
              >
                0.1
              </button>
              <button 
                onClick={() => setAmount('1')}
                className="text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 transition-colors"
              >
                1
              </button>
              <button 
                onClick={() => setAmount('5')}
                className="text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 transition-colors"
              >
                5
              </button>
            </div>
          </div>
        </div>
        
        {amount && (
          <div className="bg-zinc-800/50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">You receive</span>
              <span className="text-white">{Number(tokensReceived / 10n ** 18n).toLocaleString()} JEJU</span>
            </div>
            {bonus > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Bonus ({bonus}%)</span>
                <span className="text-jeju-400">+{Number(bonusTokens / 10n ** 18n).toLocaleString()} JEJU</span>
              </div>
            )}
            <div className="flex justify-between text-sm pt-2 border-t border-zinc-700">
              <span className="text-zinc-400">Total</span>
              <span className="text-white font-semibold">
                {Number((tokensReceived + bonusTokens) / 10n ** 18n).toLocaleString()} JEJU
              </span>
            </div>
          </div>
        )}
        
        <button
          onClick={handleContribute}
          className="w-full py-4 rounded-lg bg-gradient-to-r from-jeju-500 to-jeju-600 text-white font-semibold hover:from-jeju-400 hover:to-jeju-500 transition-all flex items-center justify-center gap-2"
        >
          <Wallet className="w-5 h-5" />
          Connect Wallet
        </button>
        
        <p className="text-xs text-zinc-500 text-center">
          Min: {formatEther(TOKENOMICS.presale.minContribution)} ETH · Max: {formatEther(TOKENOMICS.presale.maxContribution)} ETH
        </p>
      </div>
    </div>
  );
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-zinc-800 rounded-lg p-3 text-center">
      <div className="text-2xl font-bold text-white">{value.toString().padStart(2, '0')}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
      <div className="text-jeju-500 mb-1 flex justify-center">{icon}</div>
      <div className="text-lg font-semibold text-white">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}
