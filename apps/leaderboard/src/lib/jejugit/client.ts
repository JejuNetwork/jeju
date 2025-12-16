/**
 * JejuGit Client for Leaderboard
 * 
 * Fetches repository data from JejuGit decentralized git server,
 * providing the same interface as the GitHub client for unified data ingestion.
 */

export interface JejuGitConfig {
  baseUrl: string;
  authToken?: string;
}

export interface JejuGitRepository {
  id: string;
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string | null;
  head_cid: string;
  verified: boolean;
  reputation_score: number;
  council_proposal_id: string | null;
}

export interface JejuGitPullRequest {
  id: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  user: { login: string };
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  source_branch: string;
  target_branch: string;
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface JejuGitIssue {
  id: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  user: { login: string };
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string }>;
  comments: number;
}

export interface JejuGitCommit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
    login?: string;
  };
  committer: {
    name: string;
    email: string;
    date: string;
  };
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
}

export interface JejuGitUser {
  login: string;
  address: string;
  jns_name?: string;
  avatar_url?: string;
  reputation_score: number;
  public_repos: number;
}

export class JejuGitClient {
  private config: JejuGitConfig;

  constructor(config: JejuGitConfig) {
    this.config = config;
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.config.authToken) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.config.authToken}`;
    }

    const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`JejuGit API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async getRepo(owner: string, name: string): Promise<JejuGitRepository | null> {
    try {
      return await this.fetch<JejuGitRepository>(`/api/v1/repos/${owner}/${name}`);
    } catch {
      return null;
    }
  }

  async getPullRequests(
    owner: string,
    name: string,
    options?: {
      state?: 'open' | 'closed' | 'all';
      since?: string;
      until?: string;
      page?: number;
      perPage?: number;
    }
  ): Promise<JejuGitPullRequest[]> {
    const params = new URLSearchParams();
    if (options?.state) params.set('state', options.state);
    if (options?.page) params.set('page', options.page.toString());
    if (options?.perPage) params.set('per_page', options.perPage.toString());

    try {
      const prs = await this.fetch<JejuGitPullRequest[]>(
        `/api/v1/repos/${owner}/${name}/pulls?${params}`
      );

      // Filter by date range if provided
      if (options?.since || options?.until) {
        return prs.filter(pr => {
          const createdAt = new Date(pr.created_at).getTime();
          if (options.since && createdAt < new Date(options.since).getTime()) return false;
          if (options.until && createdAt > new Date(options.until).getTime()) return false;
          return true;
        });
      }

      return prs;
    } catch {
      return [];
    }
  }

  async getIssues(
    owner: string,
    name: string,
    options?: {
      state?: 'open' | 'closed' | 'all';
      since?: string;
      until?: string;
      page?: number;
      perPage?: number;
    }
  ): Promise<JejuGitIssue[]> {
    const params = new URLSearchParams();
    if (options?.state) params.set('state', options.state);
    if (options?.page) params.set('page', options.page.toString());
    if (options?.perPage) params.set('per_page', options.perPage.toString());

    try {
      const issues = await this.fetch<JejuGitIssue[]>(
        `/api/v1/repos/${owner}/${name}/issues?${params}`
      );

      // Filter by date range if provided
      if (options?.since || options?.until) {
        return issues.filter(issue => {
          const createdAt = new Date(issue.created_at).getTime();
          if (options.since && createdAt < new Date(options.since).getTime()) return false;
          if (options.until && createdAt > new Date(options.until).getTime()) return false;
          return true;
        });
      }

      return issues;
    } catch {
      return [];
    }
  }

  async getCommits(
    owner: string,
    name: string,
    options?: {
      since?: string;
      until?: string;
      sha?: string;
      page?: number;
      perPage?: number;
    }
  ): Promise<JejuGitCommit[]> {
    const params = new URLSearchParams();
    if (options?.sha) params.set('sha', options.sha);
    if (options?.page) params.set('page', options.page.toString());
    if (options?.perPage) params.set('per_page', options.perPage.toString());

    try {
      const commits = await this.fetch<JejuGitCommit[]>(
        `/api/v1/repos/${owner}/${name}/commits?${params}`
      );

      // Filter by date range if provided
      if (options?.since || options?.until) {
        return commits.filter(commit => {
          const date = new Date(commit.author.date).getTime();
          if (options.since && date < new Date(options.since).getTime()) return false;
          if (options.until && date > new Date(options.until).getTime()) return false;
          return true;
        });
      }

      return commits;
    } catch {
      return [];
    }
  }

  async getUser(username: string): Promise<JejuGitUser | null> {
    try {
      return await this.fetch<JejuGitUser>(`/api/v1/users/${username}`);
    } catch {
      return null;
    }
  }

  async searchRepos(query: string, options?: {
    page?: number;
    perPage?: number;
  }): Promise<{ total: number; items: JejuGitRepository[] }> {
    const params = new URLSearchParams();
    params.set('q', query);
    if (options?.page) params.set('page', options.page.toString());
    if (options?.perPage) params.set('per_page', options.perPage.toString());

    try {
      return await this.fetch<{ total_count: number; items: JejuGitRepository[] }>(
        `/api/v1/search/repositories?${params}`
      ).then(data => ({ total: data.total_count, items: data.items }));
    } catch {
      return { total: 0, items: [] };
    }
  }

  async healthCheck(): Promise<{ status: string }> {
    return this.fetch<{ status: string }>('/api/v1/health');
  }
}

// Create default client from environment
export function createJejuGitClient(): JejuGitClient {
  const baseUrl = process.env.JEJUGIT_URL ?? 'http://localhost:4020';
  const authToken = process.env.JEJUGIT_AUTH_TOKEN;

  return new JejuGitClient({ baseUrl, authToken });
}

// Export for use in pipeline context
export type { JejuGitConfig };
