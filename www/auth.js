// auth.js (MODULE) — Email/Password + Avatars Firestore + état global
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// =====================
// CONFIG
// =====================
export const ADMIN_EMAILS = ["tidoc.congres@gmail.com"].map(e => e.toLowerCase());

// Avatars (dossier: /avatars/)
export const AVATARS = Array.from({ length: 10 }, (_, i) => `./avatars/avatar-${i + 1}.png`);

// =====================
// INIT FIREBASE (anti double init)
// =====================
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// =====================
// HELPERS
// =====================
export function pickRandomAvatar() {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

export function isAdminUser(user = auth.currentUser) {
  const email = (user?.email || "").toLowerCase();
  return ADMIN_EMAILS.includes(email);
}

// Crée/complète users/{uid}
export async function ensureUserDoc(user, { displayName, avatarUrl } = {}) {
  if (!user?.uid) return null;

  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  // ✅ si doc existe : complète si manque avatarUrl / displayName
  if (snap.exists()) {
    const data = snap.data() || {};

    const patch = {};
    if (!data.avatarUrl) patch.avatarUrl = avatarUrl || pickRandomAvatar();
    if (!data.displayName) patch.displayName = (displayName || user.displayName || "Utilisateur").trim();

    if (Object.keys(patch).length) {
      patch.updatedAt = serverTimestamp();
      await setDoc(ref, patch, { merge: true });
      return { ...data, ...patch };
    }

    return data;
  }

  // ✅ sinon : crée doc
  const finalName = (displayName || user.displayName || "Utilisateur").trim();
  const finalAvatar = avatarUrl || pickRandomAvatar();

  const newDoc = {
    email: (user.email || "").toLowerCase(),
    displayName: finalName,
    avatarUrl: finalAvatar,
    role: isAdminUser(user) ? "admin" : "user",
    createdAt: serverTimestamp()
  };

  await setDoc(ref, newDoc, { merge: true });

  return {
    email: newDoc.email,
    displayName: finalName,
    avatarUrl: finalAvatar,
    role: newDoc.role
  };
}

export async function getUserProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// =====================
// AUTH ACTIONS
// =====================
export async function signupEmail({ email, password, displayName } = {}) {
  if (!email || !password) throw new Error("Email + mot de passe requis.");

  const cred = await createUserWithEmailAndPassword(auth, email, password);

  const name = (displayName || "Utilisateur").trim();
  await updateProfile(cred.user, { displayName: name });

  // ✅ doc Firestore + avatar aléatoire
  await ensureUserDoc(cred.user, { displayName: name, avatarUrl: pickRandomAvatar() });

  return cred.user;
}

export async function loginEmail({ email, password } = {}) {
  if (!email || !password) throw new Error("Email + mot de passe requis.");

  const cred = await signInWithEmailAndPassword(auth, email, password);

  // ✅ s’assure qu’on a un doc (et un avatar)
  await ensureUserDoc(cred.user);

  return cred.user;
}

export async function resetPassword(email) {
  if (!email) throw new Error("Email requis.");
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  await signOut(auth);
}

// Helper : exiger connexion pour accéder à une page
export function requireAuthOrRedirect(redirectTo = "./login.html") {
  onAuthStateChanged(auth, (u) => {
    if (!u) window.location.href = redirectTo;
  });
}

// =====================
// ÉTAT GLOBAL (pour toutes les pages)
// =====================
window.TIDOC_AUTH = window.TIDOC_AUTH || null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.TIDOC_AUTH = null;
    window.dispatchEvent(new CustomEvent("tidoc:auth", { detail: null }));
    return;
  }

  // ✅ état rapide (immédiat)
  const base = {
    uid: user.uid,
    email: (user.email || "").toLowerCase(),
    displayName: (user.displayName || "Utilisateur").trim(),
    isAdmin: isAdminUser(user)
  };

  window.TIDOC_AUTH = base;
  window.dispatchEvent(new CustomEvent("tidoc:auth", { detail: base }));

  // ✅ complète avec Firestore (avatar/role/nom)
  try {
    const profile = await ensureUserDoc(user);
    window.TIDOC_AUTH = { ...base, profile };
    window.dispatchEvent(new CustomEvent("tidoc:auth", { detail: window.TIDOC_AUTH }));
  } catch (e) {
    console.log("ensureUserDoc error:", e);
  }
});
