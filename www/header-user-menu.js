// header-user-menu.js (MODULE FINAL)

import { auth, db, logout } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* ================= CONFIG ================= */
const ADMIN_EMAIL = "tidoc.congres@gmail.com";
const LS_AVATAR = "tidoc_avatar";
const LS_NAME = "tidoc_name";

/* ================= CSS INJECTÉ (ANTI BUG) ================= */
(function injectHeaderCSS(){
  if (document.getElementById("tidoc-header-css")) return;

  const s = document.createElement("style");
  s.id = "tidoc-header-css";
  s.textContent = `
    .blog-topbar{
      position:sticky; top:0; z-index:9999;
      height:56px; background:#178CA8;
      display:flex; justify-content:space-between; align-items:center;
      padding:0 14px;
    }
    .blog-topbar-left,.blog-topbar-right{
      display:flex; align-items:center; gap:10px;
    }
    .icon-btn{
      background:none; border:none; color:#fff;
      padding:6px; border-radius:10px;
      display:flex; align-items:center; justify-content:center;
    }
    .icon{ width:22px; height:22px; fill:currentColor; }

    .profile-btn{
      display:flex; align-items:center; gap:10px;
      background:none; border:none; color:#fff;
      cursor:pointer; padding:0;
    }
    .profile-badge{ position:relative; display:inline-flex; }
    .profile-circle{
      width:34px; height:34px; border-radius:50%;
      background:#fff; overflow:hidden;
      display:flex; align-items:center; justify-content:center;
      box-shadow:0 4px 14px rgba(0,0,0,.15);
    }
    .status-dot{
      position:absolute; right:-2px; bottom:-2px;
      width:10px; height:10px; border-radius:50%;
      background:#cfcfcf; border:2px solid #178CA8;
    }
    .profile-name{
      display:flex; align-items:center; gap:6px;
      font-weight:800; white-space:nowrap;
    }
    .crown-ico{ width:16px; height:16px; }

    .profile-menu{
      position:absolute; top:58px; left:12px;
      background:#fff; border-radius:12px;
      box-shadow:0 10px 30px rgba(0,0,0,.15);
      overflow:hidden; z-index:10000;
    }
    .menu-item{
      width:100%; padding:12px 14px;
      border:none; background:#fff;
      text-align:left; font-weight:600;
    }
  `;
  document.head.appendChild(s);
})();

/* ================= HELPERS ================= */
function isAdmin(user){
  return (user?.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

async function getAvatar(user){
  if (!user) return "";
  if (user.photoURL) return user.photoURL;

  const cached = localStorage.getItem(LS_AVATAR);
  if (cached) return cached;

  try{
    const snap = await getDoc(doc(db,"users",user.uid));
    if (snap.exists()){
      const url = snap.data()?.avatarUrl || "";
      if (url) localStorage.setItem(LS_AVATAR,url);
      return url;
    }
  }catch{}
  return "";
}

async function getPrettyName(user){
  if (!user) return "Utilisateur";

  const cached = localStorage.getItem(LS_NAME);
  if (cached) return cached;

  try{
    const snap = await getDoc(doc(db,"users",user.uid));
    if (snap.exists()){
      const d = snap.data() || {};
      const n = (d.displayName || d.username || "").trim();
      if (n){
        localStorage.setItem(LS_NAME,n);
        return n;
      }
    }
  }catch{}

  if (user.displayName){
    localStorage.setItem(LS_NAME,user.displayName);
    return user.displayName;
  }

  if (user.email?.includes("@")) return user.email.split("@")[0];
  return "Utilisateur";
}

/* ================= BUILD HEADER ================= */
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
    <svg class="crown-ico" viewBox="0 0 24 24">
      <path fill="#fff" d="M21.6 13.56 21.8 11.1c.18-1.9.27-2.85-.06-3.24-.17-.21-.41-.34-.67-.36-.48-.04-1.08.64-2.27 2-0.62.7-.93 1.05-1.28 1.1-.19.03-.38 0-.56-.09-.32-.16-.53-.6-.95-1.47L13.8 4.46C13 2.82 12.6 2 12 2s-1 .82-1.8 2.46L8 9.05c-.42.87-.63 1.31-.95 1.47-.18.09-.37.12-.56.09-.35-.05-.66-.4-1.28-1.1-1.2-1.36-1.8-2.04-2.27-2-.26.02-.5.15-.67.36-.33.39-.24 1.34-.06 3.24l.2 2.46c.38 4 .57 6 1.75 7.2C5.32 22 7.1 22 10.64 22h2.72c3.55 0 5.33 0 6.5-1.2 1.18-1.2 1.37-3.2 1.75-7.24Z"/>
    </svg>
  `;
}

function buildProfile(left){
  const btn = document.createElement("button");
  btn.className = "profile-btn";
  btn.innerHTML = `
    <span class="profile-badge">
      <div class="profile-circle">
        <img id="profileImg" style="display:none;width:100%;height:100%;object-fit:cover"/>
        <span id="profileInitial">T</span>
      </div>
      <span class="status-dot"></span>
    </span>
    <span class="profile-name">
      <span id="profileName">Utilisateur</span>
      <span id="profileCrown" style="display:none">${crownSVG()}</span>
    </span>
  `;

  const menu = document.createElement("div");
  menu.className = "profile-menu";
  menu.style.display = "none";
  menu.innerHTML = `
    <button class="menu-item" data-act="settings">Paramètres</button>
    <button class="menu-item" data-act="logout">Se déconnecter</button>
  `;

  btn.onclick = (e)=>{
    e.stopPropagation();
    menu.style.display = menu.style.display === "block" ? "none" : "block";
  };

  menu.onclick = async (e)=>{
    const act = e.target?.dataset?.act;
    if (act === "settings") location.href = "./settings.html";
    if (act === "logout"){ await logout(); location.href="./login.html"; }
  };

  document.addEventListener("click",()=>menu.style.display="none");

  left.append(btn,menu);
}

function buildBell(right){
  const b = document.createElement("button");
  b.className = "icon-btn";
  b.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><path d="M12 22a2.5 2.5 0 0 0 2.4-2h-4.8A2.5 2.5 0 0 0 12 22Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z"/></svg>`;
  b.onclick = ()=>alert("Notifications bientôt 👀");
  right.appendChild(b);
}

/* ================= INIT ================= */
const { left, right } = ensureTopbar();
buildProfile(left);
buildBell(right);

onAuthStateChanged(auth, async (user)=>{
  if (!user){ location.href="./login.html"; return; }

  document.getElementById("profileName").textContent = await getPrettyName(user);
  document.getElementById("profileCrown").style.display = isAdmin(user) ? "" : "none";

  const img = document.getElementById("profileImg");
  const init = document.getElementById("profileInitial");
  const url = await getAvatar(user);

  if (url){
    img.src = url; img.style.display="block"; init.style.display="none";
  } else {
    init.textContent = (await getPrettyName(user))[0].toUpperCase();
  }
});
