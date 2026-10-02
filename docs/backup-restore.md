# 备份与恢复

## PostgreSQL

建议每日全量备份并持续归档 WAL，以实现时间点恢复：

```bash
pg_dump --format=custom --file=practice.dump "$DATABASE_URL"
pg_restore --clean --if-exists --dbname="$DATABASE_URL" practice.dump
```

生产环境应加密备份文件，并将访问权限限制为数据库运维角色。恢复完成后至少核对：

- 用户数、练习数和音频记录数。
- 对象存储中的对象数与 `media_assets` 记录数。
- 抽查完成的练习、标记、目标和统计结果。
- Prisma 迁移历史与代码期望一致。

## 对象存储

启用 Bucket 版本控制或按环境定义生命周期策略。不要将音频对象公开。备份或复制策略必须保留对象 Key，恢复后 `object_key` 才能继续解析。

## Redis

Redis 只保存短期队列和心跳，不是业务数据源。可从 PostgreSQL 重新生成清理/探测任务；不要将 Redis 备份作为业务恢复依据。

## 恢复演练

每月至少执行一次恢复演练：

1. 在隔离环境恢复 PostgreSQL。
2. 恢复或挂载对象存储快照。
3. 启动 API 和 Worker，执行健康检查。
4. 抽查历史详情、播放 URL、标记、目标和统计。
5. 记录恢复耗时、数据差异和后续修正项。

## 删除策略

练习删除进入 `DELETING`，Worker 删除对象后清除数据库记录。失败时状态为 `DELETE_FAILED`，应告警并重试，不得静默忽略。
