import type { NextConfig } from 'next';

const config: NextConfig = {
  // Required at runtime by the dev-only database fallback, never bundled.
  serverExternalPackages: ['@electric-sql/pglite'],
  images: {
    // Product imagery is served from supplier CDNs, which vary by source.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  webpack: (config) => {
    // The engine uses NodeNext-style `./foo.js` imports so it can also run
    // directly under tsx as the CLI. Webpack needs to be told those resolve to
    // the TypeScript sources rather than rewriting every import in the engine.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default config;
