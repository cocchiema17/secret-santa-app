import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import AuthView from '@/views/AuthView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: AuthView,
      meta: { guestOnly: true }
    },
    {
      path: '/',
      name: 'home',
      // Placeholder temporaneo finché non creiamo la Dashboard
      component: () => import('@/views/DashboardView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/preferences',
      name: 'preferences',
      component: () => import('@/views/PreferencesView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/validate',
      name: 'validate',
      component: () => import('@/views/ValidateView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true }
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue')
    }
  ]
})

router.beforeEach(async (to) => {
  const authStore = useAuthStore()
  if (!authStore.isReady) {
    await authStore.initAuth()
  }

  if (to.meta.requiresAuth && !authStore.user) {
    return { name: 'login' }
  }
  if (to.meta.guestOnly && authStore.user) {
    return { name: 'home' }
  }
  if (to.meta.requiresAdmin && !authStore.profile?.isAdmin) {
    return { name: 'home' }
  }
})

export default router