import { ethers } from 'ethers';

interface SignatureShare {
  sequencer: string;
  signature: string;
  timestamp: number;
}

interface BatchData {
  batchNumber: number;
  stateRoot: string;
  parentHash: string;
  timestamp: number;
}

interface AggregatedSignature {
  batchNumber: number;
  messageHash: string;
  signers: string[];
  signatures: string[];
}

export class ThresholdSigner {
  private signatureShares = new Map<number, SignatureShare[]>();
  private pendingBatches = new Map<number, BatchData>();
  private validSigners = new Set<string>();
  private threshold: number;

  constructor(threshold = 2) {
    this.threshold = threshold;
  }

  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  addSigner(address: string): void {
    this.validSigners.add(address.toLowerCase());
  }

  removeSigner(address: string): void {
    this.validSigners.delete(address.toLowerCase());
  }

  getSigners(): string[] {
    return Array.from(this.validSigners);
  }

  getPendingBatches(): BatchData[] {
    return Array.from(this.pendingBatches.values());
  }

  addBatch(batch: BatchData): void {
    this.pendingBatches.set(batch.batchNumber, batch);
    this.signatureShares.set(batch.batchNumber, []);
  }

  getBatchHash(batch: BatchData): string {
    return ethers.solidityPackedKeccak256(
      ['uint256', 'bytes32', 'bytes32', 'uint256'],
      [batch.batchNumber, batch.stateRoot, batch.parentHash, batch.timestamp]
    );
  }

  async signBatch(batch: BatchData, wallet: ethers.Wallet): Promise<SignatureShare> {
    const hash = this.getBatchHash(batch);
    const signature = await wallet.signMessage(ethers.getBytes(hash));
    return {
      sequencer: wallet.address,
      signature,
      timestamp: Date.now()
    };
  }

  addSignatureShare(batchNumber: number, share: SignatureShare): boolean {
    const shares = this.signatureShares.get(batchNumber);
    if (!shares) return false;
    
    // Check for duplicate
    if (shares.some(s => s.sequencer.toLowerCase() === share.sequencer.toLowerCase())) {
      return false;
    }
    
    // Validate signer if we have a whitelist
    if (this.validSigners.size > 0 && !this.validSigners.has(share.sequencer.toLowerCase())) {
      console.log(`Rejected signature from non-whitelisted signer: ${share.sequencer}`);
      return false;
    }
    
    shares.push(share);
    return true;
  }

  hasThreshold(batchNumber: number): boolean {
    const shares = this.signatureShares.get(batchNumber);
    return (shares?.length || 0) >= this.threshold;
  }

  getSignatureCount(batchNumber: number): number {
    return this.signatureShares.get(batchNumber)?.length || 0;
  }

  combineSignatures(batchNumber: number): AggregatedSignature {
    const shares = this.signatureShares.get(batchNumber);
    const batch = this.pendingBatches.get(batchNumber);
    
    if (!shares || shares.length < this.threshold) {
      throw new Error(`Need ${this.threshold} signatures, have ${shares?.length || 0}`);
    }
    if (!batch) throw new Error(`Batch ${batchNumber} not found`);

    // Sort by address for deterministic ordering
    const sorted = [...shares].sort((a, b) => 
      a.sequencer.toLowerCase().localeCompare(b.sequencer.toLowerCase())
    );
    const selected = sorted.slice(0, this.threshold);

    return {
      batchNumber,
      messageHash: this.getBatchHash(batch),
      signers: selected.map(s => s.sequencer),
      signatures: selected.map(s => s.signature)
    };
  }

  verifyAggregatedSignature(batch: BatchData, agg: AggregatedSignature): boolean {
    if (agg.signers.length < this.threshold) return false;

    const hash = ethers.getBytes(this.getBatchHash(batch));
    const seenSigners = new Set<string>();

    for (let i = 0; i < agg.signers.length; i++) {
      const signer = agg.signers[i].toLowerCase();
      
      // Check for duplicates
      if (seenSigners.has(signer)) {
        console.log(`Duplicate signer detected: ${signer}`);
        return false;
      }
      seenSigners.add(signer);
      
      // Verify signature
      const recovered = ethers.verifyMessage(hash, agg.signatures[i]).toLowerCase();
      if (recovered !== signer) {
        console.log(`Invalid signature from ${signer}, recovered ${recovered}`);
        return false;
      }
      
      // Optionally verify against whitelist
      if (this.validSigners.size > 0 && !this.validSigners.has(signer)) {
        console.log(`Signer ${signer} not in whitelist`);
        return false;
      }
    }
    
    return true;
  }

  clearBatch(batchNumber: number): void {
    this.signatureShares.delete(batchNumber);
    this.pendingBatches.delete(batchNumber);
  }

  // Convenience method for testing: sign and combine in one step
  async signAndCombine(batch: BatchData, wallets: ethers.Wallet[]): Promise<AggregatedSignature> {
    this.addBatch(batch);
    
    for (const wallet of wallets) {
      const share = await this.signBatch(batch, wallet);
      this.addSignatureShare(batch.batchNumber, share);
    }
    
    return this.combineSignatures(batch.batchNumber);
  }
}
