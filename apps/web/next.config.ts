import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-native libs stay out of the server bundle.
  serverExternalPackages: ["pg", "handlebars"],
  // Prose and structured questions are runtime assets included in deployments.
  outputFileTracingIncludes: { "/api/*": ["./prompts/*.prompt", "./prompts/*.jev.json"] },
};

export default nextConfig;
