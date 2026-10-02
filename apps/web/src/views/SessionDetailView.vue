<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiFetch, ApiError } from "../api/client.js";
import LoadingBlock from "../components/LoadingBlock.vue";
import StatusBadge from "../components/StatusBadge.vue";
import WaveformPlayer, { type WaveAnnotation } from "../components/WaveformPlayer.vue";
import { annotationLabels, formatBytes, formatDateTime, formatDuration, formatTimeMs, goalStatusLabels } from "../utils/format.js";

interface Media {
  id: string; status: string; originalName: string; mimeType: string; sizeBytes: number; durationMs: number | null; codec: string | null;
  sampleRate: number | null; channels: number | null; peaks: number[] | null; failureMessage: string | null;
}
interface Annotation { id: string; mediaId: string; type: "RHYTHM" | "FINGERING" | "EMOTION"; title: string; severity: number; startMs: number; endMs: number; description: string | null; nextAction: string | null }
interface Goal { id: string; title: string; category: string; targetValue: number; baselineValue: number | null; unit: string; dueDate: string; status: string; progresses: Array<{ id: string; actualValue: number; note: string | null; recordedAt: string }> }
interface Session {
  id: string; title: string; instrument: string; focus: string | null; location: string | null; notes: string | null; status: string; startedAt: string;
  completedAt: string | null; actualDurationMs: number; mediaAssets: Media[]; annotations: Annotation[]; goals: Goal[];
  review: { goodPoints: string | null; mainIssues: string | null; nextFocus: string | null; noIssues: boolean } | null;
}

const route = useRoute();
const router = useRouter();
const session = ref<Session | null>(null);
const loading = ref(true);
const error = ref("");
const selectedMediaId = ref("");
const playbackUrl = ref<string | null>(null);
const selectedAnnotationId = ref<string | null>(null);
const waveform = ref<InstanceType<typeof WaveformPlayer> | null>(null);
const selectedMedia = computed(() => session.value?.mediaAssets.find((media) => media.id === selectedMediaId.value) ?? null);
const waveAnnotations = computed<WaveAnnotation[]>(() =>
  (session.value?.annotations ?? [])
    .filter((item) => item.mediaId === selectedMediaId.value)
    .map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      severity: item.severity,
      startMs: Number(item.startMs),
      endMs: Number(item.endMs),
    })),
);
const readyMedia = computed(() => session.value?.mediaAssets.filter((media) => media.status === "READY") ?? []);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await apiFetch<{ session: Session }>(`/api/v1/sessions/${String(route.params.id)}`);
    session.value = result.session;
    const media = result.session.mediaAssets.find((item) => item.status === "READY");
    if (media) await selectMedia(media.id);
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "练习详情加载失败";
  } finally {
    loading.value = false;
  }
}
async function selectMedia(id: string): Promise<void> {
  selectedMediaId.value = id;
  playbackUrl.value = null;
  const media = session.value?.mediaAssets.find((item) => item.id === id);
  if (media?.status === "READY") playbackUrl.value = (await apiFetch<{ url: string }>(`/api/v1/media/${id}/playback-url`)).url;
}
function selectAnnotation(item: Annotation): void {
  selectedAnnotationId.value = item.id;
  if (item.mediaId !== selectedMediaId.value) void selectMedia(item.mediaId);
  waveform.value?.seek(Number(item.startMs));
}

function selectWaveAnnotation(id: string): void {
  const item = session.value?.annotations.find((entry) => entry.id === id);
  if (item) selectAnnotation(item);
}
async function archive(): Promise<void> {
  if (!session.value || !window.confirm("确认归档此练习？")) return;
  session.value = (await apiFetch<{ session: Session }>(`/api/v1/sessions/${session.value.id}/archive`, { method: "POST", body: "{}" })).session;
}
async function restore(): Promise<void> {
  if (!session.value) return;
  session.value = (await apiFetch<{ session: Session }>(`/api/v1/sessions/${session.value.id}/restore`, { method: "POST", body: "{}" })).session;
}
async function removeSession(): Promise<void> {
  if (!session.value) return;
  const title = window.prompt(`删除不可逆。请输入完整标题“${session.value.title}”确认：`);
  if (title == null) return;
  await apiFetch(`/api/v1/sessions/${session.value.id}`, { method: "DELETE", body: JSON.stringify({ confirmationTitle: title }) });
  await router.push("/sessions");
}
onMounted(load);
</script>

<template>
  <section class="page">
    <LoadingBlock v-if="loading" />
    <div v-else-if="error" class="alert">{{ error }} <button class="button small ghost" @click="load">重试</button></div>
    <template v-else-if="session">
      <header class="page-header">
        <div>
          <div class="row"><h1>{{ session.title }}</h1><StatusBadge :value="session.status" /></div>
          <p>{{ session.instrument }} · {{ formatDateTime(session.startedAt) }} · {{ formatDuration(session.actualDurationMs) }}</p>
        </div>
        <div class="row wrap">
          <RouterLink v-if="['DRAFT', 'IN_REVIEW'].includes(session.status)" class="button" :to="`/sessions/${session.id}/review`">继续复盘</RouterLink>
          <button v-if="session.status === 'COMPLETED'" class="button secondary" @click="archive">归档</button>
          <button v-if="session.status === 'ARCHIVED'" class="button secondary" @click="restore">恢复</button>
          <button class="button danger" @click="removeSession">删除</button>
        </div>
      </header>

      <div class="grid grid-3" style="margin-bottom: 18px">
        <article class="card"><small>音频片段</small><h2>{{ session.mediaAssets.length }} 个</h2></article>
        <article class="card"><small>问题标记</small><h2>{{ session.annotations.length }} 个</h2></article>
        <article class="card"><small>关联目标</small><h2>{{ session.goals.length }} 个</h2></article>
      </div>

      <div class="detail-grid">
        <aside class="card stack">
          <h2>音频与标记</h2>
          <button v-for="media in session.mediaAssets" :key="media.id" class="media-tab" :class="{ active: media.id === selectedMediaId }" @click="selectMedia(media.id)">
            <strong>{{ media.originalName }}</strong><small>{{ media.durationMs ? formatTimeMs(media.durationMs) : media.status }}</small>
          </button>
          <hr style="width: 100%; border: 0; border-top: 1px solid var(--line)" />
          <button v-for="item in session.annotations" :key="item.id" class="annotation-tab" :class="{ active: item.id === selectedAnnotationId }" @click="selectAnnotation(item)">
            <StatusBadge :value="item.type" kind="annotation" />
            <span><strong>{{ item.title }}</strong><small>{{ formatTimeMs(item.startMs) }} · 严重度 {{ item.severity }}</small></span>
          </button>
        </aside>

        <main class="stack">
          <WaveformPlayer ref="waveform" :url="playbackUrl" :peaks="selectedMedia?.peaks" :annotations="waveAnnotations" :selected-id="selectedAnnotationId" readonly @select="selectWaveAnnotation" />
          <article class="card">
            <h2>复盘总结</h2>
            <template v-if="session.review">
              <div class="summary-grid">
                <div><small>做得好的地方</small><p>{{ session.review.goodPoints || "未填写" }}</p></div>
                <div><small>主要问题</small><p>{{ session.review.mainIssues || "未填写" }}</p></div>
                <div><small>下次练习重点</small><p>{{ session.review.nextFocus || "未填写" }}</p></div>
                <div><small>本次状态</small><p>{{ session.review.noIssues ? "无异常" : "记录到问题" }}</p></div>
              </div>
            </template>
            <div v-else class="empty"><strong>尚未完成复盘总结</strong><p>继续复盘并填写下次重点后才能关闭练习。</p></div>
          </article>
          <article class="card">
            <h2>标记详情</h2>
            <div v-if="session.annotations.length" class="stack">
              <div v-for="item in session.annotations" :key="item.id" class="annotation-detail">
                <div class="row"><StatusBadge :value="item.type" /><strong>{{ item.title }}</strong><span class="muted">{{ formatTimeMs(item.startMs) }}–{{ formatTimeMs(item.endMs) }} · 严重度 {{ item.severity }}</span></div>
                <p v-if="item.description">{{ item.description }}</p>
                <small v-if="item.nextAction">建议动作：{{ item.nextAction }}</small>
              </div>
            </div>
            <div v-else class="empty"><strong>本次无问题标记</strong><p>{{ session.review?.noIssues ? "已明确声明本次无异常。" : "暂无标记信息。" }}</p></div>
          </article>
        </main>

        <aside class="stack">
          <article class="card">
            <h2>目标与进度</h2>
            <div v-if="session.goals.length" class="stack">
              <div v-for="goal in session.goals" :key="goal.id" class="goal-detail">
                <div class="row between"><strong>{{ goal.title }}</strong><StatusBadge :value="goal.status" kind="goal" /></div>
                <small>目标 {{ goal.targetValue }} {{ goal.unit }} · 截止 {{ goal.dueDate.slice(0, 10) }}</small>
                <div v-if="goal.progresses.length">
                  <div v-for="progress in goal.progresses" :key="progress.id" class="progress-record">
                    <span>{{ progress.actualValue }} {{ goal.unit }}</span><small>{{ formatDateTime(progress.recordedAt) }} · {{ progress.note || "无备注" }}</small>
                  </div>
                </div>
                <small v-else>尚无进度记录</small>
              </div>
            </div>
            <div v-else class="muted">本次没有目标。</div>
          </article>
          <article class="card">
            <h2>练习信息</h2>
            <dl class="details">
              <dt>本次重点</dt><dd>{{ session.focus || "未填写" }}</dd>
              <dt>地点</dt><dd>{{ session.location || "未填写" }}</dd>
              <dt>备注</dt><dd>{{ session.notes || "未填写" }}</dd>
              <dt>完成时间</dt><dd>{{ formatDateTime(session.completedAt) }}</dd>
            </dl>
          </article>
          <article class="card">
            <h2>音频元数据</h2>
            <template v-if="selectedMedia">
              <dl class="details">
                <dt>文件</dt><dd>{{ selectedMedia.originalName }}</dd>
                <dt>大小</dt><dd>{{ formatBytes(selectedMedia.sizeBytes) }}</dd>
                <dt>时长</dt><dd>{{ selectedMedia.durationMs ? formatTimeMs(selectedMedia.durationMs) : "—" }}</dd>
                <dt>编码</dt><dd>{{ selectedMedia.codec || "—" }}</dd>
                <dt>采样率</dt><dd>{{ selectedMedia.sampleRate ? `${selectedMedia.sampleRate} Hz` : "—" }}</dd>
                <dt>声道</dt><dd>{{ selectedMedia.channels || "—" }}</dd>
              </dl>
            </template>
          </article>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.detail-grid { display: grid; grid-template-columns: 240px minmax(420px, 1fr) 330px; gap: 16px; align-items: start; }
.media-tab, .annotation-tab { display: grid; gap: 4px; width: 100%; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: #fff; text-align: left; cursor: pointer; }
.annotation-tab { grid-template-columns: auto 1fr; align-items: center; }
.media-tab.active, .annotation-tab.active { border-color: var(--primary); background: #edf7f4; }
.summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.summary-grid p { margin: 5px 0 0; white-space: pre-wrap; }
.annotation-detail { padding: 12px 0; border-bottom: 1px solid var(--line); }
.goal-detail { display: grid; gap: 7px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.progress-record { display: grid; padding: 8px 0 0; border-top: 1px solid var(--line); margin-top: 8px; }
.details { display: grid; grid-template-columns: 80px 1fr; gap: 9px 12px; margin: 0; }
.details dt { color: var(--muted); }
.details dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 1200px) { .detail-grid { grid-template-columns: 220px 1fr; } .detail-grid > aside:last-child { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 800px) { .detail-grid, .detail-grid > aside:last-child { grid-template-columns: 1fr; } .summary-grid { grid-template-columns: 1fr; } }
</style>
