import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; let Next compile them.
  transpilePackages: ["@radio/db", "@radio/spotify"],
  // Node-native libs stay out of the server bundle.
  serverExternalPackages: ["pg", "pg-boss"],
};

export default nextConfig;
