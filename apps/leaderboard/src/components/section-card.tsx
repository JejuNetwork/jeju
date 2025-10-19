import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
  noPadding?: boolean;
}

export function SectionCard({
  title,
  icon: Icon,
  children,
  className,
  contentClassName,
  headerClassName = "py-4",
  noPadding = false,
}: SectionCardProps) {
  return (
    <Card className={className}>
      <CardHeader className={headerClassName}>
        <CardTitle className="text-sm font-medium">
          {Icon && (
            <span className="flex items-center gap-2">
              <Icon className="h-4 w-4" /> {title}
            </span>
          )}
          {!Icon && title}
        </CardTitle>
      </CardHeader>
      <CardContent
        className={cn(noPadding ? "px-0 py-0" : "", contentClassName)}
      >
        {children}
      </CardContent>
    </Card>
  );
}
