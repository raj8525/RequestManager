import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // The public intranet-tunnel address reaches the local application
      // through a different Host header from the browser-visible origin.
      allowedOrigins: ["8.219.147.218:13001"],
    },
  },
};

export default nextConfig;
