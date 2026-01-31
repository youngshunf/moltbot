/**
 * Multi-tenant Agent runner wrapper.
 *
 * This module wraps the existing runEmbeddedPiAgent function to add
 * multi-tenant support. It does not modify the existing runner -
 * it provides an alternative entry point for multi-tenant mode.
 */

import type { MultiTenantAgentContext } from "../multi-tenant-context.js";
import { wrapWithPendingRequests, extractAgentPaths } from "../multi-tenant-context.js";
import { runEmbeddedPiAgent } from "./run.js";
import type { RunEmbeddedPiAgentParams } from "./run/params.js";
import type { EmbeddedPiRunResult } from "./types.js";

/**
 * Extended parameters for multi-tenant agent runs.
 */
export interface RunMultiTenantAgentParams extends Omit<
  RunEmbeddedPiAgentParams,
  "workspaceDir" | "agentDir" | "config"
> {
  /** Multi-tenant context (required in multi-tenant mode) */
  multiTenantContext: MultiTenantAgentContext;
}

/**
 * Extended result for multi-tenant agent runs.
 */
export interface MultiTenantRunResult extends EmbeddedPiRunResult {
  /** User ID for tracking */
  userId: string;
}

/**
 * Run an embedded Pi agent in multi-tenant mode.
 *
 * This function:
 * 1. Wraps the execution with pending request tracking
 * 2. Uses the user's workspace and config from context
 * 3. Reports usage after completion
 *
 * @param params - Extended parameters with multi-tenant context
 * @returns Extended result with multi-tenant info
 */
export async function runMultiTenantAgent(
  params: RunMultiTenantAgentParams,
): Promise<MultiTenantRunResult> {
  const { multiTenantContext, ...baseParams } = params;
  const paths = extractAgentPaths(multiTenantContext);

  // Run with pending request tracking to prevent eviction
  const result = await wrapWithPendingRequests(multiTenantContext, async () => {
    return runEmbeddedPiAgent({
      ...baseParams,
      workspaceDir: paths.workspaceDir,
      agentDir: paths.agentDir,
      config: multiTenantContext.config,
    });
  });

  // Usage is tracked by LLM gateway via API key, no need to report here

  return {
    ...result,
    userId: multiTenantContext.userId,
  };
}

/**
 * Build multi-tenant agent params from base params and context.
 *
 * This is useful when you have standard params and want to convert
 * them to multi-tenant params.
 */
export function buildMultiTenantParams(
  baseParams: Omit<RunEmbeddedPiAgentParams, "workspaceDir" | "agentDir" | "config">,
  context: MultiTenantAgentContext,
): RunMultiTenantAgentParams {
  return {
    ...baseParams,
    multiTenantContext: context,
  };
}

/**
 * Check if a run should use multi-tenant mode.
 *
 * Returns true if a multi-tenant context is available and the user
 * is in active status.
 */
export function shouldUseMultiTenantMode(
  context: MultiTenantAgentContext | null | undefined,
): context is MultiTenantAgentContext {
  if (!context) return false;
  return context.userInstance.status === "active";
}

/**
 * Run agent with automatic mode detection.
 *
 * If multi-tenant context is provided and valid, runs in multi-tenant mode.
 * Otherwise, falls back to standard single-user mode.
 */
export async function runAgentAutoMode(
  params: RunEmbeddedPiAgentParams,
  multiTenantContext?: MultiTenantAgentContext | null,
): Promise<EmbeddedPiRunResult | MultiTenantRunResult> {
  if (shouldUseMultiTenantMode(multiTenantContext)) {
    // Extract non-overridable params
    const { workspaceDir: _w, agentDir: _a, config: _c, ...baseParams } = params;

    return runMultiTenantAgent({
      ...baseParams,
      multiTenantContext,
    });
  }

  // Fall back to standard mode
  return runEmbeddedPiAgent(params);
}
