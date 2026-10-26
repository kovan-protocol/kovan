import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["127.0.0.1"],
  // The hosted signing page is a static build in public/sign (signer/scripts/build-vercel.mjs).
  async rewrites() {
    return [
      { source: "/sign", destination: "/sign/index.html" },
      { source: "/setup", destination: "/sign/setup.html" },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
