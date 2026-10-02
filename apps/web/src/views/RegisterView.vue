<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth.js";
import { ApiError } from "../api/client.js";

const auth = useAuthStore();
const router = useRouter();
const displayName = ref("");
const email = ref("");
const password = ref("");
const confirmPassword = ref("");
const error = ref("");
const passwordValid = computed(() => password.value.length >= 10 && /[A-Za-z]/.test(password.value) && /\d/.test(password.value));

async function submit(): Promise<void> {
  error.value = "";
  if (!passwordValid.value) {
    error.value = "密码至少 10 位，且同时包含字母和数字";
    return;
  }
  if (password.value !== confirmPassword.value) {
    error.value = "两次输入的密码不一致";
    return;
  }
  try {
    await auth.register(email.value, password.value, displayName.value);
    await router.push("/");
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "注册失败，请稍后重试";
  }
}
</script>

<template>
  <main class="auth-page">
    <form class="auth-card stack" @submit.prevent="submit">
      <div class="auth-brand"><span class="brand-mark">练</span><span>练习复盘本</span></div>
      <div>
        <h1 style="margin-bottom: 8px">创建练习账户</h1>
        <p class="muted">数据仅属于你，音频默认存储在私有对象存储中。</p>
      </div>
      <div v-if="error" class="alert">{{ error }}</div>
      <label class="field"><span>展示名</span><input v-model="displayName" required maxlength="80" autocomplete="name" /></label>
      <label class="field"><span>邮箱</span><input v-model="email" required type="email" autocomplete="email" /></label>
      <label class="field"><span>密码（至少 10 位，包含字母和数字）</span><input v-model="password" required type="password" autocomplete="new-password" /></label>
      <label class="field"><span>确认密码</span><input v-model="confirmPassword" required type="password" autocomplete="new-password" /></label>
      <button class="button block" type="submit" :disabled="auth.loading">{{ auth.loading ? "创建中…" : "创建账户" }}</button>
      <p class="muted" style="text-align: center; margin: 0">已有账户？<RouterLink to="/login">返回登录</RouterLink></p>
    </form>
  </main>
</template>
