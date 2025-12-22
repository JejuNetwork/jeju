declare module 'croner' {
  export interface CronOptions {
    maxRuns?: number;
    catch?: boolean | ((error: Error, job: Cron) => void);
    timezone?: string;
    startAt?: Date | string;
    stopAt?: Date | string;
    interval?: number;
    paused?: boolean;
    context?: unknown;
    protect?: boolean | ((job: Cron) => void);
    unref?: boolean;
  }

  export class Cron {
    constructor(
      pattern: string,
      options?: CronOptions | ((job: Cron) => void | Promise<void>),
      func?: (job: Cron) => void | Promise<void>
    );
    
    nextRun(prev?: Date): Date | null;
    nextRuns(n: number, prev?: Date): Date[];
    msToNext(prev?: Date): number | null;
    currentRun(): Date | null;
    previousRun(): Date | null;
    isRunning(): boolean;
    isStopped(): boolean;
    isBusy(): boolean;
    pause(): boolean;
    resume(): boolean;
    stop(): void;
    trigger(): Promise<void>;
    
    readonly name: string | undefined;
    readonly options: CronOptions;
    readonly pattern: string;
  }
}
