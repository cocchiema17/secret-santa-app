<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
  query,
  serverTimestamp
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/firebase'
import Navbar from '@/components/Navbar.vue'

interface Challenge {
  id: string
  day: number
  title: string
  description: string
  rewardPoints: number
  status: 'pending' | 'active' | 'completed'
  winnerUid?: string
}

interface Participant {
  uid: string
  firstName: string
  lastName: string
  email: string
  points: number
}

const challenges = ref<Challenge[]>([])
const participants = ref<Participant[]>([])
const loading = ref(true)
const feedback = ref<{ type: 'success' | 'danger'; text: string } | null>(null)

// Form CRUD sfida
const editingId = ref<string | null>(null)
const formDay = ref(1)
const formTitle = ref('')
const formDescription = ref('')
const formPoints = ref(20)
const savingChallenge = ref(false)

// Form Validazione Vincitore
const selectedChallengeId = ref('')
const selectedWinnerUid = ref('')
const validating = ref(false)

// Form Email Invito (non ancora registrati)
const appUrl = ref(window.location.origin)
const rawEmails = ref('')
const customLaunchMsg = ref('')
const sendingLaunchEmail = ref(false)

const activeChallenges = computed(() =>
  challenges.value.filter((c) => c.status === 'active' || c.status === 'pending')
)

async function loadData() {
  loading.value = true
  try {
    const q = query(collection(db, 'challenges'), orderBy('day', 'asc'))
    const cSnap = await getDocs(q)
    challenges.value = cSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Challenge))

    const uSnap = await getDocs(collection(db, 'users'))
    participants.value = uSnap.docs.map((d) => ({
      uid: d.id,
      firstName: d.data().firstName,
      lastName: d.data().lastName,
      email: d.data().email,
      points: d.data().points || 0
    }))

    // Preseleziona eventuale sfida attiva
    const currentActive = challenges.value.find((c) => c.status === 'active')
    if (currentActive) {
      selectedChallengeId.value = currentActive.id
    }
  } finally {
    loading.value = false
  }
}

// --- CRUD SFIDE ---
function startEdit(c: Challenge) {
  editingId.value = c.id
  formDay.value = c.day
  formTitle.value = c.title
  formDescription.value = c.description
  formPoints.value = c.rewardPoints
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function resetForm() {
  editingId.value = null
  formDay.value = challenges.value.length < 24 ? challenges.value.length + 1 : 1
  formTitle.value = ''
  formDescription.value = ''
  formPoints.value = 20
}

async function saveChallenge() {
  if (!formTitle.value.trim() || !formDescription.value.trim()) return
  savingChallenge.value = true
  feedback.value = null

  try {
    if (editingId.value) {
      await updateDoc(doc(db, 'challenges', editingId.value), {
        day: Number(formDay.value),
        title: formTitle.value.trim(),
        description: formDescription.value.trim(),
        rewardPoints: Number(formPoints.value)
      })
      feedback.value = { type: 'success', text: 'Sfida aggiornata con successo!' }
    } else {
      await addDoc(collection(db, 'challenges'), {
        day: Number(formDay.value),
        title: formTitle.value.trim(),
        description: formDescription.value.trim(),
        rewardPoints: Number(formPoints.value),
        status: 'pending',
        completedBy: [],
        createdAt: serverTimestamp()
      })
      feedback.value = { type: 'success', text: 'Nuova sfida aggiunta al calendario!' }
    }
    resetForm()
    await loadData()
  } catch (err: any) {
    feedback.value = { type: 'danger', text: err.message }
  } finally {
    savingChallenge.value = false
  }
}

async function deleteChallenge(id: string) {
  if (!confirm('Vuoi davvero eliminare questa sfida?')) return
  try {
    await deleteDoc(doc(db, 'challenges', id))
    feedback.value = { type: 'success', text: 'Sfida eliminata.' }
    await loadData()
  } catch (err: any) {
    feedback.value = { type: 'danger', text: err.message }
  }
}

async function handleTriggerNow(challengeId: string) {
  if (!confirm('Vuoi attivare subito questa sfida e inviare l’email di notifica a tutti?')) return
  feedback.value = null
  try {
    const triggerFn = httpsCallable(functions, 'triggerChallengeNow')
    const res = await triggerFn({ challengeId, appUrl: appUrl.value })
    const data = res.data as { message: string }
    feedback.value = { type: 'success', text: data.message }
    await loadData()
  } catch (err: any) {
    feedback.value = { type: 'danger', text: err.message }
  }
}

// --- VALIDAZIONE VINCITORE ---
async function handleAwardWinner() {
  if (!selectedChallengeId.value || !selectedWinnerUid.value) return
  const challenge = challenges.value.find((c) => c.id === selectedChallengeId.value)
  if (!challenge) return

  validating.value = true
  feedback.value = null
  try {
    const awardFn = httpsCallable(functions, 'awardChallengePoints')
    await awardFn({
      winnerUid: selectedWinnerUid.value,
      points: challenge.rewardPoints,
      challengeId: challenge.id
    })

    await updateDoc(doc(db, 'challenges', challenge.id), {
      status: 'completed',
      winnerUid: selectedWinnerUid.value
    })

    feedback.value = {
      type: 'success',
      text: `Assegnati ${challenge.rewardPoints} punti al vincitore e sfida completata!`
    }
    selectedWinnerUid.value = ''
    await loadData()
  } catch (err: any) {
    feedback.value = { type: 'danger', text: err.message }
  } finally {
    validating.value = false
  }
}

// --- INVIO EMAIL LANCIO WEB APP ---
async function handleSendLaunchEmail() {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  const rawTokens = rawEmails.value
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0)

  if (rawTokens.length === 0) {
    feedback.value = { type: 'danger', text: 'Inserisci almeno un indirizzo email.' }
    return
  }

  const invalidEntries = rawTokens.filter((e) => !emailRegex.test(e))
  if (invalidEntries.length > 0) {
    feedback.value = {
      type: 'danger',
      text: `Indirizzi email non validi rilevati: ${invalidEntries.join(', ')}`
    }
    return
  }

  // Rimuove eventuali duplicati
  const uniqueEmails = [...new Set(rawTokens.map((e) => e.toLowerCase()))]

  if (!confirm(`Inviare l’email di invito a ${uniqueEmails.length} indirizzi validi?`)) return

  sendingLaunchEmail.value = true
  feedback.value = null
  try {
    const launchFn = httpsCallable(functions, 'sendAppLaunchEmail')
    const res = await launchFn({
      appUrl: appUrl.value,
      recipientEmails: uniqueEmails,
      customMessage: customLaunchMsg.value.trim()
    })
    const data = res.data as { message: string }
    feedback.value = { type: 'success', text: data.message }
    rawEmails.value = ''
  } catch (err: any) {
    feedback.value = { type: 'danger', text: err.message }
  } finally {
    sendingLaunchEmail.value = false
  }
}

function getParticipantName(uid?: string) {
  if (!uid) return ''
  const p = participants.value.find((u) => u.uid === uid)
  return p ? `${p.firstName} ${p.lastName}` : uid
}

onMounted(loadData)
</script>

<template>
  <div class="min-vh-100 text-light" style="background: radial-gradient(circle at top, #1b4332 0%, #081c15 100%);">
    <Navbar />

    <div class="container py-4 py-md-5" style="max-width: 900px;">
      <div class="d-flex align-items-center gap-2 mb-4">
        <span class="fs-2">🛡️</span>
        <div>
          <h2 class="fw-bold mb-0">Pannello Regia & Validazione</h2>
          <p class="text-white-50 small mb-0">Area riservata all'amministratore</p>
        </div>
      </div>

      <div v-if="feedback" :class="`alert alert-${feedback.type} alert-dismissible fade show`">
        {{ feedback.text }}
        <button type="button" class="btn-close" @click="feedback = null"></button>
      </div>

      <!-- 1. SEZIONE DECRETA VINCITORE -->
      <div class="card bg-dark text-light border-warning shadow rounded-4 mb-4">
        <div class="card-header bg-warning text-dark fw-bold">
          <i class="bi bi-trophy-fill me-2"></i>Decreta il Vincitore della Sfida
        </div>
        <div class="card-body p-4">
          <form @submit.prevent="handleAwardWinner" class="row g-3 align-items-end">
            <div class="col-md-5">
              <label class="form-label small fw-semibold">Seleziona Sfida</label>
              <select v-model="selectedChallengeId" class="form-select bg-dark text-light border-secondary" required>
                <option value="" disabled>-- Scegli la sfida --</option>
                <option v-for="c in activeChallenges" :key="c.id" :value="c.id">
                  {{ c.day }} Dic - {{ c.title }} ({{ c.rewardPoints }} pt) [{{ c.status }}]
                </option>
              </select>
            </div>

            <div class="col-md-4">
              <label class="form-label small fw-semibold">Seleziona Vincitore</label>
              <select v-model="selectedWinnerUid" class="form-select bg-dark text-light border-secondary" required>
                <option value="" disabled>-- Scegli l'amico --</option>
                <option v-for="p in participants" :key="p.uid" :value="p.uid">
                  {{ p.firstName }} {{ p.lastName }} ({{ p.points }} pt)
                </option>
              </select>
            </div>

            <div class="col-md-3">
              <button type="submit" class="btn btn-success w-100 fw-bold" :disabled="validating">
                <span v-if="validating" class="spinner-border spinner-border-sm me-1"></span>
                Assegna Punti
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- 2. FORM INSERIMENTO / MODIFICA SFIDA -->
      <div class="card bg-dark text-light border-success border-opacity-50 shadow rounded-4 mb-4">
        <div class="card-header border-secondary fw-bold d-flex justify-content-between align-items-center">
          <span>
            <i class="bi bi-calendar-plus me-2 text-success"></i>
            {{ editingId ? 'Modifica Sfida' : 'Aggiungi Nuova Sfida (1 - 24 Dicembre)' }}
          </span>
          <button v-if="editingId" class="btn btn-sm btn-outline-light" @click="resetForm">
            Annulla modifica
          </button>
        </div>
        <div class="card-body p-4">
          <form @submit.prevent="saveChallenge" class="row g-3">
            <div class="col-4 col-md-2">
              <label class="form-label small fw-semibold">Giorno (Dic)</label>
              <input
                v-model.number="formDay"
                type="number"
                min="1"
                max="24"
                class="form-control bg-dark text-light border-secondary"
                required
              />
            </div>

            <div class="col-8 col-md-7">
              <label class="form-label small fw-semibold">Titolo Sfida</label>
              <input
                v-model="formTitle"
                type="text"
                class="form-control bg-dark text-light border-secondary"
                placeholder="Es. Il maglione più brutto"
                required
              />
            </div>

            <div class="col-12 col-md-3">
              <label class="form-label small fw-semibold">Punti in palio</label>
              <input
                v-model.number="formPoints"
                type="number"
                min="5"
                step="5"
                class="form-control bg-dark text-light border-secondary"
                required
              />
            </div>

            <div class="col-12">
              <label class="form-label small fw-semibold">Descrizione / Regole della sfida</label>
              <textarea
                v-model="formDescription"
                rows="2"
                class="form-control bg-dark text-light border-secondary"
                placeholder="Spiega cosa devono fare i partecipanti..."
                required
              ></textarea>
            </div>

            <div class="col-12">
              <button type="submit" class="btn btn-success fw-bold px-4" :disabled="savingChallenge">
                <span v-if="savingChallenge" class="spinner-border spinner-border-sm me-1"></span>
                {{ editingId ? 'Salva Modifiche' : 'Aggiungi al Calendario' }}
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- 3. LISTA CALENDARIO SFIDE -->
      <div class="card bg-dark text-light border-secondary shadow rounded-4 mb-4">
        <div class="card-header border-secondary fw-bold">
          <i class="bi bi-list-ol me-2"></i>Calendario Sfide Caricate ({{ challenges.length }} / 24)
        </div>
        <div class="card-body p-0">
          <div v-if="loading" class="p-4 text-center">
            <div class="spinner-border text-light"></div>
          </div>
          <div v-else-if="challenges.length === 0" class="p-4 text-center text-white-50">
            Nessuna sfida inserita. Usa il form qui sopra per iniziare!
          </div>
          <div v-else class="list-group list-group-flush rounded-bottom-4">
            <div
              v-for="c in challenges"
              :key="c.id"
              class="list-group-item bg-dark text-light border-secondary p-3 d-flex flex-wrap justify-content-between align-items-center gap-3"
            >
              <div style="max-width: 550px;">
                <div class="d-flex align-items-center gap-2 mb-1">
                  <span class="badge bg-danger">{{ c.day }} Dicembre</span>
                  <span class="badge bg-warning text-dark">{{ c.rewardPoints }} pt</span>
                  <span
                    class="badge"
                    :class="{
                      'bg-secondary': c.status === 'pending',
                      'bg-success': c.status === 'active',
                      'bg-info text-dark': c.status === 'completed'
                    }"
                  >
                    {{ c.status === 'pending' ? 'In attesa' : c.status === 'active' ? 'Attiva ora' : 'Completata' }}
                  </span>
                </div>
                <h6 class="fw-bold mb-1">{{ c.title }}</h6>
                <p class="small text-white-50 mb-0">{{ c.description }}</p>
                <p v-if="c.winnerUid" class="small text-success fw-semibold mt-1 mb-0">
                  🏆 Vincitore: {{ getParticipantName(c.winnerUid) }}
                </p>
              </div>

              <div class="d-flex gap-2">
                <button
                  v-if="c.status === 'pending'"
                  class="btn btn-outline-success btn-sm"
                  title="Attiva subito e invia email"
                  @click="handleTriggerNow(c.id)"
                >
                  <i class="bi bi-send-fill me-1"></i> Attiva Ora
                </button>
                <button class="btn btn-outline-light btn-sm" @click="startEdit(c)">
                  <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-outline-danger btn-sm" @click="deleteChallenge(c.id)">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. INVIO EMAIL DI INVITO (PER CHI NON È ANCORA REGISTRATO) -->
      <div class="card bg-dark text-light border-info border-opacity-50 shadow rounded-4">
        <div class="card-header border-secondary fw-bold">
          <i class="bi bi-envelope-paper-fill me-2 text-info"></i>Invito Web App via Email (Nuovi Partecipanti)
        </div>
        <div class="card-body p-4">
          <div class="mb-3">
            <label class="form-label small fw-semibold">Indirizzi email dei destinatari</label>
            <textarea
              v-model="rawEmails"
              rows="3"
              class="form-control bg-dark text-light border-secondary"
              placeholder="Incolla gli indirizzi email separati da virgola o a capo (es. luca@gmail.com, giulia@gmail.com)..."
            ></textarea>
          </div>
          <div class="mb-3">
            <label class="form-label small fw-semibold">Link della Web App</label>
            <input v-model="appUrl" type="url" class="form-control bg-dark text-light border-secondary" />
          </div>
          <div class="mb-3">
            <label class="form-label small fw-semibold">Messaggio personalizzato (opzionale)</label>
            <textarea
              v-model="customLaunchMsg"
              rows="2"
              class="form-control bg-dark text-light border-secondary"
              placeholder="Lascia vuoto per usare il messaggio di invito predefinito..."
            ></textarea>
          </div>
          <button
            class="btn btn-info text-dark fw-bold"
            :disabled="sendingLaunchEmail"
            @click="handleSendLaunchEmail"
          >
            <span v-if="sendingLaunchEmail" class="spinner-border spinner-border-sm me-1"></span>
            Invia Invito a Registrarsi
          </button>
        </div>
      </div>
    </div>
  </div>
</template>