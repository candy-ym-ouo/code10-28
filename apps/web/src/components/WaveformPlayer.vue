<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import WaveSurfer from "wavesurfer.js";
import { annotationLabels, formatTimeMs } from "../utils/format.js";

export interface WaveAnnotation {
  id: string;
  type: "RHYTHM" | "FINGERING" | "EMOTION";
  title: string;
  severity: number;
  startMs: number;
  endMs: number;
}

const props = defineProps<{
  url: string | null;
  peaks?: number[] | null;
  annotations?: WaveAnnotation[];
  selectedId?: string | null;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
  time: [timeMs: number];
  ready: [durationMs: number];
  position: [timeMs: number];
}>();

const container = ref<HTMLDivElement | null>(null);
const currentMs = ref(0);
const durationMs = ref(0);
const playing = ref(false);
const rate = ref("1");
const zoom = ref(1);
const loopStart = ref<number | null>(null);
const loopEnd = ref<number | null>(null);
let wave: WaveSurfer | null = null;

const markerStyles = computed(() => {
  const total = durationMs.value || 1;
  return (props.annotations ?? []).map((annotation) => ({
    ...annotation,
    left: `${Math.max(0, (annotation.startMs / total) * 100)}%`,
    width: `${Math.max(0.15, ((annotation.endMs - annotation.startMs) / total) * 100)}%`,
  }));
});

const ruler = computed(() => {
  const total = durationMs.value;
  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({ ratio, label: formatTimeMs(total * ratio) }));
});

async function createWave(): Promise<void> {
  await nextTick();
  if (!container.value || !props.url) return;
  wave?.destroy();
  wave = WaveSurfer.create({
    container: container.value,
    height: 154,
    waveColor: "#80a29b",
    progressColor: "#145c55",
    cursorColor: "#193f3a",
    cursorWidth: 2,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    normalize: true,
    interact: !props.readonly,
    url: props.url,
    peaks: props.peaks?.length ? [props.peaks] : undefined,
    duration: durationMs.value ? durationMs.value / 1000 : undefined,
  });
  wave.setPlaybackRate(Number(rate.value));
  wave.on("ready", (duration) => {
    durationMs.value = Math.round(duration * 1000);
    emit("ready", durationMs.value);
  });
  wave.on("play", () => { playing.value = true; });
  wave.on("pause", () => { playing.value = false; });
  wave.on("finish", () => { playing.value = false; });
  wave.on("timeupdate", (time) => {
    currentMs.value = Math.round(time * 1000);
    emit("position", currentMs.value);
    if (loopStart.value != null && loopEnd.value != null && currentMs.value >= loopEnd.value) {
      wave?.setTime(loopStart.value / 1000);
    }
  });
  wave.on("interaction", (time) => {
    currentMs.value = Math.round(time * 1000);
    emit("time", currentMs.value);
  });
}

function playPause(): void {
  void wave?.playPause();
}
function getCurrentTime(): number { return currentMs.value; }
function getDuration(): number { return durationMs.value; }
function seek(ms: number): void { wave?.setTime(Math.max(0, Math.min(ms, durationMs.value)) / 1000); }
function setLoop(start: number | null, end: number | null): void {
  loopStart.value = start;
  loopEnd.value = end;
}
function onKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
  if (event.code === "Space") { event.preventDefault(); playPause(); }
  if (event.code === "ArrowLeft") { event.preventDefault(); seek(currentMs.value - 5000); }
  if (event.code === "ArrowRight") { event.preventDefault(); seek(currentMs.value + 5000); }
}
watch(() => [props.url, props.peaks], () => void createWave());
watch(rate, (value) => wave?.setPlaybackRate(Number(value)));
watch(zoom, (value) => wave?.zoom(value));
onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  void createWave();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  wave?.destroy();
});
defineExpose({ playPause, seek, getCurrentTime, getDuration, setLoop });
</script>

<template>
  <section class="wave-panel">
    <div class="wave-toolbar">
      <button class="button small" type="button" :disabled="!url" @click="playPause">{{ playing ? "暂停" : "播放" }}</button>
      <span class="time-display">{{ formatTimeMs(currentMs) }} / {{ formatTimeMs(durationMs) }}</span>
      <label class="speed-control">速度
        <select v-model="rate">
          <option>0.5</option><option>0.75</option><option>1</option><option>1.25</option><option>1.5</option>
        </select>
      </label>
      <label class="zoom-control">缩放 {{ zoom.toFixed(1) }}x
        <input v-model.number="zoom" type="range" min="1" max="50" step="0.5" />
      </label>
    </div>
    <div class="ruler" aria-hidden="true">
      <span v-for="tick in ruler" :key="tick.ratio" :style="{ left: `${tick.ratio * 100}%` }">{{ tick.label }}</span>
    </div>
    <div v-if="!url" class="empty waveform-empty">选择一段已就绪音频后显示真实波形</div>
    <div v-show="url" ref="container" class="waveform"></div>
    <div v-if="url" class="marker-track" aria-label="问题标记轨">
      <button
        v-for="marker in markerStyles"
        :key="marker.id"
        class="wave-marker"
        :class="[marker.type, { selected: marker.id === selectedId }]"
        :style="{ left: marker.left, width: marker.width }"
        type="button"
        :title="`${annotationLabels[marker.type]}：${marker.title}，严重度 ${marker.severity}`"
        @click="emit('select', marker.id)"
      >
        <span>{{ annotationLabels[marker.type] }} · {{ marker.severity }}</span>
      </button>
      <div v-if="currentMs" class="playhead" :style="{ left: `${durationMs ? (currentMs / durationMs) * 100 : 0}%` }" />
    </div>
  </section>
</template>

<style scoped>
.wave-panel { border: 1px solid var(--line); border-radius: var(--radius); background: #fbfcfb; overflow: hidden; }
.wave-toolbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 12px 14px; border-bottom: 1px solid var(--line); background: #fff; }
.time-display { font-variant-numeric: tabular-nums; font-weight: 750; min-width: 135px; }
.speed-control, .zoom-control { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: .86rem; }
.speed-control select { width: 78px; padding: 5px 7px; }
.zoom-control { margin-left: auto; }
.zoom-control input { width: 150px; padding: 0; }
.ruler { position: relative; height: 24px; margin: 8px 16px 0; border-bottom: 1px solid var(--line); }
.ruler span { position: absolute; bottom: 4px; transform: translateX(-50%); font-size: .68rem; color: var(--muted); white-space: nowrap; }
.waveform { min-height: 170px; padding: 0 16px 6px; }
.waveform-empty { margin: 16px; }
.marker-track { position: relative; height: 38px; margin: 0 16px 12px; border: 1px solid var(--line); border-radius: 8px; background: #eef2f0; overflow: hidden; }
.wave-marker { position: absolute; top: 6px; height: 24px; min-width: 3px; padding: 0 4px; border: 1px solid rgb(0 0 0 / 12%); border-radius: 5px; overflow: hidden; color: #fff; font-size: .67rem; text-align: left; cursor: pointer; }
.wave-marker.RHYTHM { background: var(--rhythm); }
.wave-marker.FINGERING { background: var(--fingering); }
.wave-marker.EMOTION { background: var(--emotion); }
.wave-marker.selected { outline: 3px solid #14201e; outline-offset: 1px; z-index: 2; }
.playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: #132823; pointer-events: none; }
@media (max-width: 700px) {
  .zoom-control { width: 100%; margin-left: 0; }
  .zoom-control input { flex: 1; }
  .wave-toolbar { gap: 9px; }
}
</style>
