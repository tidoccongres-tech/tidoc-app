// header-user-menu.js (MODULE)
import { auth, db } from "./auth.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const AVATAR_COUNT = 10; // avatar-1.png -> avatar-10.png (dans /avatars)
const AVATAR_BASE = "./avatars/"; // tu as dit: dossier = avatars
const AVATAR_DEFAULT = () => `${AVATAR_BASE}avatar-${1 + Math.floor(Math.random() * AVATAR_COUNT)}.png`;

function mountHeader() {
  // évite doublon si appelé 2 fois
  if (document.getElementById("tidocHeader")) return;

  const header = document.createElement("header");
  header.className = "blog-topbar";
  header.id = "tidocHeader";

  header.innerHTML = `
    <div class="blog-topbar-left">
      <button class="profile-btn" id="profileBtn" type="button" aria-label="Profil">
        <span class="profile-circle" id="profileCircle">
          <img id="profileAvatar" alt="" />
        </span>
        <span class="status-dot" id="statusDot" aria-hidden="true"></span>
      </button>
    </div>

    <div class="profile-menu" id="profileMenu" hidden>
      <button class="menu-item" id="menuSettings" type="button">Paramètres</button>
      <button class="menu-item" id="menuLogout" type="button">Se déconnecter</button>
    </div>

    <div class="blog-topbar-right">
      <button class="icon-btn" id="notifBtn" type="button" aria-label="Notifications">
        <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
          <path d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Zm7-6.4V11a7 7 0 1 0-14 0v4.6L3.5 17v1.2h17V17L19 15.6Z"/>
        </svg>
      </button>
    </div>
  `;

  document.body.prepend(header);

  // --- interactions menu ---
  const profileBtn = document.getElementById("profileBtn");
  const menu = document.getElementById("profileMenu");

  function closeMenu() { if (menu) menu.hidden = true; }
  function toggleMenu() { if (menu) menu.hidden = !menu.hidden; }

  profileBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu();
  });

  document.addEventListener("click", (e) => {
    if (!menu || !profileBtn) return;
    if (!menu.contains(e.target) && !profileBtn.contains(e.target)) closeMenu();
  });

  document.getElementById("menuSettings")?.addEventListener("click", () => {
    closeMenu();
    window.location.href = "./profile.html"; // page paramètres → profil
  });

  document.getElementById("menuLogout")?.addEventListener("click", async () => {
    closeMenu();
    await signOut(auth);
    window.location.href = "./login.html";
  });
}

async function getUserAvatar(uid) {
  // on lit users/{uid}.avatarUrl si existe, sinon avatar random (et on le garde en local)
  const key = `tidoc_avatar_${uid}`;
  const cached = localStorage.getItem(key);
  if (cached) return cached;

  try {
    const snap = await getDoc(doc(db, "users", uid));
    const url = snap.exists() ? (snap.data().avatarUrl || "") : "";
    const finalUrl = url || AVATAR_DEFAULT();
    localStorage.setItem(key, finalUrl);
    return finalUrl;
  } catch {
    const fallback = AVATAR_DEFAULT();
    localStorage.setItem(key, fallback);
    return fallback;
  }
}

function setHeaderAvatar(url, connected) {
  const img = document.getElementById("profileAvatar");
  const dot = document.getElementById("statusDot");

  if (dot) dot.style.background = connected ? "#2ecc71" : "#cfcfcf";

  if (img) {
    img.src = url || `${AVATAR_BASE}avatar-1.png`;
    img.style.display = "block";
  }
}

function bootHeader() {
  mountHeader();

  // état initial “pas connecté”
  setHeaderAvatar(`${AVATAR_BASE}avatar-1.png`, false);

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      setHeaderAvatar(`${AVATAR_BASE}avatar-1.png`, false);
      return;
    }
    const avatarUrl = await getUserAvatar(user.uid);
    setHeaderAvatar(avatarUrl, true);
  });
}

document.addEventListener("DOMContentLoaded", bootHeader);
