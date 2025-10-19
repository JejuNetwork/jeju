"use client";

import { useEffect, useState } from "react";
import { ClaimableRewardsCard } from "@/components/rewards/ClaimableRewardsCard";
import { ClaimHistoryTable } from "@/components/rewards/ClaimHistoryTable";
import { NextDistributionCountdown } from "@/components/rewards/NextDistributionCountdown";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Wallet } from "lucide-react";
import { toast } from "sonner";

// Mock wallet connection (replace with wagmi)
function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = async () => {
    setIsConnecting(true);
    // TODO: Implement wagmi wallet connection
    setTimeout(() => {
      setAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0");
      setIsConnecting(false);
    }, 1000);
  };

  const disconnect = () => {
    setAddress(null);
  };

  return { address, connect, disconnect, isConnecting };
}

export default function RewardsPage() {
  const { address, connect, disconnect, isConnecting } = useWallet();
  const [claimData, setClaimData] = useState<{
    totalClaimable: string;
    periods: {
      period: number;
      reward: string;
      claimed: boolean;
      finalized: boolean;
    }[];
  } | null>(null);
  const [history, setHistory] = useState<ClaimHistoryEntry[]>([]);
  const [isLoadingClaims, setIsLoadingClaims] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  // Fetch claims when wallet connects
  useEffect(() => {
    if (address) {
      fetchClaims();
      fetchHistory();
    }
  }, [address]);

  async function fetchClaims() {
    if (!address) return;

    setIsLoadingClaims(true);
    const response = await fetch(`/api/claims/${address}`);
    const data = await response.json();
    setClaimData(data);
    setIsLoadingClaims(false);
  }

  async function fetchHistory() {
    if (!address) return;

    setIsLoadingHistory(true);
    const response = await fetch(`/api/claims/history/${address}`);
    const data = await response.json();
    setHistory(data.history || []);
    setIsLoadingHistory(false);
  }

  async function handleClaim(period: number) {
    setIsClaiming(true);
    toast.loading("Claiming rewards...");

    // TODO: Implement actual claim transaction
    setTimeout(() => {
      setIsClaiming(false);
      toast.success(`Successfully claimed rewards for period ${period}!`);
      fetchClaims(); // Refresh
    }, 2000);
  }

  async function handleClaimAll(periods: number[]) {
    setIsClaiming(true);
    toast.loading(`Claiming ${periods.length} periods...`);

    // TODO: Implement batch claim transaction
    setTimeout(() => {
      setIsClaiming(false);
      toast.success(`Successfully claimed rewards from ${periods.length} periods!`);
      fetchClaims(); // Refresh
    }, 2000);
  }

  return (
    <main className="container mx-auto max-w-6xl space-y-6 p-4">
      <div>
        <h1 className="text-3xl font-bold">Contributor Rewards</h1>
        <p className="mt-1 text-muted-foreground">
          Claim your share of protocol fees earned from GitHub contributions
        </p>
      </div>

      {/* Wallet Connection */}
      {!address ? (
        <Alert>
          <Wallet className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>Connect your wallet to view and claim rewards</span>
            <Button
              onClick={connect}
              disabled={isConnecting}
              size="sm"
            >
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Connected Status */}
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 p-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="font-mono text-sm">{address}</span>
            </div>
            <Button variant="outline" size="sm" onClick={disconnect}>
              Disconnect
            </Button>
          </div>

          {/* Main Content */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left Column */}
            <div className="space-y-6 lg:col-span-2">
              <ClaimableRewardsCard
                address={address}
                totalClaimable={claimData?.totalClaimable || "0"}
                periods={claimData?.periods || []}
                onClaim={handleClaim}
                onClaimAll={handleClaimAll}
                isLoading={isLoadingClaims}
                isClaiming={isClaiming}
              />

              <ClaimHistoryTable
                history={history}
                isLoading={isLoadingHistory}
              />
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              <NextDistributionCountdown />

              {/* Info Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">How It Works</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div>
                    <div className="font-medium text-foreground">10% of Protocol Fees</div>
                    <div>Every transaction on Jeju allocates 10% to contributors</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">Monthly Distribution</div>
                    <div>Fees accumulate monthly, distributed by contribution score</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">Weighted Scoring</div>
                    <div>50% all-time + 30% 6-month + 20% 1-month scores</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">Claim Anytime</div>
                    <div>After finalization, claim your share from any period</div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

interface ClaimHistoryEntry {
  period: number;
  snapshotId: string;
  username: string;
  score: number;
  shares: string;
  percentage: number;
  rank: number;
  estimatedReward: string | null;
  periodStart: string;
  periodEnd: string;
  submittedToChain: boolean;
  txHash: string | null;
  finalizedTxHash: string | null;
}

