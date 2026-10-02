<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { createSHA256 } from "hash-wasm";
import WaveformPlayer, { type WaveAnnotation } from "../components/WaveformPlayer.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { apiFetch, ApiError } from "../api/client.js";
import { annotationLabels, formatBytes, formatTimeMs, parseTimeInput } from "../utils/format.js";

type AnnotationType = "RHYTHM" | "FINGERING" | "EMOTION";
interface Media {
  id: string; status: string; originalName: string; mimeType: string; sizeBytes: number | string; durationMs: number | null;
  codec: string | null; sampleRate: number | null; channels: number | null; peaks: number[] | null; failureCode: string | null; failureMessage: string | null;
}
interface Annotation {
  id: string; mediaId: string; type: AnnotationType; severity: number; startMs: number | string; endMs: number | string;
  title: string; description: string | null; nextAction: string | null; updatedAt: string;
}
interface Goal {
  id: string; title: string; category: string; metricType: string; targetValue: number | string; baselineValue: number | string | null;
  unit: string; dueDate: string; method: string | null; evidenceRequirement: string; status: string;
}
interface Review {
  goodPoints: string | null; mainIssues: string | null; nextFocus: string | null; noIssues: boolean; suggestedNextPracticeAt: string | null;
}
interface Session {
  id: string; title: string; instrument: string; status: string; version: number; actualDurationMs: number | string;
  startedAt: string; mediaAssets: Media[]; annotations: Annotation[]; goals: Goal[]; review: Review | null;
}
interface UploadItem {
  id: string; file: File; status: string; progress: number; mediaId?: string; error?: string;
}
interface NewGoal {
  key: string; title: string; category: string; metricType: string; baselineValue: string; targetValue: string; unit: string; dueDate: string;
  method: string; evidenceRequirement: string; annotationId: string;
}

const route = useRoute();
const router = useRouter();
const session = ref<Session | null>(null);
const loading = ref(true);
const error = ref("");
const saveState = ref<"saved" | "saving" | "failed">("saved");
const missing = ref<string[]>([]);
const selectedMediaId = ref("");
const selectedAnnotationId = ref<string | null>(null);
const playbackUrl = ref<string | null>(null);
const playheadMs = ref(0);
const waveform = ref<InstanceType<typeof WaveformPlayer> | null>(null);
const uploads = ref<UploadItem[]>([]);
const dragging = ref(false);
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const annotationForm = reactive({
  id: "",
  type: "RHYTHM" as AnnotationType,
  severity: 3,
  startText: "00:00.000",
  endText: "00:01.000",
  title: "",
  description: "",
  nextAction: "",
});
const reviewForm = reactive({ goodPoints: "", mainIssues: "", nextFocus: "", noIssues: false, suggestedNextPracticeAt: "" });
const progressValues = reactive<Record<string, string>>({});
const progressNotes = reactive<Record<string, string>>({});
const newGoals = ref<NewGoal[]>([]);

const selectedMedia = computed(() => session.value?.mediaAssets.find((media) => media.id === selectedMediaId.value) ?? null);
const selectedAnnotation = computed(() => session.value?.annotations.find((item) => item.id === selectedAnnotationId.value) ?? null);
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
const openGoals = computed(() => session.value?.goals.filter((goal) => ["OPEN", "IN_PROGRESS"].includes(goal.status)) ?? []);
const readyMedia = computed(() => session.value?.mediaAssets.filter((media) => media.status === "READY") ?? []);
const activeUploads = computed(() => uploads.value.filter((item) => !["READY", "FAILED", "CANCELLED"].includes(item.status)));
const startMs = computed(() => parseTimeInput(annotationForm.startText) ?? 0);
const endMs = computed(() => parseTimeInput(annotationForm.endText) ?? 0);

async function loadSession(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const result = await apiFetch<{ session: Session }>(`/api/v1/sessions/${String(route.params.id)}`);
    session.value = result.session;
    if (result.session.review) Object.assign(reviewForm, {
      goodPoints: result.session.review.goodPoints ?? "",
      mainIssues: result.session.review.mainIssues ?? "",
      nextFocus: result.session.review.nextFocus ?? "",
      noIssues: result.session.review.noIssues,
      suggestedNextPracticeAt: result.session.review.suggestedNextPracticeAt?.slice(0, 16) ?? "",
    });
    const first = result.session.mediaAssets.find((media) => media.status === "READY") ?? result.session.mediaAssets[0];
    if (first) await selectMedia(first.id);
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "练习加载失败";
  } finally {
    loading.value = false;
  }
}

async function selectMedia(id: string): Promise<void> {
  selectedMediaId.value = id;
  playbackUrl.value = null;
  const media = session.value?.mediaAssets.find((item) => item.id === id);
  if (media?.status === "READY") {
    const result = await apiFetch<{ url: string }>(`/api/v1/media/${id}/playback-url`);
    playbackUrl.value = result.url;
  }
}

function resetAnnotationForm(): void {
  Object.assign(annotationForm, {
    id: "", type: "RHYTHM", severity: 3, startText: formatTimeMs(playheadMs.value), endText: formatTimeMs(playheadMs.value + 1000), title: "", description: "", nextAction: "",
  });
  selectedAnnotationId.value = null;
}

function loadAnnotation(id: string): void {
  const item = session.value?.annotations.find((annotation) => annotation.id === id);
  if (!item) return;
  selectedAnnotationId.value = id;
  selectedMediaId.value = item.mediaId;
  Object.assign(annotationForm, {
    id: item.id,
    type: item.type,
    severity: item.severity,
    startText: formatTimeMs(Number(item.startMs)),
    endText: formatTimeMs(Number(item.endMs)),
    title: item.title,
    description: item.description ?? "",
    nextAction: item.nextAction ?? "",
  });
  void selectMedia(item.mediaId);
}

function setBoundary(boundary: "start" | "end"): void {
  if (boundary === "start") annotationForm.startText = formatTimeMs(playheadMs.value);
  else annotationForm.endText = formatTimeMs(playheadMs.value);
}

async function saveAnnotation(): Promise<void> {
  if (!selectedMedia.value) throw new Error("请先选择音频");
  if (!annotationForm.title.trim()) throw new Error("请填写短标题");
  if (endMs.value <= startMs.value) throw new Error("结束时间必须晚于开始时间");
  const endpoint = annotationForm.id ? `/api/v1/annotations/${annotationForm.id}` : `/api/v1/sessions/${session.value!.id}/annotations`;
  const payload: Record<string, unknown> = {
    type: annotationForm.type,
    severity: annotationForm.severity,
    startMs: startMs.value,
    endMs: endMs.value,
    title: annotationForm.title.trim(),
    description: annotationForm.description || null,
    nextAction: annotationForm.nextAction || null,
  };
  if (!annotationForm.id) payload.mediaId = selectedMedia.value.id;
  const result = await apiFetch<{ annotation: Annotation }>(endpoint, {
    method: annotationForm.id ? "PATCH" : "POST",
    body: JSON.stringify(payload),
  });
  const index = session.value!.annotations.findIndex((item) => item.id === result.annotation.id);
  if (index >= 0) session.value!.annotations[index] = result.annotation;
  else session.value!.annotations.push(result.annotation);
  session.value!.annotations.sort((a, b) => Number(a.startMs) - Number(b.startMs));
  selectedAnnotationId.value = result.annotation.id;
  annotationForm.id = result.annotation.id;
}

async function deleteAnnotation(): Promise<void> {
  if (!annotationForm.id || !window.confirm("确认删除此问题标记？关联目标会自动解除关联。")) return;
  await apiFetch(`/api/v1/annotations/${annotationForm.id}`, { method: "DELETE" });
  session.value!.annotations = session.value!.annotations.filter((item) => item.id !== annotationForm.id);
  resetAnnotationForm();
}

function mediaType(file: File): string {
  if (file.type.startsWith("audio/")) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return ({ mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", webm: "audio/webm" } as Record<string, string>)[extension ?? ""] ?? "audio/mpeg";
}

async function sha256(file: File): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  const chunkSize = 4 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const chunk = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

function uploadPut(url: string, file: File, mimeType: string, digest: string, onProgress: (value: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", mimeType);
    request.setRequestHeader("x-amz-meta-sha256", digest);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`对象存储返回 ${request.status}`));
    request.onerror = () => reject(new Error("上传连接中断"));
    request.ontimeout = () => reject(new Error("上传超时"));
    request.send(file);
  });
}

async function pollMedia(upload: UploadItem): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const result = await apiFetch<{ media: Media }>(`/api/v1/media/${upload.mediaId}`);
    const existing = session.value!.mediaAssets.findIndex((media) => media.id === result.media.id);
    if (existing >= 0) session.value!.mediaAssets[existing] = result.media;
    else session.value!.mediaAssets.push(result.media);
    if (result.media.status === "READY") {
      upload.status = "READY";
      upload.progress = 100;
      await selectMedia(result.media.id);
      return;
    }
    if (result.media.status === "FAILED") {
      upload.status = "FAILED";
      upload.error = result.media.failureMessage ?? "音频解析失败";
      return;
    }
    upload.status = "等待系统校验";
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  upload.status = "FAILED";
  upload.error = "音频解析超时，可点击重试";
}

async function uploadFiles(files: FileList | File[]): Promise<void> {
  for (const file of Array.from(files)) {
    const item = reactive<UploadItem>({ id: `${Date.now()}-${file.name}`, file, status: "计算摘要", progress: 0 });
    uploads.value.push(item);
    try {
      const digest = await sha256(file);
      const mimeType = mediaType(file);
      const creation = await apiFetch<{ media: { id: string }; reused: boolean; uploadUrl: string | null; requiredHeaders: Record<string, string> }>(
        `/api/v1/sessions/${session.value!.id}/media/uploads`,
        { method: "POST", body: JSON.stringify({ originalName: file.name, mimeType, sizeBytes: file.size, sha256: digest }) },
      );
      item.mediaId = creation.media.id;
      if (creation.reused) {
        item.status = "READY";
        item.progress = 100;
        const reused = await apiFetch<{ media: Media }>(`/api/v1/media/${creation.media.id}`);
        session.value!.mediaAssets.push(reused.media);
        await selectMedia(reused.media.id);
        continue;
      }
      item.status = "上传中";
      await uploadPut(creation.uploadUrl!, file, mimeType, digest, (progress) => { item.progress = progress; });
      item.status = "等待系统校验";
      await apiFetch(`/api/v1/media/${creation.media.id}/complete-upload`, { method: "POST", body: "{}" });
      await pollMedia(item);
    } catch (reason) {
      item.status = "FAILED";
      item.error = reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : "上传失败";
    }
  }
}

async function retryUpload(item: UploadItem): Promise<void> {
  uploads.value = uploads.value.filter((upload) => upload.id !== item.id);
  await uploadFiles([item.file]);
}

function onDrop(event: DragEvent): void {
  dragging.value = false;
  if (event.dataTransfer?.files.length) void uploadFiles(event.dataTransfer.files);
}

async function saveReview(): Promise<void> {
  if (!session.value || session.value.status === "COMPLETED") return;
  saveState.value = "saving";
  try {
    const result = await apiFetch<{ review: Review }>(`/api/v1/sessions/${session.value.id}/review`, {
      method: "PUT",
      body: JSON.stringify({
        version: session.value.version,
        goodPoints: reviewForm.goodPoints || null,
        mainIssues: reviewForm.mainIssues || null,
        nextFocus: reviewForm.nextFocus || null,
        noIssues: reviewForm.noIssues,
        suggestedNextPracticeAt: reviewForm.suggestedNextPracticeAt ? new Date(reviewForm.suggestedNextPracticeAt).toISOString() : null,
      }),
    });
    session.value.version += 1;
    session.value.review = result.review;
    saveState.value = "saved";
  } catch (reason) {
    saveState.value = "failed";
    if (reason instanceof ApiError && reason.code === "VERSION_CONFLICT") {
      error.value = "检测到另一窗口已修改，请刷新页面后合并内容。";
    }
  }
}

function scheduleReviewSave(): void {
  clearTimeout(saveTimer);
  saveState.value = "saving";
  saveTimer = setTimeout(() => void saveReview(), 10_000);
}

function addGoal(): void {
  newGoals.value.push({
    key: crypto.randomUUID(), title: "", category: "RHYTHM", metricType: "SPEED", baselineValue: "", targetValue: "", unit: "BPM",
    dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), method: "", evidenceRequirement: "NONE", annotationId: "",
  });
}

function removeGoal(key: string): void {
  newGoals.value = newGoals.value.filter((item) => item.key !== key);
}

async function completeReview(): Promise<void> {
  if (!session.value) return;
  error.value = "";
  missing.value = [];
  clearTimeout(saveTimer);
  try {
    const progressUpdates = openGoals.value
      .filter((goal) => progressValues[goal.id] !== undefined && progressValues[goal.id] !== "")
      .map((goal) => ({
        goalId: goal.id,
        actualValue: Number(progressValues[goal.id]),
        note: progressNotes[goal.id] || null,
      }));
    const result = await apiFetch<{ session: Session }>(`/api/v1/sessions/${session.value.id}/review/complete`, {
      method: "POST",
      body: JSON.stringify({
        version: session.value.version,
        review: {
          goodPoints: reviewForm.goodPoints || null,
          mainIssues: reviewForm.mainIssues || null,
          nextFocus: reviewForm.nextFocus,
          noIssues: reviewForm.noIssues,
          suggestedNextPracticeAt: reviewForm.suggestedNextPracticeAt ? new Date(reviewForm.suggestedNextPracticeAt).toISOString() : null,
        },
        goalCreates: newGoals.value.map((goal) => ({
          annotationId: goal.annotationId || null,
          title: goal.title,
          category: goal.category,
          metricType: goal.metricType,
          baselineValue: goal.baselineValue === "" ? null : Number(goal.baselineValue),
          targetValue: Number(goal.targetValue),
          unit: goal.unit,
          dueDate: new Date(`${goal.dueDate}T23:59:59.999Z`).toISOString(),
          method: goal.method || null,
          evidenceRequirement: goal.evidenceRequirement,
        })),
        goalProgressUpdates: progressUpdates,
      }),
    });
    await router.push(`/sessions/${result.session.id}`);
  } catch (reason) {
    if (reason instanceof ApiError && reason.code === "REVIEW_INCOMPLETE" && Array.isArray(reason.details)) {
      missing.value = reason.details as string[];
    } else {
      error.value = reason instanceof ApiError ? reason.message : "完成复盘失败";
    }
  }
}

function setLoopFromAnnotation(): void {
  if (!selectedAnnotation.value) return;
  waveform.value?.setLoop(Number(selectedAnnotation.value.startMs), Number(selectedAnnotation.value.endMs));
}

watch(() => [reviewForm.goodPoints, reviewForm.mainIssues, reviewForm.nextFocus, reviewForm.noIssues, reviewForm.suggestedNextPracticeAt], scheduleReviewSave);
onBeforeUnmount(() => clearTimeout(saveTimer));
onMounted(loadSession);
</script>

<template>
  <section class="page review-page">
    <div v-if="loading" class="loading">正在加载复盘器…</div>
    <div v-else-if="error && !session" class="alert">{{ error }}</div>
    <template v-else-if="session">
      <header class="review-header">
        <div>
          <div class="row"><h1>{{ session.title }}</h1><StatusBadge :value="session.status" /></div>
          <p class="muted">{{ session.instrument }} · 保存状态：{{ saveState === "saved" ? "已保存" : saveState === "saving" ? "保存中…" : "保存失败" }}</p>
        </div>
        <div class="row">
          <button class="button secondary" type="button" @click="saveReview">立即保存</button>
          <button class="button" type="button" :disabled="activeUploads.length > 0" @click="completeReview">完成复盘</button>
        </div>
      </header>

      <div v-if="error" class="alert" style="margin-bottom: 16px">{{ error }} <button class="button small ghost" @click="loadSession">刷新</button></div>
      <div v-if="missing.length" class="alert warning" style="margin-bottom: 16px">
        <strong>还不能完成复盘：</strong>
        <ul><li v-for="item in missing" :key="item">{{ item }}</li></ul>
      </div>

      <div class="review-grid">
        <aside class="card media-panel">
          <div class="card-title"><h2>音频片段</h2><span class="muted">{{ session.mediaAssets.length }} 个</span></div>
          <label
            class="dropzone"
            :class="{ dragging }"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
          >
            <input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.webm" multiple hidden :disabled="!['DRAFT', 'IN_REVIEW'].includes(session.status)" @change="($event.target as HTMLInputElement).files && uploadFiles(($event.target as HTMLInputElement).files!)" />
            <strong>拖入音频或点击选择</strong>
            <small>MP3 / M4A / WAV / OGG / FLAC / WebM，单文件最多 200 MB</small>
          </label>

          <div class="stack media-list">
            <button v-for="media in session.mediaAssets" :key="media.id" class="media-item" :class="{ active: media.id === selectedMediaId }" type="button" @click="selectMedia(media.id)">
              <span class="media-icon">{{ media.status === "READY" ? "▶" : "…" }}</span>
              <span class="media-copy"><strong>{{ media.originalName }}</strong><small>{{ formatBytes(Number(media.sizeBytes)) }} · {{ media.durationMs ? formatTimeMs(Number(media.durationMs)) : media.status }}</small></span>
              <StatusBadge :value="media.status" />
            </button>
          </div>

          <div v-for="item in uploads" :key="item.id" class="upload-item">
            <div class="row between"><strong>{{ item.file.name }}</strong><small>{{ item.status }}</small></div>
            <div class="progress-bar"><span :style="{ width: `${item.progress}%` }" /></div>
            <div v-if="item.error" class="row between"><small class="danger-text">{{ item.error }}</small><button class="button small ghost" @click="retryUpload(item)">重试</button></div>
          </div>
        </aside>

        <main class="review-center">
          <WaveformPlayer
            ref="waveform"
            :url="playbackUrl"
            :peaks="selectedMedia?.peaks"
            :annotations="waveAnnotations"
            :selected-id="selectedAnnotationId"
            @select="loadAnnotation"
            @position="playheadMs = $event"
          />
          <article class="card" style="margin-top: 16px">
            <div class="card-title"><h2>问题标记</h2><button class="button small secondary" type="button" :disabled="!selectedMedia || selectedMedia.status !== 'READY'" @click="resetAnnotationForm">新增标记</button></div>
            <div v-if="session.annotations.length" class="annotation-list">
              <button v-for="item in session.annotations" :key="item.id" class="annotation-row" :class="{ active: item.id === selectedAnnotationId }" type="button" @click="loadAnnotation(item.id)">
                <StatusBadge :value="item.type" kind="annotation" />
                <span><strong>{{ item.title }}</strong><small>{{ formatTimeMs(Number(item.startMs)) }}–{{ formatTimeMs(Number(item.endMs)) }} · 严重度 {{ item.severity }}</small></span>
              </button>
            </div>
            <div v-else class="empty"><strong>还没有问题标记</strong><p>将播放位置定位到问题区间后，在右侧创建第一条标记。</p></div>
          </article>
        </main>

        <aside class="review-side">
          <form class="card stack" @submit.prevent="saveAnnotation">
            <div class="card-title"><h2>{{ annotationForm.id ? "编辑标记" : "新增标记" }}</h2><button v-if="annotationForm.id" class="button small ghost" type="button" @click="setLoopFromAnnotation">循环此区间</button></div>
            <div class="row">
              <label class="field" style="flex: 1"><span>开始</span><input v-model="annotationForm.startText" /></label>
              <button class="button small ghost boundary" type="button" @click="setBoundary('start')">取当前位置</button>
            </div>
            <div class="row">
              <label class="field" style="flex: 1"><span>结束</span><input v-model="annotationForm.endText" /></label>
              <button class="button small ghost boundary" type="button" @click="setBoundary('end')">取当前位置</button>
            </div>
            <label class="field"><span>问题类型</span><select v-model="annotationForm.type"><option v-for="type in (['RHYTHM', 'FINGERING', 'EMOTION'] as const)" :key="type" :value="type">{{ annotationLabels[type] }}</option></select></label>
            <label class="field"><span>严重程度：{{ annotationForm.severity }}</span><input v-model.number="annotationForm.severity" type="range" min="1" max="5" /></label>
            <label class="field"><span>短标题</span><input v-model="annotationForm.title" required maxlength="80" /></label>
            <label class="field"><span>详细描述</span><textarea v-model="annotationForm.description" maxlength="2000" /></label>
            <label class="field"><span>建议动作</span><textarea v-model="annotationForm.nextAction" maxlength="1000" /></label>
            <div class="row end"><button v-if="annotationForm.id" class="button small danger" type="button" @click="deleteAnnotation">删除</button><button class="button small" type="submit">保存标记</button></div>
          </form>

          <form class="card stack" @submit.prevent="saveReview">
            <div class="card-title"><h2>复盘总结</h2></div>
            <label class="field"><span>本次做得好的地方</span><textarea v-model="reviewForm.goodPoints" maxlength="3000" /></label>
            <label class="field"><span>本次主要问题</span><textarea v-model="reviewForm.mainIssues" maxlength="3000" /></label>
            <label class="field"><span>下次练习重点（必填）</span><input v-model="reviewForm.nextFocus" required maxlength="500" /></label>
            <label class="field"><span>下次建议练习时间</span><input v-model="reviewForm.suggestedNextPracticeAt" type="datetime-local" /></label>
            <label class="row"><input v-model="reviewForm.noIssues" style="width: auto" type="checkbox" /> 本次无异常，但仍需创建保持型目标</label>
          </form>

          <section class="card stack">
            <div class="card-title"><h2>本次目标进度</h2></div>
            <div v-if="openGoals.length" class="stack">
              <div v-for="goal in openGoals" :key="goal.id" class="goal-progress-row">
                <strong>{{ goal.title }}</strong>
                <small>目标 {{ goal.targetValue }} {{ goal.unit }} · 截止 {{ goal.dueDate.slice(0, 10) }}</small>
                <label class="field"><span>本次实际值</span><input v-model="progressValues[goal.id]" type="number" step="any" :placeholder="`目标 ${goal.targetValue}`" /></label>
                <label class="field"><span>进度备注</span><textarea v-model="progressNotes[goal.id]" maxlength="1000" /></label>
              </div>
            </div>
            <p v-else class="muted">没有已存在的开放目标，请在下方创建新目标。</p>
          </section>

          <section class="card stack">
            <div class="card-title"><h2>下一次目标</h2><button class="button small secondary" type="button" @click="addGoal">新增目标</button></div>
            <article v-for="goal in newGoals" :key="goal.key" class="new-goal">
              <div class="row between"><strong>新目标</strong><button class="button small ghost" type="button" @click="removeGoal(goal.key)">移除</button></div>
              <label class="field"><span>可执行标题</span><input v-model="goal.title" required maxlength="160" placeholder="例如：17-24 小节八分音符连续 3 次保持 90 BPM" /></label>
              <div class="form-grid">
                <label class="field"><span>分类</span><select v-model="goal.category"><option value="RHYTHM">节奏</option><option value="FINGERING">指法</option><option value="EMOTION">情绪</option><option value="CONTINUITY">连贯性</option><option value="PITCH">音准</option><option value="SPEED">速度</option><option value="REPERTOIRE">曲目完成度</option><option value="OTHER">其他</option></select></label>
                <label class="field"><span>指标</span><select v-model="goal.metricType"><option value="DURATION">时长</option><option value="COUNT">次数</option><option value="SPEED">速度</option><option value="ACCURACY">正确率</option><option value="SUBJECTIVE_SCORE">主观评分</option><option value="CUSTOM">自定义</option></select></label>
                <label class="field"><span>基线</span><input v-model="goal.baselineValue" type="number" step="any" /></label>
                <label class="field"><span>目标值</span><input v-model="goal.targetValue" required type="number" step="any" /></label>
                <label class="field"><span>单位</span><input v-model="goal.unit" required maxlength="24" /></label>
                <label class="field"><span>截止日期</span><input v-model="goal.dueDate" required type="date" /></label>
                <label class="field"><span>关联标记</span><select v-model="goal.annotationId"><option value="">不关联</option><option v-for="annotation in session.annotations" :key="annotation.id" :value="annotation.id">{{ annotation.title }}</option></select></label>
                <label class="field"><span>证据要求</span><select v-model="goal.evidenceRequirement"><option value="NONE">无</option><option value="AUDIO">音频</option><option value="SELF_REVIEW">自评</option><option value="AUDIO_AND_SELF_REVIEW">音频与自评</option></select></label>
                <label class="field full"><span>练习方法</span><textarea v-model="goal.method" maxlength="3000" /></label>
              </div>
            </article>
            <div v-if="!newGoals.length" class="empty"><strong>尚未新增目标</strong><p>完成复盘要求至少创建一个可量化目标；已有开放目标时也可只记录进度。</p></div>
          </section>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.review-header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.review-header h1 { margin: 0; font-size: 1.65rem; }
.review-grid { display: grid; grid-template-columns: minmax(220px, 270px) minmax(420px, 1fr) minmax(300px, 360px); gap: 16px; align-items: start; }
.media-panel, .review-side { position: sticky; top: 86px; max-height: calc(100vh - 108px); overflow-y: auto; }
.media-list { margin-top: 14px; }
.dropzone { display: grid; place-items: center; gap: 4px; padding: 18px; border: 1px dashed #9eb2ab; border-radius: 12px; text-align: center; cursor: pointer; background: #f7faf8; }
.dropzone.dragging { border-color: var(--primary); background: var(--primary-soft); }
.dropzone small { max-width: 210px; }
.media-item { display: grid; grid-template-columns: 28px 1fr auto; align-items: center; gap: 8px; width: 100%; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: #fff; text-align: left; cursor: pointer; }
.media-item.active { border-color: var(--primary); background: #edf7f4; }
.media-icon { display: grid; place-items: center; width: 27px; height: 27px; border-radius: 8px; background: var(--surface-soft); }
.media-copy { min-width: 0; }
.media-copy strong, .media-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.upload-item { margin-top: 12px; padding: 10px; border-radius: 10px; background: var(--surface-soft); }
.upload-item .progress-bar { margin-top: 7px; }
.annotation-list { display: grid; gap: 8px; }
.annotation-row { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 10px; width: 100%; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: #fff; text-align: left; cursor: pointer; }
.annotation-row.active { border-color: var(--primary); background: #edf7f4; }
.annotation-row span strong, .annotation-row span small { display: block; }
.boundary { height: 42px; align-self: end; }
.goal-progress-row, .new-goal { display: grid; gap: 12px; padding: 13px 0; border-bottom: 1px solid var(--line); }
.goal-progress-row:last-child, .new-goal:last-child { border-bottom: 0; }
.danger-text { color: var(--danger); }
@media (max-width: 1180px) {
  .review-grid { grid-template-columns: 220px 1fr; }
  .review-side { position: static; grid-column: 1 / -1; max-height: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
}
@media (max-width: 900px) {
  .review-page { padding: 18px; }
  .review-header { display: grid; }
  .review-grid { grid-template-columns: 1fr; }
  .media-panel { position: static; max-height: none; }
  .review-side { grid-template-columns: 1fr; }
}
</style>
