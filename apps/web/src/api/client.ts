export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function setAccessToken(value: string | null): void {
  accessToken = value;
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const data = (await response.json()) as { accessToken?: string };
        accessToken = data.accessToken ?? null;
        return Boolean(accessToken);
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  if (response.status === 401 && retry && !path.includes("/auth/")) {
    if (await refreshAccessToken()) return apiFetch<T>(path, init, false);
  }
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    const body = payload as { error?: { code?: string; message?: string; details?: unknown } };
    throw new ApiError(response.status, body.error?.code ?? "REQUEST_FAILED", body.error?.message ?? "请求失败", body.error?.details);
  }
  return payload as T;
}

export async function initializeSession(): Promise<boolean> {
  return refreshAccessToken();
}
