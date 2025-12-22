'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDwsUrl } from '../config/contracts';

// ============ Types ============

export type PRState = 'open' | 'closed' | 'merged';
export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface PRAuthor {
  login: string;
  avatar: string;
}

export interface PRReview {
  id: string;
  author: PRAuthor;
  state: 'approved' | 'changes_requested' | 'commented' | 'pending';
  body?: string;
  submittedAt: number;
}

export interface PRCommit {
  sha: string;
  message: string;
  author: PRAuthor;
  date: number;
}

export interface PRFile {
  path: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  patch?: string;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  body: string;
  state: PRState;
  author: PRAuthor;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  labels: { name: string; color: string }[];
  reviewers: PRAuthor[];
  assignees: PRAuthor[];
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  comments: number;
  mergeable: boolean;
  draft: boolean;
  createdAt: number;
  updatedAt: number;
  mergedAt?: number;
  closedAt?: number;
}

// ============ Fetchers ============

async function fetchPullRequests(owner: string, repo: string, query?: { state?: PRState }): Promise<PullRequest[]> {
  const dwsUrl = getDwsUrl();
  const params = new URLSearchParams();
  if (query?.state) params.set('state', query.state);
  
  const res = await fetch(`${dwsUrl}/api/git/${owner}/${repo}/pulls?${params.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.pullRequests || [];
}

async function fetchPullRequest(owner: string, repo: string, prNumber: number): Promise<{
  pullRequest: PullRequest;
  commits: PRCommit[];
  files: PRFile[];
  reviews: PRReview[];
} | null> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/git/${owner}/${repo}/pulls/${prNumber}`);
  if (!res.ok) return null;
  return res.json();
}

async function createPullRequest(owner: string, repo: string, data: {
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
}): Promise<PullRequest | null> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/git/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  return res.json();
}

async function mergePullRequest(owner: string, repo: string, prNumber: number, method: MergeMethod): Promise<boolean> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/git/${owner}/${repo}/pulls/${prNumber}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method }),
  });
  return res.ok;
}

async function submitReview(owner: string, repo: string, prNumber: number, data: {
  body: string;
  event: 'approve' | 'request_changes' | 'comment';
}): Promise<boolean> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/git/${owner}/${repo}/pulls/${prNumber}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.ok;
}

// ============ Hooks ============

export function usePullRequests(owner: string, repo: string, query?: { state?: PRState }) {
  const { data: pullRequests, isLoading, error, refetch } = useQuery({
    queryKey: ['pullRequests', owner, repo, query],
    queryFn: () => fetchPullRequests(owner, repo, query),
    enabled: !!owner && !!repo,
    staleTime: 30000,
  });

  return {
    pullRequests: pullRequests || [],
    isLoading,
    error,
    refetch,
  };
}

export function usePullRequest(owner: string, repo: string, prNumber: number) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['pullRequest', owner, repo, prNumber],
    queryFn: () => fetchPullRequest(owner, repo, prNumber),
    enabled: !!owner && !!repo && !!prNumber,
    staleTime: 30000,
  });

  return {
    pullRequest: data?.pullRequest || null,
    commits: data?.commits || [],
    files: data?.files || [],
    reviews: data?.reviews || [],
    isLoading,
    error,
    refetch,
  };
}

export function useCreatePullRequest(owner: string, repo: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { title: string; body: string; head: string; base: string; draft?: boolean }) =>
      createPullRequest(owner, repo, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pullRequests', owner, repo] });
    },
  });
}

export function useMergePullRequest(owner: string, repo: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ prNumber, method }: { prNumber: number; method: MergeMethod }) =>
      mergePullRequest(owner, repo, prNumber, method),
    onSuccess: (_, { prNumber }) => {
      queryClient.invalidateQueries({ queryKey: ['pullRequest', owner, repo, prNumber] });
      queryClient.invalidateQueries({ queryKey: ['pullRequests', owner, repo] });
    },
  });
}

export function useSubmitReview(owner: string, repo: string, prNumber: number) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { body: string; event: 'approve' | 'request_changes' | 'comment' }) =>
      submitReview(owner, repo, prNumber, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pullRequest', owner, repo, prNumber] });
    },
  });
}


