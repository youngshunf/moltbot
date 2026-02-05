/**
 * Multi-tenant global configuration loader.
 *
 * This module handles loading and resolving multi-tenant configuration
 * for SaaS deployments. It does not modify any existing configuration logic.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import JSON5 from "json5";

import {
  DEFAULT_MULTI_TENANT_CONFIG,
  resolveMultiTenantConfig,
  type MultiTenantConfig,
  type OpenClawConfigWithMultiTenant,
} from "./types.multi-tenant.js";

/**
 * Global config file search paths (in order of precedence).
 */
const GLOBAL_CONFIG_PATHS = [
  // Environment variable override
  () => process.env.OPENCLAW_GLOBAL_CONFIG?.trim(),
  // System-wide config
  () => "/etc/openclaw/config.json",
  // User-level config
  () => path.join(os.homedir(), ".clawdbot", "openclaw.json"),
  () => path.join(os.homedir(), ".openclaw", "openclaw.json"),
];

/**
 * Cached global config to avoid repeated file reads.
 */
let globalConfigCache: {
  config: OpenClawConfigWithMultiTenant;
  loadedAt: number;
  path: string | null;
} | null = null;

const GLOBAL_CONFIG_CACHE_TTL_MS = 60000; // 1 minute

/**
 * Find the first existing global config file path.
 */
export function findGlobalConfigPath(): string | null {
  for (const pathFn of GLOBAL_CONFIG_PATHS) {
    const configPath = pathFn();
    if (!configPath) continue;
    try {
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    } catch {
      // Skip inaccessible paths
    }
  }
  return null;
}

/**
 * Load global configuration for multi-tenant mode.
 *
 * Returns the parsed config or an empty object if no config file exists.
 * Caches the result for performance.
 */
export function loadGlobalConfig(): OpenClawConfigWithMultiTenant {
  const now = Date.now();

  // Return cached config if still valid
  if (globalConfigCache && now - globalConfigCache.loadedAt < GLOBAL_CONFIG_CACHE_TTL_MS) {
    return globalConfigCache.config;
  }

  const configPath = findGlobalConfigPath();

  if (!configPath) {
    const emptyConfig: OpenClawConfigWithMultiTenant = {};
    globalConfigCache = { config: emptyConfig, loadedAt: now, path: null };
    return emptyConfig;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON5.parse(raw) as OpenClawConfigWithMultiTenant;

    globalConfigCache = { config: parsed, loadedAt: now, path: configPath };
    return parsed;
  } catch (err) {
    console.error(`Failed to load global config at ${configPath}:`, err);
    const emptyConfig: OpenClawConfigWithMultiTenant = {};
    globalConfigCache = { config: emptyConfig, loadedAt: now, path: configPath };
    return emptyConfig;
  }
}

/**
 * Clear the global config cache (useful for testing or forced reload).
 */
export function clearGlobalConfigCache(): void {
  globalConfigCache = null;
}

/**
 * Get the resolved multi-tenant configuration with defaults applied.
 */
export function getMultiTenantConfig(): MultiTenantConfig {
  const globalConfig = loadGlobalConfig();
  return resolveMultiTenantConfig(globalConfig.multiTenant);
}

/**
 * Check if multi-tenant mode is enabled.
 */
export function isMultiTenantMode(): boolean {
  return getMultiTenantConfig().enabled;
}

/**
 * Get the config root directory for multi-tenant mode.
 */
export function getMultiTenantConfigRoot(): string {
  const config = getMultiTenantConfig();
  return config.configRoot || DEFAULT_MULTI_TENANT_CONFIG.configRoot;
}

/**
 * Get the workspace root directory for multi-tenant mode.
 */
export function getMultiTenantWorkspaceRoot(): string {
  const config = getMultiTenantConfig();
  return config.workspaceRoot || DEFAULT_MULTI_TENANT_CONFIG.workspaceRoot;
}

/**
 * Get the template workspace path for multi-tenant mode.
 */
export function getMultiTenantTemplatePath(): string {
  const config = getMultiTenantConfig();
  return config.templatePath || DEFAULT_MULTI_TENANT_CONFIG.templatePath;
}

/**
 * Get the config file path for a specific user.
 * Directory structure: {configRoot}/users/{userId}/config.json
 */
export function getUserConfigPath(userId: string): string {
  const configRoot = getMultiTenantConfigRoot();
  // Sanitize userId to prevent directory traversal
  const safeUserId = sanitizeUserId(userId);
  return path.join(configRoot, "users", safeUserId, "config.json");
}

/**
 * Get the workspace directory path for a specific user.
 * Directory structure: {workspaceRoot}/users/{userId}/
 */
export function getUserWorkspacePath(userId: string): string {
  const workspaceRoot = getMultiTenantWorkspaceRoot();
  // Sanitize userId to prevent directory traversal
  const safeUserId = sanitizeUserId(userId);
  return path.join(workspaceRoot, "users", safeUserId);
}

/**
 * Get the agent directory path for a specific user.
 */
export function getUserAgentDir(userId: string): string {
  return path.join(getUserWorkspacePath(userId), "agent");
}

/**
 * Get the sessions directory path for a specific user.
 */
export function getUserSessionsPath(userId: string): string {
  return path.join(getUserWorkspacePath(userId), "sessions");
}

/**
 * Get the memory directory path for a specific user.
 */
export function getUserMemoryPath(userId: string): string {
  return path.join(getUserWorkspacePath(userId), "memory");
}

/**
 * Sanitize user ID to prevent directory traversal attacks.
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
export function sanitizeUserId(userId: string): string {
  // Remove any path separators and parent directory references
  const sanitized = userId
    .replace(/\.\./g, "")
    .replace(/[/\\]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_");

  if (!sanitized || sanitized.length === 0) {
    throw new Error("Invalid user ID: cannot be empty after sanitization");
  }

  if (sanitized.length > 128) {
    throw new Error("Invalid user ID: too long (max 128 characters)");
  }

  return sanitized;
}

/**
 * Ensure user directories exist.
 */
export async function ensureUserDirectories(userId: string): Promise<{
  workspacePath: string;
  configPath: string;
  agentDir: string;
  sessionsPath: string;
  memoryPath: string;
}> {
  const workspacePath = getUserWorkspacePath(userId);
  const configPath = getUserConfigPath(userId);
  const agentDir = getUserAgentDir(userId);
  const sessionsPath = getUserSessionsPath(userId);
  const memoryPath = getUserMemoryPath(userId);

  // Create directories with secure permissions
  const dirs = [path.dirname(configPath), workspacePath, agentDir, sessionsPath, memoryPath];

  for (const dir of dirs) {
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  }

  return {
    workspacePath,
    configPath,
    agentDir,
    sessionsPath,
    memoryPath,
  };
}

/**
 * Write user configuration file.
 */
export async function writeUserConfig(
  userId: string,
  config: OpenClawConfigWithMultiTenant,
): Promise<void> {
  const configPath = getUserConfigPath(userId);
  const configDir = path.dirname(configPath);

  await fs.promises.mkdir(configDir, { recursive: true, mode: 0o700 });

  const json = JSON.stringify(config, null, 2);
  await fs.promises.writeFile(configPath, json, { encoding: "utf-8", mode: 0o600 });
}

/**
 * Read user configuration file.
 */
export async function readUserConfig(
  userId: string,
): Promise<OpenClawConfigWithMultiTenant | null> {
  const configPath = getUserConfigPath(userId);

  try {
    const raw = await fs.promises.readFile(configPath, "utf-8");
    return JSON5.parse(raw) as OpenClawConfigWithMultiTenant;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Get cloud backend URL from multi-tenant config.
 */
export function getCloudBackendUrl(): string {
  const config = getMultiTenantConfig();
  return config.cloudBackendUrl;
}

/**
 * Get service token for cloud backend authentication.
 */
export function getServiceToken(): string | undefined {
  // First check environment variable
  const envToken = process.env.OPENCLAW_SERVICE_TOKEN?.trim();
  if (envToken) return envToken;

  // Fall back to config file
  const config = getMultiTenantConfig();
  return config.serviceToken;
}
