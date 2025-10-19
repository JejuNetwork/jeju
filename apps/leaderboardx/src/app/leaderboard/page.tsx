import { Leaderboard, LeaderboardFallback } from "@/components/leaderboard";
import { Suspense } from "react";
import { getLeaderboard } from "./queries";
import { getAllTags } from "./queries";

export default async function LeaderboardPage() {
  // Fetch leaderboard data for all time periods using the new DB-based query
  const [allTimeLeaderboard, monthlyLeaderboard, weeklyLeaderboard] =
    await Promise.all([
      getLeaderboard("all"),
      getLeaderboard("monthly"),
      getLeaderboard("weekly"),
    ]);

  const tabs = [
    { id: "all" as const, title: "All Time", ...allTimeLeaderboard },
    { id: "monthly" as const, title: "Monthly", ...monthlyLeaderboard },
    { id: "weekly" as const, title: "Weekly", ...weeklyLeaderboard },
  ];
  const tags = await getAllTags();

  return (
    <main className="container mx-auto space-y-8 p-4">
      <Suspense fallback={<LeaderboardFallback />}>
        <Leaderboard tabs={tabs} tags={tags} />
      </Suspense>
    </main>
  );
}
