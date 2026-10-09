import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow network access for mobile testing
  allowedDevOrigins: [
    "192.168.2.5:3000",
    "192.168.2.5",
    "localhost:3000"
  ],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:5000/api/:path*", // Proxy to backend
      },
    ];
  },
};

export default nextConfig;
