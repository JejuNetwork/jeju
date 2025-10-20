# Frontend Development Standards for Next.js App Router

This document outlines the standards for developing within the Next.js App Router, focusing on data fetching, state management, and page-specific component architecture.

## Component Organization

- **Page-Specific Components:**

  - Place in `src/app/<page>` directory related to the feature.
  - These components should contain business logic.
  - Example locations:

    ```typescript
    // ✅ DO: Place page-specific components in the related page directory
    src / app / profile / [username] / user - stats.tsx;
    src / app / leaderboard / leaderboard - filters.tsx;

    // ❌ DON'T: Mix business logic components with pure UI components
    src / components / profile - stats.tsx; // Should be in src/app/profile/
    ```

- **Shared UI Components:**

  - Place in `src/components` directory.
  - These should be pure UI/layout components without business logic.
  - Example locations:

    ```typescript
    // ✅ DO: Place reusable UI components in src/components
    src / components / stat - card.tsx;
    src / components / activity - item.tsx;

    // ❌ DON'T: Place page-specific components here
    src / components / leaderboard - page - filters.tsx; // Should be in src/app/leaderboard/
    ```

## Component Structure

- **File Naming Conventions:**

  - Use `kebab-case` for all new component filenames.
  - ✅ **DO**: `user-profile-card.tsx`
  - ❌ **DON'T**: `UserProfileCard.tsx`

- **Type-Only Imports:**
  - To prevent bundling unnecessary modules in the client, always use type-only imports when importing types.
  - ✅ **DO**: `import type { User } from '@/lib/types';`
  - ❌ **DON'T**: `import { User } from '@/lib/types';`

## Data Fetching and State Management

- **Data Fetching:**

  - Use React Server Components where possible.
  - Place data fetching logic in dedicated files (e.g., `queries.ts`).
  - Example:

    ```typescript
    // ✅ DO: Separate data fetching logic in queries.ts
    // src/app/profile/[username]/queries.ts
    export async function getUserProfile(username: string) {
      // Implementation
    }

    // src/app/profile/[username]/page.tsx
    import { getUserProfile } from "./queries";

    export default async function ProfilePage({
      params,
    }: {
      params: { username: string };
    }) {
      const userData = await getUserProfile(params.username);
      // Render component with data
    }
    ```

- **State Management:**

  - **Prefer URL Query Parameters Over useState:**

    - Store UI state in URL when possible using Next.js router and searchParams.
    - This makes state shareable, bookmarkable, and persists through refreshes.
    - Example:

    ```typescript
    // ✅ DO: Use URL query params for UI state
    // src/app/leaderboard/page.tsx
    export default function LeaderboardPage({
      searchParams
    }: {
      searchParams: { period?: string; category?: string }
    }) {
      const period = searchParams.period || 'week';
      const category = searchParams.category || 'all';

      return (
        <div>
          <LeaderboardFilters
            period={period}
            category={category}
          />
          <LeaderboardResults
            period={period}
            category={category}
          />
        </div>
      );
    }

    // src/app/leaderboard/filters.tsx
    import { useRouter, usePathname } from 'next/navigation';

    export function LeaderboardFilters({ period, category }: FilterProps) {
      const router = useRouter();
      const pathname = usePathname();

      const updateFilter = (key: string, value: string) => {
        const params = new URLSearchParams();
        params.set(key, value);
        if (key !== 'period') params.set('period', period);
        if (key !== 'category') params.set('category', category);
        router.push(`${pathname}?${params.toString()}`);
      };

      return (
        // Filter UI with onClick handlers that call updateFilter
      );
    }
    ```

  - **When to Use React useState:**

    - For ephemeral UI state that doesn't need to persist (tooltips, dropdowns).
    - For form input values before submission.
    - When leveraging external libraries that require local state.
    - When working with client components that can't use URL state.

  - **Extract complex state logic into custom hooks:**
  - Example:

    ```typescript
    // ✅ DO: Create custom hooks for complex state logic
    // src/app/leaderboard/use-leaderboard-filters.ts
    export function useLeaderboardFilters() {
      const router = useRouter();
      const pathname = usePathname();
      const searchParams = useSearchParams();

      const filters = {
        period: searchParams.get("period") || "week",
        category: searchParams.get("category") || "all",
      };

      const setFilter = useCallback(
        (key: string, value: string) => {
          const params = new URLSearchParams(searchParams);
          params.set(key, value);
          router.push(`${pathname}?${params.toString()}`);
        },
        [searchParams, router, pathname],
      );

      return { filters, setFilter };
    }
    ```

## Performance Optimization

- **Component Memoization:**

  - Memoize expensive components with `React.memo`.
  - Use `useMemo`/`useCallback` for expensive calculations or callbacks, especially in client components to prevent re-renders.
  - Example:

    ```tsx
    // ✅ DO: Memoize expensive components
    const MemoizedDataTable = React.memo(DataTable);

    // ✅ DO: Use useMemo for expensive calculations
    const sortedData = useMemo(() => {
      return [...data].sort((a, b) => b.score - a.score);
    }, [data]);
    ```

## Error Handling and Loading States

- **React Suspense for Loading States:**

  - Use React Suspense for handling loading states with Server Components.
  - Implement suspense boundaries at the appropriate level of your component tree.
  - Create well-designed skeleton components that match the structure of the content they replace.
  - Example:

    ```tsx
    // ✅ DO: Use Suspense for loading states
    // src/app/profile/[username]/page.tsx
    import { Suspense } from "react";
    import { UserStats, UserStatsLoading } from "./user-stats";
    import { UserActivity, UserActivityLoading } from "./user-activity";

    export default function ProfilePage({
      params,
    }: {
      params: { username: string };
    }) {
      return (
        <div className="space-y-6">
          <Suspense fallback={<UserStatsLoading />}>
            <UserStats username={params.username} />
          </Suspense>

          <Suspense fallback={<UserActivityLoading />}>
            <UserActivity username={params.username} />
          </Suspense>
        </div>
      );
    }
    ```

- **Asynchronous Components:**

  - Leverage `async/await` in Server Components for data fetching.
  - Loading state is managed automatically by Suspense.
  - Example:

    ```tsx
    // ✅ DO: Use async/await with Suspense
    // src/app/profile/[username]/user-stats.tsx
    import { getStats } from "./queries";

    export async function UserStats({ username }: { username: string }) {
      // This will automatically trigger Suspense while resolving
      const stats = await getStats(username);

      return (
        <div className="grid grid-cols-3 gap-4">
          {stats.map((stat) => (
            <StatCard
              key={stat.id}
              title={stat.name}
              value={stat.value}
              icon={stat.icon}
            />
          ))}
        </div>
      );
    }
    ```

- **Error Boundaries:**

  - Implement error boundaries for critical components.
  - Use the `error.tsx` file in Next.js App Router for route-level error handling.
  - Example:

    ```tsx
    // src/app/profile/[username]/error.tsx
    "use client";

    import { Button } from "@/components/ui/button";

    export default function ProfileError({
      error,
      reset,
    }: {
      error: Error & { digest?: string };
      reset: () => void;
    }) {
      return (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-destructive">
          <h2 className="text-lg font-medium">
            Something went wrong loading this profile
          </h2>
          <p className="mt-2 text-sm">{error.message}</p>
          <Button variant="outline" className="mt-4" onClick={reset}>
            Try again
          </Button>
        </div>
      );
    }
    ```

</rewritten_file>
