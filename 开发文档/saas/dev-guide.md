# OpenClaw SaaS 开发指南

## 开发环境架构

```
┌─────────────────────────────────────────────────────────────┐
│                    开发环境架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐     ┌─────────────────┐     ┌──────────┐  │
│  │   Web UI    │────▶│  Gateway        │────▶│  Cloud   │  │
│  │  :5180      │     │  :19001         │     │  Backend │  │
│  │  (Vite)     │     │  (多租户)       │     │  :8000   │  │
│  └─────────────┘     └─────────────────┘     └──────────┘  │
│                              │                              │
│                              ▼                              │
│                      ┌───────────────┐                      │
│                      │  用户工作空间   │                      │
│                      │  ~/.openclaw-  │                      │
│                      │  saas-dev/     │                      │
│                      └───────────────┘                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 快速启动

### 1. 启动 Web UI 开发服务器

```bash
cd /Users/mac/saas/creator-flow/openclaw/ui
pnpm dev
```

访问地址: http://localhost:5180?saas=1

### 2. 启动多租户 Gateway

```bash
cd /Users/mac/saas/creator-flow/openclaw
OPENCLAW_CONFIG_PATH=~/.openclaw-saas-dev/openclaw.json pnpm gateway:dev
```

Gateway 地址: ws://127.0.0.1:19001

### 3. 启动 Cloud Backend (可选)

```bash
cd /Users/mac/saas/creator-flow/clound-backend
python -m uvicorn backend.main:app --reload --port 8000
```

API 地址: http://localhost:8000

## 配置文件说明

### 多租户配置 (~/.openclaw-saas-dev/openclaw.json)

```json
{
  "gateway": {
    "mode": "local",
    "bind": "loopback",
    "port": 19001,
    "auth": {
      "token": "dev-saas-token-123"
    }
  },
  "multiTenant": {
    "enabled": true,
    "cloudBackendUrl": "http://localhost:8000",
    "serviceToken": "dev-service-token-456",
    "configRoot": "~/.openclaw-saas-dev/configs",
    "workspaceRoot": "~/.openclaw-saas-dev/workspaces"
  }
}
```

### 目录结构

```
~/.openclaw-saas-dev/
├── openclaw.json           # 多租户配置
├── configs/                # 用户配置 (按 userId)
│   └── {userId}/
│       └── config.json
├── workspaces/             # 用户工作空间 (按 userId)
│   └── {userId}/
│       ├── agent/
│       ├── sessions/
│       └── memory/
└── template/               # 新用户模板
    └── agent/
        └── IDENTITY.md
```

## Web UI 开发

### SaaS 模式自动检测

SaaS 模式由 Gateway 服务端决定，Web UI 会自动检测。

**工作流程：**
1. Web UI 连接 Gateway WebSocket
2. Gateway 在 `connect.challenge` 事件中返回 `multiTenant` 信息
3. 如果 `multiTenant.enabled && multiTenant.loginRequired`，Web UI 显示登录页
4. 用户登录后获取 Gateway Token，重新连接

访问地址：
```
http://localhost:5180
```

如果 Gateway 启用了多租户模式，Web UI 会自动显示登录页面。

### 登录流程

1. 用户输入手机号
2. 发送验证码 (POST /api/v1/auth/send-code)
3. 输入验证码登录 (POST /api/v1/auth/phone-login)
4. 获取 Gateway Token (POST /api/v1/openclaw/gateway/token)
5. 使用 Gateway Token 连接 WebSocket

### 相关文件

- `ui/src/ui/auth/` - 认证模块
  - `types.ts` - 类型定义
  - `api.ts` - API 调用
  - `store.ts` - Token 存储
- `ui/src/ui/views/login.ts` - 登录页面组件
- `ui/src/styles/login.css` - 登录页样式
- `ui/src/ui/app.ts` - 应用主组件 (登录状态管理)
- `ui/src/ui/app-render.ts` - 渲染逻辑 (条件渲染)
- `ui/src/ui/app-gateway.ts` - Gateway 连接 (Token 认证)

## Gateway 开发

### 多租户模块

- `src/config/types.multi-tenant.ts` - 多租户类型定义
- `src/config/multi-tenant.ts` - 多租户配置加载
- `src/gateway/multi-tenant/` - 多租户核心模块
  - `manager.ts` - 用户实例管理器
  - `auth.ts` - 认证扩展
  - `config-sync.ts` - 配置同步服务
  - `monitor.ts` - 监控服务
- `src/agents/workspace-resolver.ts` - 工作空间解析
- `src/commands/multi-tenant.ts` - CLI 命令

### CLI 命令

```bash
# 查看多租户统计
openclaw multi-tenant stats

# 列出用户
openclaw multi-tenant users list

# 强制同步配置
openclaw multi-tenant config sync
```

## Cloud Backend 开发

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| /api/v1/auth/send-code | POST | 发送验证码 |
| /api/v1/auth/phone-login | POST | 手机号登录 |
| /api/v1/openclaw/gateway/token | POST | 获取 Gateway Token |
| /api/v1/openclaw/gateway/config | GET/PATCH | 用户配置 |
| /api/v1/openclaw/gateway/configs | GET | 批量同步配置 (Gateway 调用) |

### 数据模型

```python
# GatewayConfig 模型
class GatewayConfig(BaseModel):
    user_id: str
    gateway_token: str  # gt_xxx 格式
    openclaw_config: dict
    llm_token: str | None
    status: str = "active"
```

## 测试

### Web UI 测试

```bash
cd /Users/mac/saas/creator-flow/openclaw/ui
pnpm test
```

### Gateway 测试

```bash
cd /Users/mac/saas/creator-flow/openclaw
pnpm test
```

### 端到端测试

1. 启动所有服务
2. 访问 http://localhost:5180?saas=1
3. 使用测试手机号登录
4. 验证 Gateway 连接和聊天功能

## 常见问题

### Gateway 启动失败: "no token configured"

确保使用正确的配置文件：
```bash
OPENCLAW_CONFIG_PATH=~/.openclaw-saas-dev/openclaw.json pnpm gateway:dev
```

### Web UI 不显示登录页

确保 Gateway 配置中启用了多租户模式：
```json
{
  "multiTenant": {
    "enabled": true
  }
}
```

### Cloud Backend 连接失败

检查 Cloud Backend 是否在 http://localhost:8000 运行

### Gateway Token 认证失败

1. 检查 Cloud Backend 是否返回有效的 gateway_token
2. 检查 token 格式是否为 `gt_xxx`
3. 查看 Gateway 日志确认认证流程

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| OPENCLAW_CONFIG_PATH | 配置文件路径 | - |
| OPENCLAW_GATEWAY_TOKEN | Gateway 认证 Token | - |
| OPENCLAW_SERVICE_TOKEN | 服务间认证 Token | - |
| OPENCLAW_SKIP_CHANNELS | 跳过消息通道初始化 | - |

## 参考链接

- [多租户配置参考](./configuration.md)
- [部署指南](./deployment.md)
- [主仓库同步策略](./主仓库同步策略.md)
