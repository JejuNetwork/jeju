import pluginConfig from '../config/src/eslint/eslint.config.plugin.js';

/**
 * ESLint configuration for @elizaos/plugin-todo
 * Uses the standardized plugin configuration from core/configs
 *
 * This is a todo management plugin with React frontend components.
 */
export default [
  ...pluginConfig,
  {
    // Todo plugin specific overrides
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: {
      // Allow flexibility for todo data structures
      '@typescript-eslint/no-explicit-any': 'off', // Aligned with project-wide settings
      'no-console': 'off', // Allow console for todo operations
    },
  },
];
