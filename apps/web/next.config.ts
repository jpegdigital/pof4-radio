import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-native libs stay out of the server bundle.
  serverExternalPackages: ["pg", "handlebars"],
  // Prompt prose is a runtime asset used by the server and included in deployments.
  outputFileTracingIncludes: { "/api/*": ["./prompts/*.prompt"] },
};

export default nextConfig;
