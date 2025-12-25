/**
 * Seeded Random Number Generator
 *
 * Provides deterministic random number generation for reproducible benchmarks.
 * @packageDocumentation
 */

/**
 * Seeded random number generator for reproducibility
 * Exported for use by other components (e.g., MarketMoverAgent)
 */
export class SeededRandom {
  private seed: number

  constructor(seed: number) {
    this.seed = seed
  }

  /**
   * Generate next random number (0-1)
   */
  next(): number {
    // Linear congruential generator
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296
    return this.seed / 4294967296
  }

  /**
   * Generate a random integer in the range [min, max] (inclusive)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  /**
   * Generate a random float in the range [min, max]
   */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /**
   * Pick a random element from an array
   * @throws Error if array is empty
   */
  pick<T>(array: readonly T[]): T {
    if (array.length === 0) {
      throw new Error('Cannot pick from empty array')
    }
    const index = Math.floor(this.next() * array.length)
    // Safe because we checked length > 0
    return array[index] as T
  }

  /**
   * Shuffle an array in place using Fisher-Yates algorithm
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const temp = array[i]
      array[i] = array[j]!
      array[j] = temp!
    }
    return array
  }

  /**
   * Get a boolean with given probability of being true
   */
  boolean(probability = 0.5): boolean {
    return this.next() < probability
  }

  /**
   * Generate a random gaussian/normal distributed number
   * Uses Box-Muller transform
   */
  gaussian(mean = 0, stdDev = 1): number {
    const u1 = this.next()
    const u2 = this.next()
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return z0 * stdDev + mean
  }

  /**
   * Get the current seed value
   */
  getSeed(): number {
    return this.seed
  }

  /**
   * Reset with a new seed
   */
  setSeed(seed: number): void {
    this.seed = seed
  }
}
