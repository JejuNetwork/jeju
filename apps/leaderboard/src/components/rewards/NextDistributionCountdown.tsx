"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";

export function NextDistributionCountdown() {
  const [timeRemaining, setTimeRemaining] = useState<string>("");

  useEffect(() => {
    function calculateTimeRemaining() {
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const diff = nextMonth.getTime() - now.getTime();

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      setTimeRemaining(`${days}d ${hours}h ${minutes}m`);
    }

    calculateTimeRemaining();
    const interval = setInterval(calculateTimeRemaining, 60000); // Update every minute

    return () => clearInterval(interval);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" />
          Next Distribution
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="text-2xl font-bold">{timeRemaining}</div>
          <div className="text-sm text-muted-foreground">
            Until next monthly snapshot
          </div>
          <div className="mt-4 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <div className="font-medium">Distribution Timeline:</div>
            <ol className="mt-2 space-y-1 list-decimal list-inside">
              <li>Month ends → Snapshot generated</li>
              <li>Oracle submits to blockchain</li>
              <li>48h dispute period</li>
              <li>Snapshot finalized</li>
              <li>You can claim rewards!</li>
            </ol>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}


