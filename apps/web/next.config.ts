import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: {},
  // The planner engine ships as TypeScript source shared with the native app.
  transpilePackages: ['@events/planner'],
  typescript: {
    // Type errors are caught in CI lint step; don't block production builds
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false }
    return config
  },
}

export default nextConfig
