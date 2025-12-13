/** Web-of-Trust Moderation */

import { keccak256, toUtf8Bytes } from 'ethers';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export enum FlagType { DUPLICATE = 'DUPLICATE', SPAM = 'SPAM', HARMFUL = 'HARMFUL', INFEASIBLE = 'INFEASIBLE', MISALIGNED = 'MISALIGNED', LOW_QUALITY = 'LOW_QUALITY', NEEDS_WORK = 'NEEDS_WORK' }

export interface ProposalFlag {
  flagId: string; proposalId: string; flagger: string; flagType: FlagType;
  reason: string; evidence?: string; stake: number; reputation: number;
  upvotes: number; downvotes: number; createdAt: number;
  resolved: boolean; resolution?: 'UPHELD' | 'REJECTED';
}

export interface TrustRelation { from: string; to: string; score: number; context: 'MODERATION' | 'PROPOSAL' | 'VOTING' | 'GENERAL'; updatedAt: number }
export interface ModerationScore { proposalId: string; visibilityScore: number; flags: ProposalFlag[]; trustWeightedFlags: number; recommendation: 'VISIBLE' | 'REVIEW' | 'HIDDEN' }
export interface ModeratorStats { address: string; flagsRaised: number; flagsUpheld: number; flagsRejected: number; accuracy: number; reputation: number; trustScore: number }

// Bounded stores with file persistence
const MAX_FLAGS = 10000, MAX_MODS = 5000;
const evict = <K, V>(m: Map<K, V>, max: number) => { if (m.size >= max) { const f = m.keys().next().value; if (f !== undefined) m.delete(f); } };

const flags = new Map<string, ProposalFlag>();
const trust = new Map<string, Map<string, TrustRelation>>();
const stats = new Map<string, ModeratorStats>();
const scores = new Map<string, ModerationScore>();

const STAKE: Record<FlagType, number> = { DUPLICATE: 10, SPAM: 5, HARMFUL: 50, INFEASIBLE: 20, MISALIGNED: 30, LOW_QUALITY: 10, NEEDS_WORK: 5 };
const WEIGHT: Record<FlagType, number> = { DUPLICATE: 30, SPAM: 50, HARMFUL: 100, INFEASIBLE: 25, MISALIGNED: 40, LOW_QUALITY: 15, NEEDS_WORK: 10 };

// File persistence
const storageDir = join(process.cwd(), '.council-storage');
const FILES = { flags: 'moderation-flags.json', stats: 'moderation-stats.json', trust: 'moderation-trust.json' };
let dirty = false;

async function ensureDir() { if (!existsSync(storageDir)) await mkdir(storageDir, { recursive: true }); }

async function save(): Promise<void> {
  if (!dirty) return;
  await ensureDir();
  await Promise.all([
    writeFile(join(storageDir, FILES.flags), JSON.stringify([...flags.entries()])),
    writeFile(join(storageDir, FILES.stats), JSON.stringify([...stats.entries()])),
    writeFile(join(storageDir, FILES.trust), JSON.stringify([...trust.entries()].map(([k, v]) => [k, [...v.entries()]]))),
  ]);
  dirty = false;
}

async function load(): Promise<void> {
  await ensureDir();
  try {
    const flagsPath = join(storageDir, FILES.flags);
    if (existsSync(flagsPath)) {
      const data = JSON.parse(await readFile(flagsPath, 'utf-8')) as [string, ProposalFlag][];
      for (const [k, v] of data) flags.set(k, v);
    }
    const statsPath = join(storageDir, FILES.stats);
    if (existsSync(statsPath)) {
      const data = JSON.parse(await readFile(statsPath, 'utf-8')) as [string, ModeratorStats][];
      for (const [k, v] of data) stats.set(k, v);
    }
    const trustPath = join(storageDir, FILES.trust);
    if (existsSync(trustPath)) {
      const data = JSON.parse(await readFile(trustPath, 'utf-8')) as [string, [string, TrustRelation][]][];
      for (const [k, v] of data) trust.set(k, new Map(v));
    }
  } catch (e) {
    console.error('[Moderation] Failed to load persisted data:', e);
  }
}

// Auto-save every 30s if dirty
setInterval(() => { save().catch(console.error); }, 30000);

export class ModerationSystem {
  async init(): Promise<void> { await load(); }

  submitFlag(proposalId: string, flagger: string, flagType: FlagType, reason: string, stake: number, evidence?: string): ProposalFlag {
    if (stake < STAKE[flagType]) throw new Error(`Minimum stake for ${flagType} is ${STAKE[flagType]}`);

    const s = this.getModeratorStats(flagger);
    const flagId = keccak256(toUtf8Bytes(`${proposalId}-${flagger}-${flagType}-${Date.now()}`)).slice(0, 18);
    const flag: ProposalFlag = { flagId, proposalId, flagger, flagType, reason, evidence, stake, reputation: s.reputation, upvotes: 0, downvotes: 0, createdAt: Date.now(), resolved: false };

    evict(flags, MAX_FLAGS);
    flags.set(flagId, flag);
    s.flagsRaised++;
    stats.set(flagger, s);
    this.updateScore(proposalId);
    dirty = true;
    return flag;
  }

  voteOnFlag(flagId: string, voter: string, upvote: boolean): void {
    const f = flags.get(flagId);
    if (!f || f.resolved) return;

    const weight = Math.max(1, Math.floor(this.getModeratorStats(voter).reputation / 10));
    upvote ? (f.upvotes += weight) : (f.downvotes += weight);
    flags.set(flagId, f);
    this.updateScore(f.proposalId);
    dirty = true;
  }

  resolveFlag(flagId: string, upheld: boolean): void {
    const f = flags.get(flagId);
    if (!f || f.resolved) return;

    f.resolved = true;
    f.resolution = upheld ? 'UPHELD' : 'REJECTED';
    flags.set(flagId, f);

    const s = this.getModeratorStats(f.flagger);
    const w = WEIGHT[f.flagType];

    if (upheld) { s.flagsUpheld++; s.reputation += w / 10; s.trustScore = Math.min(100, s.trustScore + 5); }
    else { s.flagsRejected++; s.reputation = Math.max(0, s.reputation - w / 20); s.trustScore = Math.max(0, s.trustScore - 3); }

    s.accuracy = (s.flagsUpheld / Math.max(1, s.flagsUpheld + s.flagsRejected)) * 100;
    evict(stats, MAX_MODS);
    stats.set(f.flagger, s);
    this.updateScore(f.proposalId);
    dirty = true;
  }

  getProposalModerationScore(proposalId: string): ModerationScore {
    return scores.get(proposalId) ?? { proposalId, visibilityScore: 100, flags: [], trustWeightedFlags: 0, recommendation: 'VISIBLE' };
  }

  private updateScore(proposalId: string): void {
    const active = [...flags.values()].filter(f => f.proposalId === proposalId && !f.resolved);

    const weighted = active.reduce((sum, f) => {
      const s = this.getModeratorStats(f.flagger);
      const tw = s.accuracy / 100;
      const vw = (f.upvotes - f.downvotes) / Math.max(1, f.upvotes + f.downvotes);
      return sum + WEIGHT[f.flagType] * tw * (1 + vw);
    }, 0);

    const vis = Math.max(0, 100 - weighted);
    const rec: ModerationScore['recommendation'] = vis < 30 ? 'HIDDEN' : vis < 70 ? 'REVIEW' : 'VISIBLE';
    scores.set(proposalId, { proposalId, visibilityScore: vis, flags: active, trustWeightedFlags: weighted, recommendation: rec });
  }

  getModeratorStats(address: string): ModeratorStats {
    return stats.get(address) ?? { address, flagsRaised: 0, flagsUpheld: 0, flagsRejected: 0, accuracy: 50, reputation: 10, trustScore: 50 };
  }

  setTrust(from: string, to: string, score: number, context: TrustRelation['context']): void {
    let g = trust.get(from);
    if (!g) { g = new Map(); trust.set(from, g); }
    g.set(to, { from, to, score: Math.max(-100, Math.min(100, score)), context, updatedAt: Date.now() });

    const s = this.getModeratorStats(to);
    s.trustScore = this.calcTrust(to);
    stats.set(to, s);
    dirty = true;
  }

  getTrust(from: string, to: string): number {
    return trust.get(from)?.get(to)?.score ?? 0;
  }

  private calcTrust(addr: string): number {
    let total = 0, count = 0;
    for (const [, rels] of trust) { const r = rels.get(addr); if (r) { total += r.score; count++; } }
    return count > 0 ? Math.round(50 + total / count / 2) : 50;
  }

  getProposalFlags(proposalId: string): ProposalFlag[] { return [...flags.values()].filter(f => f.proposalId === proposalId); }
  getActiveFlags(): ProposalFlag[] { return [...flags.values()].filter(f => !f.resolved); }
  getTopModerators(limit = 10): ModeratorStats[] { return [...stats.values()].sort((a, b) => b.reputation - a.reputation).slice(0, limit); }

  filterProposals<T extends { proposalId: string }>(proposals: T[], minVis = 30): T[] {
    return proposals.filter(p => this.getProposalModerationScore(p.proposalId).visibilityScore >= minVis);
  }

  shouldAutoReject(proposalId: string): { reject: boolean; reason?: string } {
    const s = this.getProposalModerationScore(proposalId);

    if (s.visibilityScore < 10) {
      const top = s.flags.sort((a, b) => WEIGHT[b.flagType] - WEIGHT[a.flagType])[0];
      return { reject: true, reason: top?.reason ?? 'Too many flags' };
    }
    if (s.flags.filter(f => f.flagType === FlagType.SPAM && f.upvotes > f.downvotes * 2).length >= 3) {
      return { reject: true, reason: 'Multiple spam flags' };
    }
    if (s.flags.some(f => f.flagType === FlagType.HARMFUL && f.upvotes > 10)) {
      return { reject: true, reason: 'Flagged harmful' };
    }
    return { reject: false };
  }

  async flush(): Promise<void> { dirty = true; await save(); }
}

let instance: ModerationSystem | null = null;
export const getModerationSystem = () => instance ??= new ModerationSystem();
export const initModeration = async () => { await getModerationSystem().init(); };
