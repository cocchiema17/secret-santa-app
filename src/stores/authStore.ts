import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db, googleProvider } from '@/firebase'

export interface UserProfile {
  uid: string
  firstName: string
  lastName: string
  email: string
  points: number
  isAdmin: boolean
  preferences: Array<{ id: string; level: 'ambito' | 'specifico'; text: string }>
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const profile = ref<UserProfile | null>(null)
  const isReady = ref(false)

  // Carica il profilo da Firestore
  async function fetchUserProfile(uid: string) {
    const docRef = doc(db, 'users', uid)
    const snap = await getDoc(docRef)
    if (snap.exists()) {
      profile.value = { uid, ...snap.data() } as UserProfile
    }
  }

  // Inizializza il listener sullo stato di login
  function initAuth(): Promise<void> {
    return new Promise((resolve) => {
      onAuthStateChanged(auth, async (firebaseUser) => {
        user.value = firebaseUser
        if (firebaseUser) {
          await fetchUserProfile(firebaseUser.uid)
        } else {
          profile.value = null
        }
        isReady.value = true
        resolve()
      })
    })
  }

  // Registrazione Email + Password
  async function registerWithEmail(firstName: string, lastName: string, email: string, password: string) {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    const newProfile: Omit<UserProfile, 'uid'> = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      points: 0,
      isAdmin: false,
      preferences: []
    }
    await setDoc(doc(db, 'users', cred.user.uid), {
      ...newProfile,
      createdAt: serverTimestamp()
    })
    profile.value = { uid: cred.user.uid, ...newProfile }
  }

  // Login Email + Password
  async function loginWithEmail(email: string, password: string) {
    const cred = await signInWithEmailAndPassword(auth, email, password)
    await fetchUserProfile(cred.user.uid)
  }

  // Login / Registrazione rapida con Google
  async function loginWithGoogle() {
    const cred = await signInWithPopup(auth, googleProvider)
    const docRef = doc(db, 'users', cred.user.uid)
    const snap = await getDoc(docRef)

    if (!snap.exists()) {
      // Primo accesso con Google: creiamo il profilo su Firestore
      const fullName = cred.user.displayName || 'Elfo Misterioso'
      const parts = fullName.trim().split(' ')
      const firstName = parts[0] || 'Elfo'
      const lastName = parts.slice(1).join(' ') || ''

      const newProfile: Omit<UserProfile, 'uid'> = {
        firstName,
        lastName,
        email: cred.user.email || '',
        points: 0,
        isAdmin: false,
        preferences: []
      }
      await setDoc(docRef, {
        ...newProfile,
        createdAt: serverTimestamp()
      })
      profile.value = { uid: cred.user.uid, ...newProfile }
    } else {
      profile.value = { uid: cred.user.uid, ...snap.data() } as UserProfile
    }
  }

  async function logout() {
    await signOut(auth)
    user.value = null
    profile.value = null
  }

  return {
    user,
    profile,
    isReady,
    initAuth,
    fetchUserProfile,
    registerWithEmail,
    loginWithEmail,
    loginWithGoogle,
    logout
  }
})