/**
 * Multi-tenant management CLI commands.
 *
 * Provides commands for managing multi-tenant deployments:
 * - users list: List all registered users
 * - users info: Get detailed info for a user
 * - users cleanup: Clean up inactive users
 * - config sync: Force sync configs from cloud
 * - stats: Show gateway statistics
 */

import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { getMultiTenantConfig } from "../config/multi-tenant.js";
import type { MultiTenantConfig } from "../config/types.multi-tenant.js";
import {
  createMultiTenantGatewayManager,
  type MultiTenantGatewayManager,
} from "../gateway/multi-tenant/manager.js";
import { createConfigSyncService } from "../gateway/multi-tenant/config-sync.js";
import { formatStats } from "../gateway/multi-tenant/monitor.js";

/**
 * Check if multi-tenant mode is enabled.
 */
async function ensureMultiTenantEnabled(runtime: RuntimeEnv): Promise<MultiTenantConfig | null> {
  const config = getMultiTenantConfig();
  if (!config?.enabled) {
    runtime.error("Multi-tenant mode is not enabled. Set multiTenant.enabled=true in config.");
    return null;
  }
  return config;
}

/**
 * Create a manager instance for CLI operations.
 */
function createManagerForCli(config: MultiTenantConfig): MultiTenantGatewayManager {
  return createMultiTenantGatewayManager({
    maxCachedUsers: config.maxCachedUsers,
    userIdleTimeoutMs: config.userIdleTimeoutMs,
    syncIntervalMs: config.syncIntervalMs,
    cloudBackendUrl: config.cloudBackendUrl,
    serviceToken: config.serviceToken,
    workspaceRoot: config.workspaceRoot,
    configRoot: config.configRoot,
    templatePath: config.templatePath,
  });
}

/**
 * List all registered users.
 */
export async function multiTenantUsersListCommand(
  opts: { json?: boolean },
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const config = await ensureMultiTenantEnabled(runtime);
  if (!config) return;

  const manager = createManagerForCli(config);

  // Sync to get latest users
  const configSync = createConfigSyncService(manager, {
    cloudBackendUrl: config.cloudBackendUrl,
    serviceToken: config.serviceToken ?? "",
    syncIntervalMs: 0, // No auto-sync for CLI
  });

  try {
    await configSync.syncNow();
  } catch (err) {
    runtime.log(`Warning: Failed to sync configs: ${err}`);
  }

  const userIds = manager.getRegisteredUserIds();
  const activeIds = manager.getActiveUserIds();

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          total: userIds.length,
          active: activeIds.length,
          users: userIds.map((id) => ({
            userId: id,
            active: activeIds.includes(id),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (userIds.length === 0) {
    runtime.log("No registered users.");
    return;
  }

  runtime.log(`Registered users: ${userIds.length} (${activeIds.length} active)`);
  runtime.log("");
  for (const userId of userIds) {
    const status = activeIds.includes(userId) ? " [active]" : "";
    runtime.log(`  - ${userId}${status}`);
  }
}

/**
 * Get detailed info for a specific user.
 */
export async function multiTenantUsersInfoCommand(
  userId: string,
  opts: { json?: boolean },
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const config = await ensureMultiTenantEnabled(runtime);
  if (!config) return;

  const manager = createManagerForCli(config);

  // Sync first
  const configSync = createConfigSyncService(manager, {
    cloudBackendUrl: config.cloudBackendUrl,
    serviceToken: config.serviceToken ?? "",
    syncIntervalMs: 0,
  });

  try {
    await configSync.syncNow();
  } catch (err) {
    runtime.log(`Warning: Failed to sync configs: ${err}`);
  }

  const instance = await manager.getUserInstance(userId);
  if (!instance) {
    runtime.error(`User not found: ${userId}`);
    return;
  }

  const info = {
    userId: instance.userId,
    status: instance.status,
    workspacePath: instance.workspacePath,
    configPath: instance.configPath,
    pendingRequests: instance.pendingRequests,
    lastActivityAt: new Date(instance.lastActivityAt).toISOString(),
    hasLlmApiKey: !!instance.llmApiKey,
    hasModelsConfig: !!instance.config.models,
  };

  if (opts.json) {
    runtime.log(JSON.stringify(info, null, 2));
    return;
  }

  runtime.log(`User: ${info.userId}`);
  runtime.log(`  Status:          ${info.status}`);
  runtime.log(`  Workspace:       ${info.workspacePath}`);
  runtime.log(`  Config:          ${info.configPath}`);
  runtime.log(`  Pending:         ${info.pendingRequests}`);
  runtime.log(`  Last Activity:   ${info.lastActivityAt}`);
  runtime.log(`  Has LLM API Key: ${info.hasLlmApiKey ? "yes" : "no"}`);
  runtime.log(`  Has Models:      ${info.hasModelsConfig ? "yes" : "no"}`);
}

/**
 * Clean up inactive users.
 */
export async function multiTenantUsersCleanupCommand(
  opts: { force?: boolean; json?: boolean },
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const config = await ensureMultiTenantEnabled(runtime);
  if (!config) return;

  const manager = createManagerForCli(config);
  manager.start();

  const beforeStats = manager.getStats();
  manager.cleanupInactiveUsers();
  const afterStats = manager.getStats();

  manager.stop();

  const evicted = beforeStats.activeInstances - afterStats.activeInstances;

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          evicted,
          before: beforeStats.activeInstances,
          after: afterStats.activeInstances,
        },
        null,
        2,
      ),
    );
    return;
  }

  runtime.log(`Cleanup complete. Evicted ${evicted} inactive users.`);
  runtime.log(`  Before: ${beforeStats.activeInstances} active instances`);
  runtime.log(`  After:  ${afterStats.activeInstances} active instances`);
}

/**
 * Force sync configs from cloud backend.
 */
export async function multiTenantConfigSyncCommand(
  opts: { json?: boolean },
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const config = await ensureMultiTenantEnabled(runtime);
  if (!config) return;

  const manager = createManagerForCli(config);

  const configSync = createConfigSyncService(manager, {
    cloudBackendUrl: config.cloudBackendUrl,
    serviceToken: config.serviceToken ?? "",
    syncIntervalMs: 0,
  });

  runtime.log("Syncing configs from cloud backend...");

  try {
    const updated = await configSync.syncNow();

    if (opts.json) {
      runtime.log(
        JSON.stringify(
          {
            success: true,
            usersUpdated: updated,
            syncedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      return;
    }

    runtime.log(`Sync complete. Updated ${updated} user configs.`);
  } catch (err) {
    if (opts.json) {
      runtime.log(
        JSON.stringify(
          {
            success: false,
            error: String(err),
          },
          null,
          2,
        ),
      );
      return;
    }

    runtime.error(`Sync failed: ${err}`);
  }
}

/**
 * Show multi-tenant gateway statistics.
 */
export async function multiTenantStatsCommand(
  opts: { json?: boolean },
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const config = await ensureMultiTenantEnabled(runtime);
  if (!config) return;

  const manager = createManagerForCli(config);

  // Sync to get accurate stats
  const configSync = createConfigSyncService(manager, {
    cloudBackendUrl: config.cloudBackendUrl,
    serviceToken: config.serviceToken ?? "",
    syncIntervalMs: 0,
  });

  try {
    await configSync.syncNow();
  } catch (err) {
    runtime.log(`Warning: Failed to sync configs: ${err}`);
  }

  const stats = manager.getStats();

  // Add memory usage
  const memUsage = process.memoryUsage();
  const extendedStats = {
    ...stats,
    memory: {
      heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMb: Math.round(memUsage.rss / 1024 / 1024),
    },
  };

  if (opts.json) {
    runtime.log(JSON.stringify(extendedStats, null, 2));
    return;
  }

  runtime.log(formatStats(stats));
  runtime.log(`Heap Used:         ${extendedStats.memory.heapUsedMb}MB`);
  runtime.log(`Heap Total:        ${extendedStats.memory.heapTotalMb}MB`);
  runtime.log(`RSS:               ${extendedStats.memory.rssMb}MB`);
}

/**
 * Multi-tenant command dispatcher.
 *
 * Usage:
 *   openclaw multi-tenant users list [--json]
 *   openclaw multi-tenant users info <userId> [--json]
 *   openclaw multi-tenant users cleanup [--force] [--json]
 *   openclaw multi-tenant config sync [--json]
 *   openclaw multi-tenant stats [--json]
 */
export async function multiTenantCommand(
  args: string[],
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const [subcommand, ...rest] = args;
  const hasJson = rest.includes("--json");

  switch (subcommand) {
    case "users": {
      const [action, ...actionArgs] = rest.filter((a) => !a.startsWith("--"));
      switch (action) {
        case "list":
          await multiTenantUsersListCommand({ json: hasJson }, runtime);
          break;
        case "info": {
          const userId = actionArgs[0];
          if (!userId) {
            runtime.error("Usage: openclaw multi-tenant users info <userId>");
            return;
          }
          await multiTenantUsersInfoCommand(userId, { json: hasJson }, runtime);
          break;
        }
        case "cleanup":
          await multiTenantUsersCleanupCommand(
            { force: rest.includes("--force"), json: hasJson },
            runtime,
          );
          break;
        default:
          runtime.error("Usage: openclaw multi-tenant users <list|info|cleanup>");
      }
      break;
    }

    case "config": {
      const [action] = rest.filter((a) => !a.startsWith("--"));
      switch (action) {
        case "sync":
          await multiTenantConfigSyncCommand({ json: hasJson }, runtime);
          break;
        default:
          runtime.error("Usage: openclaw multi-tenant config <sync>");
      }
      break;
    }

    case "stats":
      await multiTenantStatsCommand({ json: hasJson }, runtime);
      break;

    default:
      runtime.log("Multi-tenant management commands:");
      runtime.log("");
      runtime.log("  openclaw multi-tenant users list [--json]       List all registered users");
      runtime.log("  openclaw multi-tenant users info <userId>       Get user details");
      runtime.log("  openclaw multi-tenant users cleanup             Clean up inactive users");
      runtime.log("  openclaw multi-tenant config sync               Force sync from cloud");
      runtime.log("  openclaw multi-tenant stats [--json]            Show gateway statistics");
  }
}
