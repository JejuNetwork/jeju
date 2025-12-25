/**
 * Template Loader
 *
 * Loads agent templates from files and registry.
 *
 * @packageDocumentation
 */

import { logger } from '@jejunetwork/shared'
import type { AgentTemplate } from '../types'
import { AGENT_TEMPLATES } from './archetypes'

/**
 * Template Loader
 */
export class TemplateLoader {
  private customTemplates: Map<string, AgentTemplate> = new Map()

  /**
   * Load a template by name
   */
  async load(name: string): Promise<AgentTemplate | null> {
    // Check custom templates first
    const custom = this.customTemplates.get(name.toLowerCase())
    if (custom) return custom

    // Check built-in templates
    const builtin = AGENT_TEMPLATES[name.toLowerCase()]
    if (builtin) return builtin

    logger.warn('Template not found', { name })
    return null
  }

  /**
   * Register a custom template
   */
  register(template: AgentTemplate): void {
    this.customTemplates.set(template.archetype.toLowerCase(), template)
    logger.debug('Custom template registered', { archetype: template.archetype })
  }

  /**
   * List all available templates
   */
  list(): string[] {
    const builtinNames = Object.keys(AGENT_TEMPLATES)
    const customNames = Array.from(this.customTemplates.keys())
    return [...new Set([...builtinNames, ...customNames])]
  }

  /**
   * Check if template exists
   */
  has(name: string): boolean {
    const normalized = name.toLowerCase()
    return (
      this.customTemplates.has(normalized) ||
      normalized in AGENT_TEMPLATES
    )
  }

  /**
   * Clear custom templates
   */
  clearCustom(): void {
    this.customTemplates.clear()
  }
}

/** Singleton instance */
export const templateLoader = new TemplateLoader()
