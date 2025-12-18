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

// ✅ Avatars “personnages Ti’Doc” (mets tes URLs ici)
export const AVATARS = [
  "./icons/avatar-1.png",
  "./icons/avatar-2.png",
  "./icons/avatar-3.png",
  "./icons/avatar-4.png",
];

export function isAdminUser(user = auth.currentUser) {
  const email = (user?.email || "").toLowerCase();
  return ADMIN_EMAILS.includes(email);
}

export function requireAuthOrRedirect(redirectTo = "./login.html") {
  // À appeler dans chaque page protégée
  onAuthStateChanged(auth, (u) => {
    if (!u) window.location.href = redirectTo;
  });
}

export async function signupEmail({ email, password, displayName, avatarUrl }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);

  // profile Firebase (affichage)
  await updateProfile(cred.user, {
    displayName: displayName || "Utilisateur",
    photoURL: avatarUrl || ""
  });

  // users/{uid} en Firestore (pratique)
  await setDoc(doc(db, "users", cred.user.uid), {
    email: (email || "").toLowerCase(),
    displayName: displayName || "Utilisateur",
    avatarUrl: avatarUrl || "",
    createdAt: serverTimestamp(),
    role: isAdminUser(cred.user) ? "admin" : "user"
  }, { merge: true });

  return cred.user;
}

export async function loginEmail({ email, password }) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  await signOut(auth);
}

export async function getUserProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}
