'use client';

import { useQuery } from '@tanstack/react-query';
import { getDwsUrl } from '../config/contracts';

// ============ Types ============

export interface DatasetPreview {
  columns: string[];
  sample: string[][];
}

export interface Dataset {
  id: string;
  name: string;
  organization: string;
  description: string;
  type: 'text' | 'code' | 'image' | 'audio' | 'multimodal' | 'tabular';
  format: string;
  size: string;
  rows: number;
  downloads: number;
  stars: number;
  lastUpdated: number;
  license: string;
  tags: string[];
  isVerified: boolean;
  preview?: DatasetPreview;
}

export interface DatasetStats {
  totalDatasets: number;
  totalDownloads: number;
  contributors: number;
  totalSize: string;
}

// ============ Fetchers ============

async function fetchDatasets(query?: { type?: string; search?: string }): Promise<Dataset[]> {
  const dwsUrl = getDwsUrl();
  const params = new URLSearchParams();
  if (query?.type) params.set('type', query.type);
  if (query?.search) params.set('q', query.search);
  
  const res = await fetch(`${dwsUrl}/api/datasets?${params.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.datasets || [];
}

async function fetchDatasetStats(): Promise<DatasetStats> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/datasets/stats`);
  if (!res.ok) {
    return { totalDatasets: 0, totalDownloads: 0, contributors: 0, totalSize: '0 B' };
  }
  return res.json();
}

async function fetchDataset(org: string, name: string): Promise<Dataset | null> {
  const dwsUrl = getDwsUrl();
  const res = await fetch(`${dwsUrl}/api/datasets/${org}/${name}`);
  if (!res.ok) return null;
  return res.json();
}

// ============ Hooks ============

export function useDatasets(query?: { type?: string; search?: string }) {
  const { data: datasets, isLoading, error, refetch } = useQuery({
    queryKey: ['datasets', query],
    queryFn: () => fetchDatasets(query),
    staleTime: 60000,
  });

  return {
    datasets: datasets || [],
    isLoading,
    error,
    refetch,
  };
}

export function useDatasetStats() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['datasetStats'],
    queryFn: fetchDatasetStats,
    staleTime: 120000,
  });

  return {
    stats: stats || { totalDatasets: 0, totalDownloads: 0, contributors: 0, totalSize: '0 B' },
    isLoading,
    error,
  };
}

export function useDataset(org: string, name: string) {
  const { data: dataset, isLoading, error, refetch } = useQuery({
    queryKey: ['dataset', org, name],
    queryFn: () => fetchDataset(org, name),
    enabled: !!org && !!name,
    staleTime: 60000,
  });

  return {
    dataset,
    isLoading,
    error,
    refetch,
  };
}

