<script setup lang="ts">
import { ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth.js";
import { ApiError } from "../api/client.js";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref("");

async function submit(): Promise<void> {
  error.value = "";
  try {
    await auth.login(email.value, password.value);
    await router.push(typeof route.query.redirect === "string" ? route.query.redirect : "/");
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "登录失败，请稍后重试";
  }
}
</script>

<template>
  <main class="auth-page">
    <form class="auth-card stack" @submit.prevent="submit">
      <div class="auth-brand"><span class="brand-mark">练</span><span>练习复盘本</span></div>
      <div>
        <h1 style="margin-bottom: 8px">继续你的练习闭环</h1>
        <p class="muted">把问题定位到时间点，把复盘变成下一次可执行的目标。</p>
      </div>
      <div v-if="error" class="alert">{{ error }}</div>
      <label class="field"><span>邮箱</span><input v-model="email" required type="email" autocomplete="email" /></label>
      <label class="field"><span>密码</span><input v-model="password" required type="password" autocomplete="current-password" /></label>
      <button class="button block" type="submit" :disabled="auth.loading">{{ auth.loading ? "登录中…" : "登录" }}</button>
      <p class="muted" style="text-align: center; margin: 0">还没有账户？<RouterLink to="/register">创建账户</RouterLink></p>
    </form>
  </main>
</template>
