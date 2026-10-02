<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth.js";

const auth = useAuthStore();
const router = useRouter();

async function logout(): Promise<void> {
  await auth.logout();
  await router.push({ name: "login" });
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand auth-brand">
        <span class="brand-mark">练</span>
        <span>练习复盘本</span>
      </div>
      <nav class="side-nav" aria-label="主导航">
        <RouterLink class="nav-link" to="/">首页概览</RouterLink>
        <RouterLink class="nav-link" to="/sessions">练习历史</RouterLink>
        <RouterLink class="nav-link" to="/goals">目标中心</RouterLink>
        <RouterLink class="nav-link" to="/statistics">统计</RouterLink>
        <RouterLink class="nav-link" to="/settings">设置</RouterLink>
      </nav>
      <div class="sidebar-footer">
        <RouterLink class="button block" to="/sessions/new">＋ 新建练习</RouterLink>
        <div class="user-chip">
          <span class="avatar">{{ auth.user?.displayName.slice(0, 1).toUpperCase() }}</span>
          <span style="min-width: 0">
            <strong>{{ auth.user?.displayName }}</strong>
            <small>{{ auth.user?.email }}</small>
          </span>
        </div>
        <button class="button ghost block" type="button" @click="logout">退出登录</button>
      </div>
    </aside>

    <div class="app-main">
      <header class="topbar">
        <RouterLink class="brand" to="/" style="display: flex; gap: 9px; align-items: center; text-decoration: none; color: inherit">
          <span class="brand-mark">练</span>
          <strong>练习复盘本</strong>
        </RouterLink>
        <RouterLink class="button small" to="/sessions/new">＋ 新建练习</RouterLink>
      </header>
      <main>
        <RouterView />
      </main>
    </div>

    <nav class="mobile-nav" aria-label="移动端主导航">
      <RouterLink to="/">首页</RouterLink>
      <RouterLink to="/sessions">历史</RouterLink>
      <RouterLink to="/sessions/new">新建</RouterLink>
      <RouterLink to="/goals">目标</RouterLink>
      <RouterLink to="/statistics">统计</RouterLink>
    </nav>
  </div>
</template>
