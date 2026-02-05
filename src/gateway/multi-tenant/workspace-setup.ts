/**
 * Multi-tenant user workspace setup module.
 *
 * Responsible for creating user workspace directories and configuring
 * auth-profiles.json for LLM API access.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("gateway").child("workspace");

/**
 * Options for setting up a user workspace.
 */
export interface SetupUserWorkspaceOptions {
  /** User ID from cloud backend */
  userId: string;
  /** User's LLM API key */
  llmApiKey?: string | null;
  /** LLM API base URL from cloud backend */
  llmApiBaseUrl?: string | null;
  /** Root directory for user workspaces */
  workspaceRoot: string;
}

/**
 * Structure for auth-profiles.json
 */
interface AuthProfiles {
  profiles: Array<{
    id: string;
    displayName: string;
    providers: Array<{
      provider: string;
      apiKey: string;
      baseURL?: string;
    }>;
  }>;
  defaultProfileId: string;
}

/**
 * Get the path to a user's workspace directory.
 */
export function getUserWorkspacePath(workspaceRoot: string, userId: string): string {
  return path.join(workspaceRoot, "users", userId);
}

/**
 * Get the path to a user's agent directory.
 * Structure: {workspaceRoot}/users/{userId}/agent/
 */
export function getUserAgentPath(workspaceRoot: string, userId: string): string {
  return path.join(getUserWorkspacePath(workspaceRoot, userId), "agent");
}

/**
 * Result of setting up a user workspace.
 */
export interface SetupUserWorkspaceResult {
  /** Path to the user's agent directory (contains auth-profiles.json) */
  agentDir: string;
  /** Path to the user's workspace directory (for file I/O) */
  workspaceDir: string;
}

/**
 * Set up a user's workspace directory structure and auth configuration.
 *
 * Creates the following structure:
 * - {workspaceRoot}/users/{userId}/
 *   - agent/
 *     - auth-profiles.json
 *     - models.json
 *   - sessions/
 *   - memory/
 *   - custom/
 *
 * @returns The paths to user's agent and workspace directories
 */
export async function setupUserWorkspace(
  opts: SetupUserWorkspaceOptions,
): Promise<SetupUserWorkspaceResult | null> {
  const { userId, llmApiKey, llmApiBaseUrl, workspaceRoot } = opts;

  if (!workspaceRoot) {
    log.warn(`setupUserWorkspace: workspaceRoot not configured, skipping for user=${userId}`);
    return null;
  }

  const userWorkspace = getUserWorkspacePath(workspaceRoot, userId);
  const agentDir = getUserAgentPath(workspaceRoot, userId);
  // workspaceDir is the user's workspace root (for file I/O, bootstrap files, etc.)
  const workspaceDir = userWorkspace;

  try {
    // Create directory structure
    const dirs = [
      agentDir,
      path.join(userWorkspace, "sessions"),
      path.join(userWorkspace, "memory"),
      path.join(userWorkspace, "custom"),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        log.info(`created directory: ${dir}`);
      }
    }

    // Write auth-profiles.json if we have API key info
    if (llmApiKey) {
      await writeAuthProfiles(agentDir, llmApiKey, llmApiBaseUrl);
      // Write models.json to configure provider baseUrl
      if (llmApiBaseUrl) {
        await writeModelsJson(agentDir, llmApiBaseUrl);
      }
      log.info(`workspace setup complete for user=${userId}`);
    } else {
      log.warn(`no llmApiKey provided for user=${userId}, auth-profiles.json not written`);
    }

    // Write default user config file
    await writeUserConfig(agentDir);

    // Write default workspace files (HEARTBEAT.md, etc.)
    await writeDefaultFiles(workspaceDir);

    return { agentDir, workspaceDir };
  } catch (err) {
    log.error(`failed to setup workspace for user=${userId}: ${err}`);
    throw err;
  }
}

/**
 * Write auth-profiles.json with LLM API configuration.
 *
 * Uses the AuthProfileStore format expected by the agent:
 * { version: 1, profiles: { 'provider:default': { type: 'api_key', provider, key, baseURL? } } }
 */
async function writeAuthProfiles(
  agentDir: string,
  llmApiKey: string,
  llmApiBaseUrl?: string | null,
): Promise<void> {
  const authProfilesPath = path.join(agentDir, "auth-profiles.json");

  // Build profiles record with correct format
  const profiles: Record<
    string,
    {
      type: "api_key";
      provider: string;
      key: string;
      baseURL?: string;
    }
  > = {};

  // Configure providers that go through the cloud LLM gateway
  const gatewayProviders = ["anthropic", "openai"] as const;

  for (const provider of gatewayProviders) {
    const profileId = `${provider}:default`;
    profiles[profileId] = {
      type: "api_key",
      provider,
      key: llmApiKey,
      ...(llmApiBaseUrl ? { baseURL: llmApiBaseUrl } : {}),
    };
  }

  const authStore = {
    version: 1,
    profiles,
  };

  fs.writeFileSync(authProfilesPath, JSON.stringify(authStore, null, 2), "utf-8");
  log.info(`wrote auth-profiles.json to ${authProfilesPath}`);
}

/**
 * Write models.json with provider baseUrl configuration.
 *
 * This configures providers to use the cloud LLM gateway proxy endpoint.
 */
async function writeModelsJson(agentDir: string, llmApiBaseUrl: string): Promise<void> {
  const modelsJsonPath = path.join(agentDir, "models.json");

  // Configure providers to use the LLM gateway proxy
  const modelsConfig = {
    providers: {
      anthropic: {
        baseUrl: llmApiBaseUrl,
      },
      openai: {
        baseUrl: llmApiBaseUrl,
      },
    },
  };

  fs.writeFileSync(modelsJsonPath, JSON.stringify(modelsConfig, null, 2), "utf-8");
  log.info(`wrote models.json to ${modelsJsonPath}`);
}

/**
 * Write default openclaw.json config for user.
 * This is a minimal config that inherits most settings from the global config.
 */
async function writeUserConfig(agentDir: string): Promise<void> {
  const configPath = path.join(agentDir, "openclaw.json");
  if (fs.existsSync(configPath)) {
    return; // Don't overwrite existing config
  }

  // Minimal user config - inherits most settings from global
  const userConfig = {
    // User-specific settings can be added here
    // The global gateway config handles shared settings
    meta: {
      description: "User-specific OpenClaw configuration",
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(userConfig, null, 2) + "\n", "utf-8");
  log.info(`created default openclaw.json at ${configPath}`);
}

const HEARTBEAT_MD_CONTENT = `# Agent Heartbeat Instructions

This file serves as a persistent context for the AI agent.
The agent reads this file to understand long-running tasks or persistent instructions that should be followed across chat sessions.

If this file is empty, no special heartbeat instructions are active.
`;

const USER_MD_CONTENT = `# USER.md - User Profile

- Name:
- Preferred address:
- Notes:
`;

/**
 * Write default workspace files if they don't exist.
 */
async function writeDefaultFiles(workspaceDir: string): Promise<void> {
  const heartbeatPath = path.join(workspaceDir, "HEARTBEAT.md");
  if (!fs.existsSync(heartbeatPath)) {
    fs.writeFileSync(heartbeatPath, HEARTBEAT_MD_CONTENT, "utf-8");
    log.info(`created default HEARTBEAT.md at ${heartbeatPath}`);
  }

  const userMdPath = path.join(workspaceDir, "USER.md");
  if (!fs.existsSync(userMdPath)) {
    fs.writeFileSync(userMdPath, USER_MD_CONTENT, "utf-8");
    log.info(`created default USER.md at ${userMdPath}`);
  }
}
