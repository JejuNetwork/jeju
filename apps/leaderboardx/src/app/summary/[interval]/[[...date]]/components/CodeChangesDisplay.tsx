import { SectionCard } from "@/components/section-card";
import { MetricItem } from "@/components/metric-item";
import type { IntervalMetrics } from "@/app/summary/[interval]/[[...date]]/queries";
import { GitCommitVertical, FileCode, ArrowUp, ArrowDown } from "lucide-react";

interface CodeChangesDisplayProps {
  metrics: IntervalMetrics;
}

export function CodeChangesDisplay({ metrics }: CodeChangesDisplayProps) {
  return (
    <SectionCard title="Code Changes">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricItem
          icon={GitCommitVertical}
          value={metrics.codeChanges.commitCount}
          label="Commits"
        />
        <MetricItem
          icon={FileCode}
          value={metrics.codeChanges.files}
          label="Files Changed"
        />
        <MetricItem
          icon={ArrowUp}
          value={`+${metrics.codeChanges.additions.toLocaleString()}`}
          label="Lines Added"
          valueClassName="text-green-500"
          iconClassName="text-green-500"
          iconBgClassName="bg-green-500/10"
        />
        <MetricItem
          icon={ArrowDown}
          value={`-${metrics.codeChanges.deletions.toLocaleString()}`}
          label="Lines Deleted"
          valueClassName="text-red-500"
          iconClassName="text-red-500"
          iconBgClassName="bg-red-500/10"
        />
      </div>
    </SectionCard>
  );
}
