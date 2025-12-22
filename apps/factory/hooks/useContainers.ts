'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDwsUrl } from '../config/contracts';

// ============ Types ============

export type ContainerStatus = 'running' | 'stopped' | 'building' | 'failed';

export interface ContainerImage {
  id: string;
  name: string;
  tag: string;
  size: string;
  digest: string;
  createdAt: number;
  pulls: number;
  isPublic: boolean;
  description?: string;
}

export interface ContainerInstance {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  cpu: string;
  memory: string;
  gpu?: string;
  port?: number;
  endpoint?: string;
  createdAt: number;
  startedAt?: number;
  cost: string;
}

export interface ContainerStats {
  totalImages: number;
  runningContainers: number;
  totalPulls: number;
  totalStorage: string;
}

// ============ Fetchers ============

async function fetchImages(query?: { search?: string }): Promise<ContainerImage[]> {
  const dwsUrl = getDwsUrl();
  const params = new URLSearchParams();
  if (query?.search) params.set('q', query.search);
  
  const res = await fetch(`${dwsUrl}/api/containers/images?${params.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.images || [];
}

async function fetchInstances(): Promise<ContainerInstance[]> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/containers/instances`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.instances || [];
}

async function fetchContainerStats(): Promise<ContainerStats> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/containers/stats`);
  if (!res.ok) {
    return { totalImages: 0, runningContainers: 0, totalPulls: 0, totalStorage: '0 B' };
  }
  return res.json();
}

async function startContainer(imageId: string, config: { name: string; cpu: string; memory: string; gpu?: string }): Promise<ContainerInstance | null> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/containers/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageId, ...config }),
  });
  if (!res.ok) return null;
  return res.json();
}

async function stopContainer(instanceId: string): Promise<boolean> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/containers/instances/${instanceId}/stop`, {
    method: 'POST',
  });
  return res.ok;
}

async function deleteContainer(instanceId: string): Promise<boolean> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/containers/instances/${instanceId}`, {
    method: 'DELETE',
  });
  return res.ok;
}

// ============ Hooks ============

export function useContainerImages(query?: { search?: string }) {
  const { data: images, isLoading, error, refetch } = useQuery({
    queryKey: ['containerImages', query],
    queryFn: () => fetchImages(query),
    staleTime: 60000,
  });

  return {
    images: images || [],
    isLoading,
    error,
    refetch,
  };
}

export function useContainerInstances() {
  const { data: instances, isLoading, error, refetch } = useQuery({
    queryKey: ['containerInstances'],
    queryFn: fetchInstances,
    staleTime: 10000,
    refetchInterval: 30000,
  });

  return {
    instances: instances || [],
    isLoading,
    error,
    refetch,
  };
}

export function useContainerStats() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['containerStats'],
    queryFn: fetchContainerStats,
    staleTime: 60000,
  });

  return {
    stats: stats || { totalImages: 0, runningContainers: 0, totalPulls: 0, totalStorage: '0 B' },
    isLoading,
    error,
  };
}

export function useStartContainer() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ imageId, config }: { imageId: string; config: { name: string; cpu: string; memory: string; gpu?: string } }) =>
      startContainer(imageId, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containerInstances'] });
      queryClient.invalidateQueries({ queryKey: ['containerStats'] });
    },
  });
}

export function useStopContainer() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (instanceId: string) => stopContainer(instanceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containerInstances'] });
    },
  });
}

export function useDeleteContainer() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (instanceId: string) => deleteContainer(instanceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containerInstances'] });
      queryClient.invalidateQueries({ queryKey: ['containerStats'] });
    },
  });
}


