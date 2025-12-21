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
  updateProfile,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// =====================
// CONFIG
// =====================
export const ADMIN_EMAILS = ["tidoc.congres@gmail.com"].map(e => e.toLowerCase());
export const AVATARS = Array.from({ length: 10 }, (_, i) => `./avatars/avatar-${i + 1}.png`);

// =====================
// INIT FIREBASE (anti double init)
// =====================
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
auth.languageCode = "fr";
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

export async function ensureUserDoc(user, { displayName, avatarUrl } = {}) {
  if (!user?.uid) return null;

  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const data = snap.data() || {};
    const patch = {};

    if (!data.avatarUrl) patch.avatarUrl = avatarUrl || pickRandomAvatar();
    else if (avatarUrl && avatarUrl !== data.avatarUrl) patch.avatarUrl = avatarUrl;

    const wantedName = (displayName || user.displayName || "Utilisateur").trim();
    if (!data.displayName) patch.displayName = wantedName;
    else if (displayName && wantedName !== data.displayName) patch.displayName = wantedName;
    else if (!displayName && user.displayName && user.displayName.trim() !== data.displayName) patch.displayName = user.displayName.trim();

    if (Object.keys(patch).length) {
      patch.updatedAt = serverTimestamp();
      await setDoc(ref, patch, { merge: true });
      return { ...data, ...patch };
    }
    return data;
  }

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
  const name = (displayName || "").trim();
  if (!name) throw new Error("Pseudo requis.");

  const cred = await createUserWithEmailAndPassword(auth, email, password);

  const claimed = await claimUsername(cred.user, name);
  await updateProfile(cred.user, { displayName: claimed.original });

  await ensureUserDoc(cred.user, {
    displayName: claimed.original,
    avatarUrl: pickRandomAvatar()
  });

  await setDoc(doc(db, "users", cred.user.uid), {
    username: claimed.original,
    usernameNormalized: claimed.normalized,
    updatedAt: serverTimestamp()
  }, { merge: true });

  return cred.user;
}

export async function loginEmail({ email, password } = {}) {
  if (!email || !password) throw new Error("Email + mot de passe requis.");
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(cred.user);
  return cred.user;
}

// ✅ RESET PASSWORD (plus robuste)
export async function resetPassword(email, { redirectUrl } = {}) {
  const e = (email || "").trim();
  if (!e) throw new Error("Email requis.");

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  if (!emailOk) throw new Error("Adresse email invalide.");

  // optionnel mais utile: où renvoyer après reset
  const actionCodeSettings = {
    url: redirectUrl || (location.origin + "/login.html"),
    handleCodeInApp: false
  };

  await sendPasswordResetEmail(auth, e, actionCodeSettings);
}

export async function logout() {
  await signOut(auth);
}

// ✅ Changer mot de passe (ancien requis)
export async function changePasswordWithReauth(oldPassword, newPassword) {
  const u = auth.currentUser;
  if (!u || !u.email) throw new Error("Connexion requise.");

  const oldP = String(oldPassword || "");
  const newP = String(newPassword || "");

  if (!oldP) throw new Error("Ancien mot de passe requis.");
  if (newP.length < 6) throw new Error("Nouveau mot de passe trop court (min 6).");

  const cred = EmailAuthProvider.credential(u.email, oldP);
  await reauthenticateWithCredential(u, cred);
  await updatePassword(u, newP);
}

// Helper : exiger connexion pour accéder à une page
export function requireAuthOrRedirect(redirectTo = "./login.html") {
  onAuthStateChanged(auth, (u) => {
    if (!u) window.location.href = redirectTo;
  });
}

export function normalizeUsername(name = "") {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

export async function claimUsername(user, displayNameRaw) {
  const original = (displayNameRaw || "").trim();
  if (!original) throw new Error("Pseudo requis.");

  const normalized = normalizeUsername(original);
  if (!normalized || normalized.length < 3) {
    throw new Error("Pseudo invalide (min 3 caractères, lettres/chiffres/._-).");
  }

  const ref = doc(db, "usernames", normalized);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) throw new Error("Pseudo déjà pris 😕");
    tx.set(ref, {
      uid: user.uid,
      original,
      createdAt: serverTimestamp()
    });
  });

  return { original, normalized };
}

// =====================
// ÉTAT GLOBAL
// =====================
window.TIDOC_AUTH = window.TIDOC_AUTH || null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.TIDOC_AUTH = null;
    window.dispatchEvent(new CustomEvent("tidoc:auth", { detail: null }));
    return;
  }

  const base = {
    uid: user.uid,
    email: (user.email || "").toLowerCase(),
    displayName: (user.displayName || "Utilisateur").trim(),
    isAdmin: isAdminUser(user)
  };

  window.TIDOC_AUTH = base;
  window.dispatchEvent(new CustomEvent("tidoc:auth", { detail: base }));

  try {
    const profile = await ensureUserDoc(user);

    try {
      if (profile?.displayName) localStorage.setItem("tidoc_name", profile.displayName);
      if (profile?.avatarUrl) localStorage.setItem("tidoc_avatar", profile.avatarUrl);
    } catch (_) {}

    window.TIDOC_AUTH = { ...base, profile };
    window.dispatchEvent(new CustomEvent("tidoc:auth", { detail: window.TIDOC_AUTH }));
  } catch (e) {
    console.log("ensureUserDoc error:", e);
  }
});
