import { Badge, BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatBadgeProps extends BadgeProps {
  labelStart?: string;
  labelEnd?: string;
  value: string | number;
}

export function StatBadge({
  labelStart,
  labelEnd,
  value,
  variant = "outline",
  className,
  ...props
}: StatBadgeProps) {
  return (
    <Badge variant={variant} className={cn("gap-1", className)} {...props}>
      {labelStart ? (
        <span className="text-primary/80">{labelStart}</span>
      ) : null}
      <span className="text-muted-foreground">{value}</span>
      {labelEnd ? <span className="text-primary/80">{labelEnd}</span> : null}
    </Badge>
  );
}
