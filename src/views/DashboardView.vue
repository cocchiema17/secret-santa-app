<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { collection, getDocs, doc, getDoc } from 'firebase/firestore'
import { functions, db } from '@/firebase'
import { useAuthStore } from '@/stores/authStore'
import Navbar from '@/components/Navbar.vue'

interface TargetHint {
  id: string
  level: 'ambito' | 'specifico'
  cost: number
  unlocked: boolean
  text: string | null
}

interface SecretTarget {
  uid: string
  firstName: string
  lastName: string
  hints: TargetHint[]
}

const authStore = useAuthStore()

const loadingTarget = ref(true)
const isExtracted = ref(false)
const target = ref<SecretTarget | null>(null)
const unlockingId = ref<string | null>(null)
const actionMsg = ref<{ type: 'success' | 'danger'; text: string } | null>(null)

// Stati per pannello Admin / Test
const adminLoading = ref(false)
const allParticipants = ref<Array<{ uid: string; firstName: string; lastName: string; points: number }>>([])

async function loadMyTarget() {
  loadingTarget.value = true
  try {
    const getMySecretTarget = httpsCallable(functions, 'getMySecretTarget')
    const res = await getMySecretTarget()
    const data = res.data as { extracted: boolean; target?: SecretTarget }

    isExtracted.value = data.extracted
    target.value = data.target || null
  } catch (err: any) {
    console.error('Errore caricamento obiettivo:', err)
  } finally {
    loadingTarget.value = false
  }
}

async function handleUnlockHint(hint: TargetHint) {
  if (!authStore.user) return
  actionMsg.value = null
  unlockingId.value = hint.id

  try {
    const unlockHintFn = httpsCallable(functions, 'unlockHint')
    const res = await unlockHintFn({ hintId: hint.id })
    const data = res.data as { success: boolean; text: string }

    if (data.success) {
      hint.unlocked = true
      hint.text = data.text
      // Aggiorna il saldo punti nello store
      await authStore.fetchUserProfile(authStore.user.uid)
      actionMsg.value = { type: 'success', text: 'Indizio sbloccato!' }
    }
  } catch (err: any) {
    actionMsg.value = {
      type: 'danger',
      text: err.message || 'Impossibile sbloccare l’indizio.'
    }
  } finally {
    unlockingId.value = null
  }
}

// --- FUNZIONI ADMIN & TEST ---
async function loadParticipants() {
  const snap = await getDocs(collection(db, 'users'))
  allParticipants.value = snap.docs.map((d) => ({
    uid: d.id,
    firstName: d.data().firstName,
    lastName: d.data().lastName,
    points: d.data().points || 0
  }))
}

async function handleSeedMockUsers() {
  adminLoading.value = true
  actionMsg.value = null
  try {
    const seedFn = httpsCallable(functions, 'seedMockUsers')
    const res = await seedFn()
    const data = res.data as { message: string }
    actionMsg.value = { type: 'success', text: data.message }
    await loadParticipants()
  } catch (err: any) {
    actionMsg.value = { type: 'danger', text: err.message }
  } finally {
    adminLoading.value = false
  }
}

async function handleRunExtraction() {
  adminLoading.value = true
  actionMsg.value = null
  try {
    const generateFn = httpsCallable(functions, 'generateSecretSanta')
    const res = await generateFn()
    const data = res.data as { message: string }
    actionMsg.value = { type: 'success', text: data.message }
    await loadMyTarget()
  } catch (err: any) {
    actionMsg.value = { type: 'danger', text: err.message }
  } finally {
    adminLoading.value = false
  }
}

async function handleAddTestPoints() {
  if (!authStore.user) return
  adminLoading.value = true
  actionMsg.value = null
  try {
    const awardFn = httpsCallable(functions, 'awardChallengePoints')
    await awardFn({ winnerUid: authStore.user.uid, points: 50 })
    await authStore.fetchUserProfile(authStore.user.uid)
    await loadParticipants()
    actionMsg.value = { type: 'success', text: '+50 punti di test aggiunti al tuo profilo!' }
  } catch (err: any) {
    actionMsg.value = { type: 'danger', text: err.message }
  } finally {
    adminLoading.value = false
  }
}

onMounted(async () => {
  await loadMyTarget()
  if (authStore.profile?.isAdmin) {
    await loadParticipants()
  }
})
</script>

<template>
  <div class="min-vh-100 text-light" style="background: radial-gradient(circle at top, #1b4332 0%, #081c15 100%);">
    <Navbar />

    <div class="container py-4 py-md-5" style="max-width: 850px;">
      <!-- Banner di avviso se l'utente non ha ancora inserito le sue preferenze -->
      <div
        v-if="!authStore.profile?.preferences || authStore.profile.preferences.length === 0"
        class="alert alert-warning d-flex flex-wrap justify-content-between align-items-center gap-2 rounded-3 shadow-sm"
      >
        <div>
          <i class="bi bi-exclamation-circle-fill me-2"></i>
          <strong>Non hai ancora inserito i tuoi indizi regalo!</strong> Aiuta chi dovrà farti il regalo.
        </div>
        <RouterLink to="/preferences" class="btn btn-dark btn-sm fw-semibold">
          Inserisci ora
        </RouterLink>
      </div>

      <!-- Messaggi di feedback -->
      <div v-if="actionMsg" :class="`alert alert-${actionMsg.type} alert-dismissible fade show`" role="alert">
        {{ actionMsg.text }}
        <button type="button" class="btn-close" @click="actionMsg = null"></button>
      </div>

      <!-- SEZIONE PRINCIPALE: IL TUO BABBO NATALE SEGRETO -->
      <div class="card bg-dark text-light border-danger border-opacity-50 shadow-lg rounded-4 mb-4">
        <div class="card-body p-4 p-md-5 text-center">
          <div v-if="loadingTarget" class="py-4">
            <div class="spinner-border text-danger" role="status"></div>
            <p class="mt-2 text-white-50">Consultando la lista di Babbo Natale...</p>
          </div>

          <div v-else-if="!isExtracted" class="py-3">
            <div class="fs-1 mb-2">⏳🎄</div>
            <h3 class="fw-bold">Estrazione non ancora effettuata</h3>
            <p class="text-white-50 mb-0">
              Appena tutti gli amici si saranno registrati e avranno inserito le proprie preferenze,
              l'amministratore avvierà il sorteggio!
            </p>
          </div>

          <div v-else-if="target">
            <span class="badge bg-danger text-uppercase tracking-wider px-3 py-2 mb-3">
              Il tuo obiettivo segreto
            </span>
            <h1 class="display-5 fw-bold text-warning mb-1">
              🎁 {{ target.firstName }} {{ target.lastName }}
            </h1>
            <p class="text-white-50 mb-4">
              Mantieni il segreto! Usa i tuoi punti per scoprire cosa desidera.
            </p>

            <hr class="border-secondary my-4" />

            <h5 class="fw-semibold text-start mb-3">
              <i class="bi bi-lightbulb text-warning me-2"></i>Indizi disponibili
            </h5>

            <div v-if="target.hints.length === 0" class="text-white-50 fst-italic py-3">
              {{ target.firstName }} non ha ancora inserito alcun indizio!
            </div>

            <div v-else class="d-flex flex-column gap-3 text-start">
              <div
                v-for="hint in target.hints"
                :key="hint.id"
                class="p-3 rounded-3 border d-flex flex-wrap justify-content-between align-items-center gap-3"
                :class="
                  hint.unlocked
                    ? 'border-success bg-success bg-opacity-10'
                    : 'border-secondary bg-black bg-opacity-25'
                "
              >
                <div>
                  <span
                    class="badge mb-1"
                    :class="hint.level === 'ambito' ? 'bg-info text-dark' : 'bg-warning text-dark'"
                  >
                    {{ hint.level === 'ambito' ? 'Ambito Generale' : 'Indizio Specifico' }}
                  </span>

                  <p v-if="hint.unlocked" class="mb-0 fs-5 fw-semibold text-white">
                    "{{ hint.text }}"
                  </p>
                  <p v-else class="mb-0 text-white-50 fst-italic">
                    <i class="bi bi-lock-fill me-1"></i> Contenuto nascosto — Sblocca per rivelare
                  </p>
                </div>

                <div>
                  <span v-if="hint.unlocked" class="badge bg-success px-3 py-2">
                    <i class="bi bi-unlock-fill me-1"></i> Sbloccato
                  </span>
                  <button
                    v-else
                    class="btn btn-warning fw-bold"
                    :disabled="unlockingId === hint.id || (authStore.profile?.points ?? 0) < hint.cost"
                    @click="handleUnlockHint(hint)"
                  >
                    <span v-if="unlockingId === hint.id" class="spinner-border spinner-border-sm me-1"></span>
                    Sblocca ({{ hint.cost }} pt)
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- PANNELLO DI CONTROLLO & TEST (VISIBILE SOLO ALL'ADMIN) -->
      <div v-if="authStore.profile?.isAdmin" class="card bg-dark text-light border-warning shadow rounded-4">
        <div class="card-header bg-warning text-dark fw-bold d-flex align-items-center gap-2">
          <i class="bi bi-tools"></i>
          <span>Pannello Admin & Ambiente di Test</span>
        </div>
        <div class="card-body p-4">
          <p class="small text-white-50">
            Usa questi comandi per popolare 4 amici fittizi, darti punti di prova e testare l'estrazione a ciclo unico.
          </p>

          <div class="d-flex flex-wrap gap-2 mb-4">
            <button
              class="btn btn-outline-info btn-sm"
              :disabled="adminLoading"
              @click="handleSeedMockUsers"
            >
              <i class="bi bi-people-fill me-1"></i> 1. Genera 4 Amici Fittizi
            </button>

            <button
              class="btn btn-outline-warning btn-sm"
              :disabled="adminLoading"
              @click="handleAddTestPoints"
            >
              <i class="bi bi-plus-circle me-1"></i> 2. Aggiungimi +50 Punti Test
            </button>

            <button
              class="btn btn-danger btn-sm fw-bold"
              :disabled="adminLoading"
              @click="handleRunExtraction"
            >
              <i class="bi bi-shuffle me-1"></i> 3. Avvia / Rifai Estrazione
            </button>
          </div>

          <h6 class="fw-semibold mb-2">Partecipanti attuali ({{ allParticipants.length }}):</h6>
          <ul class="list-group list-group-flush rounded-3">
            <li
              v-for="p in allParticipants"
              :key="p.uid"
              class="list-group-item bg-black bg-opacity-25 text-light border-secondary d-flex justify-content-between align-items-center py-2"
            >
              <span>{{ p.firstName }} {{ p.lastName }}</span>
              <span class="badge bg-secondary">{{ p.points }} pt</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>