<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

const router = useRouter()
const authStore = useAuthStore()

async function handleLogout() {
  await authStore.logout()
  router.push('/login')
}
</script>

<template>
  <nav class="navbar navbar-expand-lg navbar-dark border-bottom border-success border-opacity-25"
       style="background-color: #0b251b;">
    <div class="container">
      <RouterLink class="navbar-brand fw-bold d-flex align-items-center gap-2" to="/">
        <span>🎅</span>
        <span>Secret Santa 2026</span>
      </RouterLink>

      <button
        class="navbar-toggler"
        type="button"
        data-bs-toggle="collapse"
        data-bs-target="#mainNavbar"
      >
        <span class="navbar-toggler-icon"></span>
      </button>

      <div id="mainNavbar" class="collapse navbar-collapse">
        <ul class="navbar-nav me-auto mb-2 mb-lg-0">
          <li class="nav-item">
            <RouterLink class="nav-link" active-class="active fw-semibold" to="/">
              <i class="bi bi-gift me-1"></i> Dashboard
            </RouterLink>
          </li>
          <li class="nav-item">
            <RouterLink class="nav-link" active-class="active fw-semibold" to="/preferences">
              <i class="bi bi-stars me-1"></i> I miei Indizi
            </RouterLink>
          </li>
          <li v-if="authStore.profile?.isAdmin" class="nav-item">
            <RouterLink class="nav-link text-warning" active-class="active fw-semibold" to="/validate">
              <i class="bi bi-shield-check me-1"></i> Valida Sfide (Admin)
            </RouterLink>
          </li>
        </ul>

        <div class="d-flex align-items-center gap-3">
          <span class="badge rounded-pill bg-warning text-dark fs-6 px-3 py-2">
            <i class="bi bi-coin me-1"></i>
            {{ authStore.profile?.points ?? 0 }} pt
          </span>

          <span class="text-light small d-none d-sm-inline">
            Ciao, <strong>{{ authStore.profile?.firstName }}</strong>
          </span>

          <button class="btn btn-outline-light btn-sm" @click="handleLogout">
            <i class="bi bi-box-arrow-right"></i> Esci
          </button>
        </div>
      </div>
    </div>
  </nav>
</template>