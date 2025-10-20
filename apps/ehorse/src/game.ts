/**
 * eHorse Racing Game - Minimal Implementation
 * 4 horses race, 1 wins, agents predict the winner
 */

export interface Horse {
  id: number;
  name: string;
  color: string;
}

export interface Race {
  id: string;
  horses: Horse[];
  status: 'pending' | 'running' | 'grace-period' | 'finished';
  winner: number | null;
  startTime: Date | null;
  gracePeriodStart: Date | null;
  endTime: Date | null;
}

export const HORSES: Horse[] = [
  { id: 1, name: 'Thunder', color: '#ef4444' },
  { id: 2, name: 'Lightning', color: '#3b82f6' },
  { id: 3, name: 'Storm', color: '#10b981' },
  { id: 4, name: 'Blaze', color: '#f59e0b' }
];

export interface RaceCallbacks {
  onAnnounce?: (raceId: string, predeterminedWinner: number) => Promise<void>;
  onStart?: (raceId: string) => Promise<void>;
  onGracePeriod?: (raceId: string) => Promise<void>;
  onFinish?: (raceId: string, winner: number) => Promise<void>;
}

export class RaceEngine {
  private currentRace: Race | null = null;
  private raceHistory: Race[] = [];
  private raceTimer: NodeJS.Timeout | null = null;
  private graceTimer: NodeJS.Timeout | null = null;
  private readonly RACE_DURATION_MS = 60000; // 1 minute per race
  private readonly GRACE_PERIOD_MS = 30000; // 30 seconds grace period
  private predeterminedWinner: number | null = null;
  private callbacks: RaceCallbacks = {};

  constructor() {
    // Don't start race yet - wait for callbacks to be set
  }

  setRaceCallbacks(callbacks: RaceCallbacks): void {
    this.callbacks = callbacks;
    // Start first race now that callbacks are configured
    if (!this.currentRace) {
      this.startNewRace();
    }
  }

  startNewRace(): Race {
    if (this.raceTimer) {
      clearTimeout(this.raceTimer);
    }
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
    }

    const raceId = `race-${Date.now()}`;
    
    // Pre-determine winner (TEE logic)
    this.predeterminedWinner = Math.floor(Math.random() * 4) + 1;
    
    this.currentRace = {
      id: raceId,
      horses: HORSES,
      status: 'pending',
      winner: null,
      startTime: null,
      gracePeriodStart: null,
      endTime: null
    };

    console.log(`🐴 New race created: ${raceId}`);
    console.log(`🎲 Predetermined winner: ${HORSES.find(h => h.id === this.predeterminedWinner)?.name} (kept secret in TEE)`);
    
    // Announce to Contest.sol (must complete before starting race)
    if (this.callbacks.onAnnounce && this.predeterminedWinner) {
      this.callbacks.onAnnounce(this.currentRace.id, this.predeterminedWinner)
        .then(() => {
          console.log('✅ Contest announced successfully, scheduling race start in 30s...');
          // Auto-start race after 30 seconds
          setTimeout(() => this.runRace(), 30000);
        })
        .catch(err => {
          console.error('❌ Failed to announce contest:', err.message);
          console.log('⚠️  Race cancelled - will create new one in 5s');
          setTimeout(() => this.startNewRace(), 5000);
        });
    } else {
      // No oracle, just start race normally
      console.log('⚠️  No oracle configured, starting race without on-chain announcement');
      setTimeout(() => this.runRace(), 30000);
    }

    return this.currentRace;
  }

  private async runRace(): Promise<void> {
    if (!this.currentRace || !this.predeterminedWinner) return;

    this.currentRace.status = 'running';
    this.currentRace.startTime = new Date();

    console.log(`🏁 Race ${this.currentRace.id} started!`);
    console.log(`   Trading ACTIVE for 60 seconds`);

    // Start contest on-chain (trading begins)
    if (this.callbacks.onStart) {
      await this.callbacks.onStart(this.currentRace.id);
    }

    // After race duration, start grace period
    this.raceTimer = setTimeout(() => {
      this.startGracePeriod();
    }, this.RACE_DURATION_MS);
  }

  private async startGracePeriod(): Promise<void> {
    if (!this.currentRace) return;

    this.currentRace.status = 'grace-period';
    this.currentRace.gracePeriodStart = new Date();

    console.log(`⏸️  Grace period started for race ${this.currentRace.id}`);
    console.log(`   Trading FROZEN for 30 seconds (prevents MEV)`);

    // Call grace period callback
    if (this.callbacks.onGracePeriod) {
      await this.callbacks.onGracePeriod(this.currentRace.id);
    }

    // After grace period, finalize results
    this.graceTimer = setTimeout(() => {
      this.finishRace();
    }, this.GRACE_PERIOD_MS);
  }

  private async finishRace(): Promise<void> {
    if (!this.currentRace || !this.predeterminedWinner) return;

    // Use predetermined winner
    const winner = this.predeterminedWinner;
    
    this.currentRace.status = 'finished';
    this.currentRace.winner = winner;
    this.currentRace.endTime = new Date();

    const winningHorse = HORSES.find(h => h.id === winner);
    console.log(`🏆 Race ${this.currentRace.id} finished! Winner: ${winningHorse?.name} (#${winner})`);
    console.log(`   Publishing results with TEE attestation...`);

    // Publish results to Contest.sol with TEE attestation
    if (this.callbacks.onFinish) {
      await this.callbacks.onFinish(this.currentRace.id, winner);
    }

    // Save to history
    this.raceHistory.push({ ...this.currentRace });
    this.predeterminedWinner = null;

    // Start new race after 10 seconds
    setTimeout(() => this.startNewRace(), 10000);
  }

  getCurrentRace(): Race | null {
    return this.currentRace;
  }

  getRaceHistory(): Race[] {
    return this.raceHistory;
  }

  getHorses(): Horse[] {
    return HORSES;
  }

  // Get race by ID (for oracle queries)
  getRaceById(raceId: string): Race | null {
    if (this.currentRace?.id === raceId) {
      return this.currentRace;
    }
    return this.raceHistory.find(r => r.id === raceId) || null;
  }

  stop(): void {
    if (this.raceTimer) {
      clearTimeout(this.raceTimer);
      this.raceTimer = null;
    }
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }
}

