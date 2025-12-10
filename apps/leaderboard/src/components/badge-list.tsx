import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface BadgeItem {
  id: string | number;
  label: string;
  className?: string;
}

interface BadgeListProps {
  items: BadgeItem[];
  className?: string;
  badgeClassName?: string;
}

export function BadgeList({
  items,
  className,
  badgeClassName = "border-0 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-500",
}: BadgeListProps) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {items.map((item) => (
        <Badge key={item.id} className={cn(badgeClassName, item.className)}>
          {item.label}
        </Badge>
      ))}
    </div>
  );
}
