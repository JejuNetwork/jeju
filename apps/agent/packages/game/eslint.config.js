import rootConfig from '../../eslint.config.js';

/**
 * ESLint configuration for @elizaos/game
 * Extends root config with Cypress-specific globals and rules
 */
export default [
  ...rootConfig,
  {
    files: ['**/*.{js,ts,tsx}'],
    languageOptions: {
      globals: {
        // Browser/DOM APIs that are missing from root config
        MessageEvent: 'readonly',
        CustomEvent: 'readonly',
        crypto: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        DataTransfer: 'readonly',
        chai: 'readonly',
      },
    },
  },
  {
    files: ['**/cypress/**/*.{js,ts,tsx}', '**/*.cy.{js,ts,tsx}'],
    languageOptions: {
      globals: {
        // Cypress globals
        cy: 'readonly',
        Cypress: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        context: 'readonly',
        it: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
      },
    },
    rules: {
      // Cypress tests often have different patterns
      'no-unused-expressions': 'off', // Cypress assertions look like unused expressions
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
];
