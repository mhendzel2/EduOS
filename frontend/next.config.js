/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    // Required when building as a static export (output:'export').
    // Has no effect in standalone/dev mode.
    unoptimized: true,
  },
  experimental: {
    webpackBuildWorker: false,
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8090',
  },
};

module.exports = nextConfig;
