import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function SummaryContentSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "prose prose-sm mx-auto mt-8 dark:prose-invert sm:prose lg:prose-lg xl:prose-xl",
        className,
      )}
    >
      {/* Heading */}
      <Skeleton className="mb-6 h-8 w-3/4" />

      {/* Paragraphs */}
      <div className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>

      {/* Subheading */}
      <Skeleton className="my-6 h-6 w-1/2" />

      {/* More paragraphs */}
      <div className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  );
}
