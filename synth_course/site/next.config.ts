import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // In Docker on macOS (Colima/sshfs) file events don't reach the container, so
  // the dev server polls instead. Set by the Dockerfile; unset when run natively.
  watchOptions: process.env.NEXT_POLL_MS ? { pollIntervalMs: Number(process.env.NEXT_POLL_MS) } : undefined,
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
