/**
 * Multi-tenant Gateway monitoring service.
 *
 * Provides periodic statistics logging and alert integration
 * for multi-tenant deployments.
 */

import type { MultiTenantGatewayManager } from "./manager.js";
import type { ConfigSyncService } from "./config-sync.js";
import type { MultiTenantManagerStats, MultiTenantManagerEvent } from "./types.js";

/**
 * Alert severity levels.
 */
export type AlertSeverity = "info" | "warning" | "error" | "critical";

/**
 * Alert data structure.
 */
export interface Alert {
  severity: AlertSeverity;
  message: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

/**
 * Alert handler function type.
 */
export type AlertHandler = (alert: Alert) => void | Promise<void>;

/**
 * Monitor configuration options.
 */
export interface MonitorOptions {
  /** Stats logging interval (ms). Default: 60000 (1 min) */
  statsIntervalMs?: number;

  /** Memory warning threshold (MB). Default: 512 */
  memoryWarningThresholdMb?: number;

  /** Active users warning threshold. Default: 80% of maxCachedUsers */
  activeUsersWarningPercent?: number;

  /** Sync failure alert threshold. Default: 3 */
  syncFailureAlertThreshold?: number;

  /** Logger instance */
  logger?: Pick<typeof console, "log" | "warn" | "error">;

  /** Custom alert handlers */
  alertHandlers?: AlertHandler[];
}

/**
 * Multi-tenant monitoring service.
 */
export class MultiTenantMonitor {
  private readonly manager: MultiTenantGatewayManager;
  private readonly configSync?: ConfigSyncService;
  private readonly options: Required<Omit<MonitorOptions, "alertHandlers">> & {
    alertHandlers: AlertHandler[];
  };

  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private lastStats: MultiTenantManagerStats | null = null;

  constructor(
    manager: MultiTenantGatewayManager,
    configSync?: ConfigSyncService,
    options: MonitorOptions = {},
  ) {
    this.manager = manager;
    this.configSync = configSync;
    this.options = {
      statsIntervalMs: options.statsIntervalMs ?? 60000,
      memoryWarningThresholdMb: options.memoryWarningThresholdMb ?? 512,
      activeUsersWarningPercent: options.activeUsersWarningPercent ?? 80,
      syncFailureAlertThreshold: options.syncFailureAlertThreshold ?? 3,
      logger: options.logger ?? console,
      alertHandlers: options.alertHandlers ?? [],
    };

    // Subscribe to manager events
    this.manager.addEventListener(this.handleManagerEvent.bind(this));
  }

  /**
   * Start monitoring.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Start periodic stats logging
    this.statsTimer = setInterval(() => {
      this.logStats();
      this.checkAlerts();
    }, this.options.statsIntervalMs);

    // Log initial stats
    this.logStats();

    this.options.logger.log("[Monitor] Started");
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    this.options.logger.log("[Monitor] Stopped");
  }

  /**
   * Get current statistics.
   */
  getStats(): MultiTenantManagerStats {
    return this.manager.getStats();
  }

  /**
   * Get last recorded statistics.
   */
  getLastStats(): MultiTenantManagerStats | null {
    return this.lastStats;
  }

  /**
   * Add an alert handler.
   */
  addAlertHandler(handler: AlertHandler): void {
    this.options.alertHandlers.push(handler);
  }

  /**
   * Remove an alert handler.
   */
  removeAlertHandler(handler: AlertHandler): void {
    const index = this.options.alertHandlers.indexOf(handler);
    if (index !== -1) {
      this.options.alertHandlers.splice(index, 1);
    }
  }

  /**
   * Log current statistics.
   */
  private logStats(): void {
    const stats = this.manager.getStats();
    this.lastStats = stats;

    const memUsage = process.memoryUsage();
    const heapUsedMb = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(memUsage.heapTotal / 1024 / 1024);

    this.options.logger.log(
      `[Monitor] Stats: users=${stats.totalUsers} active=${stats.activeInstances} ` +
        `connections=${stats.totalConnections} pending=${stats.usersWithPendingRequests} ` +
        `cacheHit=${(stats.cacheHitRate * 100).toFixed(1)}% ` +
        `syncFailures=${stats.syncFailures} ` +
        `heap=${heapUsedMb}/${heapTotalMb}MB`,
    );
  }

  /**
   * Check for alert conditions.
   */
  private checkAlerts(): void {
    const stats = this.manager.getStats();

    // Check memory usage
    const memUsage = process.memoryUsage();
    const heapUsedMb = memUsage.heapUsed / 1024 / 1024;
    if (heapUsedMb > this.options.memoryWarningThresholdMb) {
      this.emitAlert({
        severity: "warning",
        message: `High memory usage: ${Math.round(heapUsedMb)}MB`,
        timestamp: new Date().toISOString(),
        details: { heapUsedMb, threshold: this.options.memoryWarningThresholdMb },
      });
    }

    // Check active users ratio
    const activeRatio = stats.totalUsers > 0 ? (stats.activeInstances / stats.totalUsers) * 100 : 0;
    if (activeRatio > this.options.activeUsersWarningPercent) {
      this.emitAlert({
        severity: "warning",
        message: `High active user ratio: ${activeRatio.toFixed(1)}%`,
        timestamp: new Date().toISOString(),
        details: { activeInstances: stats.activeInstances, totalUsers: stats.totalUsers },
      });
    }

    // Check sync failures
    if (stats.syncFailures >= this.options.syncFailureAlertThreshold) {
      this.emitAlert({
        severity: "error",
        message: `Config sync failing: ${stats.syncFailures} consecutive failures`,
        timestamp: new Date().toISOString(),
        details: { syncFailures: stats.syncFailures, lastSyncAt: stats.lastSyncAt },
      });
    }
  }

  /**
   * Handle manager events.
   */
  private handleManagerEvent(event: MultiTenantManagerEvent): void {
    switch (event.type) {
      case "sync-failed":
        if (event.consecutiveFailures >= this.options.syncFailureAlertThreshold) {
          this.emitAlert({
            severity: "error",
            message: `Config sync failed: ${event.error}`,
            timestamp: new Date().toISOString(),
            details: { consecutiveFailures: event.consecutiveFailures },
          });
        }
        break;

      case "user-suspended":
        this.options.logger.warn(`[Monitor] User suspended: ${event.userId}`);
        break;

      case "user-expired":
        this.options.logger.warn(`[Monitor] User expired: ${event.userId}`);
        break;

      case "user-evicted":
        this.options.logger.log(`[Monitor] User evicted: ${event.userId} (${event.reason})`);
        break;
    }
  }

  /**
   * Emit an alert to all handlers.
   */
  private emitAlert(alert: Alert): void {
    // Log the alert
    const logFn =
      alert.severity === "critical" || alert.severity === "error"
        ? this.options.logger.error
        : alert.severity === "warning"
          ? this.options.logger.warn
          : this.options.logger.log;
    logFn(`[Monitor] ALERT [${alert.severity}]: ${alert.message}`);

    // Call all handlers
    for (const handler of this.options.alertHandlers) {
      try {
        handler(alert);
      } catch (err) {
        this.options.logger.error("[Monitor] Alert handler error:", err);
      }
    }
  }

  /**
   * Manually emit an alert.
   */
  alert(severity: AlertSeverity, message: string, details?: Record<string, unknown>): void {
    this.emitAlert({
      severity,
      message,
      timestamp: new Date().toISOString(),
      details,
    });
  }
}

/**
 * Create a multi-tenant monitor.
 */
export function createMultiTenantMonitor(
  manager: MultiTenantGatewayManager,
  configSync?: ConfigSyncService,
  options?: MonitorOptions,
): MultiTenantMonitor {
  return new MultiTenantMonitor(manager, configSync, options);
}

/**
 * Format stats for display.
 */
export function formatStats(stats: MultiTenantManagerStats): string {
  const lines = [
    "=== Multi-Tenant Gateway Stats ===",
    `Total Users:       ${stats.totalUsers}`,
    `Active Instances:  ${stats.activeInstances}`,
    `Total Connections: ${stats.totalConnections}`,
    `Pending Requests:  ${stats.usersWithPendingRequests}`,
    `Cache Hit Rate:    ${(stats.cacheHitRate * 100).toFixed(1)}%`,
    `Last Sync:         ${stats.lastSyncAt ?? "never"}`,
    `Sync Failures:     ${stats.syncFailures}`,
  ];
  return lines.join("\n");
}
