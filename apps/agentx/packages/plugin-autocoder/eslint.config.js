import pluginConfig from '../config/src/eslint/eslint.config.plugin.js';

/**
 * ESLint configuration for @elizaos/plugin-autocoder
 * Uses the standardized plugin configuration from config package
 */
export default [
  ...pluginConfig,
  {
    // Autocoder plugin specific overrides
    files: ['**/*.{js,ts,tsx}'],
    rules: {
      // Code generation tools need flexibility
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'no-eval': 'off', // Code generation may use eval
    },
  },
];
