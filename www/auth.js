// auth.js (MODULE) — Email/Password + Avatars Firestore
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

export const ADMIN_EMAILS = ["tidoc.congres@gmail.com"].map(e => e.toLowerCase());

// ✅ init Firebase (anti double init)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ✅ Admins
export const ADMIN_EMAILS = ["tidoc.congres@gmail.com"];

// ✅ Avatars (dossier: /avatars/)
export const AVATARS = Array.from({ length: 10 }, (_, i) => `./avatars/avatar-${i + 1}.png`);

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

  // Si doc existe déjà, compléter si manque avatar
  if (snap.exists()) {
    const data = snap.data() || {};
    if (!data.avatarUrl) {
      const newAvatar = avatarUrl || pickRandomAvatar();
      await setDoc(ref, { avatarUrl: newAvatar }, { merge: true });
      return { ...data, avatarUrl: newAvatar };
    }
    return data;
  }

  // Sinon créer doc
  const finalName = displayName || user.displayName || "Utilisateur";
  const finalAvatar = avatarUrl || pickRandomAvatar();

  await setDoc(ref, {
    email: (user.email || "").toLowerCase(),
    displayName: finalName,
    avatarUrl: finalAvatar,
    role: isAdminUser(user) ? "admin" : "user",
    createdAt: serverTimestamp()
  }, { merge: true });

  return {
    email: (user.email || "").toLowerCase(),
    displayName: finalName,
    avatarUrl: finalAvatar,
    role: isAdminUser(user) ? "admin" : "user"
  };
}

export async function getUserProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function signupEmail({ email, password, displayName } = {}) {
  if (!email || !password) throw new Error("Email + mot de passe requis.");

  const cred = await createUserWithEmailAndPassword(auth, email, password);

  // ⚠️ Pas de photo. On met juste un displayName.
  const name = (displayName || "Utilisateur").trim();
  await updateProfile(cred.user, { displayName: name });

  // Avatar aléatoire + doc user
  await ensureUserDoc(cred.user, { displayName: name, avatarUrl: pickRandomAvatar() });

  return cred.user;
}

export async function loginEmail({ email, password } = {}) {
  if (!email || !password) throw new Error("Email + mot de passe requis.");
  const cred = await signInWithEmailAndPassword(auth, email, password);

  // s’assure qu’on a bien avatarUrl en base
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

// (optionnel) helper : exiger connexion pour accéder à une page
export function requireAuthOrRedirect(redirectTo = "./login.html") {
  onAuthStateChanged(auth, (u) => {
    if (!u) window.location.href = redirectTo;
  });
}

// ===== GLOBAL STATE (pour toutes les pages) =====
window.TIDOC_AUTH = window.TIDOC_AUTH || null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.TIDOC_AUTH = null;
    window.dispatchEvent(new CustomEvent("tidoc:auth", { detail: null }));
    return;
  }

  // ✅ admin immédiat (pas besoin d'attendre Firestore)
  const base = {
    uid: user.uid,
    email: (user.email || "").toLowerCase(),
    displayName: user.displayName || "Utilisateur",
    isAdmin: isAdminUser(user),
  };

  window.TIDOC_AUTH = base;
  window.dispatchEvent(new CustomEvent("tidoc:auth", { detail: base }));

  // ✅ Ensuite on complète avec Firestore (displayName/avatar/role)
  try {
    const profile = await ensureUserDoc(user);
    window.TIDOC_AUTH = { ...base, profile };
    window.dispatchEvent(new CustomEvent("tidoc:auth", { detail: window.TIDOC_AUTH }));
  } catch (e) {
    console.log("ensureUserDoc error:", e);
  }
});
