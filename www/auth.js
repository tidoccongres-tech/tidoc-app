// auth.js (MODULE)
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

// ✅ init
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ✅ Admin(s)
const ADMIN_EMAILS = ["tidoc.congres@gmail.com"];

// ✅ Avatars “personnages Ti’Doc” (dossier = /avatars)
// Mets ici tes vrais noms de fichiers
export const AVATARS = [
  "./avatars/avatar-1.png",
  "./avatars/avatar-2.png",
  "./avatars/avatar-3.png",
  "./avatars/avatar-4.png",
  "./avatars/avatar-5.png",
  "./avatars/avatar-6.png",
  "./avatars/avatar-7.png",
  "./avatars/avatar-8.png",
  "./avatars/avatar-9.png",
  "./avatars/avatar-10.png",
];

export function pickRandomAvatar() {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

export function isAdminUser(user = auth.currentUser) {
  const email = (user?.email || "").toLowerCase();
  return ADMIN_EMAILS.includes(email);
}

/**
 * À appeler dans chaque page "protégée"
 * → si pas connecté : redirection vers login.html
 */
export function requireAuthOrRedirect(redirectTo = "./login.html") {
  onAuthStateChanged(auth, (u) => {
    if (!u) window.location.href = redirectTo;
  });
}

/**
 * Signup email + mdp
 * ✅ Maintenant: displayName + email + password seulement
 * ✅ Avatar aléatoire par défaut (modifiable dans settings plus tard)
 */
export async function signupEmail({ email, password, displayName }) {
  const cleanEmail = (email || "").trim().toLowerCase();
  const name = (displayName || "").trim() || "Utilisateur";

  const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);

  const avatarUrl = pickRandomAvatar();

  // Firebase Auth profile (affichage)
  await updateProfile(cred.user, {
    displayName: name,
    photoURL: avatarUrl
  });

  // Firestore user profile
  await setDoc(
    doc(db, "users", cred.user.uid),
    {
      email: cleanEmail,
      displayName: name,
      avatarUrl,
      createdAt: serverTimestamp(),
      role: isAdminUser(cred.user) ? "admin" : "user"
    },
    { merge: true }
  );

  return cred.user;
}

export async function loginEmail({ email, password }) {
  const cleanEmail = (email || "").trim().toLowerCase();
  const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);

  // Optionnel: si ton ancien compte n'a pas avatarUrl, on en injecte un
  await ensureUserProfile(cred.user);

  return cred.user;
}

export async function resetPassword(email) {
  const cleanEmail = (email || "").trim().toLowerCase();
  await sendPasswordResetEmail(auth, cleanEmail);
}

export async function logout() {
  await signOut(auth);
}

export async function getUserProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Si l'utilisateur existe mais n'a pas de doc Firestore complet
 * (ou pas d'avatar), on complète proprement.
 */
export async function ensureUserProfile(user = auth.currentUser) {
  if (!user?.uid) return null;

  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  const currentEmail = (user.email || "").toLowerCase();
  const currentName = user.displayName || "Utilisateur";

  // Si pas de doc du tout → on crée
  if (!snap.exists()) {
    const avatarUrl = user.photoURL || pickRandomAvatar();

    await setDoc(ref, {
      email: currentEmail,
      displayName: currentName,
      avatarUrl,
      createdAt: serverTimestamp(),
      role: isAdminUser(user) ? "admin" : "user"
    }, { merge: true });

    // On synchronise aussi Auth si manquant
    if (!user.photoURL || !user.displayName) {
      await updateProfile(user, {
        displayName: user.displayName || currentName,
        photoURL: user.photoURL || avatarUrl
      });
    }

    return { email: currentEmail, displayName: currentName, avatarUrl };
  }

  // Si doc existe mais avatar manquant → on complète
  const data = snap.data() || {};
  if (!data.avatarUrl) {
    const avatarUrl = user.photoURL || pickRandomAvatar();
    await setDoc(ref, { avatarUrl }, { merge: true });

    if (!user.photoURL) {
      await updateProfile(user, { photoURL: avatarUrl });
    }
  }

  // Si role pas cohérent, on le corrige au login
  const wantedRole = isAdminUser(user) ? "admin" : "user";
  if ((data.role || "user") !== wantedRole) {
    await setDoc(ref, { role: wantedRole }, { merge: true });
  }

  return (await getDoc(ref)).data();
}

/**
 * Pour la page "Paramètres du compte" :
 * changer l’avatar ET le displayName si tu veux.
 */
export async function updateAccountProfile({ displayName, avatarUrl }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  const updatesAuth = {};
  if (typeof displayName === "string" && displayName.trim()) {
    updatesAuth.displayName = displayName.trim();
  }
  if (typeof avatarUrl === "string" && avatarUrl.trim()) {
    updatesAuth.photoURL = avatarUrl.trim();
  }

  if (Object.keys(updatesAuth).length) {
    await updateProfile(user, updatesAuth);
  }

  const updatesDb = {};
  if (updatesAuth.displayName) updatesDb.displayName = updatesAuth.displayName;
  if (updatesAuth.photoURL) updatesDb.avatarUrl = updatesAuth.photoURL;

  if (Object.keys(updatesDb).length) {
    await setDoc(doc(db, "users", user.uid), updatesDb, { merge: true });
  }

  return true;
}
