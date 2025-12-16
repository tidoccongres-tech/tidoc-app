// auth.js — version iOS / Safari STABLE
function isInAppBrowser() {
  const ua = (navigator.userAgent || "").toLowerCase();
  return (
    ua.includes("instagram") ||
    ua.includes("fbav") ||
    ua.includes("fban") ||
    ua.includes("messenger") ||
    ua.includes("tiktok") ||
    ua.includes("snapchat") ||
    ua.includes("line") ||
    ua.includes("twitter") ||
    ua.includes("threads")
  );
}

import { firebaseConfig } from "./firebase-config.js";

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ================== CONFIG ==================
const ADMIN_EMAILS = ["tidoc.congres@gmail.com"];

// ================== FIREBASE INIT ==================
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

// ================== PERSISTENCE (CRUCIAL iOS) ==================
(async () => {
  try {
    // 🔥 Safari iOS : localStorage est le PLUS fiable
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    console.log("Auth persistence error:", e);
  }
})();

// ================== PROVIDER ==================
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// ================== GLOBAL STATE ==================
window.TIDOC_AUTH = {
  user: null,
  isAdmin: false
};

// ================== HELPERS ==================
function isInAppBrowser() {
  const ua = (navigator.userAgent || "").toLowerCase();
  return (
    ua.includes("instagram") ||
    ua.includes("fbav") ||
    ua.includes("fban") ||
    ua.includes("messenger") ||
    ua.includes("tiktok") ||
    ua.includes("snapchat") ||
    ua.includes("line") ||
    ua.includes("twitter") ||
    ua.includes("threads")
  );
}

function isAppleMobile() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function initials(user) {
  const name = (user?.displayName || user?.email || "U").trim();
  return name.charAt(0).toUpperCase();
}

// ================== UI ==================
function updateProfileUI(user) {
  const img = document.getElementById("profileImg");
  const initial = document.getElementById("profileInitial");
  const dot = document.getElementById("statusDot");

  if (dot) dot.style.background = user ? "#2ecc71" : "#cfcfcf";

  if (user && user.photoURL && img && initial) {
    img.src = user.photoURL;
    img.style.display = "block";
    initial.style.display = "none";
  } else {
    if (img) img.style.display = "none";
    if (initial) {
      initial.textContent = initials(user);
      initial.style.display = "block";
    }
  }
}

function updateAdminUI() {
  document.querySelectorAll("[data-admin-only='true']").forEach((el) => {
    el.style.display = window.TIDOC_AUTH.isAdmin ? "" : "none";
  });
}

// ================== AUTH ACTIONS ==================
async function login() {
  if (isInAppBrowser()) {
    alert(
      "Connexion impossible ici 🚫\n\n" +
      "➡️ Ouvre le site dans Safari\n" +
      "➡️ Puis reconnecte-toi"
    );
    return;
  }

  // iOS = redirect (le plus stable)
  await signInWithRedirect(auth, provider);
}

async function logout() {
  await signOut(auth);
}

// ================== MENU ==================
function toggleMenu() {
  const menu = document.getElementById("profileMenu");
  if (!menu) return;

  const logged = !!auth.currentUser;

  const loginBtn = document.getElementById("menuLogin");
  const logoutBtn = document.getElementById("menuLogout");
  const switchBtn = document.getElementById("menuSwitch");

  if (loginBtn) loginBtn.hidden = logged;
  if (logoutBtn) logoutBtn.hidden = !logged;
  if (switchBtn) switchBtn.hidden = !logged;

  menu.hidden = !menu.hidden;
}

function closeMenu() {
  const menu = document.getElementById("profileMenu");
  if (menu) menu.hidden = true;
}

// ================== EVENTS ==================
document.addEventListener("click", (e) => {
  const menu = document.getElementById("profileMenu");
  const btn = document.getElementById("profileBtn");
  if (!menu || !btn) return;
  if (!menu.contains(e.target) && !btn.contains(e.target)) closeMenu();
});

document.addEventListener("DOMContentLoaded", async () => {
  // 🔥 IMPORTANT iOS : récupérer redirect SANS forcer logout
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) {
      console.log("Redirect login success");
    }
  } catch (e) {
    console.log("Redirect ignored:", e);
  }

  document.getElementById("profileBtn")?.addEventListener("click", toggleMenu);

  document.getElementById("menuLogin")?.addEventListener("click", async () => {
    await login();
    closeMenu();
  });

  document.getElementById("menuLogout")?.addEventListener("click", async () => {
    await logout();
    closeMenu();
  });

  document.getElementById("menuSwitch")?.addEventListener("click", async () => {
    await logout();
    await login();
    closeMenu();
  });

  // 🔥 ÉTAT GLOBAL AUTH
  onAuthStateChanged(auth, (user) => {
    window.TIDOC_AUTH.user = user || null;

    const email = (user?.email || "").toLowerCase();
    window.TIDOC_AUTH.isAdmin = ADMIN_EMAILS.includes(email);

    updateProfileUI(user);
    updateAdminUI();
  });
});