// header-user-menu.js (SAFE iPad)

import * as AuthMod from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const auth = AuthMod.auth;
const db   = AuthMod.db;
const logout = AuthMod.logout ? AuthMod.logout : async () => {
  // fallback si tu n’as pas export logout()
  if (AuthMod.auth?.signOut) return AuthMod.auth.signOut();
};

const ADMIN_EMAIL = "tidoc.congres@gmail.com";
const LS_AVATAR = "tidoc_avatar";
const LS_NAME = "tidoc_name";

/* CSS de secours (au cas où style.css ne s’applique pas) */
(function injectHeaderCSS(){
  if (document.getElementById("tidoc-header-css")) return;
  const s = document.createElement("style");
  s.id = "tidoc-header-css";
  s.textContent = `
    .blog-topbar{position:sticky;top:0;height:56px;background:#178CA8;z-index:9999;
      display:flex;justify-content:space-between;align-items:center;padding:0 14px}
    .blog-topbar-left,.blog-topbar-right{display:flex;align-items:center;gap:10px}
    .icon-btn{background:none;border:none;color:#fff;padding:8px;border-radius:12px}
    .icon{width:22px;height:22px;fill:currentColor;display:block}
    .profile-btn{display:flex;align-items:center;gap:10px;background:none;border:none;color:#fff;cursor:pointer;padding:0}
    .profile-badge{position:relative;display:inline-flex}
    .profile-circle{width:34px;height:34px;border-radius:50%;background:#fff;overflow:hidden;
      display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.15)}
    .status-dot{position:absolute;right:-2px;bottom:-2px;width:10px;height:10px;border-radius:50%;
      background:#cfcfcf;border:2px solid #178CA8}
    .profile-name{display:flex;align-items:center;gap:6px;font-weight:800;max-width:160px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .profile-menu{position:absolute;top:58px;left:12px;background:#fff;border-radius:12px;z-index:10000;
      box-shadow:0 10px 30px rgba(0,0,0,.15);overflow:hidden}
    .menu-item{width:100%;padding:12px 14px;border:none;background:#fff;text-align:left;font-weight:600}
  `;
  document.head.appendChild(s);
})();

function isAdmin(user){
  return (user?.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

function ensureTopbar(){
  let topbar = document.querySelector(".blog-topbar");
  if (!topbar){
    topbar = document.createElement("header");
    topbar.className = "blog-topbar";
    document.body.prepend(topbar);
  }

  let left = topbar.querySelector(".blog-topbar-left");
  if (!left){
    left = document.createElement("div");
    left.className = "blog-topbar-left";
    topbar.appendChild(left);
  }

  let right = topbar.querySelector(".blog-topbar-right");
  if (!right){
    right = document.createElement("div");
    right.className = "blog-topbar-right";
    topbar.appendChild(right);
  }

  return { left, right };
}

function crownSVG(){
  return `
    <svg class="crown-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#fff" d="M21.6 13.56 21.8 11.1c.18-1.9.27-2.85-.06-3.24-.17-.21-.41-.34-.67-.36-.48-.04-1.08.64-2.27 2-0.62.7-.93 1.05-1.28 1.1-.19.03-.38 0-.56-.09-.32-.16-.53-.6-.95-1.47L13.8 4.46C13 2.82 12.6 2 12 2s-1 .82-1.8 2.46L8 9.05c-.42.87-.63 1.31-.95 1.47-.18.09-.37.12-.56.09-.35-.05-.66-.4-1.28-1.1-1.2-1.36-1.8-2.04-2.27-2-.26.02-.5.15-.67.36-.33.39-.24 1.34-.06 3.24l.2 2.46c.38 4 .57 6 1.75 7.2C5.32 22 7.1 22 10.64 22h2.72c3.55 0 5.33 0 6.5-1.2 1.18-1.2 1.37-3.2 1.75-7.24Z"/>
    </svg>
  `;
}

function openMenu(menu) {
  menu.classList.add("open");
}

function closeMenu(menu) {
  menu.classList.remove("open");
}

function buildProfile(left){
  left.querySelector("#tidocProfileWrap")?.remove(); // ✅ wrap unique

  const wrap = document.createElement("div");
  wrap.id = "tidocProfileWrap";
  wrap.className = "profile-wrap";

  const btn = document.createElement("button");
  btn.id = "tidocProfileBtn";
  btn.className = "profile-btn";
  btn.type = "button";

  btn.innerHTML = `
    <span class="profile-badge">
      <div class="profile-circle">
        <img id="profileImg" alt="Avatar" style="display:none;width:100%;height:100%;object-fit:cover"/>
        <span id="profileInitial" style="font-weight:900;color:#178CA8;">T</span>
      </div>
      <span class="status-dot"></span>
    </span>
    <span class="profile-name">
      <span id="profileNameTop">Utilisateur</span>
      <span id="profileCrownTop" style="display:none">${crownSVG()}</span>
    </span>
  `;

  const menu = document.createElement("div");
  menu.id = "tidocProfileMenu";
  menu.className = "profile-menu";
  menu.innerHTML = `
    <button class="menu-item" type="button" data-act="settings">Paramètres</button>
    <button class="menu-item" type="button" data-act="logout">Se déconnecter</button>
  `;

  // ✅ état initial : fermé (et non-cliquable)
  closeMenu(menu);

  // ✅ toggle
  btn.addEventListener("click", (e)=>{
    e.stopPropagation();
    const isOpen = menu.classList.contains("open");
    if (isOpen) closeMenu(menu);
    else openMenu(menu);
  });

  // ✅ évite que cliquer dans le menu ferme tout avant l’action
  menu.addEventListener("click", async (e)=>{
    e.stopPropagation();

    const act = e.target?.getAttribute?.("data-act");
    if (act === "settings") {
      closeMenu(menu);
      location.href = "./settings.html";
      return;
    }
    if (act === "logout"){
      closeMenu(menu);
      try{ await logout(); }catch(_){}
      location.href = "./login.html";
      return;
    }
  });

  // ✅ UN SEUL listener global (pas empilé)
  if (!window.__TIDOC_MENU_BOUND__) {
    window.__TIDOC_MENU_BOUND__ = true;
    document.addEventListener("click", ()=>{
      const m = document.getElementById("tidocProfileMenu");
      if (m) closeMenu(m);
    });
  }

  // ✅ on ancre menu AU bouton (wrap)
  wrap.appendChild(btn);
  wrap.appendChild(menu);
  left.appendChild(wrap);
}
function buildBell(right){
  right.querySelector("#tidocNotifBtn")?.remove();

  const b = document.createElement("button");
  b.id = "tidocNotifBtn";
  b.className = "icon-btn";
  b.type = "button";
  b.innerHTML = `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z"></path>
    </svg>
  `;
  b.addEventListener("click", ()=> location.href = "./notifications.html");
  right.appendChild(b);
}

async function getPrettyName(user){
  if (!user) return "Utilisateur";

  // ✅ 1) Firestore en priorité (source de vérité)
  if (db){
    try{
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()){
        const d = snap.data() || {};
        const n = (d.displayName || d.username || d.name || "").trim();
        if (n){
          localStorage.setItem(LS_NAME, n);
          return n;
        }
      }
    }catch(_){}
  }

  // ✅ 2) Cache localStorage
  const cached = (localStorage.getItem(LS_NAME) || "").trim();
  if (cached) return cached;

  // ✅ 3) Firebase Auth displayName
  const dn = (user.displayName || "").trim();
  if (dn) {
    localStorage.setItem(LS_NAME, dn);
    return dn;
  }

  // ✅ 4) Fallback email
  const email = (user.email || "").trim();
  if (email.includes("@")) return email.split("@")[0];

  return "Utilisateur";
}

async function getAvatarUrl(user){
  if (!user) return "";

  if (user.photoURL) return user.photoURL;

  const cached = localStorage.getItem(LS_AVATAR);
  if (cached) return cached;

  if (db){
    try{
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()){
        const url = snap.data()?.avatarUrl || "";
        if (url) localStorage.setItem(LS_AVATAR, url);
        return url;
      }
    }catch(_){}
  }

  return "";
}

async function applyHeaderUser(user){
  const img = document.getElementById("profileImg");
  const initial = document.getElementById("profileInitial");
  const nameEl = document.getElementById("profileNameTop");
  const crownEl = document.getElementById("profileCrownTop");

  const pretty = await getPrettyName(user);
  if (nameEl) nameEl.textContent = pretty;

  if (crownEl) crownEl.style.display = isAdmin(user) ? "" : "none";

  if (!img || !initial) return;

  const url = await getAvatarUrl(user);
  if (url){
    img.src = url;
    img.style.display = "block";
    initial.style.display = "none";
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
    initial.style.display = "block";
    initial.textContent = (pretty || "T").charAt(0).toUpperCase();
  }
}

/* INIT */
(function init(){
  if (!auth){
    // si auth n'est pas prêt, on affiche au moins les boutons
    const { left, right } = ensureTopbar();
    buildProfile(left);
    buildBell(right);
    return;
  }

  const { left, right } = ensureTopbar();
  buildProfile(left);
  buildBell(right);

  onAuthStateChanged(auth, async (user)=>{
    if (!user){
      if (!location.pathname.endsWith("login.html")) location.href = "./login.html";
      return;
    }
    await applyHeaderUser(user);
  });

  window.addEventListener("tidoc:avatar", (e)=>{
    const url = e?.detail?.url || "";
    if (!url) return;
    localStorage.setItem(LS_AVATAR, url);

    const img = document.getElementById("profileImg");
    const initial = document.getElementById("profileInitial");
    if (img && initial){
      img.src = url;
      img.style.display = "block";
      initial.style.display = "none";
    }
  });
    // ✅ Quand auth.js met à jour window.TIDOC_AUTH, on refresh le header (pseudo + couronne + avatar)
  window.addEventListener("tidoc:auth", async (e) => {
    const user = auth.currentUser;
    if (!user) return;
    await applyHeaderUser(user);
  });
})();
