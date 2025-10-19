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
  status: 'pending' | 'running' | 'finished';
  winner: number | null;
  startTime: Date | null;
  endTime: Date | null;
}

export const HORSES: Horse[] = [
  { id: 1, name: 'Thunder', color: '#ef4444' },
  { id: 2, name: 'Lightning', color: '#3b82f6' },
  { id: 3, name: 'Storm', color: '#10b981' },
  { id: 4, name: 'Blaze', color: '#f59e0b' }
];

export class RaceEngine {
  private currentRace: Race | null = null;
  private raceHistory: Race[] = [];
  private raceTimer: NodeJS.Timeout | null = null;
  private readonly RACE_DURATION_MS = 60000; // 1 minute per race
  private predeterminedWinner: number | null = null;
  private onRaceStart?: (raceId: string, predeterminedWinner: number) => Promise<void>;
  private onRaceFinish?: (raceId: string, winner: number) => Promise<void>;

  constructor() {
    this.startNewRace();
  }

  setRaceCallbacks(
    onStart?: (raceId: string, predeterminedWinner: number) => Promise<void>,
    onFinish?: (raceId: string, winner: number) => Promise<void>
  ): void {
    this.onRaceStart = onStart;
    this.onRaceFinish = onFinish;
  }

  startNewRace(): Race {
    if (this.raceTimer) {
      clearTimeout(this.raceTimer);
    }

    const raceId = `race-${Date.now()}`;
    
    // Pre-determine winner for oracle commitment
    this.predeterminedWinner = Math.floor(Math.random() * 4) + 1;
    
    this.currentRace = {
      id: raceId,
      horses: HORSES,
      status: 'pending',
      winner: null,
      startTime: null,
      endTime: null
    };

    console.log(`🐴 New race created: ${raceId}`);
    console.log(`🎲 Predetermined winner: ${HORSES.find(h => h.id === this.predeterminedWinner)?.name} (kept secret)`);
    
    // Auto-start race after 30 seconds
    setTimeout(() => this.runRace(), 30000);

    return this.currentRace;
  }

  private async runRace(): Promise<void> {
    if (!this.currentRace || !this.predeterminedWinner) return;

    this.currentRace.status = 'running';
    this.currentRace.startTime = new Date();

    console.log(`🏁 Race ${this.currentRace.id} started!`);

    // Call oracle commit callback
    if (this.onRaceStart) {
      await this.onRaceStart(this.currentRace.id, this.predeterminedWinner);
    }

    // Race finishes after RACE_DURATION_MS
    this.raceTimer = setTimeout(() => {
      this.finishRace();
    }, this.RACE_DURATION_MS);
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

    // Call oracle reveal callback
    if (this.onRaceFinish) {
      await this.onRaceFinish(this.currentRace.id, winner);
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
  }
}

