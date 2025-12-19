// header-user-menu.js (MODULE)
import { auth, db } from "./auth.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const LS_AVATAR = "tidoc_avatar";

// ✅ si pas d’avatar : on pioche aléatoire
const AVATAR_PATH = "./avatars/";
const AVATAR_COUNT = 10;

function pickRandomAvatar() {
  const i = Math.floor(Math.random() * AVATAR_COUNT) + 1;
  return `${AVATAR_PATH}avatar-${i}.png`;
}

function ensureTopbar() {
  // si déjà présent -> ok
  if (document.querySelector(".blog-topbar")) return;

  // injecte la topbar en haut du body
  const bar = document.createElement("div");
  bar.className = "blog-topbar";
  bar.innerHTML = `
    <div class="blog-topbar-left">
      <button class="profile-btn" id="profileBtn" type="button" aria-label="Profil">
        <div class="profile-circle">
          <img id="profileImg" alt="Avatar" />
          <span id="profileInitial">T</span>
        </div>
        <span class="status-dot" id="statusDot"></span>

        <div class="profile-menu" id="profileMenu" style="display:none;">
          <button class="menu-item" id="menuSettings" type="button">Paramètres</button>
          <button class="menu-item" id="menuLogout" type="button">Se déconnecter</button>
        </div>
      </button>
    </div>

    <button class="icon-btn" type="button" aria-label="Notifications">
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2Z"></path>
      </svg>
    </button>
  `;

  document.body.prepend(bar);
}

function applyAvatar(url, displayName) {
  const img = document.getElementById("profileImg");
  const initial = document.getElementById("profileInitial");

  if (!img || !initial) return;

  if (url) {
    img.src = url;
    img.style.display = "block";
    initial.style.display = "none";
  } else {
    img.style.display = "none";
    initial.style.display = "block";
    const letter = (displayName || "T").trim().charAt(0).toUpperCase() || "T";
    initial.textContent = letter;
  }
}

function setupMenuHandlers() {
  const btn = document.getElementById("profileBtn");
  const menu = document.getElementById("profileMenu");
  const settings = document.getElementById("menuSettings");
  const logout = document.getElementById("menuLogout");

  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    // évite fermeture immédiate quand tu cliques dedans
    e.stopPropagation();
    const open = menu.style.display !== "none";
    menu.style.display = open ? "none" : "";
  });

  document.addEventListener("click", () => {
    menu.style.display = "none";
  });

  settings?.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = "none";
    window.location.href = "./settings.html"; // ✅ ta page Paramètres (profil dedans)
  });

  logout?.addEventListener("click", async (e) => {
    e.stopPropagation();
    menu.style.display = "none";
    await signOut(auth);
    localStorage.removeItem(LS_AVATAR);
    window.location.href = "./login.html";
  });
}

async function ensureUserHasAvatar(user) {
  // 1) priorités : localStorage > Auth photoURL > Firestore avatarUrl
  const cached = localStorage.getItem(LS_AVATAR) || "";
  if (cached) return cached;

  if (user.photoURL) return user.photoURL;

  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists() && snap.data().avatarUrl) return snap.data().avatarUrl;

  // 2) si rien : on attribue un avatar random et on le sauvegarde
  const random = pickRandomAvatar();

  // cache local
  localStorage.setItem(LS_AVATAR, random);

  // sauvegarde Firestore (autorisé : users/{uid})
  await setDoc(
    doc(db, "users", user.uid),
    { avatarUrl: random, updatedAt: serverTimestamp() },
    { merge: true }
  );

  // update Auth (photoURL) pour cohérence
  // (pas vital si tu veux uniquement avatars)
  try {
    // dynamic import pour éviter d’ajouter updateProfile en haut si tu veux
    const { updateProfile } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js");
    await updateProfile(user, { photoURL: random });
  } catch {}

  return random;
}

function setupAvatarLiveUpdate() {
  // ✅ quand avatars.js enregistre -> header s’update direct
  window.addEventListener("tidoc:avatar", (e) => {
    const url = e.detail?.url || "";
    if (url) localStorage.setItem(LS_AVATAR, url);
    applyAvatar(url, auth.currentUser?.displayName || "Utilisateur");
  });
}

// ===== Boot =====
ensureTopbar();
setupMenuHandlers();
setupAvatarLiveUpdate();

// affichage immédiat si cache local dispo (même avant onAuthStateChanged)
applyAvatar(localStorage.getItem(LS_AVATAR) || "", "T");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // pas connecté : lettre "T" par défaut
    applyAvatar("", "T");
    return;
  }

  const displayName = user.displayName || "Utilisateur";

  try {
    const url = await ensureUserHasAvatar(user);
    applyAvatar(url, displayName);
  } catch (e) {
    console.log(e);
    // fallback minimal
    applyAvatar(user.photoURL || localStorage.getItem(LS_AVATAR) || "", displayName);
  }
});
document.addEventListener("DOMContentLoaded", bootHeader);
