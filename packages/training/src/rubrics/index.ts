/**
 * Rubrics Registry for Jeju Training
 *
 * A centralized registry for LLM-as-judge rubrics used in RLAIF training.
 * Allows different environments (Babylon, custom games, etc.) to register
 * their scoring rubrics that can be used by the RULER scorer.
 *
 * @packageDocumentation
 */

// Types

/**
 * LLM Judge Rubric Definition
 *
 * Defines the criteria for scoring agent trajectories using LLM-as-judge.
 */
export interface JudgeRubric {
  /** Unique identifier for the rubric */
  id: string
  /** Human-readable name */
  name: string
  /** Description of what this rubric evaluates */
  description: string
  /** Full scoring criteria text for the LLM judge */
  criteria: string
  /** Priority metrics to extract from trajectories */
  priorityMetrics: string[]
  /** Optional version for cache invalidation */
  version?: string
}

/**
 * Rubric Registry Interface
 *
 * Allows registration and retrieval of rubrics at runtime.
 */
export interface RubricRegistry {
  /** Register a new rubric */
  registerRubric(rubric: JudgeRubric): void
  /** Get a rubric by ID */
  getRubric(id: string): JudgeRubric | null
  /** List all registered rubric IDs */
  listRubrics(): string[]
  /** Check if a rubric exists */
  hasRubric(id: string): boolean
  /** Unregister a rubric */
  unregisterRubric(id: string): boolean
  /** Clear all rubrics */
  clear(): void
}

// Default Rubric

/**
 * Default rubric for general agent evaluation
 */
export const DEFAULT_RUBRIC: JudgeRubric = {
  id: 'default',
  name: 'General Agent Evaluation',
  description: 'Default rubric for evaluating AI agent performance',
  criteria: `
## General Agent Evaluation

You are evaluating an AI agent's performance in a simulation environment.

### Scoring Criteria (0.0 to 1.0)
- **Task Completion**: Did the agent achieve its goals?
- **Efficiency**: Did the agent complete tasks with minimal unnecessary actions?
- **Decision Quality**: Were the agent's decisions well-reasoned?
- **Adaptability**: Did the agent handle unexpected situations well?

### Scoring Guidelines
- 0.8-1.0: Excellent performance, goals achieved efficiently
- 0.6-0.8: Good performance, goals mostly achieved
- 0.4-0.6: Average performance, mixed results
- 0.2-0.4: Below average, significant issues
- 0.0-0.2: Poor performance, goals not achieved

Compare trajectories RELATIVE to each other within the evaluation group.
Score differences should reflect meaningful performance gaps.
`,
  priorityMetrics: [
    'behavior.actionSuccessRate',
    'behavior.episodeLength',
    'behavior.goalCompletion',
  ],
  version: '1.0.0',
}

// Registry Implementation

/** Internal registry storage */
const registry = new Map<string, JudgeRubric>()

/** Registry change listeners */
type RegistryListener = (
  event: 'register' | 'unregister',
  rubricId: string,
) => void
const listeners: RegistryListener[] = []

/**
 * Register a new rubric in the global registry
 *
 * @param rubric - The rubric to register
 * @throws Error if a rubric with the same ID already exists
 */
export function registerRubric(rubric: JudgeRubric): void {
  if (registry.has(rubric.id)) {
    throw new Error(`Rubric with ID '${rubric.id}' already registered`)
  }

  registry.set(rubric.id, {
    ...rubric,
    version: rubric.version ?? '1.0.0',
  })

  for (const listener of listeners) {
    listener('register', rubric.id)
  }
}

/**
 * Register a rubric, overwriting if it already exists
 *
 * @param rubric - The rubric to register or update
 */
export function registerOrUpdateRubric(rubric: JudgeRubric): void {
  const isNew = !registry.has(rubric.id)

  registry.set(rubric.id, {
    ...rubric,
    version: rubric.version ?? '1.0.0',
  })

  if (isNew) {
    for (const listener of listeners) {
      listener('register', rubric.id)
    }
  }
}

/**
 * Get a rubric by ID
 *
 * @param id - Rubric ID to look up
 * @returns The rubric if found, or null
 */
export function getRubric(id: string): JudgeRubric | null {
  return registry.get(id) ?? null
}

/**
 * Get a rubric by ID, falling back to default if not found
 *
 * @param id - Rubric ID to look up
 * @returns The rubric if found, or the default rubric
 */
export function getRubricOrDefault(id: string): JudgeRubric {
  return registry.get(id) ?? DEFAULT_RUBRIC
}

/**
 * List all registered rubric IDs
 *
 * @returns Array of rubric IDs
 */
export function listRubrics(): string[] {
  return Array.from(registry.keys())
}

/**
 * Check if a rubric with the given ID exists
 *
 * @param id - Rubric ID to check
 * @returns True if the rubric exists
 */
export function hasRubric(id: string): boolean {
  return registry.has(id)
}

/**
 * Unregister a rubric by ID
 *
 * @param id - Rubric ID to remove
 * @returns True if the rubric was removed, false if it didn't exist
 */
export function unregisterRubric(id: string): boolean {
  const existed = registry.delete(id)

  if (existed) {
    for (const listener of listeners) {
      listener('unregister', id)
    }
  }

  return existed
}

/**
 * Clear all registered rubrics
 */
export function clearRubrics(): void {
  const ids = Array.from(registry.keys())
  registry.clear()

  for (const id of ids) {
    for (const listener of listeners) {
      listener('unregister', id)
    }
  }
}

/**
 * Add a listener for registry changes
 *
 * @param listener - Callback for registry changes
 * @returns Function to remove the listener
 */
export function onRubricChange(listener: RegistryListener): () => void {
  listeners.push(listener)
  return () => {
    const index = listeners.indexOf(listener)
    if (index >= 0) {
      listeners.splice(index, 1)
    }
  }
}

/**
 * Get the count of registered rubrics
 *
 * @returns Number of registered rubrics
 */
export function getRubricCount(): number {
  return registry.size
}

/**
 * Get all registered rubrics
 *
 * @returns Array of all registered rubrics
 */
export function getAllRubrics(): JudgeRubric[] {
  return Array.from(registry.values())
}

// Registry Object Export

/**
 * The global rubric registry instance
 *
 * Provides an object-oriented interface to the registry functions.
 */
export const rubricRegistry: RubricRegistry = {
  registerRubric,
  getRubric,
  listRubrics,
  hasRubric,
  unregisterRubric,
  clear: clearRubrics,
}

// Initialize Default Rubric

// Register the default rubric on module load
registerOrUpdateRubric(DEFAULT_RUBRIC)
