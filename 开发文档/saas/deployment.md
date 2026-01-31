# 多租户 SaaS 部署指南

本文档介绍如何部署 OpenClaw 多租户 SaaS 版本。

## 架构概述

```
┌─────────────────────────────────────────────────────────────┐
│                      用户请求                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   OpenClaw Gateway                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Auth 扩展   │  │ 用户管理器  │  │ 配置同步    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ 监控服务    │  │ LRU 缓存    │  │ 工作空间    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Cloud Backend  │ │   LLM Gateway   │ │  用户工作空间   │
│  (用户/配置DB)  │ │  (使用量统计)   │ │  (文件存储)     │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## 前置条件

### 系统要求

- Node.js 22+
- pnpm 或 Bun
- PostgreSQL/MySQL (Cloud Backend)
- 足够的磁盘空间用于用户工作空间

### 依赖服务

1. **Cloud Backend**: 用户管理、配置存储、Gateway Token 管理
2. **LLM Gateway**: LLM API 代理，使用量统计和积分计算

## 部署步骤

### 1. 配置 Cloud Backend

确保 Cloud Backend 已部署并配置好 OpenClaw 模块：

```bash
# 在 cloud-backend 目录
cd /path/to/clound-backend

# 运行数据库迁移
alembic upgrade head

# 启动服务
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Cloud Backend 提供的 API：
- `POST /openclaw/gateway/token` - 生成用户 Gateway Token
- `PATCH /openclaw/gateway/config` - 更新用户配置
- `GET /openclaw/gateway/configs` - 同步所有用户配置 (服务间调用)

### 2. 创建全局配置文件

创建 `/etc/openclaw/config.json` 或 `~/.clawdbot/openclaw.json`：

```json
{
  "multiTenant": {
    "enabled": true,
    "cloudBackendUrl": "https://api.your-domain.com",
    "serviceToken": "your-service-token",
    "workspaceRoot": "/var/lib/openclaw/workspaces",
    "configRoot": "/var/lib/openclaw/configs",
    "templatePath": "/etc/openclaw/template",
    "maxCachedUsers": 1000,
    "userIdleTimeoutMs": 1800000,
    "syncIntervalMs": 60000
  }
}
```

也可以使用环境变量：

```bash
export OPENCLAW_GLOBAL_CONFIG=/path/to/config.json
export OPENCLAW_SERVICE_TOKEN=your-service-token
```

### 3. 准备模板工作空间

创建用户工作空间模板：

```bash
mkdir -p /etc/openclaw/template/agent
mkdir -p /etc/openclaw/template/sessions
mkdir -p /etc/openclaw/template/memory

# 可选：添加默认 IDENTITY.md
cat > /etc/openclaw/template/agent/IDENTITY.md << 'EOF'
# Assistant Identity

You are a helpful AI assistant.
EOF
```

### 4. 创建数据目录

```bash
# 创建工作空间根目录
mkdir -p /var/lib/openclaw/workspaces
mkdir -p /var/lib/openclaw/configs

# 设置权限 (假设以 openclaw 用户运行)
chown -R openclaw:openclaw /var/lib/openclaw
chmod -R 700 /var/lib/openclaw
```

### 5. 启动 Gateway

```bash
# 开发环境
pnpm openclaw gateway run --bind 0.0.0.0 --port 18789

# 生产环境 (使用 systemd)
sudo systemctl start openclaw-gateway
```

### 6. 验证部署

```bash
# 检查多租户状态
openclaw multi-tenant stats

# 强制同步配置
openclaw multi-tenant config sync

# 列出用户
openclaw multi-tenant users list
```

## Systemd 服务配置

创建 `/etc/systemd/system/openclaw-gateway.service`：

```ini
[Unit]
Description=OpenClaw Multi-Tenant Gateway
After=network.target

[Service]
Type=simple
User=openclaw
Group=openclaw
WorkingDirectory=/opt/openclaw
Environment=NODE_ENV=production
Environment=OPENCLAW_GLOBAL_CONFIG=/etc/openclaw/config.json
ExecStart=/usr/bin/node /opt/openclaw/dist/cli.js gateway run --bind 0.0.0.0 --port 18789
Restart=always
RestartSec=10

# 安全加固
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/openclaw

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable openclaw-gateway
sudo systemctl start openclaw-gateway
```

## Docker 部署

### Dockerfile

```dockerfile
FROM node:22-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile --prod

COPY dist/ ./dist/
COPY docs/ ./docs/

# 创建数据目录
RUN mkdir -p /var/lib/openclaw/workspaces /var/lib/openclaw/configs

ENV NODE_ENV=production
ENV OPENCLAW_GLOBAL_CONFIG=/etc/openclaw/config.json

EXPOSE 18789

CMD ["node", "dist/cli.js", "gateway", "run", "--bind", "0.0.0.0", "--port", "18789"]
```

### Docker Compose

```yaml
version: '3.8'

services:
  openclaw-gateway:
    build: .
    ports:
      - "18789:18789"
    volumes:
      - ./config.json:/etc/openclaw/config.json:ro
      - ./template:/etc/openclaw/template:ro
      - openclaw-workspaces:/var/lib/openclaw/workspaces
      - openclaw-configs:/var/lib/openclaw/configs
    environment:
      - NODE_ENV=production
      - OPENCLAW_SERVICE_TOKEN=${OPENCLAW_SERVICE_TOKEN}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:18789/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  openclaw-workspaces:
  openclaw-configs:
```

## 监控与运维

### 健康检查

```bash
# 基本健康检查
curl http://localhost:18789/health

# 详细状态
openclaw multi-tenant stats --json
```

### 日志

生产环境建议配置结构化日志：

```json
{
  "logging": {
    "level": "info",
    "format": "json"
  }
}
```

### 告警

监控服务会在以下情况发出告警：

- 内存使用超过阈值 (默认 512MB)
- 活跃用户比例过高 (默认 80%)
- 配置同步连续失败 (默认 3 次)

可以添加自定义告警处理器：

```typescript
import { createMultiTenantMonitor } from "openclaw/gateway/multi-tenant";

const monitor = createMultiTenantMonitor(manager, configSync, {
  alertHandlers: [
    async (alert) => {
      // 发送到 Slack/PagerDuty/etc
      await sendToSlack(alert);
    }
  ]
});
```

### 清理不活跃用户

定期清理以释放内存：

```bash
# 手动清理
openclaw multi-tenant users cleanup

# 或配置 cron
0 * * * * /usr/bin/openclaw multi-tenant users cleanup >> /var/log/openclaw-cleanup.log 2>&1
```

## 扩展部署

### 水平扩展

多租户 Gateway 支持水平扩展，但需要注意：

1. **配置同步**: 每个实例独立同步，确保 Cloud Backend 能处理并发请求
2. **会话亲和性**: 建议使用负载均衡器的会话亲和性，将同一用户路由到同一实例
3. **共享存储**: 工作空间需要使用共享存储 (NFS/EFS/etc)

### 负载均衡配置 (Nginx)

```nginx
upstream openclaw_gateways {
    ip_hash;  # 会话亲和性
    server gateway1:18789;
    server gateway2:18789;
    server gateway3:18789;
}

server {
    listen 443 ssl http2;
    server_name gateway.your-domain.com;

    location / {
        proxy_pass http://openclaw_gateways;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 故障排除

### 常见问题

**Q: 用户无法连接**
- 检查 Gateway Token 是否有效
- 确认 Cloud Backend 可访问
- 查看 Gateway 日志

**Q: 配置不同步**
- 检查 serviceToken 是否正确
- 确认网络连接
- 运行 `openclaw multi-tenant config sync` 手动同步

**Q: 内存持续增长**
- 减小 `maxCachedUsers`
- 减小 `userIdleTimeoutMs`
- 增加清理频率

### 调试模式

```bash
# 启用详细日志
DEBUG=openclaw:* openclaw gateway run
```
