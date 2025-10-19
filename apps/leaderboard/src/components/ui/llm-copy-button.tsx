"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Copy, Check, ChevronDown } from "lucide-react";
import { formatDataForLLM } from "@/lib/llm-formatter";
import type { IntervalMetrics } from "@/app/summary/[interval]/[[...date]]/queries";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface LlmCopyButtonProps {
  metrics: IntervalMetrics;
  summaryContent: string | null;
  className?: string;
}

export function LlmCopyButton({
  metrics,
  summaryContent,
  className,
}: LlmCopyButtonProps) {
  const [includeStats, setIncludeStats] = useState(true);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includePrData, setIncludePrData] = useState(true);
  const [includeIssueData, setIncludeIssueData] = useState(true);
  const [
    includeDetailedContributorSummaries,
    setIncludeDetailedContributorSummaries,
  ] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const formattedData = formatDataForLLM(metrics, summaryContent, {
        includeStats,
        includeSummary,
        includePrData,
        includeIssueData,
        includeDetailedContributorSummaries,
      });

      await navigator.clipboard.writeText(formattedData);

      setCopied(true);
      toast.success("Copied to clipboard", {
        description:
          "The formatted data has been copied and is ready to paste into an LLM.",
      });

      // Reset the copied state after 2 seconds
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
      toast.error("Copy failed", {
        description: "There was an error copying the data to your clipboard.",
      });
    }
  };

  return (
    <div className={cn("flex", className)}>
      <Button
        variant="outline"
        className="flex items-center gap-2 rounded-r-none border-r-0"
        onClick={handleCopy}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        Copy
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="rounded-l-none px-2">
            <ChevronDown className="h-4 w-4" />
            <span className="sr-only">Options</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-2">
          <div className="grid gap-4 p-2">
            <div className="flex items-center space-x-4">
              <Checkbox
                id="includeStats"
                checked={includeStats}
                onCheckedChange={(checked) => setIncludeStats(Boolean(checked))}
              />
              <Label htmlFor="includeStats">Include Stats</Label>
            </div>
            <div className="flex items-center space-x-4">
              <Checkbox
                id="includeSummary"
                checked={includeSummary}
                onCheckedChange={(checked) =>
                  setIncludeSummary(Boolean(checked))
                }
              />
              <Label htmlFor="includeSummary">Include Summary</Label>
            </div>
            <div className="flex items-center space-x-4">
              <Checkbox
                id="includePrData"
                checked={includePrData}
                onCheckedChange={(checked) =>
                  setIncludePrData(Boolean(checked))
                }
              />
              <Label htmlFor="includePrData">Include PR Data</Label>
            </div>
            <div className="flex items-center space-x-4">
              <Checkbox
                id="includeIssueData"
                checked={includeIssueData}
                onCheckedChange={(checked) =>
                  setIncludeIssueData(Boolean(checked))
                }
              />
              <Label htmlFor="includeIssueData">Include Issue Data</Label>
            </div>
            <div className="flex items-center space-x-4">
              <Checkbox
                id="includeDetailedContributorSummaries"
                checked={includeDetailedContributorSummaries}
                onCheckedChange={(checked) =>
                  setIncludeDetailedContributorSummaries(Boolean(checked))
                }
              />
              <Label htmlFor="includeDetailedContributorSummaries">
                Include Contributor Summaries
              </Label>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
