'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDwsUrl } from '../config/contracts';

// ============ Types ============

export type DiscussionCategory = 'general' | 'questions' | 'announcements' | 'show' | 'ideas';

export interface DiscussionAuthor {
  id: string;
  name: string;
  avatar: string;
}

export interface DiscussionReply {
  id: string;
  author: DiscussionAuthor;
  content: string;
  createdAt: number;
  likes: number;
  isAnswer?: boolean;
}

export interface Discussion {
  id: string;
  title: string;
  content: string;
  author: DiscussionAuthor;
  category: DiscussionCategory;
  replies: number;
  views: number;
  likes: number;
  isPinned: boolean;
  isLocked: boolean;
  createdAt: number;
  lastReplyAt: number;
  tags: string[];
}

// ============ Fetchers ============

async function fetchDiscussions(resourceType: string, resourceId: string, query?: { category?: DiscussionCategory }): Promise<Discussion[]> {
  const dwsUrl = getDwsUrl();
  const params = new URLSearchParams();
  if (query?.category) params.set('category', query.category);
  
  const res = await fetch(`${dwsUrl}/api/${resourceType}/${resourceId}/discussions?${params.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.discussions || [];
}

async function fetchDiscussion(resourceType: string, resourceId: string, discussionId: string): Promise<{ discussion: Discussion; replies: DiscussionReply[] } | null> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/${resourceType}/${resourceId}/discussions/${discussionId}`);
  if (!res.ok) return null;
  return res.json();
}

async function createDiscussion(resourceType: string, resourceId: string, data: { title: string; content: string; category: DiscussionCategory; tags: string[] }): Promise<Discussion | null> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/${resourceType}/${resourceId}/discussions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) return null;
  return res.json();
}

async function replyToDiscussion(resourceType: string, resourceId: string, discussionId: string, content: string): Promise<DiscussionReply | null> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/${resourceType}/${resourceId}/discussions/${discussionId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) return null;
  return res.json();
}

// ============ Hooks ============

export function useDiscussions(resourceType: string, resourceId: string, query?: { category?: DiscussionCategory }) {
  const { data: discussions, isLoading, error, refetch } = useQuery({
    queryKey: ['discussions', resourceType, resourceId, query],
    queryFn: () => fetchDiscussions(resourceType, resourceId, query),
    enabled: !!resourceType && !!resourceId,
    staleTime: 30000,
  });

  return {
    discussions: discussions || [],
    isLoading,
    error,
    refetch,
  };
}

export function useDiscussion(resourceType: string, resourceId: string, discussionId: string) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['discussion', resourceType, resourceId, discussionId],
    queryFn: () => fetchDiscussion(resourceType, resourceId, discussionId),
    enabled: !!resourceType && !!resourceId && !!discussionId,
    staleTime: 30000,
  });

  return {
    discussion: data?.discussion || null,
    replies: data?.replies || [],
    isLoading,
    error,
    refetch,
  };
}

export function useCreateDiscussion(resourceType: string, resourceId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { title: string; content: string; category: DiscussionCategory; tags: string[] }) =>
      createDiscussion(resourceType, resourceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discussions', resourceType, resourceId] });
    },
  });
}

export function useReplyToDiscussion(resourceType: string, resourceId: string, discussionId: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (content: string) => replyToDiscussion(resourceType, resourceId, discussionId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discussion', resourceType, resourceId, discussionId] });
      queryClient.invalidateQueries({ queryKey: ['discussions', resourceType, resourceId] });
    },
  });
}


