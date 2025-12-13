import { ethers } from 'ethers';

interface Sequencer {
  address: string;
  weight: bigint;
  lastBlock: number;
}

interface BlockProposal {
  blockNumber: number;
  stateRoot: string;
  parentHash: string;
  timestamp: number;
  sequencer: string;
}

interface Vote {
  sequencer: string;
  signature: string;
  blockNumber: number;
}

export class ConsensusAdapter {
  private sequencers: Sequencer[] = [];
  private height = 0;
  private round = 0;
  private leader: string | null = null;
  private totalWeight = 0n;
  private isRunning = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private sequencerRegistry: ethers.Contract,
    private blockInterval = 2000,
    private requiredVoteRatio = 2 / 3
  ) {}

  async loadSequencers(): Promise<void> {
    const [addresses, weights] = await this.sequencerRegistry.getActiveSequencers();
    this.sequencers = addresses.map((addr: string, i: number) => ({
      address: addr,
      weight: BigInt(weights[i].toString()),
      lastBlock: 0
    }));
    this.totalWeight = this.sequencers.reduce((sum, s) => sum + s.weight, 0n);
    console.log(`Loaded ${this.sequencers.length} sequencers, weight: ${this.totalWeight}`);
  }

  selectNextSequencer(): string {
    if (this.sequencers.length === 0) throw new Error('No sequencers');
    const rand = BigInt(Math.floor(Math.random() * Number(this.totalWeight)));
    let cumulative = 0n;
    for (const seq of this.sequencers) {
      cumulative += seq.weight;
      if (rand < cumulative) return seq.address;
    }
    return this.sequencers[this.round % this.sequencers.length].address;
  }

  async proposeBlock(parentHash: string): Promise<BlockProposal> {
    this.height++;
    this.round = 0;
    this.leader = this.selectNextSequencer();
    
    const stateRoot = ethers.keccak256(ethers.toUtf8Bytes(`state_${this.height}_${Date.now()}`));
    
    return {
      blockNumber: this.height,
      stateRoot,
      parentHash,
      timestamp: Date.now(),
      sequencer: this.leader
    };
  }

  async collectVotes(proposal: BlockProposal, signers: ethers.Wallet[]): Promise<Vote[]> {
    const votes: Vote[] = [];
    const requiredVotes = Math.ceil(this.sequencers.length * this.requiredVoteRatio);
    
    const messageHash = ethers.solidityPackedKeccak256(
      ['uint256', 'bytes32', 'bytes32', 'uint256'],
      [proposal.blockNumber, proposal.stateRoot, proposal.parentHash, proposal.timestamp]
    );
    
    for (const signer of signers) {
      const signature = await signer.signMessage(ethers.getBytes(messageHash));
      votes.push({
        sequencer: signer.address,
        signature,
        blockNumber: proposal.blockNumber
      });
      
      if (votes.length >= requiredVotes) break;
    }
    
    return votes;
  }

  verifyVotes(proposal: BlockProposal, votes: Vote[]): boolean {
    const requiredVotes = Math.ceil(this.sequencers.length * this.requiredVoteRatio);
    if (votes.length < requiredVotes) return false;
    
    const messageHash = ethers.solidityPackedKeccak256(
      ['uint256', 'bytes32', 'bytes32', 'uint256'],
      [proposal.blockNumber, proposal.stateRoot, proposal.parentHash, proposal.timestamp]
    );
    
    const validVotes = new Set<string>();
    for (const vote of votes) {
      const recovered = ethers.verifyMessage(ethers.getBytes(messageHash), vote.signature);
      if (recovered.toLowerCase() === vote.sequencer.toLowerCase()) {
        validVotes.add(vote.sequencer.toLowerCase());
      }
    }
    
    return validVotes.size >= requiredVotes;
  }

  async finalizeBlock(proposal: BlockProposal, votes: Vote[]): Promise<{ stateRoot: string; signatures: string[] }> {
    const seq = this.sequencers.find(s => s.address === proposal.sequencer);
    if (seq) seq.lastBlock = proposal.blockNumber;
    
    console.log(`Block ${proposal.blockNumber} finalized by ${proposal.sequencer.slice(0, 10)}... with ${votes.length} votes`);
    
    return {
      stateRoot: proposal.stateRoot,
      signatures: votes.map(v => v.signature)
    };
  }

  async collectVotesSimulated(proposal: BlockProposal): Promise<boolean> {
    const requiredVotes = Math.ceil(this.sequencers.length * this.requiredVoteRatio);
    const simulatedVotes = this.sequencers.length;
    console.log(`Simulated ${simulatedVotes}/${requiredVotes} votes for block ${proposal.blockNumber}`);
    return simulatedVotes >= requiredVotes;
  }

  getHeight(): number { return this.height; }
  getLeader(): string | null { return this.leader; }
  getSequencerCount(): number { return this.sequencers.length; }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    await this.loadSequencers();
    this.pollInterval = setInterval(() => this.loadSequencers().catch(console.error), 10000);
    this.runBlockProduction();
  }

  stop(): void {
    this.isRunning = false;
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  private async runBlockProduction(): Promise<void> {
    let parentHash = ethers.ZeroHash;
    
    while (this.isRunning) {
      if (this.sequencers.length === 0) {
        console.log('Waiting for sequencers...');
        await this.sleep(this.blockInterval);
        continue;
      }
      
      const proposal = await this.proposeBlock(parentHash);
      const hasConsensus = await this.collectVotesSimulated(proposal);
      
      if (hasConsensus) {
        const result = await this.finalizeBlock(proposal, []);
        parentHash = ethers.keccak256(ethers.toUtf8Bytes(result.stateRoot));
      } else {
        console.log(`Block ${proposal.blockNumber} failed consensus, retrying...`);
        this.round++;
      }
      
      await this.sleep(this.blockInterval);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
