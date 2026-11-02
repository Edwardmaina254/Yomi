import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  // Allow network access for mobile testing
  allowedDevOrigins: [
    "192.168.2.5:3000",
    "192.168.2.5",
    "localhost:3000"
  ],
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/(.*)\\.(ico|png|svg|jpg|jpeg|webp|woff|woff2)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2592000, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`, // Proxy to backend dynamically
      },
    ];
  },
};

export default nextConfig;
