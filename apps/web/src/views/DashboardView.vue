<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { apiFetch, ApiError } from "../api/client.js";
import LoadingBlock from "../components/LoadingBlock.vue";
import MetricCard from "../components/MetricCard.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { formatDateTime, formatDuration, goalStatusLabels } from "../utils/format.js";

interface Dashboard {
  weekly: {
    practiceCount: number;
    totalDurationMs: number;
    annotationCount: number;
    goalCompletionRate: number;
    completedGoalCount: number;
    overdueGoalCount: number;
  };
  recentSessions: Array<{ id: string; title: string; instrument: string; completedAt: string; actualDurationMs: number; _count: { annotations: number } }>;
  openGoals: Array<{ id: string; title: string; status: string; dueDate: string; sourceSession: { id: string; title: string; instrument: string } }>;
  continueSession: { id: string; title: string; instrument: string; status: string; _count: { mediaAssets: number; annotations: number } } | null;
}

const data = ref<Dashboard | null>(null);
const loading = ref(true);
const error = ref("");

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    data.value = await apiFetch<Dashboard>("/api/v1/statistics/dashboard");
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "首页数据加载失败";
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <section class="page">
    <header class="page-header">
      <div>
        <h1>今天继续练习什么？</h1>
        <p>从上次留下的问题与目标开始，而不是重新翻找记忆。</p>
      </div>
      <RouterLink class="button" to="/sessions/new">开始新练习</RouterLink>
    </header>
    <LoadingBlock v-if="loading" />
    <div v-else-if="error" class="alert">{{ error }} <button class="button small ghost" @click="load">重试</button></div>
    <template v-else-if="data">
      <div class="grid grid-4" style="margin-bottom: 20px">
        <MetricCard label="近 7 天练习" :value="`${data.weekly.practiceCount} 次`" />
        <MetricCard label="近 7 天总时长" :value="formatDuration(data.weekly.totalDurationMs)" />
        <MetricCard label="新增问题标记" :value="data.weekly.annotationCount" />
        <MetricCard label="目标完成率" :value="`${Math.round(data.weekly.goalCompletionRate * 100)}%`" :hint="`${data.weekly.completedGoalCount} 个已完成，${data.weekly.overdueGoalCount} 个逾期`" />
      </div>

      <div class="grid grid-2">
        <article class="card">
          <div class="card-title"><h2>下一练习建议</h2><RouterLink to="/goals">目标中心</RouterLink></div>
          <template v-if="data.openGoals.length">
            <div class="stack">
              <div v-for="goal in data.openGoals.slice(0, 3)" :key="goal.id" class="goal-row">
                <div>
                  <strong>{{ goal.title }}</strong>
                  <small>{{ goal.sourceSession.instrument }} · 来源：{{ goal.sourceSession.title }} · 截止 {{ goal.dueDate.slice(0, 10) }}</small>
                </div>
                <StatusBadge :value="goal.status" kind="goal" />
              </div>
            </div>
          </template>
          <div v-else class="empty">
            <strong>还没有待完成目标</strong>
            <p>完成一次复盘后，为下一次练习建立可量化目标。</p>
            <RouterLink class="button secondary" to="/sessions/new">开始练习</RouterLink>
          </div>
        </article>

        <article class="card">
          <div class="card-title"><h2>未完成复盘</h2></div>
          <template v-if="data.continueSession">
            <p class="muted">{{ data.continueSession.instrument }} · {{ data.continueSession._count.mediaAssets }} 段音频 · {{ data.continueSession._count.annotations }} 个标记</p>
            <h3>{{ data.continueSession.title }}</h3>
            <RouterLink class="button" :to="`/sessions/${data.continueSession.id}/review`">继续复盘</RouterLink>
          </template>
          <div v-else class="empty">
            <strong>当前没有草稿</strong>
            <p>新练习可以先上传音频，再逐步完成标记和目标。</p>
            <RouterLink class="button secondary" to="/sessions/new">新建练习</RouterLink>
          </div>
        </article>
      </div>

      <article class="card" style="margin-top: 20px">
        <div class="card-title"><h2>最近练习</h2><RouterLink to="/sessions">查看全部</RouterLink></div>
        <div v-if="data.recentSessions.length" class="table-wrap">
          <table>
            <thead><tr><th>练习</th><th>乐器</th><th>完成时间</th><th>时长</th><th>问题</th><th></th></tr></thead>
            <tbody>
              <tr v-for="session in data.recentSessions" :key="session.id">
                <td><strong>{{ session.title }}</strong></td>
                <td>{{ session.instrument }}</td>
                <td>{{ formatDateTime(session.completedAt) }}</td>
                <td>{{ formatDuration(session.actualDurationMs) }}</td>
                <td>{{ session._count.annotations }} 条</td>
                <td><RouterLink :to="`/sessions/${session.id}`">查看详情</RouterLink></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty"><strong>还没有已完成练习</strong><p>完成第一次复盘后，这里会出现你的练习趋势。</p></div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.goal-row { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.goal-row:last-child { border-bottom: 0; }
.goal-row strong, .goal-row small { display: block; }
</style>
