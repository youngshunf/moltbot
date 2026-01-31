/**
 * Multi-tenant authentication extension.
 *
 * This module extends the existing Gateway authentication to support
 * multi-tenant mode. It does not modify the existing auth.ts file -
 * it provides an additional authentication function that wraps the
 * existing logic and adds multi-tenant token support.
 */

import type { IncomingMessage } from "node:http";

import {
  authorizeGatewayConnect,
  type ResolvedGatewayAuth,
  type GatewayAuthResult,
} from "../auth.js";
import type { TailscaleWhoisIdentity } from "../../infra/tailscale.js";
import type { MultiTenantGatewayManager } from "./manager.js";
import type { MultiTenantAuthResult } from "./types.js";

type TailscaleWhoisLookup = (ip: string) => Promise<TailscaleWhoisIdentity | null>;

type ConnectAuth = {
  token?: string;
  password?: string;
  /** Multi-tenant gateway token (different from single-user token) */
  gatewayToken?: string;
};

/**
 * Extended authentication for multi-tenant mode.
 *
 * This function wraps the existing authorizeGatewayConnect and adds
 * support for multi-tenant gateway tokens. The authentication flow is:
 *
 * 1. If multi-tenant mode and gatewayToken provided:
 *    - Validate token against MultiTenantGatewayManager
 *    - Return userId if valid
 *
 * 2. Fall back to existing authentication:
 *    - Token auth
 *    - Password auth
 *    - Tailscale auth
 *
 * This preserves full backward compatibility with single-user mode.
 */
export async function authorizeGatewayConnectMultiTenant(params: {
  auth: ResolvedGatewayAuth;
  connectAuth?: ConnectAuth | null;
  req?: IncomingMessage;
  trustedProxies?: string[];
  tailscaleWhois?: TailscaleWhoisLookup;
  /** Multi-tenant manager (only in multi-tenant mode) */
  multiTenantManager?: MultiTenantGatewayManager | null;
}): Promise<MultiTenantAuthResult> {
  const { auth, connectAuth, req, trustedProxies, tailscaleWhois, multiTenantManager } = params;

  // Multi-tenant authentication path
  if (multiTenantManager && connectAuth?.gatewayToken) {
    const userId = multiTenantManager.authenticateToken(connectAuth.gatewayToken);

    if (userId) {
      return {
        ok: true,
        method: "gateway-token",
        userId,
      };
    }

    // Token provided but invalid - don't fall through to other auth methods
    return {
      ok: false,
      reason: "gateway_token_invalid",
    };
  }

  // Fall back to standard authentication
  const standardResult = await authorizeGatewayConnect({
    auth,
    connectAuth: connectAuth ? { token: connectAuth.token, password: connectAuth.password } : null,
    req,
    trustedProxies,
    tailscaleWhois,
  });

  // Convert to multi-tenant result format (without userId)
  return {
    ...standardResult,
    userId: undefined,
  };
}

/**
 * Extract gateway token from various sources.
 *
 * Checks (in order):
 * 1. X-Gateway-Token header
 * 2. Authorization: Bearer header
 * 3. Query parameter ?gateway_token=
 */
export function extractGatewayToken(req?: IncomingMessage): string | null {
  if (!req) return null;

  // Check X-Gateway-Token header
  const gatewayTokenHeader = req.headers["x-gateway-token"];
  if (typeof gatewayTokenHeader === "string" && gatewayTokenHeader.trim()) {
    return gatewayTokenHeader.trim();
  }

  // Check Authorization: Bearer header
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  // Check query parameter (for WebSocket upgrade requests)
  const url = req.url;
  if (url) {
    try {
      const searchParams = new URL(url, "http://localhost").searchParams;
      const tokenParam = searchParams.get("gateway_token");
      if (tokenParam) {
        return tokenParam.trim();
      }
    } catch {
      // Invalid URL, ignore
    }
  }

  return null;
}

/**
 * Check if the request appears to be a multi-tenant authentication attempt.
 *
 * This is useful for deciding whether to use multi-tenant auth flow
 * before actually validating the token.
 */
export function isMultiTenantAuthAttempt(
  req?: IncomingMessage,
  connectAuth?: ConnectAuth | null,
): boolean {
  // Check if gatewayToken is in connect params
  if (connectAuth?.gatewayToken) {
    return true;
  }

  // Check if gateway token header is present
  if (extractGatewayToken(req)) {
    return true;
  }

  return false;
}

/**
 * Build ConnectAuth from request headers and query params.
 *
 * This is useful for extracting auth info from HTTP upgrade requests.
 */
export function buildConnectAuthFromRequest(
  req: IncomingMessage,
  existingAuth?: ConnectAuth | null,
): ConnectAuth {
  const gatewayToken = extractGatewayToken(req);

  return {
    ...existingAuth,
    gatewayToken: gatewayToken ?? existingAuth?.gatewayToken,
  };
}
