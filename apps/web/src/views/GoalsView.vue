<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { apiFetch, ApiError } from "../api/client.js";
import EmptyState from "../components/EmptyState.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { goalStatusLabels } from "../utils/format.js";

interface Goal {
  id: string; title: string; category: string; metricType: string; baselineValue: number | null; targetValue: number; unit: string; dueDate: string;
  method: string | null; evidenceRequirement: string; status: string; version: number;
  sourceSession: { id: string; title: string; instrument: string; startedAt: string };
  annotation: { id: string; title: string; type: string } | null;
  progresses: Array<{ id: string; actualValue: number; note: string | null; recordedAt: string; session: { id: string; title: string } }>;
}
interface SessionOption { id: string; title: string; instrument: string; status: string }

const goals = ref<Goal[]>([]);
const sessions = ref<SessionOption[]>([]);
const status = ref("");
const loading = ref(true);
const error = ref("");
const creating = ref(false);
const progressSession = reactive<Record<string, string>>({});
const progressValue = reactive<Record<string, string>>({});
const progressNote = reactive<Record<string, string>>({});
const form = reactive({
  sourceSessionId: "", title: "", category: "RHYTHM", metricType: "SPEED", baselineValue: "", targetValue: "", unit: "BPM",
  dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), method: "", evidenceRequirement: "NONE", annotationId: "",
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const query = status.value ? `?status=${status.value}&limit=100` : "?limit=100";
    const [goalResult, sessionResult] = await Promise.all([
      apiFetch<{ data: Goal[] }>(`/api/v1/goals${query}`),
      apiFetch<{ data: SessionOption[] }>("/api/v1/sessions?status=ALL&limit=100&sortBy=updatedAt&sortOrder=desc"),
    ]);
    goals.value = goalResult.data;
    sessions.value = sessionResult.data;
    if (!form.sourceSessionId && sessions.value[0]) form.sourceSessionId = sessions.value[0].id;
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "目标加载失败";
  } finally {
    loading.value = false;
  }
}
async function createGoal(): Promise<void> {
  const annotationId = form.annotationId || null;
  await apiFetch("/api/v1/goals", {
    method: "POST",
    body: JSON.stringify({
      sourceSessionId: form.sourceSessionId,
      annotationId,
      title: form.title,
      category: form.category,
      metricType: form.metricType,
      baselineValue: form.baselineValue === "" ? null : Number(form.baselineValue),
      targetValue: Number(form.targetValue),
      unit: form.unit,
      dueDate: new Date(`${form.dueDate}T12:00:00.000Z`).toISOString(),
      method: form.method || null,
      evidenceRequirement: form.evidenceRequirement,
    }),
  });
  creating.value = false;
  form.title = "";
  form.targetValue = "";
  await load();
}
async function recordProgress(goal: Goal): Promise<void> {
  const sessionId = progressSession[goal.id] || goal.sourceSession.id;
  const actualValue = Number(progressValue[goal.id]);
  if (!Number.isFinite(actualValue)) return;
  await apiFetch(`/api/v1/goals/${goal.id}/progress`, {
    method: "POST",
    body: JSON.stringify({ sessionId, actualValue, note: progressNote[goal.id] || null }),
  });
  progressValue[goal.id] = "";
  progressNote[goal.id] = "";
  await load();
}
async function completeGoal(goal: Goal): Promise<void> {
  if (!window.confirm(`确认目标“${goal.title}”已经达成？`)) return;
  await apiFetch(`/api/v1/goals/${goal.id}/complete`, { method: "POST", body: "{}" });
  await load();
}
async function cancelGoal(goal: Goal): Promise<void> {
  const reason = window.prompt("请输入取消目标的原因：");
  if (!reason) return;
  await apiFetch(`/api/v1/goals/${goal.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
  await load();
}
async function activateGoal(goal: Goal): Promise<void> {
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await apiFetch(`/api/v1/goals/${goal.id}/activate`, { method: "POST", body: JSON.stringify({ dueDate: due }) });
  await load();
}
onMounted(load);
</script>

<template>
  <section class="page">
    <header class="page-header">
      <div><h1>目标中心</h1><p>把问题转化为可判断完成的目标，并保留每一次进度证据。</p></div>
      <button class="button" :disabled="!sessions.length" @click="creating = !creating">新增目标</button>
    </header>
    <div class="tabs" style="margin-bottom: 18px">
      <button class="tab" :class="{ active: status === '' }" @click="status = ''; load()">全部</button>
      <button v-for="item in ['OPEN', 'IN_PROGRESS', 'ACHIEVED', 'MISSED', 'CANCELLED']" :key="item" class="tab" :class="{ active: status === item }" @click="status = item; load()">{{ goalStatusLabels[item as keyof typeof goalStatusLabels] }}</button>
    </div>

    <form v-if="creating" class="card form-grid" style="margin-bottom: 18px" @submit.prevent="createGoal">
      <label class="field full"><span>来源练习</span><select v-model="form.sourceSessionId" required><option v-for="session in sessions" :key="session.id" :value="session.id">{{ session.instrument }} · {{ session.title }}</option></select></label>
      <label class="field full"><span>可执行目标标题</span><input v-model="form.title" required maxlength="160" placeholder="包含具体片段、动作和数值" /></label>
      <label class="field"><span>分类</span><select v-model="form.category"><option value="RHYTHM">节奏</option><option value="FINGERING">指法</option><option value="EMOTION">情绪</option><option value="CONTINUITY">连贯性</option><option value="PITCH">音准</option><option value="SPEED">速度</option><option value="REPERTOIRE">曲目完成度</option><option value="OTHER">其他</option></select></label>
      <label class="field"><span>指标类型</span><select v-model="form.metricType"><option value="DURATION">时长</option><option value="COUNT">次数</option><option value="SPEED">速度</option><option value="ACCURACY">正确率</option><option value="SUBJECTIVE_SCORE">主观评分</option><option value="CUSTOM">自定义</option></select></label>
      <label class="field"><span>基线值</span><input v-model="form.baselineValue" type="number" step="any" /></label>
      <label class="field"><span>目标值</span><input v-model="form.targetValue" required type="number" step="any" /></label>
      <label class="field"><span>单位</span><input v-model="form.unit" required maxlength="24" /></label>
      <label class="field"><span>截止日期</span><input v-model="form.dueDate" required type="date" /></label>
      <label class="field"><span>证据要求</span><select v-model="form.evidenceRequirement"><option value="NONE">无</option><option value="AUDIO">音频</option><option value="SELF_REVIEW">自评</option><option value="AUDIO_AND_SELF_REVIEW">音频与自评</option></select></label>
      <label class="field full"><span>练习方法</span><textarea v-model="form.method" maxlength="3000" /></label>
      <div class="row end full"><button class="button ghost" type="button" @click="creating = false">取消</button><button class="button" type="submit">创建目标</button></div>
    </form>

    <LoadingBlock v-if="loading" />
    <div v-else-if="error" class="alert">{{ error }} <button class="button small ghost" @click="load">重试</button></div>
    <EmptyState v-else-if="!goals.length" title="没有符合条件的目标" description="从练习详情或复盘总结中创建目标，下一次练习就能直接接手。" action-label="新建练习" @action="$router.push('/sessions/new')" />
    <div v-else class="goals-grid">
      <article v-for="goal in goals" :key="goal.id" class="card stack">
        <div class="row between"><StatusBadge :value="goal.status" kind="goal" /><small>截止 {{ goal.dueDate.slice(0, 10) }}</small></div>
        <div><h2>{{ goal.title }}</h2><p class="muted">{{ goal.sourceSession.instrument }} · 来源：{{ goal.sourceSession.title }}</p></div>
        <div class="metric-line"><strong>{{ goal.targetValue }} {{ goal.unit }}</strong><span v-if="goal.baselineValue != null">基线 {{ goal.baselineValue }} {{ goal.unit }}</span></div>
        <p v-if="goal.method" class="muted">{{ goal.method }}</p>
        <div v-if="goal.progresses.length" class="progress-history">
          <strong>最近进度</strong>
          <div v-for="progress in goal.progresses.slice(0, 3)" :key="progress.id"><span>{{ progress.actualValue }} {{ goal.unit }}</span><small>{{ progress.recordedAt.slice(0, 10) }} · {{ progress.session.title }}</small></div>
        </div>
        <div v-if="!['ACHIEVED', 'CANCELLED'].includes(goal.status)" class="progress-form">
          <select v-model="progressSession[goal.id]"><option value="">选择本次练习</option><option v-for="session in sessions" :key="session.id" :value="session.id">{{ session.title }}</option></select>
          <input v-model="progressValue[goal.id]" type="number" step="any" placeholder="实际值" />
          <input v-model="progressNote[goal.id]" placeholder="备注" />
          <button class="button small secondary" @click="recordProgress(goal)">记录进度</button>
        </div>
        <div class="row end">
          <button v-if="['MISSED', 'CANCELLED'].includes(goal.status)" class="button small secondary" @click="activateGoal(goal)">重新激活</button>
          <button v-if="!['ACHIEVED', 'CANCELLED'].includes(goal.status)" class="button small" @click="completeGoal(goal)">确认达成</button>
          <button v-if="!['ACHIEVED', 'CANCELLED'].includes(goal.status)" class="button small ghost" @click="cancelGoal(goal)">取消</button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.goals-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 17px; }
.metric-line { display: flex; align-items: baseline; gap: 12px; }
.metric-line strong { font-size: 1.6rem; }
.metric-line span { color: var(--muted); }
.progress-history { display: grid; gap: 7px; padding: 12px; border-radius: 10px; background: var(--surface-soft); }
.progress-history div { display: flex; justify-content: space-between; gap: 10px; }
.progress-form { display: grid; grid-template-columns: 1fr 100px 1fr auto; gap: 8px; }
@media (max-width: 900px) { .goals-grid { grid-template-columns: 1fr; } .progress-form { grid-template-columns: 1fr; } }
</style>
