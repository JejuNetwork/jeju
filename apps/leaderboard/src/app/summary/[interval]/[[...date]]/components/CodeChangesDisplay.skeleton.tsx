import { Skeleton } from "@/components/ui/skeleton";

export function CodeChangesDisplaySkeleton() {
  return (
    <div className="rounded-lg border bg-card p-6">
      <Skeleton className="mb-6 h-6 w-36" /> {/* Code Changes title */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* Commits skeleton */}
        <div className="flex flex-col space-y-2">
          <Skeleton className="h-10 w-14" /> {/* Value */}
          <Skeleton className="h-5 w-20" /> {/* Label: Commits */}
        </div>

        {/* Files Changed skeleton */}
        <div className="flex flex-col space-y-2">
          <Skeleton className="h-10 w-14" /> {/* Value */}
          <Skeleton className="h-5 w-32" /> {/* Label: Files Changed */}
        </div>

        {/* Lines Added skeleton */}
        <div className="flex flex-col space-y-2">
          <Skeleton className="h-10 w-20" /> {/* Value */}
          <Skeleton className="h-5 w-24" /> {/* Label: Lines Added */}
        </div>

        {/* Lines Deleted skeleton */}
        <div className="flex flex-col space-y-2">
          <Skeleton className="h-10 w-20" /> {/* Value */}
          <Skeleton className="h-5 w-28" /> {/* Label: Lines Deleted */}
        </div>
      </div>
    </div>
  );
}
