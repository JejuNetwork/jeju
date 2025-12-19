import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/lib/**',
      '**/.next/**',
      '**/.cache/**',
      '**/.turbo/**',
      '**/coverage/**',
      'vendor/**',
      '8004/**',
      'packages/contracts/**',
      'packages/deployment/kubernetes/**',
      'packages/deployment/terraform/**',
      'packages/deployment/kurtosis/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/playwright.config.ts',
      '**/synpress.config.ts',
      '**/vite.config.ts',
      '**/next.config.js',
      '**/postcss.config.js',
      '**/tailwind.config.js',
    ],
  },
  // Base JS recommended rules
  js.configs.recommended,
  // TypeScript recommended rules
  ...tseslint.configs.recommended,
  // TypeScript strict rules
  ...tseslint.configs.strict,
  // Main config for all TS files
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        Bun: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        ReadableStream: 'readonly',
        WritableStream: 'readonly',
        TransformStream: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        crypto: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
      },
    },
    rules: {
      // Enforce no any - this is the key rule per your requirements
      '@typescript-eslint/no-explicit-any': 'error',
      // Also catch unsafe any usage
      '@typescript-eslint/no-unsafe-assignment': 'off', // Would require type-aware linting
      '@typescript-eslint/no-unsafe-member-access': 'off', // Would require type-aware linting
      '@typescript-eslint/no-unsafe-call': 'off', // Would require type-aware linting
      '@typescript-eslint/no-unsafe-return': 'off', // Would require type-aware linting
      // Unused vars - allow underscore prefix
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Other strict rules
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'off', // Requires type-aware
      '@typescript-eslint/prefer-optional-chain': 'off', // Requires type-aware
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': false,
          'ts-nocheck': false,
        },
      ],
      // General rules
      'no-console': 'off',
      'no-debugger': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  // React-specific rules for TSX files
  {
    files: ['**/*.tsx'],
    rules: {
      // Allow any in event handlers which often have complex types
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  // Test files - slightly relaxed
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn', // Relax for tests
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  }
);

