import { defineConfig } from 'oxlint';

export default defineConfig({
  plugins: ['typescript', 'eslint', 'react', 'react-perf', 'import'],
  categories: {
    correctness: 'error',
  },
  ignorePatterns: ['dist/**', 'node_modules/**'],
  rules: {
    'eslint/no-unused-vars': [
      'error',
      {
        args: 'all',
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
  },
});
