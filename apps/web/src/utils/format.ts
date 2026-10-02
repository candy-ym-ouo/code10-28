export function formatDuration(ms: number | bigint | null | undefined): string {
  const value = Number(ms ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0 分钟";
  const totalMinutes = Math.round(value / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function toDateTimeLocal(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

export function formatTimeMs(value: number): string {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = Math.floor(safe % 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function parseTimeInput(value: string): number | null {
  const clean = value.trim().replace(",", ".");
  const match = /^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?$/.exec(clean);
  if (!match) return null;
  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2]);
  if (seconds >= 60) return null;
  const millis = Number((match[3] ?? "").padEnd(3, "0"));
  return minutes * 60_000 + seconds * 1000 + millis;
}

export function formatBytes(value: number | bigint): string {
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export const annotationLabels = {
  RHYTHM: "节奏不稳",
  FINGERING: "指法困难",
  EMOTION: "情绪变化",
} as const;

export const sessionStatusLabels = {
  DRAFT: "草稿",
  IN_REVIEW: "复盘中",
  COMPLETED: "已完成",
  ARCHIVED: "已归档",
  DELETING: "删除中",
  DELETE_FAILED: "删除失败",
} as const;

export const goalStatusLabels = {
  OPEN: "待开始",
  IN_PROGRESS: "进行中",
  ACHIEVED: "已达成",
  MISSED: "已逾期",
  CANCELLED: "已取消",
} as const;
