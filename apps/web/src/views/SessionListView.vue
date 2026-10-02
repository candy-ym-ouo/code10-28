<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { apiFetch, ApiError } from "../api/client.js";
import EmptyState from "../components/EmptyState.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { formatDateTime, formatDuration, sessionStatusLabels } from "../utils/format.js";

interface SessionRow {
  id: string;
  title: string;
  instrument: string;
  startedAt: string;
  actualDurationMs: number;
  status: string;
  updatedAt: string;
  _count: { mediaAssets: number; annotations: number; goals: number };
  annotations: Array<{ type: string; severity: number }>;
  goals: Array<{ id: string; title: string; status: string }>;
}
interface SessionPage { data: SessionRow[]; nextCursor: string | null }

const filters = reactive({ q: "", instrument: "", status: "COMPLETED", sortBy: "startedAt", sortOrder: "desc" });
const data = ref<SessionPage>({ data: [], nextCursor: null });
const loading = ref(true);
const error = ref("");
const cursors: string[] = [];

async function load(cursor?: string): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    if (cursor) params.set("cursor", cursor);
    data.value = await apiFetch<SessionPage>(`/api/v1/sessions?${params.toString()}`);
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "练习列表加载失败";
  } finally {
    loading.value = false;
  }
}
async function nextPage(): Promise<void> {
  if (!data.value.nextCursor) return;
  cursors.push(data.value.nextCursor);
  await load(data.value.nextCursor);
}
async function previousPage(): Promise<void> {
  cursors.pop();
  await load(cursors.at(-1));
}
async function archive(session: SessionRow): Promise<void> {
  if (!window.confirm(`确认归档“${session.title}”？归档后默认不再出现在历史列表中。`)) return;
  await apiFetch(`/api/v1/sessions/${session.id}/archive`, { method: "POST", body: "{}" });
  await load();
}
watch(() => [filters.q, filters.instrument, filters.status, filters.sortBy, filters.sortOrder], () => { cursors.length = 0; void load(); });
onMounted(() => load());
</script>

<template>
  <section class="page">
    <header class="page-header">
      <div><h1>练习历史</h1><p>搜索、筛选并回看每一次练习中的音频、问题与目标。</p></div>
      <RouterLink class="button" to="/sessions/new">新建练习</RouterLink>
    </header>

    <div class="tabs" style="margin-bottom: 18px">
      <button v-for="status in ['COMPLETED', 'IN_REVIEW', 'DRAFT', 'ARCHIVED', 'ALL']" :key="status" class="tab" :class="{ active: filters.status === status }" @click="filters.status = status">
        {{ status === "ALL" ? "全部" : sessionStatusLabels[status as keyof typeof sessionStatusLabels] }}
      </button>
    </div>

    <form class="card filters" @submit.prevent="load()">
      <input v-model="filters.q" placeholder="搜索标题、曲目、乐器或备注" aria-label="搜索练习" />
      <input v-model="filters.instrument" placeholder="乐器" aria-label="按乐器筛选" />
      <select v-model="filters.sortBy" aria-label="排序字段">
        <option value="startedAt">开始时间</option><option value="actualDurationMs">练习时长</option><option value="annotationCount">问题数量</option><option value="updatedAt">更新时间</option>
      </select>
      <select v-model="filters.sortOrder" aria-label="排序方向"><option value="desc">降序</option><option value="asc">升序</option></select>
      <button class="button secondary" type="submit">筛选</button>
    </form>

    <LoadingBlock v-if="loading" />
    <div v-else-if="error" class="alert">{{ error }} <button class="button small ghost" @click="load()">重试</button></div>
    <EmptyState v-else-if="!data.data.length" title="没有符合条件的练习" description="调整筛选条件，或开始一次新的练习。" action-label="开始新练习" @action="$router.push('/sessions/new')" />
    <div v-else class="card" style="margin-top: 18px">
      <div class="table-wrap">
        <table>
          <thead><tr><th>练习</th><th>状态</th><th>开始时间</th><th>时长</th><th>音频 / 标记 / 目标</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="session in data.data" :key="session.id">
              <td><strong>{{ session.title }}</strong><small style="display: block">{{ session.instrument }}</small></td>
              <td><StatusBadge :value="session.status" /></td>
              <td>{{ formatDateTime(session.startedAt) }}</td>
              <td>{{ formatDuration(session.actualDurationMs) }}</td>
              <td>{{ session._count.mediaAssets }} / {{ session._count.annotations }} / {{ session._count.goals }}</td>
              <td>
                <div class="row">
                  <RouterLink v-if="['DRAFT', 'IN_REVIEW'].includes(session.status)" class="button small" :to="`/sessions/${session.id}/review`">继续复盘</RouterLink>
                  <RouterLink v-else class="button small secondary" :to="`/sessions/${session.id}`">详情</RouterLink>
                  <button v-if="session.status === 'COMPLETED'" class="button small ghost" @click="archive(session)">归档</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="row between" style="margin-top: 18px"><button class="button ghost" :disabled="!cursors.length" @click="previousPage">上一页</button><button class="button ghost" :disabled="!data.nextCursor" @click="nextPage">下一页</button></div>
    </div>
  </section>
</template>

<style scoped>
.filters { display: grid; grid-template-columns: minmax(220px, 2fr) 1fr auto auto auto; gap: 10px; margin-bottom: 18px; }
@media (max-width: 760px) { .filters { grid-template-columns: 1fr; } }
</style>
