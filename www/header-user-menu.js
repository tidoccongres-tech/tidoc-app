/* header-user-menu.js (MODULE)
   - Injecte la topbar Ti'Doc (bleue) partout
   - Avatar: photoURL Firebase -> sinon avatarUrl Firestore -> sinon avatar aléatoire (persisté)
   - Menu: Paramètres + Se déconnecter
*/

import { auth, db, logout, AVATARS } from "./auth.js";
import { onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ============ Config ============
const SETTINGS_URL = "./profile.html";   // page paramètres/profil (tu peux changer)
const LOGIN_URL    = "./login.html";     // page login (tu peux changer)

// ============ Helpers ============
function escapeHTML(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getPageTitle() {
  // option 1 : <body data-title="Billets">
  const t = document.body?.dataset?.title?.trim();
  if (t) return t;

  // option 2 : document.title "Ti'Doc — Billets" -> "Billets"
  const raw = (document.title || "").trim();
  const parts = raw.split("—").map(x => x.trim());
  return parts.length > 1 ? parts[parts.length - 1] : "Ti’Doc";
}

function initials(user) {
  const name = (user?.displayName || user?.email || "U").trim();
  return name.slice(0, 1).toUpperCase();
}

function pickRandomAvatar() {
  if (!Array.isArray(AVATARS) || AVATARS.length === 0) return "";
  return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

async function getUserDoc(uid) {
  if (!uid) return null;
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

async function ensureAvatarForUser(user) {
  // 1) si Firebase a une photoURL -> ok
  if (user?.photoURL) return { avatarUrl: user.photoURL, source: "firebase" };

  // 2) si Firestore users/{uid}.avatarUrl -> ok
  const profile = await getUserDoc(user?.uid);
  if (profile?.avatarUrl) return { avatarUrl: profile.avatarUrl, source: "firestore" };

  // 3) sinon avatar aléatoire -> on le persiste dans Firestore + updateProfile
  const random = pickRandomAvatar();
  if (!random) return { avatarUrl: "", source: "none" };

  // Firestore
  await setDoc(doc(db, "users", user.uid), {
    email: (user.email || "").toLowerCase(),
    displayName: user.displayName || "Utilisateur",
    avatarUrl: random,
    updatedAt: serverTimestamp()
  }, { merge: true });

  // Firebase Auth profile (pour que ce soit dispo partout rapidement)
  try { await updateProfile(user, { photoURL: random }); } catch {}

  return { avatarUrl: random, source: "random" };
}

// ============ UI Injection ============
function injectHeader() {
  const root = document.getElementById("appHeader");
  if (!root) return;

  const title = escapeHTML(getPageTitle());

  root.innerHTML = `
    <header class="blog-topbar">
      <div class="blog-topbar-left">
        <button class="profile-btn" id="profileBtn" type="button" aria-label="Profil">
          <span class="profile-circle" id="profileCircle">
            <img id="profileImg" alt="" />
            <span id="profileInitial">T</span>
          </span>
          <span class="status-dot" id="statusDot" aria-hidden="true"></span>
        </button>

        <div style="color:#fff;font-weight:900;font-size:14px;letter-spacing:.2px;opacity:.95;">
          ${title}
        </div>
      </div>

      <div class="blog-topbar-right">
        <button class="icon-btn" id="notifBtn" type="button" aria-label="Notifications">
          <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
            <path d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Zm7-6.4V11a7 7 0 1 0-14 0v4.6L3.5 17v1.2h17V17L19 15.6Z"/>
          </svg>
        </button>
      </div>

      <div class="profile-menu" id="profileMenu" hidden>
        <button class="menu-item" id="menuSettings" type="button">Paramètres</button>
        <button class="menu-item" id="menuLogout" type="button">Se déconnecter</button>
      </div>
    </header>
  `;
}

function bindHeaderEvents() {
  const profileBtn  = document.getElementById("profileBtn");
  const menu        = document.getElementById("profileMenu");
  const menuSettings= document.getElementById("menuSettings");
  const menuLogout  = document.getElementById("menuLogout");

  if (!profileBtn || !menu) return;

  function toggleMenu() { menu.hidden = !menu.hidden; }
  function closeMenu()  { menu.hidden = true; }

  profileBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu();
  });

  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && !profileBtn.contains(e.target)) closeMenu();
  });

  menuSettings?.addEventListener("click", () => {
    closeMenu();
    window.location.href = SETTINGS_URL;
  });

  menuLogout?.addEventListener("click", async () => {
    closeMenu();
    await logout();
    // option: forcer retour login
    window.location.href = LOGIN_URL;
  });

  // notif: pour l’instant on laisse neutre
  document.getElementById("notifBtn")?.addEventListener("click", () => {
    // à brancher plus tard
    // alert("Notifications bientôt 👀");
  });
}

// ============ Avatar render ============
function updateAvatarUI({ user, avatarUrl }) {
  const img     = document.getElementById("profileImg");
  const initial = document.getElementById("profileInitial");
  const dot     = document.getElementById("statusDot");

  if (dot) dot.style.background = user ? "#2ecc71" : "#cfcfcf";

  if (user && avatarUrl && img && initial) {
    img.src = avatarUrl;
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

// ============ Boot ============
document.addEventListener("DOMContentLoaded", () => {
  injectHeader();
  bindHeaderEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      updateAvatarUI({ user: null, avatarUrl: "" });
      return;
    }

    try {
      const { avatarUrl } = await ensureAvatarForUser(user);
      updateAvatarUI({ user, avatarUrl });
    } catch {
      // fallback si Firestore bug
      updateAvatarUI({ user, avatarUrl: user.photoURL || "" });
    }
  });
});
