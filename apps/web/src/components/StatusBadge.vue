<script setup lang="ts">
import { annotationLabels, goalStatusLabels, sessionStatusLabels } from "../utils/format.js";

const props = defineProps<{ value: string; kind?: "session" | "annotation" | "goal" | "media" }>();

const labels: Record<string, string> = {
  ...sessionStatusLabels,
  ...goalStatusLabels,
  ...annotationLabels,
  PENDING_UPLOAD: "待上传",
  UPLOADING: "上传中",
  UPLOADED: "等待校验",
  PROCESSING: "解析中",
  READY: "可用",
  FAILED: "失败",
  CANCELLED: "已取消",
};
</script>

<template>
  <span class="badge" :class="props.value">{{ labels[props.value] ?? props.value }}</span>
</template>
