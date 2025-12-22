declare module 'croner' {
  export interface CronOptions<TContext = Record<string, never>> {
    maxRuns?: number
    catch?: boolean | ((error: Error, job: Cron<TContext>) => void)
    timezone?: string
    startAt?: Date | string
    stopAt?: Date | string
    interval?: number
    paused?: boolean
    context?: TContext
    protect?: boolean | ((job: Cron<TContext>) => void)
    unref?: boolean
  }

  export class Cron<TContext = Record<string, never>> {
    constructor(
      pattern: string,
      options?:
        | CronOptions<TContext>
        | ((job: Cron<TContext>) => void | Promise<void>),
      func?: (job: Cron<TContext>) => void | Promise<void>,
    )

    nextRun(prev?: Date): Date | null
    nextRuns(n: number, prev?: Date): Date[]
    msToNext(prev?: Date): number | null
    currentRun(): Date | null
    previousRun(): Date | null
    isRunning(): boolean
    isStopped(): boolean
    isBusy(): boolean
    pause(): boolean
    resume(): boolean
    stop(): void
    trigger(): Promise<void>

    readonly name: string | undefined
    readonly options: CronOptions<TContext>
    readonly pattern: string
  }
}
