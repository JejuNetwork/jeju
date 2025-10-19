/**
 * Extract repository information from the current URL
 * Defaults to elizaos/eliza if not running on GitHub Pages
 */
export function getRepositoryInfo() {
  // Check if we're on GitHub Pages
  const hostnameMatch = window.location.hostname.match(/^(.+?)\.github\.io$/);
  
  if (hostnameMatch) {
    const owner = hostnameMatch[1];
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const repo = pathParts[0] || 'eliza';
    
    return { owner, repo };
  }
  
  // Check for environment variable override (useful for custom domains)
  if (typeof process !== 'undefined' && process.env?.VITE_GITHUB_REPOSITORY) {
    const [owner, repo] = process.env.VITE_GITHUB_REPOSITORY.split('/');
    if (owner && repo) {
      return { owner, repo };
    }
  }
  
  // Default fallback for local development or non-GitHub Pages hosting
  return { owner: 'elizaos', repo: 'eliza' };
}

/**
 * Get the full repository path (owner/repo)
 */
export function getRepositoryPath() {
  const { owner, repo } = getRepositoryInfo();
  return `${owner}/${repo}`;
}

/**
 * Get the GitHub repository URL
 */
export function getGitHubUrl() {
  return `https://github.com/${getRepositoryPath()}`;
}

/**
 * Get the GitHub releases URL
 */
export function getReleasesUrl() {
  return `${getGitHubUrl()}/releases`;
}

/**
 * Get the GitHub API releases URL
 */
export function getApiReleasesUrl() {
  return `https://api.github.com/repos/${getRepositoryPath()}/releases`;
}