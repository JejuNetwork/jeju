import { getRepositories } from "../queries";
import { RepositoryCard } from "./RepositoryCard";

export async function RepositoryList() {
  const repositories = await getRepositories();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {repositories.map((repo) => (
        <RepositoryCard key={repo.id} repository={repo} />
      ))}
    </div>
  );
}

export function RepositoryListFallback() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-52 animate-pulse rounded-lg border bg-muted"
        />
      ))}
    </div>
  );
}
