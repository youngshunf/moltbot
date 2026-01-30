# Openclaw 多租户 SaaS 化改造方案 - 改造清单

## 改造优先级

```
P0 (必须) - 核心多租户支持
├─ 配置系统改造
├─ Gateway 认证改造
├─ 工作区隔离
└─ 会话管理隔离

P1 (重要) - 功能完善
├─ 配置同步服务
├─ 用户实例管理
├─ LRU 缓存清理
└─ 监控和日志

P2 (优化) - 增强功能
├─ 性能优化
├─ 错误处理
└─ 管理工具
```

---

## P0-1: 配置系统改造

### 文件：`src/config/io.ts`

**改造内容**：支持多租户配置加载

```typescript
// 改造前：单用户配置加载
export async function loadConfig(): Promise<OpenclawConfig> {
  const configPath = getConfigPath();  // ~/.clawdbot/openclaw.json
  return await readConfigFile(configPath);
}

// 改造后：支持多租户配置加载
export async function loadConfig(userId?: string): Promise<OpenclawConfig> {
  if (userId) {
    // 多租户模式：加载用户专属配置
    const configPath = getUserConfigPath(userId);
    return await readConfigFile(configPath);
  } else {
    // 单用户模式（向后兼容）
    const configPath = getConfigPath();
    return await readConfigFile(configPath);
  }
}

export function getUserConfigPath(userId: string): string {
  const configRoot = getMultiTenantConfigRoot();
  return `${configRoot}/users/${userId}/openclaw.json`;
}

export function getMultiTenantConfigRoot(): string {
  const globalConfig = loadGlobalConfig();
  return globalConfig.multiTenant?.configRoot || '/data/openclaw/configs';
}
```

### 新增文件：`src/config/multi-tenant.ts`

**内容**：多租户配置类型和加载函数

```typescript
export interface MultiTenantConfig {
  enabled: boolean;
  cloudBackendUrl: string;
  configRoot: string;
  workspaceRoot: string;
  templatePath: string;
  maxCachedUsers: number;
  userIdleTimeoutMs: number;
  syncIntervalMs: number;
}

export function loadGlobalConfig(): { multiTenant?: MultiTenantConfig } {
  // 优先级：环境变量 > /etc/openclaw/config.json > ~/.clawdbot/openclaw.json
  const configPath = process.env.OPENCLAW_GLOBAL_CONFIG
    || '/etc/openclaw/config.json'
    || '~/.clawdbot/openclaw.json';

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

export function getMultiTenantConfigRoot(): string {
  const globalConfig = loadGlobalConfig();
  return globalConfig.multiTenant?.configRoot || '/data/openclaw/configs';
}

export function getMultiTenantWorkspaceRoot(): string {
  const globalConfig = loadGlobalConfig();
  return globalConfig.multiTenant?.workspaceRoot || '/data/openclaw/workspaces';
}

export function getUserConfigPath(userId: string): string {
  const configRoot = getMultiTenantConfigRoot();
  return path.join(configRoot, 'users', userId, 'openclaw.json');
}

export function getUserWorkspacePath(userId: string): string {
  const workspaceRoot = getMultiTenantWorkspaceRoot();
  return path.join(workspaceRoot, 'users', userId);
}
```

---

## P0-2: Gateway 认证改造

### 文件：`src/gateway/auth.ts`

**改造内容**：支持多租户 token 验证

```typescript
// 改造前：单 token 验证
export function validateGatewayToken(token: string): boolean {
  const expectedToken = process.env.CLAWDBOT_GATEWAY_TOKEN;
  return !expectedToken || token === expectedToken;
}

// 改造后：多租户 token 验证
export async function validateGatewayToken(
  token: string,
  manager?: MultiTenantGatewayManager
): Promise<{ valid: boolean; userId?: string }> {

  // 多租户模式
  if (manager) {
    const userId = await manager.authenticateToken(token);
    return { valid: !!userId, userId };
  }

  // 单用户模式（向后兼容）
  const expectedToken = process.env.CLAWDBOT_GATEWAY_TOKEN;
  const valid = !expectedToken || token === expectedToken;
  return { valid };
}
```

### 文件：`src/gateway/server/ws-connection/message-handler.ts`

**改造内容**：connect 请求处理，绑定用户上下文

```typescript
// 改造：connect 请求处理
async function handleConnect(
  ws: WebSocket,
  params: ConnectParams,
  context: GatewayContext
): Promise<ConnectResponse> {

  const { manager } = context;

  // 验证 token
  const authResult = await validateGatewayToken(params.auth.token, manager);

  if (!authResult.valid) {
    throw new Error('Invalid gateway token');
  }

  // 多租户模式：绑定用户上下文
  if (authResult.userId) {
    const userInstance = await manager.getUserInstance(authResult.userId);
    userInstance.connections.add(ws);

    ws.userData = {
      userId: authResult.userId,
      userInstance,
      config: userInstance.config,
      workspacePath: userInstance.workspacePath,
      workspaceResolver: userInstance.workspaceResolver
    };

    console.log(`[Gateway] User ${authResult.userId} connected`);
  }

  return {
    type: 'hello-ok',
    protocol: PROTOCOL_VERSION,
    policy: { tickIntervalMs: 15000 }
  };
}
```

---

## P0-3: 工作区隔离

### 新增文件：`src/agents/workspace-resolver.ts`

**内容**：工作区文件解析器

```typescript
export class WorkspaceFileResolver {
  constructor(
    private userWorkspacePath: string,
    private templatePath: string
  ) {}

  async readWorkspaceFile(filename: string): Promise<string> {
    // 1. 尝试读取用户自定义文件
    const customPath = path.join(this.userWorkspacePath, 'custom', filename);
    if (await this.exists(customPath)) {
      return await fs.readFile(customPath, 'utf-8');
    }

    // 2. 回退到模板
    const templateFilePath = path.join(this.templatePath, filename);
    if (await this.exists(templateFilePath)) {
      return await fs.readFile(templateFilePath, 'utf-8');
    }

    // 3. 返回默认内容
    return this.getDefaultContent(filename);
  }

  async writeWorkspaceFile(filename: string, content: string): Promise<void> {
    const customPath = path.join(this.userWorkspacePath, 'custom', filename);
    await fs.mkdir(path.dirname(customPath), { recursive: true });
    await fs.writeFile(customPath, content, 'utf-8');
  }

  getMemoryPath(): string {
    return path.join(this.userWorkspacePath, 'memory');
  }

  getSessionsPath(): string {
    return path.join(this.userWorkspacePath, 'sessions');
  }

  async readTodayMemory(): Promise<string> {
    const today = new Date().toISOString().split('T')[0];
    const memoryPath = path.join(this.getMemoryPath(), `${today}.md`);
    if (await this.exists(memoryPath)) {
      return await fs.readFile(memoryPath, 'utf-8');
    }
    return '';
  }

  async writeTodayMemory(content: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const memoryPath = path.join(this.getMemoryPath(), `${today}.md`);
    await fs.writeFile(memoryPath, content, 'utf-8');
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private getDefaultContent(filename: string): string {
    const defaults: Record<string, string> = {
      'AGENTS.md': '# Agent 行为指南\n\n你是一个有帮助的 AI 助手。',
      'SOUL.md': '# 人格设定\n\n友好、专业、高效。',
      'USER.md': '# 用户信息\n\n用户偏好待补充。',
      'IDENTITY.md': '# Agent 身份\n\n我是你的 AI 助手。',
      'TOOLS.md': '# 工具使用说明\n\n可用工具列表待补充。',
      'HEARTBEAT.md': '# 心跳检查\n\n定期检查系统状态。'
    };
    return defaults[filename] || `# ${filename}\n\n内容待补充。`;
  }
}
```

### 文件：`src/agents/pi-embedded-runner/run.ts`

**改造内容**：使用工作区解析器

```typescript
// 改造：使用工作区解析器
export async function runPiEmbedded(
  params: AgentParams,
  context: AgentContext
): Promise<AgentResponse> {

  // 获取工作区解析器（多租户模式）
  const workspaceResolver = context.workspaceResolver
    || new WorkspaceFileResolver(
        context.workspacePath || '~/clawd',
        '/data/openclaw/workspaces/template'
      );

  // 读取工作区文件
  const agentsMd = await workspaceResolver.readWorkspaceFile('AGENTS.md');
  const soulMd = await workspaceResolver.readWorkspaceFile('SOUL.md');
  const userMd = await workspaceResolver.readWorkspaceFile('USER.md');
  const todayMemory = await workspaceResolver.readTodayMemory();

  // 构建系统提示
  const systemPrompt = buildSystemPrompt({
    agentsMd,
    soulMd,
    userMd,
    todayMemory,
    memoryPath: workspaceResolver.getMemoryPath(),
    // ...
  });

  // ... 其余逻辑
}
```

---

## P0-4: 会话管理隔离

### 文件：`src/sessions/store.ts`

**改造内容**：支持多租户会话存储

```typescript
// 改造前：单用户会话存储
export function getSessionsPath(agentId: string): string {
  return `~/.clawdbot/agents/${agentId}/sessions`;
}

// 改造后：多租户会话存储
export function getSessionsPath(userId?: string, agentId?: string): string {
  if (userId) {
    // 多租户模式
    const workspaceRoot = getMultiTenantWorkspaceRoot();
    return `${workspaceRoot}/users/${userId}/sessions`;
  } else {
    // 单用户模式（向后兼容）
    return `~/.clawdbot/agents/${agentId}/sessions`;
  }
}
```

---

## P1-1: 多租户管理器

### 新增文件：`src/gateway/multi-tenant-manager.ts`

**内容**：完整的多租户管理器实现（见 02-核心组件设计.md）

**核心功能**：
- 用户实例管理（懒加载）
- Token 验证
- 配置同步
- LRU 清理

---

## P1-2: 配置同步服务（改进版）

### 新增文件：`src/gateway/config-sync.ts`

**核心功能**：

- **增量同步**：使用 `lastSyncTimestamp` 参数，只同步变更的用户配置
- **指数退避重试**：失败时按 1s/2s/4s/8s/16s... 重试，最大 5 分钟
- **配置版本控制**：使用 `configVersion` 字段处理乐观锁冲突
- **Webhook 支持**：支持云端主动推送配置变更
- **健康检查**：同步失败超过阈值时发出告警

```typescript
// src/gateway/config-sync.ts

export interface SyncOptions {
  lastSyncTimestamp?: string;  // ISO 8601 时间戳
  force?: boolean;             // 强制全量同步
}

export class ConfigSyncService {
  private syncInterval: NodeJS.Timeout | null = null;
  private lastSyncTimestamp: string | null = null;
  private consecutiveFailures = 0;
  private readonly maxRetryDelayMs = 5 * 60 * 1000;  // 最大 5 分钟

  constructor(
    private manager: MultiTenantGatewayManager,
    private intervalMs: number,
    private webhookEnabled: boolean = false
  ) {}

  start(): void {
    // 启动时全量同步一次
    this.sync({ force: true });

    // 定期增量同步
    this.syncInterval = setInterval(() => {
      this.sync({ lastSyncTimestamp: this.lastSyncTimestamp ?? undefined });
    }, this.intervalMs);

    // 如果启用 Webhook，还需要启动 Webhook 监听
    if (this.webhookEnabled) {
      this.startWebhookListener();
    }
  }

  private async sync(options: SyncOptions = {}): Promise<void> {
    try {
      await this.manager.syncUserConfigs(options);
      this.lastSyncTimestamp = new Date().toISOString();
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures++;
      const retryDelay = Math.min(
        Math.pow(2, this.consecutiveFailures) * 1000,
        this.maxRetryDelayMs
      );
      console.error(`[ConfigSync] Failed (attempt ${this.consecutiveFailures}), retry in ${retryDelay}ms:`, error);
      
      // 连续失败超过 5 次，发出告警
      if (this.consecutiveFailures >= 5) {
        console.error('[ConfigSync] ALERT: Sync failed 5+ times consecutively');
        // TODO: 发送告警通知
      }

      // 安排重试
      setTimeout(() => this.sync(options), retryDelay);
    }
  }

  private startWebhookListener(): void {
    // Webhook 回调端点，用于接收云端推送的配置变更
    // POST /api/webhook/config-update
    console.log('[ConfigSync] Webhook listener enabled');
  }

  // ... 其他方法
}
```

---

## P1-3: Gateway 启动改造

### 文件：`src/gateway/server.impl.ts`

**改造内容**：支持多租户模式启动

```typescript
// 改造：Gateway 启动逻辑
export async function startGatewayServer(
  options: GatewayServerOptions
): Promise<GatewayServer> {

  // 加载全局配置
  const globalConfig = loadGlobalConfig();
  const multiTenantConfig = globalConfig.multiTenant;

  let manager: MultiTenantGatewayManager | undefined;
  let configSync: ConfigSyncService | undefined;
  let cleanupInterval: NodeJS.Timeout | undefined;

  // 多租户模式
  if (multiTenantConfig?.enabled) {
    console.log('[Gateway] Starting in multi-tenant mode');

    // 初始化多租户管理器
    manager = new MultiTenantGatewayManager(multiTenantConfig);

    // 同步用户配置
    await manager.syncUserConfigs();

    // 启动配置同步服务
    configSync = new ConfigSyncService(
      manager,
      multiTenantConfig.syncIntervalMs
    );
    configSync.start();

    // 启动清理任务
    cleanupInterval = setInterval(() => {
      manager.cleanupInactiveUsers();
    }, multiTenantConfig.userIdleTimeoutMs);

    console.log('[Gateway] Multi-tenant mode initialized');
  } else {
    console.log('[Gateway] Starting in single-user mode');
  }

  // 创建 WebSocket 服务器
  const wss = new WebSocketServer({
    port: options.port,
    host: options.bind
  });

  wss.on('connection', (ws) => {
    handleConnection(ws, { manager, ...options });
  });

  console.log(`[Gateway] Listening on ${options.bind}:${options.port}`);

  return {
    wss,
    manager,
    configSync,
    close: () => {
      configSync?.stop();
      if (cleanupInterval) {
        clearInterval(cleanupInterval);
      }
      wss.close();
    }
  };
}
```

---

## P1-4: 使用量上报

### 新增文件：`src/gateway/usage-reporter.ts`

**内容**：使用量上报服务（见 03-核心流程设计.md）

**核心功能**：
- 异步上报到云端
- 错误处理（不影响主流程）

---

## P2-1: 监控和日志

### 新增文件：`src/gateway/multi-tenant-monitor.ts`

**内容**：多租户监控

```typescript
export class MultiTenantMonitor {
  constructor(private manager: MultiTenantGatewayManager) {}

  getStats() {
    const stats = this.manager.getStats();
    return {
      totalUsers: stats.totalUsers,
      activeInstances: stats.activeInstances,
      totalConnections: stats.totalConnections,
      timestamp: new Date().toISOString()
    };
  }

  startMonitoring(intervalMs: number = 60000) {
    setInterval(() => {
      const stats = this.getStats();
      console.log('[Monitor]', JSON.stringify(stats));
    }, intervalMs);
  }
}
```

---

## P2-2: 管理工具

### 新增文件：`src/cli/multi-tenant-cli.ts`

**内容**：多租户管理命令

```bash
# 查看用户列表
openclaw users list

# 查看用户详情
openclaw users info <userId>

# 清理用户缓存
openclaw users cleanup

# 强制同步配置
openclaw config sync

# 查看统计信息
openclaw stats
```

---

## 改造文件清单汇总

### 需要修改的文件

**P0 优先级（必须）**：
- `src/config/io.ts` - 支持多租户配置加载
- `src/gateway/auth.ts` - 扩展多租户 token 验证（保持现有 API 兼容）
- `src/gateway/server/ws-connection/message-handler.ts` - connect 请求处理
- `src/agents/pi-embedded-runner/run.ts` - 使用工作区解析器

**P1 优先级（重要）**：
- `src/gateway/server.impl.ts` - 支持多租户模式启动
- `src/gateway/server/ws-types.ts` - 扩展 GatewayWsClient 类型

### 需要新增的文件

**P0 优先级（必须）**：
- `src/config/multi-tenant.ts` - 多租户配置类型和加载
- `src/agents/workspace-resolver.ts` - 工作区文件解析器

**P1 优先级（重要）**：
- `src/gateway/multi-tenant-manager.ts` - 多租户管理器
- `src/gateway/config-sync.ts` - 配置同步服务（增量同步 + 重试）
- `src/gateway/usage-reporter.ts` - 使用量上报

**P2 优先级（优化）**：
- `src/gateway/multi-tenant-monitor.ts` - 监控服务
- `src/cli/multi-tenant-cli.ts` - 管理命令

---

## 改造风险评估

### 低风险
- 新增文件（不影响现有功能）
- 向后兼容的改造（保留单用户模式）

### 中风险
- 配置加载逻辑改造（需要充分测试）
- 认证流程改造（需要确保安全性）

### 高风险
- Gateway 启动流程改造（核心流程，需要谨慎）
- 工作区文件读取改造（影响所有 Agent 请求）

### 风险缓解措施
1. **充分测试**：单元测试 + 集成测试 + E2E 测试
2. **灰度发布**：先在测试环境验证，再逐步推广
3. **向后兼容**：保留单用户模式，支持平滑迁移
4. **监控告警**：部署后密切监控，及时发现问题
5. **回滚方案**：准备快速回滚机制

---

## P3: 测试策略

### 单元测试

**命名规范**：`*.test.ts`，与源文件同目录

**重点测试文件**：
- `src/gateway/multi-tenant-manager.test.ts`
  - token 验证逻辑
  - 用户实例懒加载
  - LRU 清理逻辑（确保不中断正在进行的请求）
  - 配置同步失败重试

- `src/agents/workspace-resolver.test.ts`
  - 文件读取优先级（用户自定义 > 模板 > 默认）
  - 路径处理（跨平台兼容）
  - 记忆文件读写

- `src/gateway/auth.test.ts`
  - 多租户 token 验证
  - 与现有认证方式的兼容性

### 集成测试

- `src/gateway/multi-tenant.integration.test.ts`
  - 多用户并发连接
  - 配置热更新
  - 用户隔离验证

### E2E 测试

**命名规范**：`*.e2e.test.ts`

- `src/gateway/multi-tenant.e2e.test.ts`
  - 完整的用户注册 → 连接 → 对话流程
  - 多租户工作区隔离
  - 使用量上报

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定测试
pnpm test multi-tenant

# 运行覆盖率报告
pnpm test:coverage

# E2E 测试
pnpm test:e2e
```

### 覆盖率要求

根据项目现有标准，新增代码需满足：
- Lines: 70%
- Branches: 70%
- Functions: 70%
- Statements: 70%

---

## 下一步

请阅读 **05-云端服务接入设计.md**，了解云端服务的实现方案。
