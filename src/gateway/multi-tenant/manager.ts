/**
 * Multi-tenant Gateway Manager.
 *
 * Manages user instances, authentication tokens, and LRU caching
 * for multi-tenant deployments. This module does not modify any
 * existing Gateway code - it provides additional management capabilities.
 */

import type { OpenClawConfig } from "../../config/types.js";
import {
  type CloudUserConfig,
  type UserInstance,
  DEFAULT_MULTI_TENANT_CONFIG,
} from "../../config/types.multi-tenant.js";
import {
  ensureUserDirectories,
  writeUserConfig,
  readUserConfig,
  sanitizeUserId,
} from "../../config/multi-tenant.js";
import {
  createWorkspaceFileResolver,
  type WorkspaceFileResolver,
} from "../../agents/workspace-resolver.js";
import type {
  MultiTenantManagerOptions,
  MultiTenantManagerStats,
  MultiTenantManagerEvent,
  MultiTenantManagerEventListener,
} from "./types.js";

/**
 * Multi-tenant Gateway Manager.
 *
 * Responsibilities:
 * - Maintain user instances with LRU eviction
 * - Map gateway tokens to user IDs
 * - Track pending requests to prevent premature eviction
 * - Provide statistics for monitoring
 */
export class MultiTenantGatewayManager {
  private readonly userInstances: Map<string, UserInstance>;
  private readonly tokenToUserId: Map<string, string>;
  private readonly configCache: Map<string, OpenClawConfig>;
  private readonly workspaceResolvers: Map<string, WorkspaceFileResolver>;
  private readonly options: Required<MultiTenantManagerOptions>;
  private readonly eventListeners: Set<MultiTenantManagerEventListener>;

  private cacheHits = 0;
  private cacheMisses = 0;
  private lastSyncAt: string | null = null;
  private syncFailures = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: MultiTenantManagerOptions = {}) {
    this.options = {
      maxCachedUsers: options.maxCachedUsers ?? DEFAULT_MULTI_TENANT_CONFIG.maxCachedUsers,
      userIdleTimeoutMs: options.userIdleTimeoutMs ?? DEFAULT_MULTI_TENANT_CONFIG.userIdleTimeoutMs,
      syncIntervalMs: options.syncIntervalMs ?? DEFAULT_MULTI_TENANT_CONFIG.syncIntervalMs,
      cloudBackendUrl: options.cloudBackendUrl ?? DEFAULT_MULTI_TENANT_CONFIG.cloudBackendUrl,
      serviceToken: options.serviceToken ?? "",
      workspaceRoot: options.workspaceRoot ?? DEFAULT_MULTI_TENANT_CONFIG.workspaceRoot,
      configRoot: options.configRoot ?? DEFAULT_MULTI_TENANT_CONFIG.configRoot,
      templatePath: options.templatePath ?? DEFAULT_MULTI_TENANT_CONFIG.templatePath,
      logger: options.logger ?? console,
    };

    this.userInstances = new Map();
    this.tokenToUserId = new Map();
    this.workspaceResolvers = new Map();
    this.eventListeners = new Set();
    this.configCache = new Map();
  }

  /**
   * Start the manager (begin cleanup timer).
   */
  start(): void {
    if (this.cleanupTimer) return;

    // Run cleanup every minute
    this.cleanupTimer = setInterval(() => {
      this.cleanupInactiveUsers();
    }, 60000);

    this.options.logger.log("[MultiTenantManager] Started");
  }

  /**
   * Stop the manager (clear timers, cleanup resources).
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.options.logger.log("[MultiTenantManager] Stopped");
  }

  /**
   * Register event listener.
   */
  addEventListener(listener: MultiTenantManagerEventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * Remove event listener.
   */
  removeEventListener(listener: MultiTenantManagerEventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * Emit an event to all listeners.
   */
  private emit(event: MultiTenantManagerEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        this.options.logger.error("[MultiTenantManager] Event listener error:", err);
      }
    }
  }

  /**
   * Authenticate a gateway token and return the user ID.
   *
   * @param token - Gateway authentication token
   * @returns User ID if authenticated, null otherwise
   */
  authenticateToken(token: string): string | null {
    const userId = this.tokenToUserId.get(token);
    if (!userId) return null;

    // Check if user is still active
    const instance = this.userInstances.get(userId);
    if (!instance) return null;

    // Check user status
    if (instance.status === "suspended") {
      this.emit({ type: "user-suspended", userId });
      return null;
    }
    if (instance.status === "expired") {
      this.emit({ type: "user-expired", userId });
      return null;
    }

    return userId;
  }

  /**
   * Get or create a user instance.
   *
   * @param userId - User ID
   * @returns User instance or null if not found
   */
  async getUserInstance(userId: string): Promise<UserInstance | null> {
    const safeUserId = sanitizeUserId(userId);

    // Check cache first
    const cached = this.userInstances.get(safeUserId);
    if (cached) {
      this.cacheHits++;
      cached.lastActivityAt = Date.now();
      return cached;
    }

    this.cacheMisses++;

    // Try to load from disk
    const config = await readUserConfig(safeUserId);
    if (!config) {
      return null;
    }

    // Initialize user instance
    return this.initializeUserInstance(safeUserId, config);
  }

  /**
   * Initialize a new user instance.
   */
  private async initializeUserInstance(
    userId: string,
    config: OpenClawConfig,
    cloudConfig?: CloudUserConfig,
  ): Promise<UserInstance> {
    const paths = await ensureUserDirectories(userId);

    const instance: UserInstance = {
      userId,
      config,
      workspacePath: paths.workspacePath,
      configPath: paths.configPath,
      lastActivityAt: Date.now(),
      pendingRequests: 0,
      status: cloudConfig?.status ?? "active",
      llmApiKey: cloudConfig?.llmApiKey,
    };

    this.userInstances.set(userId, instance);
    this.configCache.set(userId, config);

    // Create workspace resolver
    const resolver = createWorkspaceFileResolver({
      userId,
      workspacePath: paths.workspacePath,
      templatePath: this.options.templatePath,
    });
    this.workspaceResolvers.set(userId, resolver);

    this.emit({ type: "user-loaded", userId });
    return instance;
  }

  /**
   * Get workspace resolver for a user.
   */
  getWorkspaceResolver(userId: string): WorkspaceFileResolver | null {
    return this.workspaceResolvers.get(sanitizeUserId(userId)) ?? null;
  }

  /**
   * Update user configs from cloud backend sync.
   *
   * @param configs - Array of user configs from cloud
   */
  async updateUserConfigs(configs: CloudUserConfig[]): Promise<number> {
    let updated = 0;

    for (const cloudConfig of configs) {
      try {
        const userId = sanitizeUserId(cloudConfig.userId);

        // Update token mapping
        this.tokenToUserId.set(cloudConfig.gatewayToken, userId);

        // Write config to disk
        await writeUserConfig(userId, cloudConfig.openclawConfig);

        // Update in-memory instance if loaded
        const existing = this.userInstances.get(userId);
        if (existing) {
          existing.config = cloudConfig.openclawConfig;
          existing.status = cloudConfig.status;
          existing.llmApiKey = cloudConfig.llmApiKey;
          this.configCache.set(userId, cloudConfig.openclawConfig);
        }

        updated++;
      } catch (err) {
        this.options.logger.error(
          `[MultiTenantManager] Failed to update config for user ${cloudConfig.userId}:`,
          err,
        );
      }
    }

    this.lastSyncAt = new Date().toISOString();
    this.syncFailures = 0;
    this.emit({ type: "config-synced", usersUpdated: updated, timestamp: this.lastSyncAt });

    return updated;
  }

  /**
   * Record a sync failure.
   */
  recordSyncFailure(error: string): void {
    this.syncFailures++;
    this.emit({ type: "sync-failed", error, consecutiveFailures: this.syncFailures });
  }

  /**
   * Increment pending requests for a user.
   */
  incrementPendingRequests(userId: string): void {
    const instance = this.userInstances.get(sanitizeUserId(userId));
    if (instance) {
      instance.pendingRequests++;
      instance.lastActivityAt = Date.now();
    }
  }

  /**
   * Decrement pending requests for a user.
   */
  decrementPendingRequests(userId: string): void {
    const instance = this.userInstances.get(sanitizeUserId(userId));
    if (instance && instance.pendingRequests > 0) {
      instance.pendingRequests--;
      instance.lastActivityAt = Date.now();
    }
  }

  /**
   * Cleanup inactive users.
   */
  cleanupInactiveUsers(): void {
    const now = Date.now();
    const idleTimeout = this.options.userIdleTimeoutMs;

    for (const [userId, instance] of this.userInstances) {
      // Skip users with pending requests
      if (instance.pendingRequests > 0) continue;

      // Check if idle timeout exceeded
      if (now - instance.lastActivityAt > idleTimeout) {
        this.evictUser(userId, "idle");
      }
    }

    // Enforce max cached users via LRU
    while (this.userInstances.size > this.options.maxCachedUsers) {
      // Find oldest user without pending requests
      let oldestUserId: string | null = null;
      let oldestActivity = Infinity;

      for (const [userId, instance] of this.userInstances) {
        if (instance.pendingRequests > 0) continue;
        if (instance.lastActivityAt < oldestActivity) {
          oldestActivity = instance.lastActivityAt;
          oldestUserId = userId;
        }
      }

      if (oldestUserId) {
        this.evictUser(oldestUserId, "lru");
      } else {
        break; // All users have pending requests
      }
    }
  }

  /**
   * Maybe evict a user if they have no pending requests.
   */
  private maybeEvictUser(userId: string, reason: "idle" | "lru" | "manual"): void {
    const instance = this.userInstances.get(userId);
    if (!instance) return;
    if (instance.pendingRequests > 0) return;
    this.evictUser(userId, reason);
  }

  /**
   * Evict a user from memory.
   */
  private evictUser(userId: string, reason: "idle" | "lru" | "manual"): void {
    this.userInstances.delete(userId);
    this.configCache.delete(userId);
    this.workspaceResolvers.delete(userId);
    this.emit({ type: "user-evicted", userId, reason });
  }

  /**
   * Manually evict a user.
   */
  forceEvictUser(userId: string): boolean {
    const safeUserId = sanitizeUserId(userId);
    if (!this.userInstances.has(safeUserId)) return false;
    this.evictUser(safeUserId, "manual");
    return true;
  }

  /**
   * Get manager statistics.
   */
  getStats(): MultiTenantManagerStats {
    let usersWithPendingRequests = 0;
    let totalConnections = 0;

    for (const instance of this.userInstances.values()) {
      if (instance.pendingRequests > 0) {
        usersWithPendingRequests++;
        totalConnections += instance.pendingRequests;
      }
    }

    const totalHits = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalHits > 0 ? this.cacheHits / totalHits : 0;

    return {
      totalUsers: this.tokenToUserId.size,
      activeInstances: this.userInstances.size,
      totalConnections,
      usersWithPendingRequests,
      cacheHitRate,
      lastSyncAt: this.lastSyncAt,
      syncFailures: this.syncFailures,
    };
  }

  /**
   * Get the number of consecutive sync failures.
   */
  getSyncFailures(): number {
    return this.syncFailures;
  }

  /**
   * Check if a token is registered.
   */
  hasToken(token: string): boolean {
    return this.tokenToUserId.has(token);
  }

  /**
   * Get all registered user IDs.
   */
  getRegisteredUserIds(): string[] {
    return [...new Set(this.tokenToUserId.values())];
  }

  /**
   * Get all active user IDs (currently loaded in memory).
   */
  getActiveUserIds(): string[] {
    return [...this.userInstances.keys()];
  }
}

/**
 * Create a multi-tenant gateway manager.
 */
export function createMultiTenantGatewayManager(
  options?: MultiTenantManagerOptions,
): MultiTenantGatewayManager {
  return new MultiTenantGatewayManager(options);
}
