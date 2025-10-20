import { Skeleton } from "@/components/ui/skeleton";

export function StatCardsDisplaySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {/* Contributors card skeleton */}
      <div className="rounded-lg border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-5 w-28" /> {/* Title: Contributors */}
          <Skeleton className="h-5 w-5 rounded-full" /> {/* Icon */}
        </div>
        <div className="space-y-4">
          <Skeleton className="h-12 w-16" /> {/* Large number */}
          <div className="flex items-center space-x-1">
            <Skeleton className="h-8 w-8 rounded-full" /> {/* Avatar */}
            <Skeleton className="h-8 w-8 rounded-full" /> {/* Avatar */}
            <Skeleton className="h-8 w-8 rounded-full" /> {/* Avatar */}
            <Skeleton className="h-8 w-12 rounded-full" /> {/* +X more */}
          </div>
        </div>
      </div>

      {/* Pull Requests card skeleton */}
      <div className="rounded-lg border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-5 w-28" /> {/* Title: Pull Requests */}
          <Skeleton className="h-5 w-5 rounded-full" /> {/* Icon */}
        </div>
        <div className="space-y-2">
          <Skeleton className="h-12 w-16" /> {/* Large number */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-14" /> {/* Label: New */}
              <Skeleton className="h-5 w-8" /> {/* Value */}
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-20" /> {/* Label: Merged */}
              <Skeleton className="h-5 w-8" /> {/* Value */}
            </div>
          </div>
        </div>
      </div>

      {/* Issues card skeleton */}
      <div className="rounded-lg border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-5 w-16" /> {/* Title: Issues */}
          <Skeleton className="h-5 w-5 rounded-full" /> {/* Icon */}
        </div>
        <div className="space-y-2">
          <Skeleton className="h-12 w-16" /> {/* Large number */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-14" /> {/* Label: New */}
              <Skeleton className="h-5 w-8" /> {/* Value */}
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-20" /> {/* Label: Closed */}
              <Skeleton className="h-5 w-8" /> {/* Value */}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
