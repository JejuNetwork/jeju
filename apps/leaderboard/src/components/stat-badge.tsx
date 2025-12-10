import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatBadgeProps {
  labelStart?: string;
  labelEnd?: string;
  value: string | number;
  variant?: "default" | "secondary" | "outline";
  className?: string;
}

export function StatBadge({
  labelStart,
  labelEnd,
  value,
  variant = "outline",
  className,
}: StatBadgeProps) {
  return (
    <Badge variant={variant} className={cn("font-mono text-xs", className)}>
      {labelStart && (
        <span className="text-muted-foreground">{labelStart}</span>
      )}
      <span className="text-primary/80">{value}</span>
      {labelEnd && <span className="text-muted-foreground">{labelEnd}</span>}
    </Badge>
  );
}
