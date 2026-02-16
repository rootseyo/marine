import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  async rewrites() {
    return [
      {
        source: '/api/admin/:path*',
        destination: `${process.env.API_BASE_URL}/api/admin/:path*`,
      },
    ];
  },
};

export default nextConfig;
