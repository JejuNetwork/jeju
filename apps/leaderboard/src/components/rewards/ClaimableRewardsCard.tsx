"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format-number";
import { Coins, ExternalLink } from "lucide-react";

interface RewardPeriod {
  period: number;
  reward: string;
  claimed: boolean;
  finalized: boolean;
}

interface ClaimableRewardsCardProps {
  address: string;
  totalClaimable: string;
  periods: RewardPeriod[];
  onClaim: (period: number) => Promise<void>;
  onClaimAll: (periods: number[]) => Promise<void>;
  isLoading?: boolean;
  isClaiming?: boolean;
}

export function ClaimableRewardsCard({
  address,
  totalClaimable,
  periods,
  onClaim,
  onClaimAll,
  isLoading = false,
  isClaiming = false,
}: ClaimableRewardsCardProps) {
  const unclaimedPeriods = periods.filter((p) => !p.claimed && p.finalized);
  const totalClaimableNum = parseFloat(totalClaimable) / 1e18;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-5 w-5" />
          Claimable Rewards
        </CardTitle>
        <CardDescription>
          Protocol fee share earned from GitHub contributions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Total Claimable */}
        <div className="rounded-lg border border-border bg-muted/50 p-6">
          <div className="text-sm text-muted-foreground">Total Claimable</div>
          <div className="mt-1 text-3xl font-bold">
            {formatNumber(totalClaimableNum)} <span className="text-lg font-normal text-muted-foreground">elizaOS</span>
          </div>
          {unclaimedPeriods.length > 0 && (
            <div className="mt-2 text-sm text-muted-foreground">
              Across {unclaimedPeriods.length} period{unclaimedPeriods.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* Claim All Button */}
        {unclaimedPeriods.length > 0 && (
          <Button
            onClick={() => onClaimAll(unclaimedPeriods.map((p) => p.period))}
            disabled={isClaiming || totalClaimableNum === 0}
            className="w-full"
            size="lg"
          >
            {isClaiming ? "Claiming..." : `Claim All (${unclaimedPeriods.length} periods)`}
          </Button>
        )}

        {/* Period Breakdown */}
        {periods.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Period Breakdown</div>
            <div className="space-y-2">
              {periods.map((period) => {
                const rewardNum = parseFloat(period.reward) / 1e18;
                return (
                  <div
                    key={period.period}
                    className="flex items-center justify-between rounded-md border border-border p-3"
                  >
                    <div>
                      <div className="font-medium">Period {period.period}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatNumber(rewardNum)} elizaOS
                      </div>
                    </div>
                    <div>
                      {period.claimed ? (
                        <span className="text-sm text-muted-foreground">✓ Claimed</span>
                      ) : period.finalized ? (
                        <Button
                          size="sm"
                          onClick={() => onClaim(period.period)}
                          disabled={isClaiming}
                        >
                          Claim
                        </Button>
                      ) : (
                        <span className="text-sm text-muted-foreground">Pending</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* No Rewards */}
        {periods.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
            <Coins className="mx-auto mb-2 h-12 w-12 opacity-20" />
            <div className="font-medium">No rewards yet</div>
            <div className="mt-1 text-sm">
              Contribute to JejuNetwork/Jeju to earn monthly rewards
            </div>
          </div>
        )}

        {/* Explorer Link */}
        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
          <a
            href={`https://explorer.jeju.network/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-primary"
          >
            View on Explorer
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

export function ClaimableRewardsCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-32 w-full" />
      </CardContent>
    </Card>
  );
}


