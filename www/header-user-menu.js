// header-user-menu.js (SAFE iPad)
import * as AuthMod from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  doc, getDoc,
  collection, query, where, orderBy, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const auth = AuthMod.auth;
const db   = AuthMod.db;
const logout = AuthMod.logout ? AuthMod.logout : async () => {
  if (AuthMod.auth?.signOut) return AuthMod.auth.signOut();
};

const ADMIN_EMAIL = "tidoc.congres@gmail.com";
const LS_AVATAR = "tidoc_avatar";
const LS_NAME = "tidoc_name";

/* CSS de secours */
(function injectHeaderCSS(){
  if (document.getElementById("tidoc-header-css")) return;
  const s = document.createElement("style");
  s.id = "tidoc-header-css";
  s.textContent = `
    .blog-topbar{position:fixed;top:0;left:0;right:0;height:56px;background:#178CA8;z-index:50000;
      display:flex;justify-content:space-between;align-items:center;padding:0 14px}
    .blog-topbar-left,.blog-topbar-right{display:flex;align-items:center;gap:10px}
    .icon-btn{background:none;border:none;color:#fff;padding:8px;border-radius:12px;position:relative}
    .icon{width:22px;height:22px;fill:currentColor;display:block}
    .notif-dot{position:absolute;right:6px;top:6px;width:9px;height:9px;border-radius:50%;
      background:#ff3b30;border:2px solid #178CA8;display:none}
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

    .tidoc-toast{
      position:fixed;left:50%;top:10px;transform:translateX(-50%);
      background:#ffffff;border:1px solid rgba(0,0,0,.08);
      box-shadow:0 10px 30px rgba(0,0,0,.15);
      border-radius:14px;padding:10px 12px;z-index:20000;
      max-width:min(92vw,520px);display:none;cursor:pointer;
    }
    .tidoc-toast-title{font-weight:900;color:#178CA8;margin-bottom:2px}
    .tidoc-toast-text{font-size:13px;opacity:.8}
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
    <svg class="crown-ico" viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px;">
      <path fill="#fff" d="M21.6 13.56 21.8 11.1c.18-1.9.27-2.85-.06-3.24-.17-.21-.41-.34-.67-.36-.48-.04-1.08.64-2.27 2-0.62.7-.93 1.05-1.28 1.1-.19.03-.38 0-.56-.09-.32-.16-.53-.6-.95-1.47L13.8 4.46C13 2.82 12.6 2 12 2s-1 .82-1.8 2.46L8 9.05c-.42.87-.63 1.31-.95 1.47-.18.09-.37.12-.56.09-.35-.05-.66-.4-1.28-1.1-1.2-1.36-1.8-2.04-2.27-2-.26.02-.5.15-.67.36-.33.39-.24 1.34-.06 3.24l.2 2.46c.38 4 .57 6 1.75 7.2C5.32 22 7.1 22 10.64 22h2.72c3.55 0 5.33 0 6.5-1.2 1.18-1.2 1.37-3.2 1.75-7.24Z"/>
    </svg>
  `;
}

function openMenu(menu){ menu.classList.add("open"); }
function closeMenu(menu){ menu.classList.remove("open"); }

function buildProfile(left){
  left.querySelector("#tidocProfileWrap")?.remove();

  const wrap = document.createElement("div");
  wrap.id = "tidocProfileWrap";
  wrap.className = "profile-wrap";      // ✅ important (ancre le menu)

  const btn = document.createElement("button");
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

  closeMenu(menu);

  const toggle = (e) => {
    e?.stopPropagation?.();
    menu.classList.contains("open") ? closeMenu(menu) : openMenu(menu);
  };

  // ✅ iPad: parfois click saute → on force touchend aussi
  btn.addEventListener("click", toggle, { passive:false });
  btn.addEventListener("touchend", (e)=>{ e.preventDefault(); toggle(e); }, { passive:false });

  menu.addEventListener("click", async (e)=>{
  e.stopPropagation();
  const item = e.target.closest?.("[data-act]");
  const act = item?.getAttribute("data-act");
  if (!act) return;

  if (act === "settings") { closeMenu(menu); location.href = "./settings.html"; }
  if (act === "logout") { closeMenu(menu); try{ await logout(); }catch(_){} location.href = "./login.html"; }
});

["pointerdown","touchstart","mousedown"].forEach(evt=>{
  menu.addEventListener(evt, (e)=> e.stopPropagation(), { capture:true, passive:false });
});
  
  if (!window.__TIDOC_MENU_BOUND__) {
  window.__TIDOC_MENU_BOUND__ = true;

  const closeIfOutside = (e) => {
    const m = document.getElementById("tidocProfileMenu");
    const wrap = document.getElementById("tidocProfileWrap"); // contient btn + menu
    if (!m || !wrap) return;

    // ✅ on ferme SEULEMENT si tap/click en dehors
    if (!wrap.contains(e.target)) closeMenu(m);
  };

  // ✅ pointerdown = le plus fiable iOS + desktop
  document.addEventListener("pointerdown", closeIfOutside, true);

  // fallback anciens iOS (rare)
  document.addEventListener("touchstart", closeIfOutside, { capture: true, passive: true });
  document.addEventListener("mousedown", closeIfOutside, true);
}

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  left.appendChild(wrap);
}

function buildBell(right){
  // cache sur la page notifications
  if (location.pathname.endsWith("notifications.html")) {
    right.querySelector("#tidocNotifWrap")?.remove();
    return;
  }

  right.querySelector("#tidocNotifWrap")?.remove();

  const wrap = document.createElement("div");
  wrap.id = "tidocNotifWrap";

  const b = document.createElement("button");
  b.id = "tidocNotifBtn";
  b.className = "icon-btn";
  b.type = "button";
  b.innerHTML = `
    <span class="notif-dot" id="tidocNotifDot"></span>
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z"></path>
    </svg>
  `;

  b.addEventListener("click", (e)=>{
    e.stopPropagation();
    location.href = "./notifications.html";
  });

  wrap.appendChild(b);
  right.appendChild(wrap);
}

function buildPartnersIcon(right){
  // (optionnel) cache si déjà sur la page partenaires
  if (location.pathname.endsWith("partners.html")) {
    right.querySelector("#tidocPartnersWrap")?.remove();
    return;
  }

  right.querySelector("#tidocPartnersWrap")?.remove();

  const wrap = document.createElement("div");
  wrap.id = "tidocPartnersWrap";

  const b = document.createElement("button");
  b.id = "tidocPartnersBtn";
  b.className = "icon-btn";
  b.type = "button";
  b.title = "Partenaires";

  b.innerHTML = `
    <svg class="icon" viewBox="0 -8 72 72" aria-hidden="true">
      <path d="M64,12.78v17s-3.63.71-4.38.81-3.08.85-4.78-.78C52.22,27.25,42.93,18,42.93,18a3.54,3.54,0,0,0-4.18-.21c-2.36,1.24-5.87,3.07-7.33,3.78a3.37,3.37,0,0,1-5.06-2.64,3.44,3.44,0,0,1,2.1-3c3.33-2,10.36-6,13.29-7.52,1.78-1,3.06-1,5.51,1C50.27,12,53,14.27,53,14.27a2.75,2.75,0,0,0,2.26.43C58.63,14,64,12.78,64,12.78ZM27,41.5a3,3,0,0,0-3.55-4.09,3.07,3.07,0,0,0-.64-3,3.13,3.13,0,0,0-3-.75,3.07,3.07,0,0,0-.65-3,3.38,3.38,0,0,0-4.72.13c-1.38,1.32-2.27,3.72-1,5.14s2.64.55,3.72.3c-.3,1.07-1.2,2.07-.09,3.47s2.64.55,3.72.3c-.3,1.07-1.16,2.16-.1,3.46s2.84.61,4,.25c-.45,1.15-1.41,2.39-.18,3.79s4.08.75,5.47-.58a3.32,3.32,0,0,0,.3-4.68A3.18,3.18,0,0,0,27,41.5Zm25.35-8.82L41.62,22a3.53,3.53,0,0,0-3.77-.68c-1.5.66-3.43,1.56-4.89,2.24a8.15,8.15,0,0,1-3.29,1.1,5.59,5.59,0,0,1-3-10.34C29,12.73,34.09,10,34.09,10a6.46,6.46,0,0,0-5-2C25.67,8,18.51,12.7,18.51,12.7a5.61,5.61,0,0,1-4.93.13L8,10.89v19.4s1.59.46,3,1a6.33,6.33,0,0,1,1.56-2.47,6.17,6.17,0,0,1,8.48-.06,5.4,5.4,0,0,1,1.34,2.37,5.49,5.49,0,0,1,2.29,1.4A5.4,5.4,0,0,1,26,34.94a5.47,5.47,0,0,1,3.71,4,5.38,5.38,0,0,1,2.39,1.43,5.65,5.65,0,0,1,1.48,4.89,0,0,0,0,1,0,0s.8.9,1.29,1.39a2.46,2.46,0,0,0,3.48-3.48s2,2.48,4.28,1c2-1.4,1.69-3.06.74-4a3.19,3.19,0,0,0,4.77.13,2.45,2.45,0,0,0,.13-3.3s1.33,1.81,4,.12c1.89-1.6,1-3.43,0-4.39Z"/>
    </svg>
  `;

  b.addEventListener("click", (e)=>{
    e.stopPropagation();
    location.href = "./partners.html"; // ✅ la page que tu vas créer
  });

  wrap.appendChild(b);
  right.appendChild(wrap);
}

async function getPrettyName(user){
  if (!user) return "Utilisateur";

  // 1) Firestore : on ne prend QUE displayName/username (pas "name")
  if (db){
    try{
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()){
        const d = snap.data() || {};
        const n = (d.displayName || d.username || "").trim(); // ✅ name retiré
        if (n){ localStorage.setItem(LS_NAME, n); return n; }
      }
    }catch(_){}
  }

  // 2) Auth (priorité : souvent dispo juste après updateProfile)
const dn = (user.displayName || "").trim();
if (dn) {
  try { localStorage.setItem(LS_NAME, dn); } catch(_){}
  return dn;
}

// 3) Cache
const cached = (localStorage.getItem(LS_NAME) || "").trim();
if (cached) return cached;

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

  const url = await getAvatarUrl(user);
  if (img && initial){
    if (url){
      img.src = url; img.style.display = "block"; initial.style.display = "none";
    } else {
      img.removeAttribute("src"); img.style.display = "none";
      initial.style.display = "block"; initial.textContent = (pretty || "T").charAt(0).toUpperCase();
    }
  }
}

// ✅ unread dot + toast
let __unsubNotifs = null;
let __lastToastId = null;

function ensureToast(){
  let t = document.getElementById("tidocToast");
  if (t) return t;
  t = document.createElement("div");
  t.id = "tidocToast";
  t.className = "tidoc-toast";
  document.body.appendChild(t);
  return t;
}

function showToast(n){
  const t = ensureToast();
  t.innerHTML = `
    <div class="tidoc-toast-title">Nouvelle notification</div>
    <div class="tidoc-toast-text">${(n?.text || "Notification")}</div>
  `;
  t.style.display = "block";
  t.onclick = () => { t.style.display = "none"; location.href = "./notifications.html"; };
  setTimeout(()=>{ t.style.display = "none"; }, 4500);
}

function bindNotificationsLive(uid){
  if (!db) return;

  __unsubNotifs?.();
  __unsubNotifs = null;

  const dot = () => document.getElementById("tidocNotifDot");

  const qy = query(
    collection(db, "notifications", uid, "items"),
    orderBy("createdAt", "desc"),
    limit(20)
  );

  let didInit = false;              // ✅ skip 1er snapshot
  const toasted = new Set();        // ✅ évite double toast même si rebind

  __unsubNotifs = onSnapshot(qy, (snap) => {
    const unread = snap.docs.some(d => (d.data()?.read === false));
    const d = dot();
    if (d) d.style.display = unread ? "block" : "none";

    // ✅ 1er snapshot = pas de toast (sinon spam)
    if (!didInit) {
      didInit = true;
      // on mémorise ce qui existe déjà pour ne pas toaster après un rebind
      snap.docs.forEach(x => toasted.add(x.id));
      return;
    }

    // toast : seulement pour les NOUVEAUX docs unread
    snap.docChanges().forEach((ch) => {
      if (ch.type !== "added") return;

      const data = ch.doc.data() || {};
      if (data.read !== false) return;

      const id = ch.doc.id;
      if (toasted.has(id)) return;
      toasted.add(id);

      // évite toast sur la page notifications
      if (location.pathname.endsWith("notifications.html")) return;

      showToast(data);
    });
  });
}

/* INIT */
(function init(){
  const { left, right } = ensureTopbar();
buildProfile(left);
buildPartnersIcon(right); // ✅ handshake à côté
buildBell(right);

  onAuthStateChanged(auth, async (user)=>{
    if (!user){
      if (!location.pathname.endsWith("login.html")) location.href = "./login.html";
      return;
    }
    await applyHeaderUser(user);
    bindNotificationsLive(user.uid);
  });

  window.addEventListener("tidoc:avatar", (e)=>{
    const url = e?.detail?.url || "";
    if (!url) return;
    localStorage.setItem(LS_AVATAR, url);
    const img = document.getElementById("profileImg");
    const initial = document.getElementById("profileInitial");
    if (img && initial){
      img.src = url; img.style.display = "block"; initial.style.display = "none";
    }
  });

  window.addEventListener("tidoc:auth", async () => {
    const user = auth.currentUser;
    if (!user) return;
    await applyHeaderUser(user);
  });
})();
