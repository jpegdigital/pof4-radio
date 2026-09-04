import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-native libs stay out of the server bundle.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
