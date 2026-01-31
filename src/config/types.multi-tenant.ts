/**
 * Multi-tenant SaaS configuration types.
 *
 * These types extend the core OpenClaw configuration to support multi-tenant mode.
 * When multiTenant.enabled is false (default), OpenClaw operates in single-user mode.
 */

import type { OpenClawConfig } from "./types.openclaw.js";

/**
 * Multi-tenant configuration for SaaS deployment.
 */
export interface MultiTenantConfig {
  /** Enable multi-tenant mode. Default: false */
  enabled: boolean;

  /** Cloud backend URL for config sync and usage reporting */
  cloudBackendUrl: string;

  /** Root directory for user config files. Default: /data/openclaw/configs */
  configRoot: string;

  /** Root directory for user workspaces. Default: /data/openclaw/workspaces */
  workspaceRoot: string;

  /** Path to workspace template directory. Default: /data/openclaw/workspaces/template */
  templatePath: string;

  /** Maximum number of cached user instances. Default: 100 */
  maxCachedUsers: number;

  /** Idle timeout before evicting user instance (ms). Default: 3600000 (1h) */
  userIdleTimeoutMs: number;

  /** Config sync interval from cloud (ms). Default: 300000 (5min) */
  syncIntervalMs: number;

  /** Service token for cloud backend authentication */
  serviceToken?: string;
}

/**
 * User instance state in the multi-tenant gateway.
 */
export interface UserInstance {
  /** User ID from cloud backend */
  userId: string;

  /** User's OpenClaw configuration */
  config: OpenClawConfig;

  /** Path to user's workspace directory */
  workspacePath: string;

  /** Path to user's config file */
  configPath: string;

  /** Timestamp of last activity (Date.now()) */
  lastActivityAt: number;

  /** Number of pending requests (prevents cleanup during active requests) */
  pendingRequests: number;

  /** User subscription status */
  status: "active" | "suspended" | "expired";

  /** User's LLM API key (for proxying requests) */
  llmApiKey?: string;
}

/**
 * User config data synced from cloud backend.
 */
export interface CloudUserConfig {
  /** User ID */
  userId: string;

  /** Gateway authentication token */
  gatewayToken: string;

  /** User's OpenClaw configuration (JSON) */
  openclawConfig: OpenClawConfig;

  /** User subscription status */
  status: "active" | "suspended" | "expired";

  /** User's LLM API key */
  llmApiKey?: string;

  /** Last updated timestamp (ISO string) */
  updatedAt: string;
}

/**
 * Config sync response from cloud backend.
 */
export interface ConfigSyncResponse {
  /** List of user configs (full or delta) */
  users: CloudUserConfig[];

  /** Timestamp for next incremental sync */
  syncTimestamp: string;

  /** Whether more pages are available */
  hasMore: boolean;

  /** Cursor for pagination */
  nextCursor?: string;
}

/**
 * Default multi-tenant configuration values.
 */
export const DEFAULT_MULTI_TENANT_CONFIG: MultiTenantConfig = {
  enabled: false,
  cloudBackendUrl: "",
  configRoot: "/data/openclaw/configs",
  workspaceRoot: "/data/openclaw/workspaces",
  templatePath: "/data/openclaw/workspaces/template",
  maxCachedUsers: 100,
  userIdleTimeoutMs: 3600000, // 1 hour
  syncIntervalMs: 300000, // 5 minutes
};

/**
 * Extended OpenClaw config with optional multi-tenant settings.
 * This extends the base config without modifying it.
 */
export interface OpenClawConfigWithMultiTenant extends OpenClawConfig {
  /** Multi-tenant configuration (SaaS mode) */
  multiTenant?: Partial<MultiTenantConfig>;
}

/**
 * Type guard to check if config has multi-tenant enabled.
 */
export function isMultiTenantEnabled(
  config: OpenClawConfig | OpenClawConfigWithMultiTenant,
): config is OpenClawConfigWithMultiTenant & { multiTenant: { enabled: true } } {
  const mtConfig = (config as OpenClawConfigWithMultiTenant).multiTenant;
  return mtConfig?.enabled === true;
}

/**
 * Resolve multi-tenant config with defaults.
 */
export function resolveMultiTenantConfig(config?: Partial<MultiTenantConfig>): MultiTenantConfig {
  return {
    ...DEFAULT_MULTI_TENANT_CONFIG,
    ...config,
  };
}
