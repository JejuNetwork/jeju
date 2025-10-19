"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatReadableDate } from "@/lib/date-utils";
import { formatNumber } from "@/lib/format-number";
import { ExternalLink, History } from "lucide-react";

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

interface ClaimHistoryTableProps {
  history: ClaimHistoryEntry[];
  isLoading?: boolean;
}

export function ClaimHistoryTable({ history, isLoading = false }: ClaimHistoryTableProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Claim History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Claim History
        </CardTitle>
        <CardDescription>
          Your monthly allocation history
        </CardDescription>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
            <History className="mx-auto mb-2 h-12 w-12 opacity-20" />
            <div className="font-medium">No history yet</div>
            <div className="mt-1 text-sm">
              Your allocation history will appear here after the first snapshot
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left text-sm text-muted-foreground">
                  <th className="pb-3 font-medium">Period</th>
                  <th className="pb-3 font-medium">Date Range</th>
                  <th className="pb-3 font-medium text-right">Rank</th>
                  <th className="pb-3 font-medium text-right">Score</th>
                  <th className="pb-3 font-medium text-right">Share</th>
                  <th className="pb-3 font-medium text-right">Reward</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => {
                  const rewardNum = entry.estimatedReward
                    ? parseFloat(entry.estimatedReward) / 1e18
                    : 0;

                  return (
                    <tr
                      key={entry.snapshotId}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="py-3 font-mono text-sm">{entry.period}</td>
                      <td className="py-3 text-sm text-muted-foreground">
                        {formatReadableDate(entry.periodStart)} - {formatReadableDate(entry.periodEnd)}
                      </td>
                      <td className="py-3 text-right font-medium">
                        #{entry.rank}
                      </td>
                      <td className="py-3 text-right text-muted-foreground">
                        {formatNumber(entry.score)}
                      </td>
                      <td className="py-3 text-right text-muted-foreground">
                        {entry.percentage.toFixed(2)}%
                      </td>
                      <td className="py-3 text-right font-medium">
                        {formatNumber(rewardNum)}
                      </td>
                      <td className="py-3">
                        {entry.finalizedTxHash ? (
                          <a
                            href={`https://explorer.jeju.network/tx/${entry.finalizedTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            Finalized
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : entry.submittedToChain ? (
                          <span className="text-xs text-muted-foreground">
                            Submitted
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


