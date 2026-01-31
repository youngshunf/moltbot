# 多租户 SaaS 配置参考

本文档详细说明 OpenClaw 多租户 SaaS 版本的所有配置选项。

## 配置文件位置

配置文件按以下优先级查找（从高到低）：

1. 环境变量 `OPENCLAW_GLOBAL_CONFIG` 指定的路径
2. `/etc/openclaw/config.json` (系统级)
3. `~/.clawdbot/openclaw.json` (用户级)
4. `~/.openclaw/openclaw.json` (用户级)

## 多租户配置 (multiTenant)

### 完整配置示例

```json
{
  "multiTenant": {
    "enabled": true,
    "cloudBackendUrl": "https://api.example.com",
    "serviceToken": "sk-xxxx",
    "workspaceRoot": "/var/lib/openclaw/workspaces",
    "configRoot": "/var/lib/openclaw/configs",
    "templatePath": "/etc/openclaw/template",
    "maxCachedUsers": 1000,
    "userIdleTimeoutMs": 1800000,
    "syncIntervalMs": 60000
  }
}
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | `false` | 是否启用多租户模式 |
| `cloudBackendUrl` | string | `"http://localhost:8000"` | Cloud Backend API 地址 |
| `serviceToken` | string | - | 服务间认证 Token |
| `workspaceRoot` | string | `"/var/lib/openclaw/workspaces"` | 用户工作空间根目录 |
| `configRoot` | string | `"/var/lib/openclaw/configs"` | 用户配置文件根目录 |
| `templatePath` | string | `"/etc/openclaw/template"` | 新用户工作空间模板路径 |
| `maxCachedUsers` | number | `1000` | 内存中最大缓存用户数 |
| `userIdleTimeoutMs` | number | `1800000` (30分钟) | 用户空闲超时时间（毫秒） |
| `syncIntervalMs` | number | `60000` (1分钟) | 配置同步间隔（毫秒） |

### 环境变量

部分配置可通过环境变量覆盖：

| 环境变量 | 对应配置项 |
|----------|-----------|
| `OPENCLAW_GLOBAL_CONFIG` | 配置文件路径 |
| `OPENCLAW_SERVICE_TOKEN` | `multiTenant.serviceToken` |

## 用户配置结构

每个用户的配置存储在 `{configRoot}/{userId}/config.json`：

```json
{
  "models": {
    "providers": {
      "openai": {
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "user-api-key-or-use-gateway"
      }
    }
  },
  "agents": {
    "default": {
      "model": "gpt-4"
    }
  }
}
```

用户配置会与全局配置合并，用户配置优先级更高。

## 用户工作空间结构

每个用户的工作空间位于 `{workspaceRoot}/{userId}/`：

```
{workspaceRoot}/{userId}/
├── agent/
│   ├── IDENTITY.md      # 用户自定义身份
│   └── ...
├── sessions/            # 会话数据
├── memory/              # 记忆数据
└── ...
```

### 模板工作空间

新用户首次连接时，会从 `templatePath` 复制模板文件：

```
{templatePath}/
├── agent/
│   └── IDENTITY.md      # 默认身份模板
├── sessions/
└── memory/
```

## Cloud Backend API 配置

### 用户认证

用户通过 Gateway Token 认证连接：

```
Authorization: Bearer gt_xxxxxxxx
```

Token 格式：`gt_` 前缀 + 32 字符随机字符串

### API 端点

**生成 Gateway Token** (用户调用)

```http
POST /openclaw/gateway/token
Authorization: Bearer <user_jwt_token>

Response:
{
  "gateway_token": "gt_xxxxxxxx",
  "created_at": "2024-01-01T00:00:00Z",
  "expires_at": null
}
```

**更新用户配置** (用户调用)

```http
PATCH /openclaw/gateway/config
Authorization: Bearer <user_jwt_token>
Content-Type: application/json

{
  "openclaw_config": {
    "models": {...},
    "agents": {...}
  }
}
```

**同步配置** (Gateway 调用)

```http
GET /openclaw/gateway/configs?since=2024-01-01T00:00:00Z
Authorization: Bearer <service_token>

Response:
{
  "configs": [
    {
      "user_id": "user123",
      "gateway_token": "gt_xxxxxxxx",
      "openclaw_config": {...},
      "status": "active",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ],
  "sync_token": "..."
}
```

## 监控配置 (MonitorOptions)

监控服务可通过代码配置：

```typescript
import { createMultiTenantMonitor } from "openclaw/gateway/multi-tenant";

const monitor = createMultiTenantMonitor(manager, configSync, {
  // 统计日志间隔 (毫秒)
  statsIntervalMs: 60000,
  
  // 内存告警阈值 (MB)
  memoryWarningThresholdMb: 512,
  
  // 活跃用户比例告警阈值 (%)
  activeUsersWarningPercent: 80,
  
  // 同步失败告警阈值 (连续次数)
  syncFailureAlertThreshold: 3,
  
  // 自定义日志
  logger: console,
  
  // 告警处理器
  alertHandlers: [
    async (alert) => {
      console.log(`Alert: ${alert.severity} - ${alert.message}`);
    }
  ]
});
```

## CLI 命令

### 用户管理

```bash
# 列出所有用户
openclaw multi-tenant users list [--json]

# 查看用户详情
openclaw multi-tenant users info <userId> [--json]

# 清理不活跃用户
openclaw multi-tenant users cleanup [--force] [--json]
```

### 配置管理

```bash
# 强制同步配置
openclaw multi-tenant config sync [--json]
```

### 统计信息

```bash
# 查看统计
openclaw multi-tenant stats [--json]
```

输出示例：

```
=== Multi-Tenant Gateway Stats ===
Total Users:       150
Active Instances:  45
Total Connections: 12
Pending Requests:  3
Cache Hit Rate:    92.5%
Last Sync:         2024-01-01T12:00:00Z
Sync Failures:     0
Heap Used:         128MB
Heap Total:        256MB
RSS:               312MB
```

## 安全配置

### 用户隔离

- 每个用户有独立的工作空间目录
- 用户 ID 经过净化处理，防止路径遍历攻击
- 工作空间目录权限设置为 `700`

### Token 安全

- Gateway Token 使用安全随机数生成
- Token 在数据库中存储为 SHA256 哈希
- 建议定期轮换 Service Token

### 网络安全

建议配置：

1. 使用 HTTPS 加密所有通信
2. 配置防火墙限制 Gateway 端口访问
3. 使用 VPC/内网连接 Cloud Backend

## 性能调优

### 内存优化

```json
{
  "multiTenant": {
    "maxCachedUsers": 500,
    "userIdleTimeoutMs": 900000
  }
}
```

- 减小 `maxCachedUsers` 降低内存使用
- 减小 `userIdleTimeoutMs` 更快释放不活跃用户

### 同步优化

```json
{
  "multiTenant": {
    "syncIntervalMs": 300000
  }
}
```

- 增大 `syncIntervalMs` 减少 Cloud Backend 压力
- 用户配置变更会在下次同步时生效

### 大规模部署

对于 10000+ 用户的部署：

1. **水平扩展**: 部署多个 Gateway 实例
2. **共享存储**: 使用 NFS/EFS 存储工作空间
3. **数据库优化**: 为 `gateway_config` 表添加索引
4. **缓存**: 考虑在 Cloud Backend 前加 Redis 缓存

## 迁移指南

### 从单用户模式迁移

1. 创建多租户配置文件
2. 将现有用户数据移动到用户工作空间
3. 在 Cloud Backend 创建用户记录
4. 启用多租户模式

```bash
# 移动现有数据
mv ~/.clawdbot /var/lib/openclaw/workspaces/admin

# 更新配置
echo '{"multiTenant":{"enabled":true,...}}' > /etc/openclaw/config.json
```

### 回退到单用户模式

设置 `multiTenant.enabled = false` 即可回退，Gateway 将使用默认的单用户认证方式。

## 参考链接

- [部署指南](/saas/deployment)
- [Cloud Backend API 文档](/saas/api)
- [故障排除](/saas/troubleshooting)
