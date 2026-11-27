<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <div class="min-vh-100 d-flex align-items-center justify-content-center px-3">
    <div class="xmas-card-red p-4 p-md-5 text-center shadow-lg" style="max-width: 520px;">
      <div class="display-1 mb-2">🧭🦌</div>
      <span class="badge bg-warning text-dark fw-bold px-3 py-2 rounded-pill mb-3">
        Errore 404 — Sentiero innevato
      </span>
      <h1 class="font-christmas display-4 text-warning mb-3">
        Ti sei perso nella bufera?
      </h1>
      <p class="text-white-50 fs-5 mb-4">
        Non preoccuparti, anche le renne ogni tanto sbagliano strada! Clicca qui sotto per tornare al villaggio di Babbo Natale.
      </p>
      <RouterLink to="/" class="btn btn-warning btn-lg fw-bold px-4 rounded-pill shadow">
        <i class="bi bi-house-door-fill me-2"></i>
        Torna al Villaggio di Babbo Natale
      </RouterLink>
    </div>
  </div>
</template>