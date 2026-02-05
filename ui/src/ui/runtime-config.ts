/**
 * Runtime configuration using Vite environment variables.
 * 
 * Environment files:
 * - .env.development  - Development mode (pnpm dev)
 * - .env.production   - Production build (pnpm build)
 * - .env.local        - Local overrides (git-ignored)
 * 
 * Variables must be prefixed with VITE_ to be exposed to client code.
 */

export interface RuntimeConfig {
  /** Gateway WebSocket URL (e.g., "ws://192.168.1.100:19001") */
  gatewayUrl: string;
  /** Cloud backend URL for SaaS auth (e.g., "http://localhost:8000") */
  cloudBackendUrl: string;
}

// Read from Vite env vars (injected at build/dev time)
const env = import.meta.env;

const config: RuntimeConfig = {
  gatewayUrl: (env.VITE_GATEWAY_URL as string) || "",
  cloudBackendUrl: (env.VITE_CLOUD_BACKEND_URL as string) || "",
};

// Log config in development
if (env.DEV) {
  console.log("[config] Environment config:", config);
}

/**
 * Resolve the default Gateway URL based on current location.
 */
function resolveDefaultGatewayUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const hostname = location.hostname;
  const port = location.port;
  
  // If running on non-standard port (dev server), use Gateway default port
  if (port && port !== "80" && port !== "443") {
    return `${proto}://${hostname}:19001`;
  }
  
  return `${proto}://${location.host}`;
}

/**
 * Load runtime configuration (synchronous - config is already loaded via env vars).
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  return config;
}

/**
 * Get the runtime config synchronously.
 */
export function getRuntimeConfig(): RuntimeConfig {
  return config;
}

/**
 * Get the effective Gateway URL.
 * Uses env var if set, otherwise falls back to auto-detection.
 */
export function getEffectiveGatewayUrl(): string {
  if (config.gatewayUrl) {
    return config.gatewayUrl;
  }
  return resolveDefaultGatewayUrl();
}

/**
 * Get the cloud backend URL for SaaS auth.
 */
export function getCloudBackendUrl(): string {
  return config.cloudBackendUrl;
}
