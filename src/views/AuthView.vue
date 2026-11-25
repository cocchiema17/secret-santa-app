<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

const router = useRouter()
const authStore = useAuthStore()

const isRegister = ref(false)
const firstName = ref('')
const lastName = ref('')
const email = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)

async function handleSubmit() {
  errorMsg.value = ''
  loading.value = true
  try {
    if (isRegister.value) {
      if (!firstName.value || !lastName.value) {
        errorMsg.value = 'Inserisci nome e cognome.'
        loading.value = false
        return
      }
      await authStore.registerWithEmail(firstName.value, lastName.value, email.value, password.value)
    } else {
      await authStore.loginWithEmail(email.value, password.value)
    }
    router.push('/')
  } catch (err: any) {
    errorMsg.value = translateFirebaseError(err.code)
  } finally {
    loading.value = false
  }
}

async function handleGoogle() {
  errorMsg.value = ''
  loading.value = true
  try {
    await authStore.loginWithGoogle()
    router.push('/')
  } catch (err: any) {
    errorMsg.value = translateFirebaseError(err.code)
  } finally {
    loading.value = false
  }
}

function translateFirebaseError(code: string): string {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'Questa email è già registrata.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email o password non corretti.'
    case 'auth/weak-password':
      return 'La password deve avere almeno 6 caratteri.'
    default:
      return 'Si è verificato un errore durante l’accesso. Riprova.'
  }
}
</script>

<template>
  <div class="min-vh-100 d-flex align-items-center justify-content-center bg-dark py-4 px-3"
       style="background: radial-gradient(circle at top, #1b4332 0%, #081c15 100%);">
    <div class="card shadow-lg border-0 rounded-4 w-100" style="max-width: 430px;">
      <div class="card-body p-4 p-sm-5">
        <div class="text-center mb-4">
          <div class="fs-1 mb-1">🎅🎄</div>
          <h2 class="fw-bold text-danger mb-1">Secret Santa</h2>
          <p class="text-muted small">Accedi al villaggio di Natale</p>
        </div>

        <!-- Switch Accedi / Registrati -->
        <div class="btn-group w-100 mb-4" role="group">
          <button
            type="button"
            class="btn"
            :class="!isRegister ? 'btn-danger' : 'btn-outline-danger'"
            @click="isRegister = false; errorMsg = ''"
          >
            Accedi
          </button>
          <button
            type="button"
            class="btn"
            :class="isRegister ? 'btn-danger' : 'btn-outline-danger'"
            @click="isRegister = true; errorMsg = ''"
          >
            Registrati
          </button>
        </div>

        <div v-if="errorMsg" class="alert alert-danger py-2 small" role="alert">
          <i class="bi bi-exclamation-triangle-fill me-1"></i> {{ errorMsg }}
        </div>

        <form @submit.prevent="handleSubmit">
          <div v-if="isRegister" class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label small fw-semibold">Nome</label>
              <input v-model="firstName" type="text" class="form-control" placeholder="Mario" required />
            </div>
            <div class="col-6">
              <label class="form-label small fw-semibold">Cognome</label>
              <input v-model="lastName" type="text" class="form-control" placeholder="Rossi" required />
            </div>
          </div>

          <div class="mb-3">
            <label class="form-label small fw-semibold">Email</label>
            <input v-model="email" type="email" class="form-control" placeholder="mario@esempio.it" required />
          </div>

          <div class="mb-4">
            <label class="form-label small fw-semibold">Password</label>
            <input v-model="password" type="password" class="form-control" placeholder="Min. 6 caratteri" required />
          </div>

          <button type="submit" class="btn btn-success w-100 py-2 fw-semibold" :disabled="loading">
            <span v-if="loading" class="spinner-border spinner-border-sm me-2"></span>
            {{ isRegister ? 'Crea Account' : 'Entra' }}
          </button>
        </form>

        <div class="d-flex align-items-center my-3">
          <hr class="flex-grow-1" />
          <span class="px-2 text-muted small">oppure</span>
          <hr class="flex-grow-1" />
        </div>

        <button
          type="button"
          class="btn btn-outline-dark w-100 py-2 d-flex align-items-center justify-content-center gap-2"
          :disabled="loading"
          @click="handleGoogle"
        >
          <i class="bi bi-google text-danger"></i>
          <span>Continua con Google</span>
        </button>
      </div>
    </div>
  </div>
</template>