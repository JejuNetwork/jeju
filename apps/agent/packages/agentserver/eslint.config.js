import {
  baseConfig,
  testOverrides,
  standardIgnores,
} from '../config/src/eslint/eslint.config.base.js';

/**
 * ESLint configuration for @elizaos/agentserver
 * Extends the base config with agentserver-specific overrides
 */
export default [
  ...baseConfig,
  testOverrides,
  {
    ignores: [
      ...standardIgnores,
      // Agentserver specific ignores (from .eslintignore)
      'dist/',
      'dist-backend/',
      'dist-binaries/',
      'node_modules/',
      '*.log',
      'coverage/',
      '.turbo/',
    ],
  },
  {
    // Agentserver specific overrides
    files: ['**/*.{js,ts,tsx}'],
    rules: {
      // Server code may need flexible typing for various integrations
      '@typescript-eslint/no-explicit-any': 'off',
      // Server logs are important for debugging
      'no-console': 'off',
    },
  },
];
