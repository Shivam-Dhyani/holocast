/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';

const nextConfig = {
  reactStrictMode: true,
  // In production, Caddy serves /api/* and /* under one origin (TDD §3.3).
  // In dev, proxy /api to the Express API so the app is same-origin.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
