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
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { auth, db, googleProvider } from '@/firebase'

export interface UserProfile {
  uid: string
  firstName: string
  lastName: string
  email: string
  points: number
  isAdmin: boolean
  preferences: Array<{ id: string; level: 'ambito' | 'specifico'; text: string; cost?: number }>
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const profile = ref<UserProfile | null>(null)
  const isReady = ref(false)
  let unsubscribeProfile: (() => void) | null = null

  // Sottoscrizione in tempo reale al profilo utente su Firestore
  function subscribeToProfile(uid: string): Promise<void> {
    if (unsubscribeProfile) {
      unsubscribeProfile()
      unsubscribeProfile = null
    }

    return new Promise((resolve) => {
      const docRef = doc(db, 'users', uid)
      unsubscribeProfile = onSnapshot(docRef, async (snap) => {
        if (snap.exists()) {
          profile.value = { uid, ...snap.data() } as UserProfile
        } else {
          await signOut(auth)
          user.value = null
          profile.value = null
        }
        resolve()
      })
    })
  }

  // Manteniamo anche fetchUserProfile come alias compatibile per eventuali chiamate esistenti
  async function fetchUserProfile(uid: string) {
    const snap = await getDoc(doc(db, 'users', uid))
    if (snap.exists()) {
      profile.value = { uid, ...snap.data() } as UserProfile
    }
  }

  function initAuth(): Promise<void> {
    return new Promise((resolve) => {
      onAuthStateChanged(auth, async (firebaseUser) => {
        user.value = firebaseUser
        if (firebaseUser) {
          await subscribeToProfile(firebaseUser.uid)
        } else {
          if (unsubscribeProfile) {
            unsubscribeProfile()
            unsubscribeProfile = null
          }
          profile.value = null
        }
        isReady.value = true
        resolve()
      })
    })
  }

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
    await subscribeToProfile(cred.user.uid)
  }

  async function loginWithEmail(email: string, password: string) {
    const cred = await signInWithEmailAndPassword(auth, email, password)
    await subscribeToProfile(cred.user.uid)
  }

  async function loginWithGoogle() {
    const cred = await signInWithPopup(auth, googleProvider)
    const docRef = doc(db, 'users', cred.user.uid)
    const snap = await getDoc(docRef)

    if (!snap.exists()) {
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
    }
    await subscribeToProfile(cred.user.uid)
  }

  async function logout() {
    if (unsubscribeProfile) {
      unsubscribeProfile()
      unsubscribeProfile = null
    }
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