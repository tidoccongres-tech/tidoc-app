// header-user-menu.js (MODULE)
import { auth, db, logout } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const LS_KEY = "tidoc_avatar";
const ADMIN_EMAIL = "tidoc.congres@gmail.com";

// ---------- helpers ----------
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
function isAdminUser(user) {
  const email = (user?.email || "").toLowerCase();
  return email === ADMIN_EMAIL.toLowerCase();
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

  right.style.display = "flex";
  right.style.alignItems = "center";
  right.style.gap = "8px";

  return { topbar, left, right };
}

function buildBell(right) {
  right.querySelector("#tidocNotifBtn")?.remove();

  const btn = document.createElement("button");
  btn.id = "tidocNotifBtn";
  btn.type = "button";
  btn.className = "icon-btn";
  btn.setAttribute("aria-label", "Notifications");

  btn.innerHTML = `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z"></path>
    </svg>
  `;

  btn.addEventListener("click", () => {
    alert("Notifications (bientôt 👀)");
  });

  right.appendChild(btn);
  return btn;
}

// ✅ Couronne SVG (blanc)
function crownSvgWhite() {
  return `
    <svg class="tidoc-crown" viewBox="0 0 24 24" aria-hidden="true"
      style="width:16px;height:16px;margin-left:6px;display:inline-block;vertical-align:-3px;"
      fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21.609 13.5616L21.8382 11.1263C22.0182 9.2137 22.1082 8.25739 21.781 7.86207C21.604 7.64823 21.3633 7.5172 21.106 7.4946C20.6303 7.45282 20.0329 8.1329 18.8381 9.49307C18.2202 10.1965 17.9113 10.5482 17.5666 10.6027C17.3757 10.6328 17.1811 10.6018 17.0047 10.5131C16.6865 10.3529 16.4743 9.91812 16.0499 9.04851L13.8131 4.46485C13.0112 2.82162 12.6102 2 12 2C11.3898 2 10.9888 2.82162 10.1869 4.46486L7.95007 9.04852C7.5257 9.91812 7.31351 10.3529 6.99526 10.5131C6.81892 10.6018 6.62434 10.6328 6.43337 10.6027C6.08872 10.5482 5.77977 10.1965 5.16187 9.49307C3.96708 8.1329 3.36968 7.45282 2.89399 7.4946C2.63666 7.5172 2.39598 7.64823 2.21899 7.86207C1.8918 8.25739 1.9818 9.2137 2.16181 11.1263L2.391 13.5616C2.76865 17.5742 2.95748 19.5805 4.14009 20.7902C5.32271 22 7.09517 22 10.6401 22H13.3599C16.9048 22 18.6773 22 19.8599 20.7902C21.0425 19.5805 21.2313 17.5742 21.609 13.5616Z"
        fill="#FFFFFF"/>
    </svg>
  `;
}

function buildProfileButton(left) {
  left.querySelector("#tidocProfileBtn")?.remove();
  left.querySelector("#tidocProfileMenu")?.remove();

  const btn = document.createElement("button");
  btn.id = "tidocProfileBtn";
  btn.type = "button";
  btn.className = "profile-btn";
  btn.setAttribute("aria-label", "Menu profil");
  btn.setAttribute("aria-expanded", "false");

  // ✅ avatar + label (nom + couronne)
  btn.innerHTML = `
    <div class="profile-circle">
      <img id="profileImg" alt="Avatar" style="display:none;width:100%;height:100%;object-fit:cover;" />
      <span id="profileInitial" style="font-weight:900;color:var(--tidoc);">T</span>
    </div>

    <span id="tidocUserLabel"
      style="
        margin-left:10px;
        color:#fff;
        font-weight:800;
        font-size:13px;
        max-width:140px;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      "
    >…</span>

    <span class="status-dot"></span>
  `;

  const menu = document.createElement("div");
  menu.id = "tidocProfileMenu";
  menu.className = "profile-menu";
  menu.style.display = "none";
  menu.setAttribute("aria-hidden", "true");

  menu.innerHTML = `
    <button class="menu-item" type="button" data-action="settings">Paramètres</button>
    <button class="menu-item" type="button" data-action="logout">Se déconnecter</button>
  `;

  left.appendChild(btn);
  left.appendChild(menu);

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

  menu.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const act = t.getAttribute("data-action");
    if (!act) return;

    if (act === "settings") window.location.href = "./settings.html";

    if (act === "logout") {
      try { await logout(); } catch (_) {}
      window.location.href = "./login.html";
    }
  });

  document.addEventListener("click", () => {
    closeMenu(menu);
    btn.setAttribute("aria-expanded", "false");
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      closeMenu(menu);
      btn.setAttribute("aria-expanded", "false");
    }
  });

  return { btn, menu };
}

async function applyAvatarToButton(user) {
  // ✅ nom + couronne
  const label = document.getElementById("tidocUserLabel");
  if (label) {
    const dn = (user?.displayName || "").trim();
    const fallback = (user?.email || "").split("@")[0] || "Utilisateur";
    const name = dn || fallback;

    label.innerHTML = `${name}${isAdminUser(user) ? crownSvgWhite() : ""}`;
  }

  // ✅ avatar
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

  // garde le nom + couronne OK
  if (auth.currentUser) await applyAvatarToButton(auth.currentUser);
});
