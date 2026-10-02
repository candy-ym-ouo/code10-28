# 部署说明

## 生产拓扑

推荐独立运行 PostgreSQL、Redis、S3 兼容对象存储、API、Worker 和 Web 静态站点。API 与 Worker 可水平扩展，但 Shared Secret、数据库和对象存储配置必须一致。

## 上线步骤

1. 准备域名、TLS 证书和私有 S3 Bucket。
2. 使用 Secret 管理器向 API 与 Worker 注入 `.env.example` 中列出的变量。
3. 在构建环境执行 `npm ci && npm run build`，将 TypeScript 构建产物发布到服务器。
4. 先运行 `npm run db:deploy`，确认迁移成功后启动 API 与 Worker。
5. 将 `apps/web/dist` 部署到静态站点或普通 Web 服务器。
6. 将 `/api` 和 `/health` 转发到 API 进程，并检查 `/health/ready`。
7. 使用真实账户完成一次上传、探测、标记、目标、完成复盘和统计检查。

## 反向代理

生产环境可以在 Web 服务器或负载均衡器上配置：

- TLS 1.2+ 与 HSTS。
- 请求体限制；音频二进制走 S3 预签名 URL，不经过应用进程。
- 上传、播放和 API 的超时与连接限制。
- 真实客户端 IP 透传，Fastify 已启用 `trustProxy`。
- `/metrics` 仅允许监控网络或鉴权网关访问。

## Cookie 与 CORS

`PUBLIC_API_ORIGIN` 使用 `https://` 时，Refresh Cookie 自动启用 `Secure`。生产环境 `WEB_ORIGIN` 必须精确填写前端域名，不能使用通配符。前端与 API 建议同域，以降低 CORS 与 Cookie 配置复杂度。

## Worker

运行 Worker 的服务器需要安装 FFmpeg/ffprobe。需要监控：

- `media-processing` 队列等待时间。
- 探测成功率和失败原因。
- `worker:heartbeat` Redis Key，正常每 10 秒刷新，TTL 30 秒。
- `DELETE_FAILED` 练习和导出任务积压。

## 发布回滚

数据库迁移一旦完成，回滚代码前必须确认旧代码兼容新 Schema。建议采用向后兼容的“扩展—迁移—收缩”方式。对象存储保留版本控制，避免错误清理导致不可恢复。
