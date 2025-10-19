import React from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricItemProps {
  icon: LucideIcon;
  value: string | number;
  label: string;
  valueClassName?: string;
  iconClassName?: string;
  iconBgClassName?: string;
}

export function MetricItem({
  icon: Icon,
  value,
  label,
  valueClassName,
  iconClassName,
  iconBgClassName = "bg-primary/10",
}: MetricItemProps) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full",
          iconBgClassName,
        )}
      >
        <Icon className={cn("h-5 w-5", iconClassName)} />
      </div>
      <div>
        <div className={cn("text-xl font-bold", valueClassName)}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
