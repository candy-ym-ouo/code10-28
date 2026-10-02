<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use, type ECharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);
import { apiFetch, ApiError } from "../api/client.js";
import LoadingBlock from "../components/LoadingBlock.vue";
import MetricCard from "../components/MetricCard.vue";
import { annotationLabels, formatDuration } from "../utils/format.js";

interface Overview { practiceCount: number; totalDurationMs: number; annotationCount: number; averageAnnotationsPerPractice: number; newGoalCount: number; completedGoalCount: number; overdueGoalCount: number; goalCompletionRate: number }
interface Trends { data: Array<{ date: string; practiceCount: number; durationMs: number; annotationCount: number }> }
interface Issues { byType: Array<{ type: keyof typeof annotationLabels; count: number }>; bySeverity: Array<{ severity: number; count: number }>; difficultMedia: Array<{ mediaId: string; originalName: string; sessionId: string; sessionTitle: string; instrument: string; annotationCount: number; severitySum: number; score: number; reason: string }> }
interface GoalStats { newGoals: number; completedGoals: number; dueGoals: number; overdueGoals: number; completionRate: number; denominatorExplanation: string }
interface Instruments { data: Array<{ instrument: string; practiceCount: number; durationMs: number; annotationCount: number }> }

const range = ref("30");
const customFrom = ref(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
const customTo = ref(new Date().toISOString().slice(0, 10));
const overview = ref<Overview | null>(null);
const trends = ref<Trends | null>(null);
const issues = ref<Issues | null>(null);
const goals = ref<GoalStats | null>(null);
const instruments = ref<Instruments | null>(null);
const loading = ref(true);
const error = ref("");
const trendEl = ref<HTMLDivElement | null>(null);
const issueEl = ref<HTMLDivElement | null>(null);
const instrumentEl = ref<HTMLDivElement | null>(null);
let trendChart: ECharts | null = null;
let issueChart: ECharts | null = null;
let instrumentChart: ECharts | null = null;

function dates(): { from: Date; to: Date } {
  const to = new Date();
  if (range.value === "custom") return { from: new Date(`${customFrom.value}T00:00:00`), to: new Date(`${customTo.value}T23:59:59.999`) };
  const days = Number(range.value);
  const from = range.value === "year" ? new Date(to.getFullYear(), 0, 1) : new Date(to.getTime() - days * 86_400_000);
  return { from, to };
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const { from, to } = dates();
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai" });
    const [overviewResult, trendsResult, issuesResult, goalsResult, instrumentsResult] = await Promise.all([
      apiFetch<Overview>(`/api/v1/statistics/overview?${params}`),
      apiFetch<Trends>(`/api/v1/statistics/trends?${params}`),
      apiFetch<Issues>(`/api/v1/statistics/issues?${params}`),
      apiFetch<GoalStats>(`/api/v1/statistics/goals?${params}`),
      apiFetch<Instruments>(`/api/v1/statistics/instruments?${params}`),
    ]);
    overview.value = overviewResult;
    trends.value = trendsResult;
    issues.value = issuesResult;
    goals.value = goalsResult;
    instruments.value = instrumentsResult;
    await nextTick();
    renderCharts();
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "统计加载失败";
  } finally {
    loading.value = false;
  }
}

function renderCharts(): void {
  if (trendEl.value && trends.value) {
    trendChart ??= init(trendEl.value);
    trendChart.setOption({
      tooltip: { trigger: "axis" },
      legend: { data: ["练习时长（分钟）", "问题标记"] },
      grid: { left: 46, right: 36, top: 38, bottom: 34 },
      xAxis: { type: "category", data: trends.value.data.map((item) => item.date) },
      yAxis: [{ type: "value", name: "分钟" }, { type: "value", name: "标记" }],
      series: [
        { name: "练习时长（分钟）", type: "line", smooth: true, areaStyle: {}, data: trends.value.data.map((item) => Math.round(item.durationMs / 60_000)) },
        { name: "问题标记", type: "bar", yAxisIndex: 1, barMaxWidth: 24, data: trends.value.data.map((item) => item.annotationCount) },
      ],
    });
  }
  if (issueEl.value && issues.value) {
    issueChart ??= init(issueEl.value);
    issueChart.setOption({
      tooltip: { trigger: "item" },
      legend: { bottom: 0 },
      series: [{ type: "pie", radius: ["42%", "70%"], center: ["50%", "44%"], data: issues.value.byType.map((item) => ({ name: annotationLabels[item.type], value: item.count })), color: ["#e0822d", "#3778b7", "#8059a8"] }],
    });
  }
  if (instrumentEl.value && instruments.value) {
    instrumentChart ??= init(instrumentEl.value);
    instrumentChart.setOption({
      tooltip: { trigger: "axis" },
      grid: { left: 55, right: 28, top: 30, bottom: 46 },
      xAxis: { type: "category", data: instruments.value.data.map((item) => item.instrument), axisLabel: { rotate: 20 } },
      yAxis: { type: "value", name: "分钟" },
      series: [{ type: "bar", barMaxWidth: 48, data: instruments.value.data.map((item) => Math.round(item.durationMs / 60_000)), color: "#145c55" }],
    });
  }
}

function resize(): void {
  trendChart?.resize();
  issueChart?.resize();
  instrumentChart?.resize();
}
onMounted(() => { void load(); window.addEventListener("resize", resize); });
onBeforeUnmount(() => { window.removeEventListener("resize", resize); trendChart?.dispose(); issueChart?.dispose(); instrumentChart?.dispose(); });
</script>

<template>
  <section class="page">
    <header class="page-header">
      <div><h1>练习统计</h1><p>所有指标由已完成练习、标记、目标与进度实时聚合，不在前端重算口径。</p></div>
      <div class="row">
        <select v-model="range" style="width: 150px" @change="load"><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option><option value="year">今年</option><option value="custom">自定义</option></select>
        <button class="button secondary" @click="load">刷新</button>
      </div>
    </header>
    <div v-if="range === 'custom'" class="card row wrap" style="margin-bottom: 18px"><label class="field"><span>开始日期</span><input v-model="customFrom" type="date" /></label><label class="field"><span>结束日期</span><input v-model="customTo" type="date" /></label><button class="button" @click="load">应用</button></div>
    <LoadingBlock v-if="loading" />
    <div v-else-if="error" class="alert">{{ error }} <button class="button small ghost" @click="load">重试</button></div>
    <template v-else-if="overview && goals">
      <div class="grid grid-4" style="margin-bottom: 18px">
        <MetricCard label="完成练习" :value="`${overview.practiceCount} 次`" />
        <MetricCard label="实际练习总时长" :value="formatDuration(overview.totalDurationMs)" />
        <MetricCard label="问题标记" :value="`${overview.annotationCount} 条`" :hint="`平均每次 ${overview.averageAnnotationsPerPractice} 条`" />
        <MetricCard label="目标完成率" :value="`${Math.round(goals.completionRate * 100)}%`" :hint="`${goals.completedGoals}/${goals.dueGoals}，${goals.overdueGoals} 个逾期`" />
      </div>

      <div class="stats-grid">
        <article class="card"><div class="card-title"><h2>练习趋势</h2></div><div ref="trendEl" class="chart" /></article>
        <article class="card"><div class="card-title"><h2>问题类型占比</h2></div><div ref="issueEl" class="chart" /></article>
        <article class="card"><div class="card-title"><h2>各乐器练习时长</h2></div><div ref="instrumentEl" class="chart" /></article>
      </div>

      <div class="grid grid-2" style="margin-top: 18px">
        <article class="card">
          <div class="card-title"><h2>严重程度分布</h2><small>本次表现中的明显程度</small></div>
          <div class="severity-list">
            <div v-for="item in issues?.bySeverity ?? []" :key="item.severity"><span>{{ item.severity }} 级</span><div class="progress-bar"><span :style="{ width: `${overview.annotationCount ? item.count / overview.annotationCount * 100 : 0}%` }" /></div><strong>{{ item.count }}</strong></div>
          </div>
        </article>
        <article class="card">
          <div class="card-title"><h2>目标统计</h2><small>{{ goals.denominatorExplanation }}</small></div>
          <div class="grid grid-2">
            <MetricCard label="新增目标" :value="goals.newGoals" />
            <MetricCard label="完成目标" :value="goals.completedGoals" />
            <MetricCard label="到期目标" :value="goals.dueGoals" />
            <MetricCard label="逾期目标" :value="goals.overdueGoals" />
          </div>
        </article>
      </div>

      <article class="card" style="margin-top: 18px">
        <div class="card-title"><h2>最需要复习的音频片段</h2><small>分数 = 标记数 ×10 + 严重度 ×2 + 近 30 天次数 ×3</small></div>
        <div v-if="issues?.difficultMedia.length" class="table-wrap">
          <table><thead><tr><th>排序</th><th>音频</th><th>来源练习</th><th>标记</th><th>严重度合计</th><th>排序原因</th></tr></thead><tbody>
            <tr v-for="(item, index) in issues.difficultMedia" :key="item.mediaId"><td>{{ index + 1 }}</td><td>{{ item.originalName }}</td><td>{{ item.instrument }} · {{ item.sessionTitle }}</td><td>{{ item.annotationCount }}</td><td>{{ item.severitySum }}</td><td>{{ item.reason }}</td></tr>
          </tbody></table>
        </div>
        <div v-else class="empty"><strong>当前范围没有可排序的问题片段</strong><p>完成练习并添加标记后，这里会按统一权重列出困难片段。</p></div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.stats-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) repeat(2, minmax(0, 1fr)); gap: 18px; }
.chart { width: 100%; height: 310px; }
.severity-list { display: grid; gap: 15px; }
.severity-list > div { display: grid; grid-template-columns: 58px 1fr 40px; align-items: center; gap: 12px; }
@media (max-width: 1050px) { .stats-grid { grid-template-columns: 1fr; } }
</style>
