import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { apiFetch, initializeSession, setAccessToken } from "../api/client.js";

export interface User {
  id: string;
  email: string;
  displayName: string;
  defaultInstrument: string | null;
  timezone: string;
  locale: string;
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(null);
  const initialized = ref(false);
  const loading = ref(false);
  const isAuthenticated = computed(() => Boolean(user.value));

  async function initialize(): Promise<void> {
    if (initialized.value) return;
    loading.value = true;
    try {
      if (await initializeSession()) {
        user.value = (await apiFetch<{ user: User }>("/api/v1/users/me")).user;
      }
    } finally {
      initialized.value = true;
      loading.value = false;
    }
  }

  async function login(email: string, password: string): Promise<void> {
    loading.value = true;
    try {
      const result = await apiFetch<{ user: User; accessToken: string }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setAccessToken(result.accessToken);
      user.value = result.user;
    } finally {
      loading.value = false;
    }
  }

  async function register(email: string, password: string, displayName: string): Promise<void> {
    loading.value = true;
    try {
      const result = await apiFetch<{ user: User; accessToken: string }>("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, displayName }),
      });
      setAccessToken(result.accessToken);
      user.value = result.user;
    } finally {
      loading.value = false;
    }
  }

  async function logout(): Promise<void> {
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST", body: "{}" });
    } finally {
      setAccessToken(null);
      user.value = null;
    }
  }

  function updateUser(next: User): void {
    user.value = next;
  }

  return { user, initialized, loading, isAuthenticated, initialize, login, register, logout, updateUser };
});
