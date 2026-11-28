import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import * as nodemailer from 'nodemailer'

const smtpUser = defineSecret('SMTP_USER')
const smtpPass = defineSecret('SMTP_PASS')

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


// Helper per creare il transporter Nodemailer (configurato per Gmail; modificabile per altri SMTP)
function createMailTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpUser.value(),
      pass: smtpPass.value()
    }
  })
}

// Helper per inviare email a tutti i partecipanti reali (esclude i mock_user_ di test)
async function sendEmailToAllUsers(subject: string, htmlBody: string) {
  const usersSnap = await db.collection('users').get()
  const emails: string[] = []

  usersSnap.forEach((doc) => {
    if (!doc.id.startsWith('mock_user_') && doc.data().email) {
      emails.push(doc.data().email)
    }
  })

  if (emails.length === 0) return 0

  const transporter = createMailTransporter()
  await transporter.sendMail({
    from: `"Babbo Natale Segreto 🎅" <${smtpUser.value()}>`,
    bcc: emails, // BCC così gli indirizzi restano ordinati e privati
    subject,
    html: htmlBody
  })

  return emails.length
}

/**
 * 6. INVIO EMAIL DI INVITO A REGISTRARSI (Destinatari inseriti manualmente dall'Admin)
 */
export const sendAppLaunchEmail = onCall(
  { secrets: [smtpUser, smtpPass] },
  async (request) => {
    await assertIsAdmin(request.auth?.uid)

    const { appUrl, customMessage, recipientEmails } = request.data as {
      appUrl: string
      customMessage?: string
      recipientEmails: string[]
    }

    if (!appUrl) {
      throw new HttpsError('invalid-argument', 'URL dell’applicazione mancante.')
    }

    if (!Array.isArray(recipientEmails) || recipientEmails.length === 0) {
      throw new HttpsError('invalid-argument', 'Inserisci almeno un indirizzo email destinatario.')
    }

    // Pulisce e valida gli indirizzi email
    const validEmails = recipientEmails
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))

    if (validEmails.length === 0) {
      throw new HttpsError('invalid-argument', 'Nessun indirizzo email valido trovato.')
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 2px solid #c1121f; border-radius: 12px; background-color: #ffffff;">
        <h2 style="color: #c1121f; text-align: center;">🎅 Sei invitato al Babbo Natale Segreto 2026! 🎄</h2>
        <p>Ciao!</p>
        <p>${
          customMessage ||
          'Il Villaggio di Babbo Natale è ufficialmente aperto! Clicca sul pulsante qui sotto per creare il tuo account, inserire i tuoi indizi regalo e prepararti alle sfide giornaliere di dicembre.'
        }</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${appUrl}" style="background-color: #1b4332; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
            Registrati nella Web App
          </a>
        </div>
        <p style="font-size: 13px; color: #555;">
          Oppure copia questo link nel browser: <br/>
          <a href="${appUrl}" style="color: #c1121f;">${appUrl}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #888; text-align: center;">A presto, gli Elfi di Babbo Natale ❄️</p>
      </div>
    `

    const transporter = createMailTransporter()
    await transporter.sendMail({
      from: `"Babbo Natale Segreto 🎅" <${smtpUser.value()}>`,
      bcc: validEmails,
      subject: '🎅 Invito Ufficiale: Babbo Natale Segreto 2026!',
      html
    })

    return {
      success: true,
      message: `Email di invito inviata con successo a ${validEmails.length} destinatari!`
    }
  }
)

/**
 * 7. ATTIVA UNA SFIDA E INVIA L'EMAIL DI NOTIFICA (Usata sia dallo scheduler che dal tasto test Admin)
 */
async function activateChallengeAndNotify(challengeDoc: admin.firestore.DocumentSnapshot, appUrl: string) {
  const data = challengeDoc.data()!

  await challengeDoc.ref.update({
    status: 'active',
    activatedAt: admin.firestore.FieldValue.serverTimestamp()
  })

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 2px solid #1b4332; border-radius: 12px;">
      <h2 style="color: #1b4332; text-align: center;">🔔 Nuova Sfida Giornaliera (Giorno ${data.day} Dicembre)!</h2>
      <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #c1121f;">${data.title}</h3>
        <p style="margin-bottom: 10px;">${data.description}</p>
        <p style="font-weight: bold; color: #d97706; margin-bottom: 0;">🏆 In palio: ${data.rewardPoints} punti</p>
      </div>
      <div style="text-align: center; margin: 25px 0;">
        <a href="${appUrl}" style="background-color: #c1121f; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">
          Vai all'App e partecipa
        </a>
      </div>
    </div>
  `

  return await sendEmailToAllUsers(
    `🎄 Sfida del ${data.day} Dicembre: ${data.title} (+${data.rewardPoints} pt)`,
    html
  )
}

/**
 * 8. AZIONE MANUALE ADMIN: ATTIVA SUBITO UNA SFIDA E MANDA EMAIL
 */
export const triggerChallengeNow = onCall(
  { secrets: [smtpUser, smtpPass] },
  async (request) => {
    await assertIsAdmin(request.auth?.uid)

    const { challengeId, appUrl } = request.data as { challengeId: string; appUrl: string }
    const docSnap = await db.collection('challenges').doc(challengeId).get()

    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'Sfida non trovata.')
    }

    const sentCount = await activateChallengeAndNotify(docSnap, appUrl || 'https://secret-santa-2026-d1e50.web.app')
    return { success: true, message: `Sfida attivata ed email inviata a ${sentCount} partecipanti!` }
  }
)

/**
 * 9. SCHEDULER AUTOMATICO: OGNI GIORNO ALLE 08:00 IMPOSTA UN ORARIO RANDOMICO (10:00 - 19:30)
 */
export const planDailyRandomChallenge = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'Europe/Rome' },
  async () => {
    const now = new Date()
    // Verifica se siamo a Dicembre (getMonth() === 11)
    if (now.getMonth() !== 11) return

    const todayDay = now.getDate()
    if (todayDay < 1 || todayDay > 24) return

    const snap = await db
      .collection('challenges')
      .where('day', '==', todayDay)
      .where('status', '==', 'pending')
      .limit(1)
      .get()

    if (snap.empty) return

    // Calcola un orario casuale tra le 10:00 e le 19:30 di oggi
    const randomHour = Math.floor(Math.random() * 10) + 10 // 10..19
    const randomMinute = Math.floor(Math.random() * 60)
    const releaseDate = new Date(now.getFullYear(), 11, todayDay, randomHour, randomMinute, 0)

    await snap.docs[0].ref.update({
      scheduledReleaseAt: admin.firestore.Timestamp.fromDate(releaseDate)
    })
  }
)

/**
 * 10. SCHEDULER AUTOMATICO: OGNI 15 MINUTI CONTROLLA SE È ORA DI RILASCIARE LA SFIDA
 */
export const checkAndReleaseChallenge = onSchedule(
  {
    schedule: '*/15 10-20 * * *',
    timeZone: 'Europe/Rome',
    secrets: [smtpUser, smtpPass]
  },
  async () => {
    const now = admin.firestore.Timestamp.now()

    const snap = await db
      .collection('challenges')
      .where('status', '==', 'pending')
      .where('scheduledReleaseAt', '<=', now)
      .get()

    if (snap.empty) return

    const appUrl = 'https://secret-santa-2026-d1e50.web.app'
    for (const docSnap of snap.docs) {
      await activateChallengeAndNotify(docSnap, appUrl)
    }
  }
)