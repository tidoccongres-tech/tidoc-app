// header-user-menu.js (MODULE)
import { auth, db, isAdminUser, pickRandomAvatar } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

function $(id) { return document.getElementById(id); }

function updateAdminUI() {
  const ok = !!window.TIDOC_AUTH?.isAdmin;
  document.querySelectorAll("[data-admin-only='true']").forEach((el) => {
    el.style.display = ok ? "" : "none";
  });
}

function setAvatarInHeader(avatarUrl) {
  const img = $("profileImg");
  const initial = $("profileInitial");
  const dot = $("statusDot");

  if (dot) dot.style.background = avatarUrl ? "#2ecc71" : "#cfcfcf";

  if (img) {
    img.src = avatarUrl || pickRandomAvatar();
    img.style.display = "block";
  }
  if (initial) initial.style.display = "none";
}

function showLoggedMenu(isLogged) {
  const loginBtn = $("menuLogin");
  const logoutBtn = $("menuLogout");
  const settingsBtn = $("menuSettings"); // <-- à ajouter dans HTML
  const switchBtn = $("menuSwitch");     // si tu l’as encore, on le cache

  if (loginBtn) loginBtn.hidden = isLogged;
  if (logoutBtn) logoutBtn.hidden = !isLogged;
  if (settingsBtn) settingsBtn.hidden = !isLogged;
  if (switchBtn) switchBtn.hidden = true; // on n’utilise plus "changer de compte"
}

function toggleMenu() {
  const menu = $("profileMenu");
  if (!menu) return;
  menu.hidden = !menu.hidden;
}
function closeMenu() {
  const menu = $("profileMenu");
  if (menu) menu.hidden = true;
}

async function getAvatarForUser(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists() && snap.data()?.avatarUrl) return snap.data().avatarUrl;
  } catch {}
  return pickRandomAvatar();
}

document.addEventListener("DOMContentLoaded", () => {
  // clic sur le bouton profil
  $("profileBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    toggleMenu();
  });

  // fermer menu si clic dehors
  document.addEventListener("click", (e) => {
    const menu = $("profileMenu");
    const btn = $("profileBtn");
    if (!menu || !btn) return;
    if (!menu.contains(e.target) && !btn.contains(e.target)) closeMenu();
  });

  // menu actions
  $("menuLogout")?.addEventListener("click", async () => {
    await auth.signOut();
    closeMenu();
    window.location.href = "./login.html";
  });

  $("menuLogin")?.addEventListener("click", () => {
    closeMenu();
    window.location.href = "./login.html";
  });

  $("menuSettings")?.addEventListener("click", () => {
    closeMenu();
    window.location.href = "./settings.html"; // page paramètres (à créer)
  });

  // état auth
  onAuthStateChanged(auth, async (user) => {
    window.TIDOC_AUTH = window.TIDOC_AUTH || {};
    window.TIDOC_AUTH.user = user || null;
    window.TIDOC_AUTH.isAdmin = isAdminUser(user);

    updateAdminUI();

    if (!user) {
      showLoggedMenu(false);
      setAvatarInHeader(pickRandomAvatar()); // même déconnecté -> avatar random
      return;
    }

    showLoggedMenu(true);
    const avatarUrl = await getAvatarForUser(user.uid);
    setAvatarInHeader(avatarUrl);
  });
});
