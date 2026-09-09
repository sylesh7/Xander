// @ts-check
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Non-negotiable rule #2 (Section 0.2): env is read in exactly one place.
      // src/config/env.ts opts out of this via the override below.
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Read config from src/config/env.ts instead. env.ts is the only file permitted to touch process.env (Backend-Suganthan.md Section 0.2).',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/config/env.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    // Build-tool config, not application code — the rule exists to keep every
    // *request-serving* code path reading through the validated env.ts schema.
    // vitest.config.ts reads process.env once, at config-load time, only to let
    // a real credential loaded via `node --env-file=.env` (npm run test:live)
    // take precedence over the fixed test placeholder below it.
    files: ['vitest.config.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    // Plain Node scripts outside the TS project (e.g. scripts/substreams-pack.mjs)
    // get no type-aware globals from tsconfig, so ESLint's no-undef otherwise
    // flags `process`, `URL`, etc. as unrecognized.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
)
