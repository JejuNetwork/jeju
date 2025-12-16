/**
 * External service integrations (GitHub, Linear, npm)
 * Provides web2 integration layer for Factory
 */

// ============ GitHub Integration ============

const GITHUB_API = 'https://api.github.com';

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  clone_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  updated_at: string;
  default_branch: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  html_url: string;
  created_at: string;
  labels: { name: string; color: string }[];
  assignees: { login: string; avatar_url: string }[];
}

export interface GitHubPR {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  html_url: string;
  created_at: string;
  head: { ref: string };
  base: { ref: string };
}

export class GitHubService {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      ...options.headers as Record<string, string>,
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return fetch(`${GITHUB_API}${path}`, { ...options, headers });
  }

  async getUserRepos(): Promise<GitHubRepo[]> {
    const response = await this.fetch('/user/repos?per_page=100&sort=updated');
    if (!response.ok) throw new Error('Failed to fetch GitHub repos');
    return response.json();
  }

  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    const response = await this.fetch(`/repos/${owner}/${repo}`);
    if (!response.ok) throw new Error('Repository not found');
    return response.json();
  }

  async getIssues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubIssue[]> {
    const response = await this.fetch(`/repos/${owner}/${repo}/issues?state=${state}&per_page=100`);
    if (!response.ok) throw new Error('Failed to fetch issues');
    return response.json();
  }

  async createIssue(owner: string, repo: string, params: {
    title: string;
    body?: string;
    labels?: string[];
  }): Promise<GitHubIssue> {
    const response = await this.fetch(`/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!response.ok) throw new Error('Failed to create issue');
    return response.json();
  }

  async getPullRequests(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubPR[]> {
    const response = await this.fetch(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=100`);
    if (!response.ok) throw new Error('Failed to fetch PRs');
    return response.json();
  }

  async syncRepoToJeju(owner: string, repo: string): Promise<{ success: boolean; jejuRepoId?: string }> {
    // This would call DWS to create a mirrored repo
    const repoData = await this.getRepo(owner, repo);
    
    // Import to Jeju Git
    const response = await fetch(`${process.env.NEXT_PUBLIC_DWS_URL}/api/git/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'github',
        sourceUrl: repoData.clone_url,
        name: repoData.name,
        description: repoData.description,
        isPrivate: repoData.private,
      }),
    });

    if (!response.ok) {
      return { success: false };
    }

    const result = await response.json();
    return { success: true, jejuRepoId: result.id };
  }
}

// ============ Linear Integration ============

const LINEAR_API = 'https://api.linear.app/graphql';

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string; color: string };
  priority: number;
  assignee: { name: string; avatarUrl: string } | null;
  labels: { name: string; color: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface LinearProject {
  id: string;
  name: string;
  description: string | null;
  state: string;
  progress: number;
  startDate: string | null;
  targetDate: string | null;
}

export class LinearService {
  private apiKey: string | null = null;

  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async query(query: string, variables?: Record<string, unknown>): Promise<unknown> {
    if (!this.apiKey) throw new Error('Linear API key not set');

    const response = await fetch(LINEAR_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) throw new Error('Linear API request failed');
    const data = await response.json();
    return data.data;
  }

  async getIssues(teamKey?: string): Promise<LinearIssue[]> {
    const result = await this.query(`
      query GetIssues($teamKey: String) {
        issues(filter: { team: { key: { eq: $teamKey } } }, first: 100) {
          nodes {
            id
            identifier
            title
            description
            state { name color }
            priority
            assignee { name avatarUrl }
            labels { nodes { name color } }
            createdAt
            updatedAt
          }
        }
      }
    `, { teamKey }) as { issues: { nodes: LinearIssue[] } };
    return result.issues.nodes;
  }

  async createIssue(params: {
    teamId: string;
    title: string;
    description?: string;
    priority?: number;
    labelIds?: string[];
  }): Promise<LinearIssue> {
    const result = await this.query(`
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            description
            state { name color }
            priority
            assignee { name avatarUrl }
            labels { nodes { name color } }
            createdAt
            updatedAt
          }
        }
      }
    `, { input: params }) as { issueCreate: { issue: LinearIssue } };
    return result.issueCreate.issue;
  }

  async getProjects(): Promise<LinearProject[]> {
    const result = await this.query(`
      query GetProjects {
        projects(first: 50) {
          nodes {
            id
            name
            description
            state
            progress
            startDate
            targetDate
          }
        }
      }
    `) as { projects: { nodes: LinearProject[] } };
    return result.projects.nodes;
  }

  async syncIssueToJeju(issueId: string): Promise<{ success: boolean; jejuTaskId?: string }> {
    const issues = await this.getIssues();
    const issue = issues.find(i => i.id === issueId);
    if (!issue) return { success: false };

    // Create task in Jeju ProjectBoard
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/projects/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        externalSource: 'linear',
        externalId: issue.id,
      }),
    });

    if (!response.ok) {
      return { success: false };
    }

    const result = await response.json();
    return { success: true, jejuTaskId: result.id };
  }
}

// ============ npm Integration ============

const NPM_REGISTRY = 'https://registry.npmjs.org';

export interface NpmPackage {
  name: string;
  description: string;
  'dist-tags': { latest: string };
  versions: Record<string, {
    version: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>;
  time: Record<string, string>;
  maintainers: { name: string; email: string }[];
  repository?: { url: string };
  license: string;
}

export interface NpmSearchResult {
  package: {
    name: string;
    version: string;
    description: string;
    keywords: string[];
    date: string;
    links: { npm: string; homepage?: string; repository?: string };
    publisher: { username: string };
  };
  score: { final: number; detail: { quality: number; popularity: number; maintenance: number } };
}

export class NpmService {
  async getPackage(name: string): Promise<NpmPackage> {
    const response = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error('Package not found');
    return response.json();
  }

  async search(query: string, size = 20): Promise<NpmSearchResult[]> {
    const response = await fetch(
      `${NPM_REGISTRY}/-/v1/search?text=${encodeURIComponent(query)}&size=${size}`
    );
    if (!response.ok) throw new Error('Search failed');
    const data = await response.json();
    return data.objects;
  }

  async getPackageTarball(name: string, version: string): Promise<Blob> {
    const pkg = await this.getPackage(name);
    const versionInfo = pkg.versions[version];
    if (!versionInfo) throw new Error('Version not found');

    // Get tarball URL from version info
    const tarballUrl = `${NPM_REGISTRY}/${encodeURIComponent(name)}/-/${name.split('/').pop()}-${version}.tgz`;
    const response = await fetch(tarballUrl);
    if (!response.ok) throw new Error('Failed to fetch tarball');
    return response.blob();
  }

  async mirrorToJeju(name: string, version?: string): Promise<{ success: boolean; jejuPackageId?: string }> {
    const pkg = await this.getPackage(name);
    const targetVersion = version || pkg['dist-tags'].latest;
    const tarball = await this.getPackageTarball(name, targetVersion);

    // Upload to Jeju package registry
    const formData = new FormData();
    formData.append('tarball', tarball, `${name.replace('/', '-')}-${targetVersion}.tgz`);
    formData.append('metadata', JSON.stringify({
      name,
      version: targetVersion,
      description: pkg.description,
      license: pkg.license,
      externalSource: 'npm',
    }));

    const response = await fetch(`${process.env.NEXT_PUBLIC_DWS_URL}/api/packages`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      return { success: false };
    }

    const result = await response.json();
    return { success: true, jejuPackageId: result.id };
  }
}

// ============ Export Singleton Instances ============

export const githubService = new GitHubService();
export const linearService = new LinearService();
export const npmService = new NpmService();
