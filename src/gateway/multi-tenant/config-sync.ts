/**
 * Multi-tenant configuration sync service.
 *
 * This service periodically syncs user configurations from the cloud backend.
 * Features:
 * - Incremental sync using timestamps
 * - Exponential backoff retry on failures
 * - Alert emission after consecutive failures
 */

import type { ConfigSyncResponse } from "../../config/types.multi-tenant.js";
import type { MultiTenantGatewayManager } from "./manager.js";

/**
 * Configuration sync service options.
 */
export interface ConfigSyncServiceOptions {
  /** Cloud backend URL */
  cloudBackendUrl: string;

  /** Service token for authentication */
  serviceToken: string;

  /** Sync interval in milliseconds. Default: 300000 (5 min) */
  syncIntervalMs?: number;

  /** Initial retry delay in milliseconds. Default: 1000 (1s) */
  initialRetryDelayMs?: number;

  /** Maximum retry delay in milliseconds. Default: 300000 (5 min) */
  maxRetryDelayMs?: number;

  /** Number of consecutive failures before alerting. Default: 5 */
  alertThreshold?: number;

  /** Logger instance */
  logger?: Pick<typeof console, "log" | "warn" | "error">;

  /** Alert callback */
  onAlert?: (message: string, consecutiveFailures: number) => void;
}

/**
 * Configuration sync service.
 */
export class ConfigSyncService {
  private readonly manager: MultiTenantGatewayManager;
  private readonly options: Required<ConfigSyncServiceOptions>;

  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncTimestamp: string | null = null;
  private consecutiveFailures = 0;
  private currentRetryDelay: number;
  private isRunning = false;
  private isSyncing = false;

  constructor(manager: MultiTenantGatewayManager, options: ConfigSyncServiceOptions) {
    this.manager = manager;
    this.options = {
      cloudBackendUrl: options.cloudBackendUrl,
      serviceToken: options.serviceToken,
      syncIntervalMs: options.syncIntervalMs ?? 300000,
      initialRetryDelayMs: options.initialRetryDelayMs ?? 1000,
      maxRetryDelayMs: options.maxRetryDelayMs ?? 300000,
      alertThreshold: options.alertThreshold ?? 5,
      logger: options.logger ?? console,
      onAlert: options.onAlert ?? (() => {}),
    };
    this.currentRetryDelay = this.options.initialRetryDelayMs;
  }

  /**
   * Start the sync service.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.options.logger.log("[ConfigSyncService] Starting...");

    // Do initial sync immediately
    this.scheduleSync(0);
  }

  /**
   * Stop the sync service.
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    this.options.logger.log("[ConfigSyncService] Stopped");
  }

  /**
   * Force an immediate sync.
   */
  async syncNow(): Promise<{ success: boolean; usersUpdated: number; error?: string }> {
    return this.doSync();
  }

  /**
   * Get the last sync timestamp.
   */
  getLastSyncTimestamp(): string | null {
    return this.lastSyncTimestamp;
  }

  /**
   * Get consecutive failure count.
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /**
   * Schedule the next sync.
   */
  private scheduleSync(delayMs: number): void {
    if (!this.isRunning) return;

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }

    this.syncTimer = setTimeout(async () => {
      await this.doSync();
      this.scheduleNextSync();
    }, delayMs);
  }

  /**
   * Schedule the next sync based on success/failure state.
   */
  private scheduleNextSync(): void {
    if (!this.isRunning) return;

    if (this.consecutiveFailures > 0) {
      // Use exponential backoff
      this.scheduleSync(this.currentRetryDelay);
    } else {
      // Normal interval
      this.scheduleSync(this.options.syncIntervalMs);
    }
  }

  /**
   * Perform the sync operation.
   */
  private async doSync(): Promise<{ success: boolean; usersUpdated: number; error?: string }> {
    if (this.isSyncing) {
      return { success: false, usersUpdated: 0, error: "sync_in_progress" };
    }

    this.isSyncing = true;

    try {
      const response = await this.fetchConfigs();

      // Update manager with new configs
      const usersUpdated = await this.manager.updateUserConfigs(response.users);

      // Update state
      this.lastSyncTimestamp = response.syncTimestamp;
      this.consecutiveFailures = 0;
      this.currentRetryDelay = this.options.initialRetryDelayMs;

      this.options.logger.log(`[ConfigSyncService] Sync completed: ${usersUpdated} users updated`);

      // Handle pagination
      if (response.hasMore && response.nextCursor) {
        // Schedule immediate follow-up sync for next page
        this.scheduleSync(100);
      }

      return { success: true, usersUpdated };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      this.consecutiveFailures++;
      this.manager.recordSyncFailure(errorMessage);

      // Exponential backoff
      this.currentRetryDelay = Math.min(this.currentRetryDelay * 2, this.options.maxRetryDelayMs);

      this.options.logger.error(
        `[ConfigSyncService] Sync failed (attempt ${this.consecutiveFailures}):`,
        errorMessage,
      );

      // Alert if threshold reached
      if (this.consecutiveFailures >= this.options.alertThreshold) {
        const alertMessage = `Config sync has failed ${this.consecutiveFailures} consecutive times. Last error: ${errorMessage}`;
        this.options.onAlert(alertMessage, this.consecutiveFailures);
        this.options.logger.error(`[ConfigSyncService] ALERT: ${alertMessage}`);
      }

      return { success: false, usersUpdated: 0, error: errorMessage };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Fetch configs from cloud backend.
   */
  private async fetchConfigs(): Promise<ConfigSyncResponse> {
    const url = new URL("/api/v1/openclaw/gateway/configs", this.options.cloudBackendUrl);

    // Add since parameter for incremental sync
    if (this.lastSyncTimestamp) {
      url.searchParams.set("since", this.lastSyncTimestamp);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.options.serviceToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data as ConfigSyncResponse;
  }
}

/**
 * Create a config sync service.
 */
export function createConfigSyncService(
  manager: MultiTenantGatewayManager,
  options: ConfigSyncServiceOptions,
): ConfigSyncService {
  return new ConfigSyncService(manager, options);
}
