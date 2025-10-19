import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        global: 'readonly',
        globalThis: 'readonly',
        exports: 'writable',
        window: 'readonly',
        document: 'readonly',
        // Node.js globals
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',

        // Web APIs available in both browser and Node.js
        FormData: 'readonly',
        File: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',

        // DOM globals for React components
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLTableElement: 'readonly',
        HTMLTableSectionElement: 'readonly',
        HTMLTableRowElement: 'readonly',
        HTMLTableCellElement: 'readonly',
        HTMLTableCaptionElement: 'readonly',
        Element: 'readonly',
        Document: 'readonly',

        // Event types
        PointerEvent: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        Event: 'readonly',
        EventTarget: 'readonly',

        // Canvas and WebGL
        CanvasRenderingContext2D: 'readonly',
        WebGLRenderingContext: 'readonly',
        WebGL2RenderingContext: 'readonly',

        // SVG
        SVGElement: 'readonly',
        SVGSVGElement: 'readonly',

        // Other DOM APIs
        ScrollBehavior: 'readonly',
        MutationObserver: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',

        // Media APIs
        ImageData: 'readonly',
        DOMRect: 'readonly',
        FileReader: 'readonly',

        // Browser APIs
        navigator: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        indexedDB: 'readonly',
        caches: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        speechSynthesis: 'readonly',
        SpeechSynthesisUtterance: 'readonly',
        WebSocket: 'readonly',
        MediaStream: 'readonly',
        AudioContext: 'readonly',
        MediaRecorder: 'readonly',
        MediaStreamTrack: 'readonly',
        RequestInit: 'readonly',
        HTMLParagraphElement: 'readonly',
        HTMLHeadingElement: 'readonly',

        // Arrays and Buffers
        ArrayBuffer: 'readonly',
        Uint8Array: 'readonly',
        Float32Array: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        NodeJS: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        Bun: 'readonly',
        Response: 'readonly',
        BufferEncoding: 'readonly',
        React: 'readonly',

        // Test framework globals
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
        vitest: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
    },
    rules: {
      // TypeScript specific rules - relaxed for large legacy codebase
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off', // Too noisy for legacy codebase
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',

      // General JavaScript/TypeScript rules
      'no-unused-vars': 'off', // Use TypeScript version instead
      'no-console': 'off',
      'no-debugger': 'error',
      'no-alert': 'warn', // Allow confirm() etc in frontends
      'no-var': 'error',
      'prefer-const': 'warn', // Not critical
      'prefer-arrow-callback': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',

      // Remove all formatting-related rules that conflict with Prettier
      // These are now handled by Prettier

      // Import/Export rules
      'no-duplicate-imports': 'off', // Common in large codebases

      // Best practices
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-return-assign': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unused-expressions': 'error',
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'prefer-promise-reject-errors': 'error',
      radix: 'warn', // Common to omit radix for base 10
      yoda: 'warn',

      // Relax some patterns common in this codebase
      'no-useless-catch': 'warn',
      'no-fallthrough': 'warn',
      'no-case-declarations': 'off',
      'no-control-regex': 'warn',
      'no-useless-escape': 'off',
      'no-empty': 'warn', // Sometimes empty blocks are intentional
      'no-unreachable': 'warn', // Sometimes intentional for debugging
    },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    rules: {
      // React specific rules can be added here
      // Remove jsx-quotes as it's a formatting rule handled by Prettier
    },
  },
  {
    files: [
      '**/*.test.{js,ts,tsx}',
      '**/*.spec.{js,ts,tsx}',
      '**/__tests__/**/*',
      '**/test-utils/**/*',
      '**/tests/**/*',
    ],
    rules: {
      // Relax rules for test files - they often have different patterns
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
      'no-undef': 'off',
      'no-duplicate-imports': 'off',
      'no-useless-catch': 'off',
      'no-fallthrough': 'off',
      'no-case-declarations': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['**/packages/hyperfy/**/*.{js,ts,tsx,jsx}'],
    languageOptions: {
      globals: {
        React: 'readonly',
        world: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off', // TypeScript handles type checking
      '@typescript-eslint/no-explicit-any': 'off',
      'react/react-in-jsx-scope': 'off',
    },
  },
  // Apply prettier config last to override any formatting rules
  prettierConfig,
  {
    ignores: [
      // Dependencies and package managers
      '**/node_modules/',
      'node_modules/**',
      '.pnp',
      '.pnp.js',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'bun.lockb',

      // Build outputs and generated files
      '**/dist/',
      '**/build/',
      '**/out/',
      '**/.next/',
      '**/.nuxt/',
      '**/.output/',
      '**/coverage/',
      '**/.turbo/',
      '**/.*cache*/',
      '**/.cache/',
      '**/.temp/',
      '**/.tmp/',
      '**/tmp/',
      '**/temp/',
      '*.tsbuildinfo',
      '**/*.tsbuildinfo',

      // Minified and compiled files
      '**/*.min.js',
      '**/*.min.css',
      '**/*.bundle.js',
      '**/*.chunk.js',
      '**/*.map',

      // Static assets and public directories
      '**/public/',
      '**/static/',
      '**/assets/',

      // Environment and config files
      '.env*',
      '!.env.example',
      '**/rollup.config.*',
      '**/tsconfig*.json',

      // IDE and editor files
      '**/.vscode/',
      '**/.idea/',
      '**/*.swp',
      '**/*.swo',
      '**/.vim/',

      // OS files
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/desktop.ini',

      // Version control
      '**/.git/',
      '**/.svn/',
      '**/.hg/',

      // Logs and debugging
      '**/*.log',
      '**/logs/',
      '**/.nyc_output/',

      // Test artifacts
      '**/cypress/screenshots/',
      '**/cypress/videos/',
      '**/test-results/',
      '**/playwright-report/',
      '**/__screenshots__/',

      // Database files
      '**/*.db',
      '**/*.sqlite',
      '**/*.sqlite3',

      // Archive files
      '**/*.zip',
      '**/*.tar.gz',
      '**/*.rar',
      '**/*.7z',

      // Binary files
      '**/*.exe',
      '**/*.dll',
      '**/*.so',
      '**/*.dylib',
      '**/*.bin',

      // Documentation build outputs
      '**/docs/.vitepress/dist/',
      '**/docs/.vitepress/cache/',
      '**/storybook-static/',

      // Docker and container files
      'Dockerfile*',
      'docker-compose*.yml',
      'docker-compose*.yaml',
      '.dockerignore',

      // CI/CD and automation
      '**/.circleci/',
      '**/.travis.yml',
      '**/.appveyor.yml',
      '**/jenkins*',

      // Additional large directories and files
      '**/packages/**/*.md',
      '**/docker',
      '**/docker/**',
      '**/components.json',
      '**/bunfig.toml',
      '**/analyze-errors.cjs',
      '**/debug-*.js',
      '**/*.debug.js',
      '**/*.config.json',

      // Misc
      '**/.*rc.js',
      '**/.*rc.json',
      '**/.*rc.yml',
      '**/.*rc.yaml',
    ],
  },
];
