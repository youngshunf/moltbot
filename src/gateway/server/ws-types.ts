import type { WebSocket } from "ws";

import type { ConnectParams } from "../protocol/index.js";

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  connId: string;
  presenceKey?: string;
  /** Multi-tenant user ID (only present when authenticated via gateway token) */
  multiTenantUserId?: string;
  /** Multi-tenant user agent directory path (for auth-profiles.json etc.) */
  multiTenantAgentDir?: string;
  /** Multi-tenant user workspace directory path (for file I/O) */
  multiTenantWorkspaceDir?: string;
};
