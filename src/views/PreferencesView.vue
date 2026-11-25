<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useAuthStore } from '@/stores/authStore'
import Navbar from '@/components/Navbar.vue'

interface HintFormItem {
  id: string
  level: 'ambito' | 'specifico'
  text: string
  cost: number
}

const authStore = useAuthStore()
const hints = ref<HintFormItem[]>([])
const saving = ref(false)
const savedSuccess = ref(false)
const errorMsg = ref('')

// Prezzi fittizi di default per livello
const LEVEL_COSTS = {
  ambito: 15,
  specifico: 30
}

onMounted(() => {
  if (authStore.profile?.preferences && authStore.profile.preferences.length > 0) {
    hints.value = JSON.parse(JSON.stringify(authStore.profile.preferences))
  } else {
    // Inizializziamo con 2 righe vuote pronte da compilare
    hints.value = [
      { id: 'h_' + Date.now() + '_1', level: 'ambito', text: '', cost: LEVEL_COSTS.ambito },
      { id: 'h_' + Date.now() + '_2', level: 'specifico', text: '', cost: LEVEL_COSTS.specifico }
    ]
  }
})

function addHint(level: 'ambito' | 'specifico') {
  if (hints.value.length >= 5) return
  hints.value.push({
    id: 'h_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    level,
    text: '',
    cost: LEVEL_COSTS[level]
  })
}

function removeHint(index: number) {
  hints.value.splice(index, 1)
}

function updateLevelCost(hint: HintFormItem) {
  hint.cost = LEVEL_COSTS[hint.level]
}

async function savePreferences() {
  if (!authStore.user) return
  errorMsg.value = ''
  savedSuccess.value = false

  // Filtra eventuali righe lasciate completamente vuote
  const cleaned = hints.value
    .map((h) => ({ ...h, text: h.text.trim() }))
    .filter((h) => h.text.length > 0)

  if (cleaned.length === 0) {
    errorMsg.value = 'Inserisci almeno un indizio per aiutare il tuo Babbo Natale!'
    return
  }

  saving.value = true
  try {
    const userRef = doc(db, 'users', authStore.user.uid)
    await updateDoc(userRef, { preferences: cleaned })
    await authStore.fetchUserProfile(authStore.user.uid)
    hints.value = cleaned
    savedSuccess.value = true
  } catch (err) {
    errorMsg.value = 'Errore durante il salvataggio delle preferenze.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="min-vh-100 text-light" style="background: radial-gradient(circle at top, #1b4332 0%, #081c15 100%);">
    <Navbar />

    <div class="container py-4 py-md-5" style="max-width: 720px;">
      <div class="card bg-dark text-light border-success border-opacity-50 shadow-lg rounded-4">
        <div class="card-body p-4 p-md-5">
          <div class="d-flex align-items-center gap-2 mb-2">
            <span class="fs-2">🎁</span>
            <h2 class="fw-bold mb-0">I tuoi Indizi Regalo</h2>
          </div>
          <p class="text-white-50 mb-4">
            Scrivi alcuni suggerimenti su cosa ti piacerebbe ricevere. Chi ti ha pescato potrà sbloccarli
            spendendo i punti guadagnati con le sfide giornaliere!
          </p>

          <div v-if="savedSuccess" class="alert alert-success py-2">
            <i class="bi bi-check-circle-fill me-1"></i> Indizi salvati con successo!
          </div>
          <div v-if="errorMsg" class="alert alert-danger py-2">
            <i class="bi bi-exclamation-triangle-fill me-1"></i> {{ errorMsg }}
          </div>

          <form @submit.prevent="savePreferences">
            <div
              v-for="(hint, idx) in hints"
              :key="hint.id"
              class="p-3 mb-3 rounded-3 border border-secondary bg-black bg-opacity-25"
            >
              <div class="d-flex justify-content-between align-items-center mb-2 gap-2">
                <div class="d-flex align-items-center gap-2">
                  <select
                    v-model="hint.level"
                    class="form-select form-select-sm bg-dark text-light border-secondary w-auto"
                    @change="updateLevelCost(hint)"
                  >
                    <option value="ambito">Ambito generale ({{ LEVEL_COSTS.ambito }} pt)</option>
                    <option value="specifico">Indizio specifico ({{ LEVEL_COSTS.specifico }} pt)</option>
                  </select>
                </div>

                <button
                  v-if="hints.length > 1"
                  type="button"
                  class="btn btn-outline-danger btn-sm"
                  @click="removeHint(idx)"
                >
                  <i class="bi bi-trash"></i>
                </button>
              </div>

              <input
                v-model="hint.text"
                type="text"
                class="form-control bg-dark text-light border-secondary"
                :placeholder="
                  hint.level === 'ambito'
                    ? 'Es. Tecnologia, lettura, cucina, sport...'
                    : 'Es. Una tazza termica o un libro di fantascienza...'
                "
              />
            </div>

            <div class="d-flex flex-wrap gap-2 mb-4" v-if="hints.length < 5">
              <button type="button" class="btn btn-outline-light btn-sm" @click="addHint('ambito')">
                <i class="bi bi-plus-lg me-1"></i> Aggiungi Ambito
              </button>
              <button type="button" class="btn btn-outline-warning btn-sm" @click="addHint('specifico')">
                <i class="bi bi-plus-lg me-1"></i> Aggiungi Indizio Specifico
              </button>
            </div>

            <button type="submit" class="btn btn-success w-100 py-2 fw-bold" :disabled="saving">
              <span v-if="saving" class="spinner-border spinner-border-sm me-2"></span>
              Salva i miei Indizi
            </button>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>