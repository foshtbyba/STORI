import type { NextConfig } from 'next';

const config: NextConfig = {
  // Standalone puts the server and only the deps it actually uses into
  // .next/standalone, which is what the Docker image copies.
  output: 'standalone',
  experimental: { typedRoutes: false },
};

export default config;
