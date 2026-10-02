import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth.js";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("../views/LoginView.vue"), meta: { guestOnly: true } },
    { path: "/register", name: "register", component: () => import("../views/RegisterView.vue"), meta: { guestOnly: true } },
    {
      path: "/",
      component: () => import("../components/AppShell.vue"),
      meta: { requiresAuth: true },
      children: [
        { path: "", name: "dashboard", component: () => import("../views/DashboardView.vue") },
        { path: "sessions", name: "sessions", component: () => import("../views/SessionListView.vue") },
        { path: "sessions/new", name: "session-new", component: () => import("../views/SessionNewView.vue") },
        { path: "sessions/:id/review", name: "session-review", component: () => import("../views/ReviewView.vue"), meta: { immersive: true } },
        { path: "sessions/:id", name: "session-detail", component: () => import("../views/SessionDetailView.vue") },
        { path: "goals", name: "goals", component: () => import("../views/GoalsView.vue") },
        { path: "statistics", name: "statistics", component: () => import("../views/StatisticsView.vue") },
        { path: "settings", name: "settings", component: () => import("../views/SettingsView.vue") },
      ],
    },
    { path: "/:pathMatch(.*)*", name: "not-found", component: () => import("../views/NotFoundView.vue") },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.initialize();
  if (to.meta.requiresAuth && !auth.isAuthenticated) return { name: "login", query: { redirect: to.fullPath } };
  if (to.meta.guestOnly && auth.isAuthenticated) return { name: "dashboard" };
  return true;
});

export default router;
