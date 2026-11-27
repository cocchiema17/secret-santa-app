<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
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

interface Participant {
  uid: string
  firstName: string
  lastName: string
  points: number
}

interface ChallengeItem {
  id: string
  day: number
  title: string
  description: string
  rewardPoints: number
  status: 'pending' | 'active' | 'completed'
  winnerUid?: string
}

const authStore = useAuthStore()

// Stati Obiettivo Segreto
const loadingTarget = ref(true)
const isExtracted = ref(false)
const target = ref<SecretTarget | null>(null)
const isTargetRevealed = ref(false) // Controlla il sigillo anti-sbirciata
const unlockingId = ref<string | null>(null)
const actionMsg = ref<{ type: 'success' | 'danger'; text: string } | null>(null)

// Stati Real-Time
const allParticipants = ref<Participant[]>([])
const allChallenges = ref<ChallengeItem[]>([])
let unsubUsers: (() => void) | null = null
let unsubChallenges: (() => void) | null = null

// Stati Admin
const adminLoading = ref(false)

const leaderboard = computed(() => {
  return [...allParticipants.value].sort((a, b) => b.points - a.points)
})

const activeChallenge = computed(() => {
  return allChallenges.value.find((c) => c.status === 'active') || null
})

const completedChallenges = computed(() => {
  return allChallenges.value
    .filter((c) => c.status === 'completed')
    .sort((a, b) => b.day - a.day)
})

function getParticipantName(uid?: string): string {
  if (!uid) return 'Sconosciuto'
  const found = allParticipants.value.find((p) => p.uid === uid)
  return found ? `${found.firstName} ${found.lastName}` : 'Partecipante'
}

function subscribeRealtimeData() {
  unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
    allParticipants.value = snap.docs.map((d) => ({
      uid: d.id,
      firstName: d.data().firstName || '',
      lastName: d.data().lastName || '',
      points: d.data().points || 0
    }))
  })

  const qChallenges = query(collection(db, 'challenges'), orderBy('day', 'asc'))
  unsubChallenges = onSnapshot(qChallenges, (snap) => {
    allChallenges.value = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<ChallengeItem, 'id'>)
    }))
  })
}

async function loadMyTarget() {
  loadingTarget.value = true
  try {
    const getMySecretTarget = httpsCallable(functions, 'getMySecretTarget')
    const res = await getMySecretTarget()
    const data = res.data as { extracted: boolean; target?: SecretTarget }

    isExtracted.value = data.extracted
    target.value = data.target || null
  } catch (err) {
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
async function handleSeedMockUsers() {
  adminLoading.value = true
  actionMsg.value = null
  try {
    const seedFn = httpsCallable(functions, 'seedMockUsers')
    const res = await seedFn()
    const data = res.data as { message: string }
    actionMsg.value = { type: 'success', text: data.message }
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
    isTargetRevealed.value = false
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
    actionMsg.value = { type: 'success', text: '+50 punti di test aggiunti al tuo profilo!' }
  } catch (err: any) {
    actionMsg.value = { type: 'danger', text: err.message }
  } finally {
    adminLoading.value = false
  }
}

onMounted(async () => {
  subscribeRealtimeData()
  await loadMyTarget()
})

onUnmounted(() => {
  if (unsubUsers) unsubUsers()
  if (unsubChallenges) unsubChallenges()
})
</script>

<template>
  <div class="min-vh-100 text-light pb-5">
    <Navbar />

    <div class="container py-4" style="max-width: 960px;">
      <!-- Intestazione di benvenuto -->
      <div class="text-center mb-4">
        <h1 class="font-christmas display-4 text-warning mb-1">
          🎄 Villaggio di Natale 🎅
        </h1>
        <p class="text-white-50 mb-0">
          Benvenuto/a <strong>{{ authStore.profile?.firstName }}</strong>! Completa le sfide, accumula punti e scopri cosa regalare.
        </p>
      </div>

      <!-- Banner avviso preferenze mancanti -->
      <div
        v-if="!authStore.profile?.preferences || authStore.profile.preferences.length === 0"
        class="alert alert-warning d-flex flex-wrap justify-content-between align-items-center gap-2 rounded-4 shadow-sm mb-4"
      >
        <div>
          <i class="bi bi-gift-fill me-2"></i>
          <strong>Non hai ancora inserito i tuoi indizi regalo!</strong> Aiuta chi dovrà farti il regalo.
        </div>
        <RouterLink to="/preferences" class="btn btn-dark btn-sm fw-bold px-3">
          Inserisci ora
        </RouterLink>
      </div>

      <!-- Messaggi di feedback -->
      <div v-if="actionMsg" :class="`alert alert-${actionMsg.type} alert-dismissible fade show rounded-4`" role="alert">
        {{ actionMsg.text }}
        <button type="button" class="btn-close" @click="actionMsg = null"></button>
      </div>

      <!-- 1. SFIDA DEL GIORNO (ATTIVA) -->
      <div v-if="activeChallenge" class="xmas-card p-4 mb-4 border-warning">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
          <span class="badge bg-warning text-dark fw-bold px-3 py-2 rounded-pill">
            🔥 Sfida del {{ activeChallenge.day }} Dicembre
          </span>
          <span class="badge bg-success fs-6 px-3 py-2 rounded-pill">
            +{{ activeChallenge.rewardPoints }} pt
          </span>
        </div>
        <h3 class="font-christmas fs-2 text-white mb-2">{{ activeChallenge.title }}</h3>
        <p class="text-white-50 mb-0">{{ activeChallenge.description }}</p>
      </div>

      <!-- 2. IL TUO BABBO NATALE SEGRETO (CON SIGILLO INTERATTIVO) -->
      <div class="xmas-card-red p-4 p-md-5 text-center mb-4">
        <div v-if="loadingTarget" class="py-4">
          <div class="spinner-border text-warning" role="status"></div>
          <p class="mt-2 text-white-50">Consultando la lista di Babbo Natale...</p>
        </div>

        <div v-else-if="!isExtracted" class="py-3">
          <div class="fs-1 mb-2">⏳🦌</div>
          <h3 class="font-christmas fs-1 text-warning">Estrazione in attesa</h3>
          <p class="text-white-50 mb-0">
            Appena tutti gli amici si saranno registrati e avranno inserito le proprie preferenze,
            verrà avviato il sorteggio ufficiale!
          </p>
        </div>

        <div v-else-if="target">
          <!-- STATO COPERTO (SIGILLO ANTI-SBIRCIATA) -->
          <div
            v-if="!isTargetRevealed"
            class="secret-envelope p-4 p-md-5 my-2"
            @click="isTargetRevealed = true"
          >
            <div class="wax-seal mb-3">🎅</div>
            <h3 class="font-christmas fs-1 text-warning mb-2">
              Il tuo Destinatario Segreto è pronto!
            </h3>
            <p class="text-white-50 mb-3">
              Assicurati che nessuno stia sbirciando il tuo schermo, poi tocca il sigillo per aprire la busta.
            </p>
            <span class="btn btn-warning fw-bold px-4 rounded-pill">
              <i class="bi bi-envelope-open-fill me-2"></i>Apri Busta Segreta
            </span>
          </div>

          <!-- STATO SVELATO -->
          <div v-else class="reveal-pop">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <span class="badge bg-danger border border-warning text-uppercase px-3 py-2 rounded-pill">
                🎁 Il tuo obiettivo segreto
              </span>
              <button
                class="btn btn-outline-light btn-sm rounded-pill"
                @click="isTargetRevealed = false"
              >
                <i class="bi bi-eye-slash me-1"></i> Nascondi
              </button>
            </div>

            <h2 class="font-christmas display-3 text-warning mb-1">
              {{ target.firstName }} {{ target.lastName }}
            </h2>
            <p class="text-white-50 mb-4">
              Mantieni il segreto! Usa i tuoi punti per sbloccare i suoi desideri.
            </p>

            <hr class="border-warning border-opacity-25 my-4" />

            <h5 class="fw-bold text-start mb-3 text-warning">
              <i class="bi bi-stars me-2"></i>Indizi Regalo di {{ target.firstName }}
            </h5>

            <div v-if="target.hints.length === 0" class="text-white-50 fst-italic py-3">
              {{ target.firstName }} non ha ancora inserito alcun indizio!
            </div>

            <div v-else class="d-flex flex-column gap-3 text-start">
              <div
                v-for="hint in target.hints"
                :key="hint.id"
                class="p-3 rounded-4 border d-flex flex-wrap justify-content-between align-items-center gap-3"
                :class="
                  hint.unlocked
                    ? 'border-success bg-success bg-opacity-10'
                    : 'border-secondary bg-black bg-opacity-25'
                "
              >
                <div>
                  <span
                    class="badge rounded-pill mb-1"
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
                  <span v-if="hint.unlocked" class="badge bg-success px-3 py-2 rounded-pill">
                    <i class="bi bi-unlock-fill me-1"></i> Sbloccato
                  </span>
                  <button
                    v-else
                    class="btn btn-warning fw-bold rounded-pill px-3"
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

      <!-- 3. CLASSIFICA & STORICO SFIDE -->
      <div class="row g-4 mb-4">
        <div class="col-12 col-lg-6">
          <div class="xmas-card h-100 overflow-hidden">
            <div class="p-3 px-4 border-bottom border-secondary border-opacity-50 fw-bold d-flex align-items-center gap-2">
              <span class="fs-4">🏆</span>
              <span class="font-christmas fs-3 text-warning">Classifica Elfi ({{ leaderboard.length }})</span>
            </div>
            <ul class="list-group list-group-flush">
              <li
                v-for="(player, idx) in leaderboard"
                :key="player.uid"
                class="list-group-item d-flex justify-content-between align-items-center py-3 px-4 border-secondary border-opacity-25 text-light"
                :class="player.uid === authStore.user?.uid ? 'bg-success bg-opacity-25 fw-bold' : 'bg-transparent'"
              >
                <div class="d-flex align-items-center gap-3">
                  <span class="fs-5" style="min-width: 28px;">
                    <template v-if="idx === 0">🥇</template>
                    <template v-else-if="idx === 1">🥈</template>
                    <template v-else-if="idx === 2">🥉</template>
                    <template v-else class="text-white-50 fs-6 fw-bold">#{{ idx + 1 }}</template>
                  </span>
                  <div>
                    <span>{{ player.firstName }} {{ player.lastName }}</span>
                    <span v-if="player.uid === authStore.user?.uid" class="badge bg-warning text-dark ms-2 small">
                      Tu
                    </span>
                  </div>
                </div>
                <span class="badge rounded-pill bg-warning text-dark fs-6 px-3">
                  {{ player.points }} pt
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="xmas-card h-100 overflow-hidden">
            <div class="p-3 px-4 border-bottom border-secondary border-opacity-50 fw-bold d-flex align-items-center gap-2">
              <span class="fs-4">📜</span>
              <span class="font-christmas fs-3 text-warning">Albo d'Oro Sfide ({{ completedChallenges.length }})</span>
            </div>
            <div v-if="completedChallenges.length === 0" class="p-4 text-center text-white-50 fst-italic">
              Nessuna sfida ancora conclusa. Preparati per la prossima!
            </div>
            <ul v-else class="list-group list-group-flush">
              <li
                v-for="ch in completedChallenges"
                :key="ch.id"
                class="list-group-item bg-transparent text-light border-secondary border-opacity-25 py-3 px-4"
              >
                <div class="d-flex justify-content-between align-items-start mb-1">
                  <span class="badge bg-danger rounded-pill">{{ ch.day }} Dicembre</span>
                  <span class="badge bg-success rounded-pill">+{{ ch.rewardPoints }} pt</span>
                </div>
                <div class="fw-bold mb-1">{{ ch.title }}</div>
                <div class="small text-warning">
                  <i class="bi bi-trophy-fill me-1"></i>
                  Vincitore: <strong>{{ getParticipantName(ch.winnerUid) }}</strong>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- 4. PANNELLO ADMIN -->
      <div v-if="authStore.profile?.isAdmin" class="xmas-card border-warning p-4">
        <div class="fw-bold text-warning mb-2 d-flex align-items-center gap-2">
          <i class="bi bi-tools"></i>
          <span>Pannello Admin & Ambiente di Test</span>
        </div>
        <p class="small text-white-50 mb-3">
          Comandi rapidi per popolare amici fittizi, aggiungere punti di prova e avviare il sorteggio.
        </p>

        <div class="d-flex flex-wrap gap-2">
          <button class="btn btn-outline-info btn-sm" :disabled="adminLoading" @click="handleSeedMockUsers">
            <i class="bi bi-people-fill me-1"></i> 1. Genera 4 Amici Fittizi
          </button>
          <button class="btn btn-outline-warning btn-sm" :disabled="adminLoading" @click="handleAddTestPoints">
            <i class="bi bi-plus-circle me-1"></i> 2. Aggiungimi +50 Punti Test
          </button>
          <button class="btn btn-danger btn-sm fw-bold" :disabled="adminLoading" @click="handleRunExtraction">
            <i class="bi bi-shuffle me-1"></i> 3. Avvia / Rifai Estrazione
          </button>
        </div>
      </div>
    </div>
  </div>
</template>