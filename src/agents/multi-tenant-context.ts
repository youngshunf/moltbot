/**
 * Multi-tenant Agent context utilities.
 *
 * This module provides helper functions for running agents in multi-tenant mode.
 * It does not modify any existing agent code - it provides utilities that can be
 * used to wrap agent operations with multi-tenant context.
 */

import type { OpenClawConfig } from "../config/types.js";
import type { UserInstance } from "../config/types.multi-tenant.js";
import type { MultiTenantGatewayManager } from "../gateway/multi-tenant/manager.js";
import type { WorkspaceFileResolver } from "./workspace-resolver.js";
import { createWorkspaceFileResolver } from "./workspace-resolver.js";

/**
 * Multi-tenant context for agent execution.
 */
export interface MultiTenantAgentContext {
  /** User ID */
  userId: string;

  /** User instance from manager */
  userInstance: UserInstance;

  /** User's configuration */
  config: OpenClawConfig;

  /** Workspace file resolver */
  workspaceResolver: WorkspaceFileResolver;

  /** Path to user's workspace */
  workspacePath: string;

  /** Path to user's agent directory */
  agentDir: string;

  /** Reference to the manager for pending request tracking */
  manager: MultiTenantGatewayManager;
}

/**
 * Resolve multi-tenant context for a user.
 *
 * @param manager - Multi-tenant gateway manager
 * @param userId - User ID
 * @returns Multi-tenant context or null if user not found
 */
export async function resolveMultiTenantContext(
  manager: MultiTenantGatewayManager,
  userId: string,
): Promise<MultiTenantAgentContext | null> {
  const userInstance = await manager.getUserInstance(userId);
  if (!userInstance) return null;

  const workspaceResolver = manager.getWorkspaceResolver(userId);
  if (!workspaceResolver) return null;

  return {
    userId,
    userInstance,
    config: userInstance.config,
    workspaceResolver,
    workspacePath: userInstance.workspacePath,
    agentDir: `${userInstance.workspacePath}/agent`,
    manager,
  };
}

/**
 * Wrap a function with pending request tracking.
 *
 * This ensures the user instance is not evicted while the request is in progress.
 *
 * @param context - Multi-tenant context
 * @param fn - Function to execute
 * @returns Result of the function
 */
export async function wrapWithPendingRequests<T>(
  context: MultiTenantAgentContext,
  fn: () => Promise<T>,
): Promise<T> {
  context.manager.incrementPendingRequests(context.userId);
  try {
    return await fn();
  } finally {
    context.manager.decrementPendingRequests(context.userId);
  }
}

/**
 * Create a workspace resolver for a specific user.
 *
 * This is a standalone function that doesn't require a manager.
 * Useful for testing or standalone usage.
 */
export function createUserWorkspaceResolver(params: {
  userId: string;
  workspacePath: string;
  templatePath?: string;
}): WorkspaceFileResolver {
  return createWorkspaceFileResolver(params);
}

/**
 * Type guard to check if context is multi-tenant.
 */
export function isMultiTenantContext(context: unknown): context is MultiTenantAgentContext {
  if (!context || typeof context !== "object") return false;
  const ctx = context as Record<string, unknown>;
  return (
    typeof ctx.userId === "string" &&
    ctx.userInstance !== undefined &&
    ctx.workspaceResolver !== undefined &&
    ctx.manager !== undefined
  );
}

/**
 * Extract agent-relevant paths from multi-tenant context.
 */
export function extractAgentPaths(context: MultiTenantAgentContext): {
  workspaceDir: string;
  agentDir: string;
  sessionsPath: string;
  memoryPath: string;
} {
  return {
    workspaceDir: context.workspacePath,
    agentDir: context.agentDir,
    sessionsPath: context.workspaceResolver.getSessionsPath(),
    memoryPath: context.workspaceResolver.getMemoryPath(),
  };
}
