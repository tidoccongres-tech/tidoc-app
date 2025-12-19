// header-user-menu.js (MODULE)
import { auth, db, logout } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const LS_KEY = "tidoc_avatar";

// ---------- helpers ----------
function esc(s = "") {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function closeMenu(menu) {
  if (!menu) return;
  menu.style.display = "none";
  menu.setAttribute("aria-hidden", "true");
}

function openMenu(menu) {
  if (!menu) return;
  menu.style.display = "block";
  menu.setAttribute("aria-hidden", "false");
}

// Récupère l’avatar : Auth.photoURL -> localStorage -> Firestore
async function getAvatarUrl(user) {
  if (!user) return "";
  if (user.photoURL) return user.photoURL;

  const cached = localStorage.getItem(LS_KEY) || "";
  if (cached) return cached;

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const url = snap.data()?.avatarUrl || "";
      if (url) localStorage.setItem(LS_KEY, url);
      return url;
    }
  } catch (_) {}

  return "";
}

// ---------- build topbar ----------
function ensureTopbar() {
  // Réutilise la topbar existante sinon crée
  let topbar = document.querySelector(".blog-topbar");
  if (!topbar) {
    topbar = document.createElement("header");
    topbar.className = "blog-topbar";
    document.body.prepend(topbar);
  }

  let left = topbar.querySelector(".blog-topbar-left");
  if (!left) {
    left = document.createElement("div");
    left.className = "blog-topbar-left";
    topbar.appendChild(left);
  }

  let right = topbar.querySelector(".blog-topbar-right");
  if (!right) {
    right = document.createElement("div");
    right.className = "blog-topbar-right";
    topbar.appendChild(right);
  }

  // petit style safe si jamais .blog-topbar-right n’a pas de CSS
  right.style.display = "flex";
  right.style.alignItems = "center";
  right.style.gap = "8px";

  return { topbar, left, right };
}

function buildBell(right) {
  // évite doublons
  right.querySelector("#tidocNotifBtn")?.remove();

  const btn = document.createElement("button");
  btn.id = "tidocNotifBtn";
  btn.type = "button";
  btn.className = "icon-btn"; // ✅ utilise ton CSS existant (.blog-topbar .icon-btn)
  btn.setAttribute("aria-label", "Notifications");

  // SVG cloche (fill currentColor => blanc via .icon-btn)
  btn.innerHTML = `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z"></path>
    </svg>
  `;

  // Pour l’instant : placeholder (plus tard tu feras notifications.html)
  btn.addEventListener("click", () => {
    // window.location.href = "./notifications.html";
    alert("Notifications (bientôt 👀)");
  });

  right.appendChild(btn);
  return btn;
}

function buildProfileButton(left) {
  // Nettoie si doublon
  left.querySelector("#tidocProfileBtn")?.remove();
  left.querySelector("#tidocProfileMenu")?.remove();

  const btn = document.createElement("button");
  btn.id = "tidocProfileBtn";
  btn.type = "button";
  btn.className = "profile-btn";
  btn.setAttribute("aria-label", "Menu profil");
  btn.setAttribute("aria-expanded", "false");

  btn.innerHTML = `
    <div class="profile-circle">
      <img id="profileImg" alt="Avatar" style="display:none;width:100%;height:100%;object-fit:cover;" />
      <span id="profileInitial" style="font-weight:900;color:var(--tidoc);">T</span>
    </div>
    <span class="status-dot"></span>
  `;

  const menu = document.createElement("div");
  menu.id = "tidocProfileMenu";
  menu.className = "profile-menu";
  menu.style.display = "none"; // ✅ caché par défaut
  menu.setAttribute("aria-hidden", "true");

  menu.innerHTML = `
    <button class="menu-item" type="button" data-action="settings">Paramètres</button>
    <button class="menu-item" type="button" data-action="logout">Se déconnecter</button>
  `;

  left.appendChild(btn);
  left.appendChild(menu);

  // Toggle menu
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = menu.style.display === "block";
    if (isOpen) {
      closeMenu(menu);
      btn.setAttribute("aria-expanded", "false");
    } else {
      openMenu(menu);
      btn.setAttribute("aria-expanded", "true");
    }
  });

  // Actions menu
  menu.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const act = t.getAttribute("data-action");
    if (!act) return;

    if (act === "settings") {
      window.location.href = "./settings.html";
    }

    if (act === "logout") {
      try {
        await logout();
      } catch (_) {}
      window.location.href = "./login.html";
    }
  });

  // Clique hors du menu → ferme
  document.addEventListener("click", () => {
    closeMenu(menu);
    btn.setAttribute("aria-expanded", "false");
  });

  // ESC → ferme
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      closeMenu(menu);
      btn.setAttribute("aria-expanded", "false");
    }
  });

  return { btn, menu };
}

async function applyAvatarToButton(user) {
  const img = document.getElementById("profileImg");
  const initial = document.getElementById("profileInitial");
  if (!img || !initial) return;

  const url = await getAvatarUrl(user);
  if (url) {
    img.src = url;
    img.style.display = "block";
    initial.style.display = "none";
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
    initial.style.display = "block";
    initial.textContent =
      (user?.displayName || "Ti’Doc").trim().charAt(0).toUpperCase() || "T";
  }
}

// ---------- init ----------
const { left, right } = ensureTopbar();
buildProfileButton(left);
buildBell(right);

onAuthStateChanged(auth, async (user) => {
  // si pas connecté → renvoie vers login (sauf sur login)
  if (!user) {
    if (!location.pathname.endsWith("login.html")) {
      window.location.href = "./login.html";
    }
    return;
  }
  await applyAvatarToButton(user);
});

// 🔁 quand avatars.js enregistre → MAJ direct du header
window.addEventListener("tidoc:avatar", async (e) => {
  const url = e?.detail?.url || "";
  if (url) localStorage.setItem(LS_KEY, url);

  const img = document.getElementById("profileImg");
  const initial = document.getElementById("profileInitial");
  if (img && initial && url) {
    img.src = url;
    img.style.display = "block";
    initial.style.display = "none";
  }
});
