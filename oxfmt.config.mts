import { defineConfig } from 'oxfmt';

export default defineConfig({
  trailingComma: 'es5',
  tabWidth: 2,
  semi: true,
  singleQuote: true,
  jsxSingleQuote: false,
  printWidth: 100,
  sortPackageJson: true,
  sortTailwindcss: true,
  sortImports: true,
  ignorePatterns: [
    // dependencies
    '/node_modules',
    '/.pnp',
    '.pnp.*',
    '.yarn/*',
    '!.yarn/patches',
    '!.yarn/plugins',
    '!.yarn/releases',
    '!.yarn/versions',

    // testing
    '/coverage',

    // production
    '/dist',

    // misc
    '.DS_Store',
    '*.pem',

    // debug
    'npm-debug.log*',
    'yarn-debug.log*',
    'yarn-error.log*',
    '.pnpm-debug.log*',

    // env files
    '.env*',

    // vercel
    '.vercel',

    // typescript
    '*.tsbuildinfo',
    'next-env.d.ts',

    // agents
    '.agents',
  ],
});
