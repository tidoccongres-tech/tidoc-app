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
  updatePassword,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  runTransaction,
  Timestamp   // 👈 AJOUT ICI
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
auth.languageCode = "fr";

export const db = getFirestore(app);

export async function setPseudo(newName){
  const u = auth.currentUser;
  if (!u) throw new Error("Connexion requise.");

  const name = String(newName || "").trim();
  if (!name) throw new Error("Pseudo requis.");

  await updateProfile(u, { displayName: name });

  // ✅ assure que users/{uid} existe avec les champs minimum
  await ensureUserDoc(u, { displayName: name, avatarUrl: pickRandomAvatar() });

  // ✅ ensuite seulement patch
  await setDoc(doc(db, "users", u.uid), {
    displayName: name,
    updatedAt: serverTimestamp()
  }, { merge:true });

  try { localStorage.setItem("tidoc_name", name); } catch(_){}
  window.dispatchEvent(new CustomEvent("tidoc:auth"));
}

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

    // avatar: si manquant, ou si on fournit avatarUrl
    if (!data.avatarUrl) patch.avatarUrl = avatarUrl || pickRandomAvatar();
    else if (avatarUrl && avatarUrl !== data.avatarUrl) patch.avatarUrl = avatarUrl;

    // displayName:
    // displayName: on ne l'écrit QUE si manquant, ou si on fournit displayName explicitement
const wantedName = (displayName || "").trim();
const authName = (user.displayName || "").trim();

if (!data.displayName) patch.displayName = wantedName || authName || "Utilisateur";
else if (wantedName && wantedName !== data.displayName) patch.displayName = wantedName;
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
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
};
 console.log("Creating users doc payload:", newDoc);
  
  try {
  // On essaye une création "pure"
  await setDoc(ref, newDoc); // PAS de merge sur create
} catch (e) {
  // Si la doc existe déjà (course), on ne touche PAS createdAt
  // On fait juste un patch safe
  await setDoc(ref, {
    email: newDoc.email,
    displayName: finalName,
    avatarUrl: finalAvatar,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

return {
  email: newDoc.email,
  displayName: finalName,
  avatarUrl: finalAvatar
};
}

export async function getUserProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// =====================
// USERNAME UNIQUE
// =====================
export function normalizeUsername(name = "") {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
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

    // ✅ IMPORTANT : pas de serverTimestamp ici
   tx.set(ref, {
  uid: user.uid,
  original,
  createdAt: Timestamp.now()
    });
  });

  return { original, normalized };
}

function waitForAuthReady() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      unsub();
      resolve(u || null);
    });
  });
}

// =====================
// AUTH ACTIONS
// =====================
export async function signupEmail({ email, password, displayName } = {}) {
  window.__TIDOC_SIGNUP_IN_PROGRESS__ = true;

  let cred = null;

  // helper debug
  const step = (label) => {
    console.log("[SIGNUP]", label);
    // tu peux commenter l’alert si ça t’énerve
    alert(label);
  };

  try {

    if (!email || !password) throw new Error("Email + mot de passe requis.");

    const name = String(displayName || "").trim();
    if (!name) throw new Error("Pseudo requis.");

    cred = await createUserWithEmailAndPassword(auth, email, password);

    step("STEP 2: wait onAuthStateChanged");
    await new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (u) => {
        if (u) {
          unsub();
          resolve(u);
        }
      });
    });

    await cred.user.getIdToken(true);

    const claimed = await claimUsername(cred.user, name);

    await updateProfile(cred.user, { displayName: claimed.original });

     // STEP 5: écrire users/{uid}
// STEP 5: écrire users/{uid}
step("STEP 5: write users/{uid}");

const userRef = doc(db, "users", cred.user.uid);
const nowTs = Timestamp.now();
const avatar = pickRandomAvatar();

try {
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    // CREATE (avec createdAt)
    await setDoc(userRef, {
      email: String(cred.user.email || "").toLowerCase(),
      displayName: claimed.original,
      avatarUrl: avatar,
      username: claimed.original,
      usernameNormalized: claimed.normalized,
      createdAt: nowTs,
      updatedAt: nowTs
    });
    step("STEP 5b: users doc CREATED");
  } else {
    // PATCH (sans toucher createdAt)
    const prev = snap.data() || {};
    await setDoc(userRef, {
      displayName: claimed.original,
      avatarUrl: prev.avatarUrl || avatar,
      username: claimed.original,
      usernameNormalized: claimed.normalized,
      updatedAt: nowTs
    }, { merge: true });
    step("STEP 5b: users doc PATCHED");
  }

} catch (e) {
  console.log("STEP 5 FAILED:", e);
  alert("STEP 5 FAILED:\n" + (e?.code || "") + "\n" + (e?.message || e));
  throw e;
}

    step("STEP 6: cache + events");
    try { localStorage.setItem("tidoc_name", claimed.original); } catch (_) {}
    try { localStorage.setItem("tidoc_avatar", avatar); } catch (_) {}

    window.dispatchEvent(new CustomEvent("tidoc:avatar", { detail: { url: avatar } }));
    window.dispatchEvent(new CustomEvent("tidoc:auth"));

    step("STEP 7: SUCCESS");
    return cred.user;

  } catch (e) {
    const code = e?.code || "no-code";
    const msg = e?.message || String(e);

    console.log("SIGNUP ERROR CODE:", code);
    console.log("SIGNUP ERROR MSG :", msg);
    alert("Signup error:\n" + code + "\n" + msg);

    // rollback auth user si créé
    try { if (cred?.user) await deleteUser(cred.user); } catch (_) {}

    throw e;

  } finally {
    window.__TIDOC_SIGNUP_IN_PROGRESS__ = false;
  }
}
export async function loginEmail({ email, password } = {}) {
  if (!email || !password) throw new Error("Email + mot de passe requis.");
  const cred = await signInWithEmailAndPassword(auth, email, password);

  try { await ensureUserDoc(cred.user); }
  catch (e) { console.warn("ensureUserDoc failed on login:", e); }

  return cred.user;
}

// ✅ RESET PASSWORD (redirige vers reset.html)
export async function resetPassword(email) {
  const e = String(email || "").trim();
  if (!e) throw new Error("Email requis.");

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  if (!emailOk) throw new Error("Adresse email invalide.");

  // 🔁 page custom (tu dois l’avoir sur GitHub Pages)
  const actionCodeSettings = {
    url: "https://tidoccongres-tech.github.io/reset.html",
    handleCodeInApp: true
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

    // ✅ si signup en cours, on laisse signupEmail gérer users/{uid}
    if (window.__TIDOC_SIGNUP_IN_PROGRESS__) {
      return;
    }

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
