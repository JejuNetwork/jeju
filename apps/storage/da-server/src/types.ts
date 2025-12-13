/**
 * JejuDA Type Definitions
 */

export interface CommitmentData {
  cid: string;
  timestamp: number;
  size?: number;
}

export interface PutResponse {
  commitment: string;
  cid: string;
  size: number;
  timestamp: number;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  ipfs: boolean;
  uptime: number;
  version: string;
}

export interface ReadyResponse {
  ready: boolean;
  reason?: string;
}

export interface Metrics {
  totalPuts: number;
  totalGets: number;
  totalBytes: number;
  cacheSize: number;
  lastPutTime: number;
}

export interface IPFSAddResponse {
  Hash: string;
  Size: string;
  Name: string;
}

export interface IPFSIDResponse {
  ID: string;
  PublicKey: string;
  Addresses: string[];
  AgentVersion: string;
  ProtocolVersion: string;
}






