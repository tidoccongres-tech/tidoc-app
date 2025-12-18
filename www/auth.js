// auth.js (MODULE) — session-only + menu topbar stable
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserSessionPersistence,
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

// ✅ Admin
const ADMIN_EMAILS = ["tidoc.congres@gmail.com"];

// ✅ dossier avatars (TU M’AS DIT : pas "icons", mais "avatars")
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
  "./avatars/avatar-10.png"
];

window.TIDOC_AUTH = window.TIDOC_AUTH || { user: null, isAdmin: false };

// ✅ 1) Session only (fermeture = déconnexion)
(async () => {
  try {
    await setPersistence(auth, browserSessionPersistence);
  } catch (e) {
    console.log("setPersistence error:", e);
  }
})();

export function isAdminUser(user = auth.currentUser) {
  const email = (user?.email || "").toLowerCase();
  return ADMIN_EMAILS.includes(email);
}

function pickRandomAvatar() {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

// ===== UI TOPBAR (avatar + menu) =====
function initials(user) {
  const name = (user?.displayName || user?.email || "U").trim();
  return name.slice(0, 1).toUpperCase();
}

async function ensureUserDoc(u) {
  if (!u?.uid) return null;

  const ref = doc(db, "users", u.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const avatarUrl = u.photoURL || pickRandomAvatar();

    // Met à jour le profil Firebase si pas d’avatar
    if (!u.photoURL) {
      try { await updateProfile(u, { photoURL: avatarUrl }); } catch {}
    }

    await setDoc(ref, {
      email: (u.email || "").toLowerCase(),
      displayName: u.displayName || "Utilisateur",
      avatarUrl,
      role: isAdminUser(u) ? "admin" : "user",
      createdAt: serverTimestamp()
    }, { merge: true });

    return { avatarUrl };
  }

  return snap.data();
}

function updateTopbarUI(u, userDoc) {
  const img = document.getElementById("profileImg");
  const initial = document.getElementById("profileInitial");
  const dot = document.getElementById("statusDot");

  const avatarUrl = userDoc?.avatarUrl || u?.photoURL || "";

  if (dot) dot.style.background = u ? "#2ecc71" : "#cfcfcf";

  if (u && avatarUrl && img && initial) {
    img.src = avatarUrl;
    img.style.display = "block";
    initial.style.display = "none";
  } else {
    if (img) img.style.display = "none";
    if (initial) {
      initial.textContent = initials(u);
      initial.style.display = "block";
    }
  }

  // admin-only
  document.querySelectorAll("[data-admin-only='true']").forEach((el) => {
    el.style.display = window.TIDOC_AUTH.isAdmin ? "" : "none";
  });
}

function initProfileMenu() {
  const btn = document.getElementById("profileBtn");
  const menu = document.getElementById("profileMenu");
  const logoutBtn = document.getElementById("menuLogout");
  const settingsBtn = document.getElementById("menuSettings");

  if (!btn || !menu) return;

  function openMenu() { menu.hidden = false; }
  function closeMenu() { menu.hidden = true; }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    menu.hidden ? openMenu() : closeMenu();
  });

  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) closeMenu();
  });

  logoutBtn?.addEventListener("click", async () => {
    closeMenu();
    await signOut(auth);
    window.location.href = "./login.html";
  });

  settingsBtn?.addEventListener("click", () => {
    closeMenu();
    window.location.href = "./account.html";
  });
}

// ===== API Auth email =====
export async function signupEmail({ email, password, displayName }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);

  const avatarUrl = pickRandomAvatar();
  await updateProfile(cred.user, {
    displayName: displayName || "Utilisateur",
    photoURL: avatarUrl
  });

  await setDoc(doc(db, "users", cred.user.uid), {
    email: (email || "").toLowerCase(),
    displayName: displayName || "Utilisateur",
    avatarUrl,
    role: isAdminUser(cred.user) ? "admin" : "user",
    createdAt: serverTimestamp()
  }, { merge: true });

  return cred.user;
}

export async function loginEmail({ email, password }) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await ensureUserDoc(cred.user);
  return cred.user;
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  await signOut(auth);
}

// ===== Garde (pages protégées) =====
export function requireAuthOrRedirect(redirectTo = "./login.html") {
  onAuthStateChanged(auth, (u) => {
    if (!u) window.location.href = redirectTo;
  });
}

// ===== Boot global =====
document.addEventListener("DOMContentLoaded", () => {
  initProfileMenu();

  onAuthStateChanged(auth, async (u) => {
    window.TIDOC_AUTH.user = u || null;
    window.TIDOC_AUTH.isAdmin = isAdminUser(u);

    let userDoc = null;
    if (u) userDoc = await ensureUserDoc(u);

    updateTopbarUI(u, userDoc);
  });
});
