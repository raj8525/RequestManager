import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // The public intranet-tunnel address reaches the local application
      // through a different Host header from the browser-visible origin.
      allowedOrigins: ["47.121.188.131:13001"],
    },
  },
};

export default nextConfig;
