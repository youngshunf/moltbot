# OpenClaw 多租户 SaaS 版本

OpenClaw 多租户 SaaS 版本允许在单个 Gateway 实例上服务多个用户，每个用户拥有独立的配置和工作空间。

## 特性

- **用户隔离**: 每个用户拥有独立的工作空间、配置和会话
- **弹性扩展**: LRU 缓存机制，支持大量用户
- **配置同步**: 从 Cloud Backend 自动同步用户配置
- **监控告警**: 内置监控服务，支持自定义告警
- **CLI 工具**: 完整的命令行管理工具
- **无侵入设计**: 纯扩展实现，不修改核心代码

## 快速开始

### 1. 启用多租户模式

创建配置文件 `/etc/openclaw/config.json`：

```json
{
  "multiTenant": {
    "enabled": true,
    "cloudBackendUrl": "https://api.your-domain.com",
    "serviceToken": "your-service-token"
  }
}
```

### 2. 启动 Gateway

```bash
openclaw gateway run --bind 0.0.0.0 --port 18789
```

### 3. 用户连接

用户使用 Gateway Token 连接：

```bash
# 用户从 Cloud Backend 获取 Token
curl -X POST https://api.your-domain.com/openclaw/gateway/token \
  -H "Authorization: Bearer <user_jwt>"

# 使用 Token 连接 Gateway
openclaw connect --gateway-token gt_xxxxxxxx
```

## 文档目录

- [部署指南](deployment) - 完整的部署步骤和运维指南
- [配置参考](configuration) - 所有配置选项详解

## 架构设计

多租户扩展采用 **纯扩展** 设计原则：

1. **不修改核心代码** - 所有功能通过新增模块实现
2. **可选启用** - `multiTenant.enabled = false` 时回退到单用户模式
3. **向后兼容** - 可与上游仓库无冲突合并

### 模块结构

```
src/
├── config/
│   ├── types.multi-tenant.ts    # 多租户类型定义
│   └── multi-tenant.ts          # 全局配置加载
├── agents/
│   ├── workspace-resolver.ts    # 工作空间文件解析
│   ├── multi-tenant-context.ts  # 上下文工具
│   └── pi-embedded-runner/
│       └── run-multi-tenant.ts  # Runner 包装器
├── gateway/
│   └── multi-tenant/
│       ├── types.ts             # 类型定义
│       ├── manager.ts           # 用户管理器
│       ├── auth.ts              # 认证扩展
│       ├── config-sync.ts       # 配置同步
│       ├── monitor.ts           # 监控服务
│       └── index.ts             # 模块导出
└── commands/
    └── multi-tenant.ts          # CLI 命令
```

## 核心组件

### MultiTenantGatewayManager

用户实例管理器，负责：
- 用户实例的 LRU 缓存
- Gateway Token 到用户 ID 的映射
- 待处理请求追踪（防止过早驱逐）
- 统计信息收集

### ConfigSyncService

配置同步服务，负责：
- 定期从 Cloud Backend 拉取配置
- 更新本地用户配置文件
- 刷新内存中的配置缓存

### MultiTenantMonitor

监控服务，负责：
- 定期输出统计日志
- 检测异常条件并发出告警
- 支持自定义告警处理器

## CLI 命令

```bash
# 查看帮助
openclaw multi-tenant

# 用户管理
openclaw multi-tenant users list
openclaw multi-tenant users info <userId>
openclaw multi-tenant users cleanup

# 配置同步
openclaw multi-tenant config sync

# 统计信息
openclaw multi-tenant stats
```

## 与 Cloud Backend 集成

多租户 Gateway 需要配合 Cloud Backend 使用：

**Cloud Backend 职责：**
- 用户注册和认证
- Gateway Token 生成和管理
- 用户配置存储
- 提供配置同步 API

**Gateway 职责：**
- 验证 Gateway Token
- 管理用户实例
- 处理用户请求
- 路由到正确的 LLM 服务

## 安全考虑

1. **用户隔离**: 每个用户的工作空间完全隔离
2. **Token 安全**: Gateway Token 使用安全随机数，数据库存储哈希
3. **路径净化**: 用户 ID 经过净化防止目录遍历
4. **权限控制**: 工作空间目录权限 700

## 性能特性

- **LRU 缓存**: 自动驱逐不活跃用户，控制内存使用
- **延迟加载**: 用户实例按需创建
- **增量同步**: 只同步变更的配置
- **连接保护**: 有待处理请求的用户不会被驱逐

## 相关链接

- [GitHub 仓库](https://github.com/openclaw/openclaw)
- [Cloud Backend 项目](https://github.com/your-org/cloud-backend)
- [问题反馈](https://github.com/openclaw/openclaw/issues)
