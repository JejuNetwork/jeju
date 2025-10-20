/**
 * Evidence Storage Service
 * Localnet equivalent to IPFS for evidence file storage
 * Uses local filesystem with content-addressed storage
 */

import { Plugin, Service, type IAgentRuntime, Action, type Memory } from '@elizaos/core';
import { ethers } from 'ethers';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface EvidenceFile {
  hash: string; // Content hash (CID-like)
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: number;
  uploadedBy: string; // Agent wallet address
  content?: string; // Base64 encoded for binary files, or direct text
}

/**
 * Evidence Storage Service
 * Content-addressed storage for evidence files
 */
export class EvidenceService extends Service {
  public static serviceType = 'evidence_service';
  
  private storagePath!: string;
  private evidence: Map<string, EvidenceFile> = new Map();
  
  async start(runtime: IAgentRuntime): Promise<EvidenceService> {
    // Set up storage directory
    this.storagePath = runtime.getSetting('EVIDENCE_STORAGE_PATH') || './data/evidence';
    
    // Create directory if it doesn't exist
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
    } catch (error: any) {
      runtime.logger.error('Failed to create evidence storage directory', error);
      throw new Error(`Could not create evidence storage at ${this.storagePath}`);
    }
    
    // Load existing evidence from disk
    await this.loadExistingEvidence(runtime);
    
    runtime.logger.info('Evidence service started', {
      storagePath: this.storagePath,
      loadedFiles: this.evidence.size
    });
    
    return this;
  }
  
  /**
   * Load existing evidence files from disk
   */
  private async loadExistingEvidence(runtime: IAgentRuntime): Promise<void> {
    try {
      const files = await fs.readdir(this.storagePath);
      
      for (const filename of files) {
        if (filename.endsWith('.json')) {
          const metaPath = path.join(this.storagePath, filename);
          const content = await fs.readFile(metaPath, 'utf-8');
          const metadata: EvidenceFile = JSON.parse(content);
          
          if (metadata.hash) {
            this.evidence.set(metadata.hash, metadata);
          }
        }
      }
      
      runtime.logger.info(`Loaded ${this.evidence.size} existing evidence files`);
    } catch (error) {
      runtime.logger.warn('Could not load existing evidence (directory might be empty)', error);
    }
  }
  
  /**
   * Store evidence and return content-addressed hash
   */
  async storeEvidence(
    content: string,
    filename: string,
    mimeType: string,
    uploadedBy: string
  ): Promise<string> {
    // Generate content hash (similar to IPFS CID)
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(content));
    // Make it look like an IPFS CID
    const cid = `Qm${contentHash.slice(2, 48)}`;
    
    const evidenceFile: EvidenceFile = {
      hash: cid,
      filename,
      mimeType,
      size: content.length,
      uploadedAt: Date.now(),
      uploadedBy,
      content
    };
    
    // Store metadata to disk
    const metaPath = path.join(this.storagePath, `${cid}.json`);
    await fs.writeFile(metaPath, JSON.stringify(evidenceFile, null, 2));
    
    // Store content separately
    const contentPath = path.join(this.storagePath, cid);
    await fs.writeFile(contentPath, content);
    
    // Cache in memory
    this.evidence.set(cid, evidenceFile);
    
    this.runtime.logger.info('Evidence stored', {
      hash: cid,
      filename,
      size: content.length
    });
    
    return cid;
  }
  
  /**
   * Retrieve evidence by hash
   */
  async getEvidence(hash: string): Promise<EvidenceFile | null> {
    // Check cache first
    const cached = this.evidence.get(hash);
    if (cached) {
      return cached;
    }
    
    // Try to load from disk
    try {
      const metaPath = path.join(this.storagePath, `${hash}.json`);
      const content = await fs.readFile(metaPath, 'utf-8');
      const metadata: EvidenceFile = JSON.parse(content);
      
      // Load actual content
      const contentPath = path.join(this.storagePath, hash);
      const fileContent = await fs.readFile(contentPath, 'utf-8');
      metadata.content = fileContent;
      
      // Cache it
      this.evidence.set(hash, metadata);
      
      return metadata;
    } catch (error) {
      this.runtime.logger.error(`Evidence not found: ${hash}`, error);
      return null;
    }
  }
  
  /**
   * List all evidence files
   */
  listEvidence(): EvidenceFile[] {
    return Array.from(this.evidence.values()).map(e => ({
      ...e,
      content: undefined // Don't include content in listings
    }));
  }
  
  /**
   * Delete evidence file
   */
  async deleteEvidence(hash: string): Promise<boolean> {
    try {
      const metaPath = path.join(this.storagePath, `${hash}.json`);
      const contentPath = path.join(this.storagePath, hash);
      
      await Promise.all([
        fs.unlink(metaPath),
        fs.unlink(contentPath)
      ]);
      
      this.evidence.delete(hash);
      
      this.runtime.logger.info('Evidence deleted', {hash});
      return true;
    } catch (error) {
      this.runtime.logger.error(`Failed to delete evidence ${hash}`, error);
      return false;
    }
  }
  
  async stop(): Promise<void> {
    this.evidence.clear();
    this.runtime.logger.info('Evidence service stopped');
  }
  
  public get capabilityDescription(): string {
    return 'Content-addressed evidence storage (localnet IPFS equivalent)';
  }
}

/**
 * Upload Evidence Action
 */
export const uploadEvidenceAction: Action = {
  name: 'UPLOAD_EVIDENCE',
  description: 'Upload evidence file to content-addressed storage and get hash',
  
  similes: ['store evidence', 'save proof', 'upload file', 'ipfs upload'],
  
  examples: [[
    {
      name: 'system',
      content: {text: 'Upload evidence of the exploit'}
    },
    {
      name: 'agent',
      content: {text: 'Uploading evidence to storage...', action: 'UPLOAD_EVIDENCE'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<EvidenceService>('evidence_service');
    return !!service;
  },
  
  handler: async (runtime: IAgentRuntime, message: Memory, state?: any) => {
    const service = runtime.getService<EvidenceService>('evidence_service');
    if (!service) {
      return {success: false, error: 'Evidence service not available'};
    }
    
    try {
      const evidenceContent = state?.content || message.content?.data?.content || message.content?.text;
      const filename = state?.filename || message.content?.data?.filename || 'evidence.txt';
      const mimeType = state?.mimeType || message.content?.data?.mimeType || 'text/plain';
      
      if (!evidenceContent) {
        throw new Error('Evidence content required');
      }
      
      // Get contract service for wallet address
      const contractService = runtime.getService('contract_service') as any;
      const uploadedBy = contractService?.getWallet()?.address || 'unknown';
      
      const hash = await service.storeEvidence(
        evidenceContent,
        filename,
        mimeType,
        uploadedBy
      );
      
      runtime.logger.info('Evidence uploaded', {hash, filename});
      
      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Evidence uploaded successfully. Hash: ${hash}. Filename: ${filename}. Size: ${evidenceContent.length} bytes.`,
          action: 'UPLOAD_EVIDENCE',
          data: {hash, filename, mimeType, size: evidenceContent.length}
        },
        roomId: message.roomId
      }, 'messages');
      
      return {success: true, hash, filename, size: evidenceContent.length};
    } catch (error: any) {
      runtime.logger.error('Evidence upload failed:', error);
      return {success: false, error: error.message};
    }
  }
};

/**
 * Retrieve Evidence Action
 */
export const retrieveEvidenceAction: Action = {
  name: 'RETRIEVE_EVIDENCE',
  description: 'Retrieve evidence file by content hash',
  
  similes: ['get evidence', 'fetch proof', 'download file', 'ipfs cat'],
  
  examples: [[
    {
      name: 'system',
      content: {text: 'Retrieve evidence QmX7b9...'}
    },
    {
      name: 'agent',
      content: {text: 'Retrieving evidence from storage...', action: 'RETRIEVE_EVIDENCE'}
    }
  ]],
  
  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<EvidenceService>('evidence_service');
    return !!service;
  },
  
  handler: async (runtime: IAgentRuntime, message: Memory, state?: any) => {
    const service = runtime.getService<EvidenceService>('evidence_service');
    if (!service) {
      return {success: false, error: 'Evidence service not available'};
    }
    
    try {
      const hash = state?.hash || message.content?.data?.hash;
      
      if (!hash) {
        throw new Error('Evidence hash required');
      }
      
      const evidence = await service.getEvidence(hash);
      
      if (!evidence) {
        return {success: false, error: `Evidence not found: ${hash}`};
      }
      
      runtime.logger.info('Evidence retrieved', {hash, filename: evidence.filename});
      
      await runtime.createMemory({
        userId: runtime.agentId,
        content: {
          text: `Evidence retrieved: ${evidence.filename} (${evidence.size} bytes). Uploaded: ${new Date(evidence.uploadedAt).toISOString()}`,
          action: 'RETRIEVE_EVIDENCE',
          data: {
            hash,
            filename: evidence.filename,
            mimeType: evidence.mimeType,
            size: evidence.size,
            uploadedAt: evidence.uploadedAt,
            content: evidence.content
          }
        },
        roomId: message.roomId
      }, 'messages');
      
      return {
        success: true,
        hash,
        filename: evidence.filename,
        content: evidence.content,
        mimeType: evidence.mimeType
      };
    } catch (error: any) {
      runtime.logger.error('Evidence retrieval failed:', error);
      return {success: false, error: error.message};
    }
  }
};

export const evidencePlugin: Plugin = {
  name: '@crucible/plugin-evidence',
  description: 'Content-addressed evidence storage for security testing',
  services: [EvidenceService],
  actions: [uploadEvidenceAction, retrieveEvidenceAction]
};

