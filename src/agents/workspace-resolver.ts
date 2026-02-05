/**
 * Multi-tenant workspace file resolver.
 *
 * This module provides a workspace file resolution mechanism for multi-tenant mode.
 * Files are resolved with the following priority:
 * 1. User's custom file ({workspacePath}/custom/{filename})
 * 2. Template file ({templatePath}/{filename})
 * 3. Built-in default content
 *
 * This module does not modify existing workspace.ts logic - it provides an alternative
 * resolution mechanism for multi-tenant deployments.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { getMultiTenantTemplatePath } from "../config/multi-tenant.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
} from "./workspace.js";

/**
 * Workspace file resolver for multi-tenant mode.
 *
 * Provides file resolution with priority: user custom > template > default.
 */
export interface WorkspaceFileResolver {
  /** User ID this resolver is bound to */
  readonly userId: string;

  /** User's workspace directory path */
  readonly workspacePath: string;

  /** Template directory path */
  readonly templatePath: string;

  /**
   * Read a workspace file with priority resolution.
   * @param filename - File name (e.g., "AGENTS.md")
   * @returns File content or null if not found
   */
  readWorkspaceFile(filename: string): Promise<string | null>;

  /**
   * Write a file to user's custom directory.
   * @param filename - File name (e.g., "AGENTS.md")
   * @param content - File content
   */
  writeWorkspaceFile(filename: string, content: string): Promise<void>;

  /**
   * Check if a file exists in any resolution layer.
   * @param filename - File name
   * @returns Path where file was found, or null
   */
  resolveFilePath(filename: string): Promise<string | null>;

  /**
   * Get the path to user's memory directory.
   */
  getMemoryPath(): string;

  /**
   * Get the path to user's sessions directory.
   */
  getSessionsPath(): string;

  /**
   * Read today's memory file.
   * @returns Memory content or null
   */
  readTodayMemory(): Promise<string | null>;

  /**
   * Write today's memory file.
   * @param content - Memory content
   */
  writeTodayMemory(content: string): Promise<void>;

  /**
   * List all files in a directory within the workspace.
   * @param subdir - Subdirectory name (relative to workspace)
   */
  listFiles(subdir?: string): Promise<string[]>;
}

/**
 * Default content for bootstrap files when neither user nor template exists.
 */
const DEFAULT_FILE_CONTENT: Record<string, string> = {
  [DEFAULT_AGENTS_FILENAME]: `# Agent Configuration

This file configures your AI agent's behavior and capabilities.
`,
  [DEFAULT_SOUL_FILENAME]: `# Soul

Define your agent's personality and communication style.
`,
  [DEFAULT_TOOLS_FILENAME]: `# Tools

Configure available tools and their permissions.
`,
  [DEFAULT_IDENTITY_FILENAME]: `# Identity

Define your agent's identity and role.
`,
  [DEFAULT_USER_FILENAME]: `# User

Information about the user for personalization.
`,
  [DEFAULT_HEARTBEAT_FILENAME]: `# Heartbeat

Scheduled tasks and periodic actions.
`,
  [DEFAULT_BOOTSTRAP_FILENAME]: `# Bootstrap

Initial setup and onboarding instructions.
`,
  [DEFAULT_MEMORY_FILENAME]: `# Memory

Agent's persistent memory and learned information.
`,
};

/**
 * Get today's date string in YYYY-MM-DD format.
 */
function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Create a workspace file resolver for a specific user.
 *
 * @param params - Resolver configuration
 * @returns WorkspaceFileResolver instance
 */
export function createWorkspaceFileResolver(params: {
  userId: string;
  workspacePath: string;
  templatePath?: string;
}): WorkspaceFileResolver {
  const { userId, workspacePath } = params;
  const templatePath = params.templatePath || getMultiTenantTemplatePath();

  // Directory structure:
  // {workspacePath}/
  //   custom/          - User's custom files (highest priority)
  //   memory/          - Memory files
  //   sessions/        - Session files

  const customDir = path.join(workspacePath, "custom");
  // Use the passed workspacePath directly to ensure consistency
  // (don't rely on global config functions which might return different paths)
  const memoryDir = path.join(workspacePath, "memory");
  const sessionsDir = path.join(workspacePath, "sessions");

  /**
   * Try to read a file, return null if it doesn't exist.
   */
  async function tryReadFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ENOENT") return null;
      throw err;
    }
  }

  /**
   * Ensure a directory exists.
   */
  async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  }

  const resolver: WorkspaceFileResolver = {
    userId,
    workspacePath,
    templatePath,

    async readWorkspaceFile(filename: string): Promise<string | null> {
      // Sanitize filename to prevent directory traversal
      const safeName = path.basename(filename);

      // Priority 1: User's custom file
      const customPath = path.join(customDir, safeName);
      const customContent = await tryReadFile(customPath);
      if (customContent !== null) return customContent;

      // Priority 2: Template file
      const templateFilePath = path.join(templatePath, safeName);
      const templateContent = await tryReadFile(templateFilePath);
      if (templateContent !== null) return templateContent;

      // Priority 3: Built-in default
      const defaultContent = DEFAULT_FILE_CONTENT[safeName];
      if (defaultContent) return defaultContent;

      return null;
    },

    async writeWorkspaceFile(filename: string, content: string): Promise<void> {
      const safeName = path.basename(filename);
      await ensureDir(customDir);
      const filePath = path.join(customDir, safeName);
      await fs.writeFile(filePath, content, { encoding: "utf-8", mode: 0o600 });
    },

    async resolveFilePath(filename: string): Promise<string | null> {
      const safeName = path.basename(filename);

      // Check custom directory
      const customPath = path.join(customDir, safeName);
      try {
        await fs.access(customPath);
        return customPath;
      } catch {
        // Not in custom
      }

      // Check template directory
      const templateFilePath = path.join(templatePath, safeName);
      try {
        await fs.access(templateFilePath);
        return templateFilePath;
      } catch {
        // Not in template
      }

      // Check if we have a built-in default
      if (safeName in DEFAULT_FILE_CONTENT) {
        return `builtin:${safeName}`;
      }

      return null;
    },

    getMemoryPath(): string {
      return memoryDir;
    },

    getSessionsPath(): string {
      return sessionsDir;
    },

    async readTodayMemory(): Promise<string | null> {
      const todayFile = `${getTodayDateString()}.md`;
      const memoryPath = path.join(memoryDir, todayFile);
      return tryReadFile(memoryPath);
    },

    async writeTodayMemory(content: string): Promise<void> {
      await ensureDir(memoryDir);
      const todayFile = `${getTodayDateString()}.md`;
      const memoryPath = path.join(memoryDir, todayFile);
      await fs.writeFile(memoryPath, content, { encoding: "utf-8", mode: 0o600 });
    },

    async listFiles(subdir?: string): Promise<string[]> {
      const targetDir = subdir ? path.join(workspacePath, subdir) : workspacePath;
      try {
        const entries = await fs.readdir(targetDir);
        return entries;
      } catch {
        return [];
      }
    },
  };

  return resolver;
}

/**
 * Load all bootstrap files using the workspace resolver.
 *
 * This is the multi-tenant equivalent of loadWorkspaceBootstrapFiles from workspace.ts.
 */
export async function loadBootstrapFilesWithResolver(resolver: WorkspaceFileResolver): Promise<
  Array<{
    name: string;
    path: string | null;
    content: string | null;
    source: "custom" | "template" | "builtin" | "missing";
  }>
> {
  const bootstrapFiles = [
    DEFAULT_AGENTS_FILENAME,
    DEFAULT_SOUL_FILENAME,
    DEFAULT_TOOLS_FILENAME,
    DEFAULT_IDENTITY_FILENAME,
    DEFAULT_USER_FILENAME,
    DEFAULT_HEARTBEAT_FILENAME,
    DEFAULT_BOOTSTRAP_FILENAME,
  ];

  const results: Array<{
    name: string;
    path: string | null;
    content: string | null;
    source: "custom" | "template" | "builtin" | "missing";
  }> = [];

  for (const filename of bootstrapFiles) {
    const resolvedPath = await resolver.resolveFilePath(filename);
    const content = await resolver.readWorkspaceFile(filename);

    let source: "custom" | "template" | "builtin" | "missing" = "missing";
    if (resolvedPath) {
      if (resolvedPath.startsWith("builtin:")) {
        source = "builtin";
      } else if (resolvedPath.includes(resolver.templatePath)) {
        source = "template";
      } else {
        source = "custom";
      }
    }

    results.push({
      name: filename,
      path: resolvedPath?.startsWith("builtin:") ? null : resolvedPath,
      content,
      source,
    });
  }

  return results;
}

/**
 * Copy template files to user's workspace.
 *
 * Useful for initializing a new user's workspace with template files.
 */
export async function initializeUserWorkspace(
  resolver: WorkspaceFileResolver,
  options?: {
    /** Only copy if user has no custom files */
    onlyIfEmpty?: boolean;
    /** Files to copy (defaults to all bootstrap files) */
    files?: string[];
  },
): Promise<string[]> {
  const filesToCopy = options?.files || [
    DEFAULT_AGENTS_FILENAME,
    DEFAULT_SOUL_FILENAME,
    DEFAULT_TOOLS_FILENAME,
    DEFAULT_IDENTITY_FILENAME,
    DEFAULT_USER_FILENAME,
    DEFAULT_HEARTBEAT_FILENAME,
  ];

  // Check if workspace already has custom files
  if (options?.onlyIfEmpty) {
    const existingFiles = await resolver.listFiles("custom");
    if (existingFiles.length > 0) {
      return [];
    }
  }

  const copiedFiles: string[] = [];

  for (const filename of filesToCopy) {
    const content = await resolver.readWorkspaceFile(filename);
    if (content !== null) {
      await resolver.writeWorkspaceFile(filename, content);
      copiedFiles.push(filename);
    }
  }

  return copiedFiles;
}
