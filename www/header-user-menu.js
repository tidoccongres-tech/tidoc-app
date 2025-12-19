/* header-user-menu.js (MODULE)
   Topbar bleue + avatar + menu Paramètres / Déconnexion
   Avatar = photoURL Firebase -> Firestore users/{uid}.avatarUrl -> localStorage -> avatar aléatoire
*/

import { auth, db, logout, AVATARS } from "./auth.js";
import {
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const SETTINGS_URL = "./profile.html";
const LOGIN_URL = "./login.html";

function getPageTitle() {
  const t = document.body?.dataset?.title?.trim();
  if (t) return t;
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

function lsKey(uid) {
  return `tidoc_avatar_${uid}`;
}

async function getUserAvatarFromFirestore(uid) {
  try {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      if (d?.avatarUrl) return d.avatarUrl;
    }
  } catch (e) {
    // Firestore peut être bloqué -> on ignore et on passera en fallback
    console.log("Firestore get users/{uid} blocked:", e?.code || e);
  }
  return "";
}

async function setUserAvatarToFirestore(uid, email, displayName, avatarUrl) {
  try {
    await setDoc(doc(db, "users", uid), {
      email: (email || "").toLowerCase(),
      displayName: displayName || "Utilisateur",
      avatarUrl,
      updatedAt: serverTimestamp()
    }, { merge: true });
    return true;
  } catch (e) {
    console.log("Firestore set users/{uid} blocked:", e?.code || e);
    return false;
  }
}

async function ensureAvatarUrl(user) {
  // 1) Firebase photoURL
  if (user?.photoURL) return user.photoURL;

  // 2) Firestore
  const fsAvatar = await getUserAvatarFromFirestore(user.uid);
  if (fsAvatar) {
    try { await updateProfile(user, { photoURL: fsAvatar }); } catch {}
    localStorage.setItem(lsKey(user.uid), fsAvatar);
    return fsAvatar;
  }

  // 3) localStorage
  const lsAvatar = localStorage.getItem(lsKey(user.uid)) || "";
  if (lsAvatar) return lsAvatar;

  // 4) random fallback (même si Firestore bloqué)
  const random = pickRandomAvatar();
  if (!random) return "";

  localStorage.setItem(lsKey(user.uid), random);

  // on tente d’écrire dans Firestore (si bloqué, pas grave)
  await setUserAvatarToFirestore(
    user.uid,
    user.email || "",
    user.displayName || "Utilisateur",
    random
  );

  // on tente d’écrire dans Firebase auth (si ça échoue, pas grave)
  try { await updateProfile(user, { photoURL: random }); } catch {}

  return random;
}

function updateAvatarUI(user, avatarUrl) {
  const img = document.getElementById("profileImg");
  const initial = document.getElementById("profileInitial");
  const dot = document.getElementById("statusDot");

  if (dot) dot.style.background = user ? "#2ecc71" : "#cfcfcf";

  if (user && avatarUrl && img && initial) {
    img.src = avatarUrl;

    // important: forcer l’affichage
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

function injectHeader() {
  const root = document.getElementById("appHeader");
  if (!root) return;

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

        <div style="color:#fff;font-weight:900;font-size:14px;opacity:.95;">
          ${getPageTitle()}
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
  const profileBtn = document.getElementById("profileBtn");
  const menu = document.getElementById("profileMenu");
  if (!profileBtn || !menu) return;

  const closeMenu = () => { menu.hidden = true; };

  profileBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });

  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && !profileBtn.contains(e.target)) closeMenu();
  });

  document.getElementById("menuSettings")?.addEventListener("click", () => {
    closeMenu();
    window.location.href = SETTINGS_URL;
  });

  document.getElementById("menuLogout")?.addEventListener("click", async () => {
    closeMenu();
    await logout();
    window.location.href = LOGIN_URL;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  injectHeader();
  bindHeaderEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      updateAvatarUI(null, "");
      return;
    }

    const avatarUrl = await ensureAvatarUrl(user);
    updateAvatarUI(user, avatarUrl);
  });
});
