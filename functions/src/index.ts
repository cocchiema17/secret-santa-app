import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'

admin.initializeApp()
const db = admin.firestore()

// Imposta la region europea per tutte le funzioni
setGlobalOptions({ region: 'europe-west1' })

export interface HintItem {
  id: string
  level: 'ambito' | 'specifico'
  text: string
  cost: number
}

// Helper per verificare se chi chiama è Admin
async function assertIsAdmin(uid: string | undefined) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Devi effettuare il login.')
  }
  const userSnap = await db.collection('users').doc(uid).get()
  if (!userSnap.exists || userSnap.data()?.isAdmin !== true) {
    throw new HttpsError('permission-denied', 'Solo l’amministratore può eseguire questa azione.')
  }
}

/**
 * 1. ESTRAZIONE CICLO UNICO (A -> B -> C -> D -> E -> A)
 */
export const generateSecretSanta = onCall(async (request) => {
  await assertIsAdmin(request.auth?.uid)

  const usersSnap = await db.collection('users').get()
  const users = usersSnap.docs.map((doc) => ({
    uid: doc.id,
    firstName: doc.data().firstName,
    lastName: doc.data().lastName
  }))

  if (users.length < 3) {
    throw new HttpsError(
      'failed-precondition',
      'Servono almeno 3 partecipanti registrati per fare l’estrazione.'
    )
  }

  // Mescolamento casuale (Fisher-Yates shuffle)
  const shuffled = [...users]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  // Scrittura atomica in batch: crea il ciclo unico A -> B -> ... -> Z -> A
  const batch = db.batch()

  for (let i = 0; i < shuffled.length; i++) {
    const giver = shuffled[i]
    const receiver = shuffled[(i + 1) % shuffled.length]

    const secretRef = db.collection('secrets').doc(giver.uid)
    batch.set(secretRef, {
      targetUid: receiver.uid,
      unlockedHints: [],
      assignedAt: admin.firestore.FieldValue.serverTimestamp()
    })
  }

  // Aggiorna lo stato globale del gioco
  const statusRef = db.collection('gameConfig').doc('status')
  batch.set(statusRef, {
    isExtracted: true,
    totalParticipants: shuffled.length,
    extractedAt: admin.firestore.FieldValue.serverTimestamp()
  })

  await batch.commit()

  return {
    success: true,
    message: `Estrazione completata con successo per ${shuffled.length} partecipanti!`
  }
})

/**
 * 2. RECUPERA IL PROPRIO OBIETTIVO E GLI INDIZI (mascherando quelli non sbloccati)
 */
export const getMySecretTarget = onCall(async (request) => {
  const uid = request.auth?.uid
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Devi effettuare il login.')
  }

  const secretSnap = await db.collection('secrets').doc(uid).get()
  if (!secretSnap.exists) {
    return { extracted: false }
  }

  const secretData = secretSnap.data()!
  const targetUid: string = secretData.targetUid
  const unlockedHints: string[] = secretData.unlockedHints || []

  const targetSnap = await db.collection('users').doc(targetUid).get()
  if (!targetSnap.exists) {
    throw new HttpsError('not-found', 'Utente destinatario non trovato.')
  }

  const targetData = targetSnap.data()!
  const rawPreferences: HintItem[] = targetData.preferences || []

  // Restituiamo il testo SOLO per gli indizi già sbloccati; per gli altri mandiamo solo livello e costo!
  const sanitizedHints = rawPreferences.map((hint) => {
    const isUnlocked = unlockedHints.includes(hint.id)
    return {
      id: hint.id,
      level: hint.level,
      cost: hint.cost,
      unlocked: isUnlocked,
      text: isUnlocked ? hint.text : null
    }
  })

  return {
    extracted: true,
    target: {
      uid: targetUid,
      firstName: targetData.firstName,
      lastName: targetData.lastName,
      hints: sanitizedHints
    }
  }
})

/**
 * 3. SBLOCCA UN INDIZIO SPENDENDO I PUNTI (Transazione sicura)
 */
export const unlockHint = onCall(async (request) => {
  const uid = request.auth?.uid
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Devi effettuare il login.')
  }

  const hintId = request.data?.hintId as string
  if (!hintId) {
    throw new HttpsError('invalid-argument', 'ID indizio mancante.')
  }

  const userRef = db.collection('users').doc(uid)
  const secretRef = db.collection('secrets').doc(uid)

  const unlockedText = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef)
    const secretSnap = await tx.get(secretRef)

    if (!userSnap.exists || !secretSnap.exists) {
      throw new HttpsError('failed-precondition', 'Estrazione non ancora effettuata o utente non valido.')
    }

    const userData = userSnap.data()!
    const secretData = secretSnap.data()!
    const currentPoints: number = userData.points || 0
    const unlockedHints: string[] = secretData.unlockedHints || []

    if (unlockedHints.includes(hintId)) {
      throw new HttpsError('already-exists', 'Hai già sbloccato questo indizio!')
    }

    // Leggi il destinatario per trovare il costo reale dell'indizio
    const targetRef = db.collection('users').doc(secretData.targetUid)
    const targetSnap = await tx.get(targetRef)
    const targetPrefs: HintItem[] = targetSnap.data()?.preferences || []

    const targetHint = targetPrefs.find((h) => h.id === hintId)
    if (!targetHint) {
      throw new HttpsError('not-found', 'Indizio non trovato.')
    }

    if (currentPoints < targetHint.cost) {
      throw new HttpsError(
        'failed-precondition',
        `Punti insufficienti! Servono ${targetHint.cost} punti, ne hai ${currentPoints}.`
      )
    }

    // Scala i punti e salva l'indizio sbloccato
    tx.update(userRef, { points: currentPoints - targetHint.cost })
    tx.update(secretRef, { unlockedHints: [...unlockedHints, hintId] })

    return targetHint.text
  })

  return { success: true, text: unlockedText }
})

/**
 * 4. ASSEGNA PUNTI PER UNA SFIDA (Pagina /validate - solo Admin)
 */
export const awardChallengePoints = onCall(async (request) => {
  await assertIsAdmin(request.auth?.uid)

  const { winnerUid, points, challengeId } = request.data as {
    winnerUid: string
    points: number
    challengeId?: string
  }

  if (!winnerUid || typeof points !== 'number' || points <= 0) {
    throw new HttpsError('invalid-argument', 'Parametri non validi.')
  }

  const winnerRef = db.collection('users').doc(winnerUid)
  await winnerRef.update({
    points: admin.firestore.FieldValue.increment(points)
  })

  if (challengeId) {
    const challengeRef = db.collection('challenges').doc(challengeId)
    await challengeRef.update({
      completedBy: admin.firestore.FieldValue.arrayUnion(winnerUid)
    })
  }

  return { success: true }
})

/**
 * 5. HELPER DI TEST: CREA 5 UTENTI FITTIZI CON INDIZI PRECOMPILATI
 */
export const seedMockUsers = onCall(async (request) => {
  await assertIsAdmin(request.auth?.uid)

  const mockFriends = [
    {
      uid: 'mock_user_1',
      firstName: 'Luca',
      lastName: 'Bianchi',
      email: 'luca.test@esempio.it',
      points: 50,
      preferences: [
        { id: 'h1', level: 'ambito', text: 'Tecnologia e gadget da scrivania', cost: 15 },
        { id: 'h2', level: 'specifico', text: 'Un supporto magnetico per telefono o luce LED monitor', cost: 30 }
      ]
    },
    {
      uid: 'mock_user_2',
      firstName: 'Giulia',
      lastName: 'Verdi',
      email: 'giulia.test@esempio.it',
      points: 40,
      preferences: [
        { id: 'h1', level: 'ambito', text: 'Cucina e bevande calde', cost: 15 },
        { id: 'h2', level: 'specifico', text: 'Una tazza termica da viaggio o set di tè particolari', cost: 30 }
      ]
    },
    {
      uid: 'mock_user_3',
      firstName: 'Marco',
      lastName: 'Neri',
      email: 'marco.test@esempio.it',
      points: 20,
      preferences: [
        { id: 'h1', level: 'ambito', text: 'Giochi da tavolo e carte', cost: 15 },
        { id: 'h2', level: 'specifico', text: 'Un gioco di carte veloce da fare in gruppo (tipo Exploding Kittens)', cost: 30 }
      ]
    },
    {
      uid: 'mock_user_4',
      firstName: 'Sara',
      lastName: 'Russo',
      email: 'sara.test@esempio.it',
      points: 60,
      preferences: [
        { id: 'h1', level: 'ambito', text: 'Libri e cancelleria', cost: 15 },
        { id: 'h2', level: 'specifico', text: 'Un romanzo thriller o un’agenda Moleskine 2027', cost: 30 }
      ]
    }
  ]

  const batch = db.batch()
  for (const friend of mockFriends) {
    const ref = db.collection('users').doc(friend.uid)
    batch.set(ref, {
      firstName: friend.firstName,
      lastName: friend.lastName,
      email: friend.email,
      points: friend.points,
      isAdmin: false,
      preferences: friend.preferences,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    })
  }

  await batch.commit()
  return { success: true, message: 'Creati 4 amici fittizi (totale 5 con te)!' }
})