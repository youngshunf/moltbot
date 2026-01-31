/**
 * Multi-tenant Gateway module exports.
 *
 * This module provides all multi-tenant functionality for the Gateway.
 * Import from this file to use multi-tenant features.
 */

// Types
export type {
  MultiTenantContext,
  GatewayWsClientMultiTenant,
  MultiTenantAuthResult,
  MultiTenantManagerStats,
  MultiTenantManagerEvent,
  MultiTenantManagerEventListener,
  MultiTenantManagerOptions,
} from "./types.js";

export { hasMultiTenantContext } from "./types.js";

// Manager
export { MultiTenantGatewayManager, createMultiTenantGatewayManager } from "./manager.js";

// Authentication
export {
  authorizeGatewayConnectMultiTenant,
  extractGatewayToken,
  isMultiTenantAuthAttempt,
  buildConnectAuthFromRequest,
} from "./auth.js";

// Config Sync
export type { ConfigSyncServiceOptions } from "./config-sync.js";
export { ConfigSyncService, createConfigSyncService } from "./config-sync.js";

// Monitor
export type { AlertSeverity, Alert, AlertHandler, MonitorOptions } from "./monitor.js";
export { MultiTenantMonitor, createMultiTenantMonitor, formatStats } from "./monitor.js";
