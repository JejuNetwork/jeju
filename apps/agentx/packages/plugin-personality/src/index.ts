import type { Plugin, IAgentRuntime, Memory, CustomMetadata } from '@elizaos/core';
import { logger, MemoryType } from '@elizaos/core';

import { characterEvolutionEvaluator } from './evaluators/character-evolution';
import { modifyCharacterAction } from './actions/modify-character';
import { CharacterFileManager } from './services/character-file-manager';
/**
 * Self-Modification Plugin for ElizaOS
 *
 * Enables agents to evolve their character files over time through:
 * - Conversation analysis and learning
 * - User feedback integration
 * - Gradual personality development
 * - Safe character file management
 *
 * Features:
 * - CHARACTER_EVOLUTION evaluator: Analyzes conversations for evolution opportunities
 * - MODIFY_CHARACTER action: Handles direct character modifications
 * - CHARACTER_EVOLUTION provider: Supplies self-reflection context
 * - CharacterFileManager service: Manages safe file operations with backups
 */
export const selfModificationPlugin: Plugin = {
  name: '@elizaos/plugin-personality',
  description:
    'Enables agent self-modification and character evolution through conversation analysis and user feedback',

  // Core components
  evaluators: [characterEvolutionEvaluator],
  actions: [modifyCharacterAction],
  services: [CharacterFileManager],

  // Plugin configuration
  config: {
    // Evolution settings
    EVOLUTION_COOLDOWN_MS: 5 * 60 * 1000, // 5 minutes between evaluations
    MODIFICATION_CONFIDENCE_THRESHOLD: 0.7, // Minimum confidence for auto-modifications
    MAX_BIO_ELEMENTS: 20,
    MAX_TOPICS: 50,
    MAX_BACKUPS: 10,

    // Safety settings
    REQUIRE_ADMIN_APPROVAL: false, // Set to true in production
    ENABLE_AUTO_EVOLUTION: true,
    VALIDATE_MODIFICATIONS: true,

    // File management
    BACKUP_DIRECTORY: '.eliza/character-backups',
    CHARACTER_FILE_DETECTION: true,
  },

  async init(config: Record<string, string>, runtime: IAgentRuntime): Promise<void> {
    logger.info('Self-Modification Plugin initializing...');

    
      // Validate environment
      const characterFileManager =
        runtime.getService<CharacterFileManager>('character-file-manager');
      if (!characterFileManager) {
        logger.warn(
          'CharacterFileManager service not available - file modifications will be memory-only'
        );
      }

      // Log current character state
      const character = runtime.character;
      const characterStats = {
        name: character.name,
        bioElements: Array.isArray(character.bio) ? character.bio.length : 1,
        topics: character.topics?.length || 0,
        messageExamples: character.messageExamples?.length || 0,
        hasStyleConfig: !!(character.style?.all || character.style?.chat || character.style?.post),
        hasSystemPrompt: !!character.system,
      };

      logger.info('Current character state', characterStats);

      // Initialize evolution tracking using proper cache methods
      try {
        await runtime.setCache('self-modification:initialized', Date.now().toString());
        await runtime.setCache('self-modification:modification-count', '0');
        logger.info('Evolution tracking initialized');
      } catch (cacheError) {
        logger.warn('Cache initialization failed, continuing without cache', cacheError);
      }

      // Create proper initialization memory with correct structure
      try {
        // Store initialization state
        const initMemory: Memory = {
          entityId: runtime.agentId,
          roomId: runtime.agentId, // Using agentId as roomId for plugin initialization
          content: {
            text: `Self-modification plugin initialized. Character: ${characterStats.name}, Bio: ${characterStats.bioElements} elements, Topics: ${characterStats.topics}, System: ${characterStats.hasSystemPrompt ? 'present' : 'none'}`,
            source: 'plugin_initialization',
          },
          metadata: {
            type: MemoryType.CUSTOM,
            plugin: '@elizaos/plugin-personality',
            timestamp: Date.now(),
            characterBaseline: characterStats,
          } as CustomMetadata,
        };

        await runtime.createMemory(initMemory, 'plugin_events');
        logger.info('Plugin initialization memory created');
      } catch (memoryError) {
        logger.warn('Failed to create initialization memory, continuing', memoryError);
      }

      logger.info('Self-Modification Plugin initialized successfully', {
        evolutionEnabled: config.ENABLE_AUTO_EVOLUTION !== 'false',
        fileManagerAvailable: !!characterFileManager,
        confidenceThreshold: config.MODIFICATION_CONFIDENCE_THRESHOLD || '0.7',
        characterHasSystem: characterStats.hasSystemPrompt,
      });
    
  },
};

// Export individual components for testing
export { characterEvolutionEvaluator, modifyCharacterAction, CharacterFileManager };

// Default export
export default selfModificationPlugin;
