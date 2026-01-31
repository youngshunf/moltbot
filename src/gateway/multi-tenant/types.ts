/**
 * Multi-tenant Gateway type extensions.
 *
 * These types extend the core Gateway types to support multi-tenant mode.
 * They do not modify existing types - they provide parallel definitions
 * that include multi-tenant context.
 */

import type { WebSocket } from "ws";

import type { OpenClawConfig } from "../../config/types.js";
import type { UserInstance } from "../../config/types.multi-tenant.js";
import type { WorkspaceFileResolver } from "../../agents/workspace-resolver.js";
import type { ConnectParams } from "../protocol/index.js";
import type { GatewayWsClient } from "../server/ws-types.js";

/**
 * Multi-tenant context attached to a WebSocket connection.
 */
export interface MultiTenantContext {
  /** User ID from cloud backend */
  userId: string;

  /** Reference to user instance in the manager */
  userInstance: UserInstance;

  /** User's resolved configuration */
  config: OpenClawConfig;

  /** Path to user's workspace directory */
  workspacePath: string;

  /** Workspace file resolver for this user */
  workspaceResolver: WorkspaceFileResolver;
}

/**
 * Extended GatewayWsClient with optional multi-tenant context.
 *
 * This extends the base type without modifying it.
 * In single-user mode, multiTenant is undefined.
 */
export interface GatewayWsClientMultiTenant extends GatewayWsClient {
  /** Multi-tenant context (only present in multi-tenant mode) */
  multiTenant?: MultiTenantContext;
}

/**
 * Type guard to check if a client has multi-tenant context.
 */
export function hasMultiTenantContext(
  client: GatewayWsClient | GatewayWsClientMultiTenant,
): client is GatewayWsClientMultiTenant & { multiTenant: MultiTenantContext } {
  return "multiTenant" in client && client.multiTenant !== undefined;
}

/**
 * Authentication result extended with user ID for multi-tenant mode.
 */
export interface MultiTenantAuthResult {
  ok: boolean;
  method?: "token" | "password" | "tailscale" | "device-token" | "gateway-token";
  user?: string;
  reason?: string;
  /** User ID if authenticated via multi-tenant token */
  userId?: string;
}

/**
 * Manager statistics for monitoring.
 */
export interface MultiTenantManagerStats {
  /** Total number of registered users */
  totalUsers: number;

  /** Number of active (loaded) user instances */
  activeInstances: number;

  /** Number of active WebSocket connections */
  totalConnections: number;

  /** Number of users with pending requests */
  usersWithPendingRequests: number;

  /** Cache hit rate (0-1) */
  cacheHitRate: number;

  /** Last config sync timestamp */
  lastSyncAt: string | null;

  /** Number of consecutive sync failures */
  syncFailures: number;
}

/**
 * Event types emitted by the multi-tenant manager.
 */
export type MultiTenantManagerEvent =
  | { type: "user-loaded"; userId: string }
  | { type: "user-evicted"; userId: string; reason: "idle" | "lru" | "manual" }
  | { type: "config-synced"; usersUpdated: number; timestamp: string }
  | { type: "sync-failed"; error: string; consecutiveFailures: number }
  | { type: "user-suspended"; userId: string }
  | { type: "user-expired"; userId: string };

/**
 * Listener for multi-tenant manager events.
 */
export type MultiTenantManagerEventListener = (event: MultiTenantManagerEvent) => void;

/**
 * Options for creating a multi-tenant manager.
 */
export interface MultiTenantManagerOptions {
  /** Maximum number of cached user instances */
  maxCachedUsers?: number;

  /** Idle timeout before evicting user instance (ms) */
  userIdleTimeoutMs?: number;

  /** Config sync interval (ms) */
  syncIntervalMs?: number;

  /** Cloud backend URL */
  cloudBackendUrl?: string;

  /** Service token for cloud backend authentication */
  serviceToken?: string;

  /** Workspace root directory */
  workspaceRoot?: string;

  /** Config root directory */
  configRoot?: string;

  /** Template path */
  templatePath?: string;

  /** Logger instance */
  logger?: Pick<typeof console, "log" | "warn" | "error">;
}
