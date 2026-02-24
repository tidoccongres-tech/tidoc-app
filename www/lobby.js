// lobby.js (MODULE) — Lobby (lobby.png + lobby-NB.png) -> Game (map.png + collisions.png)

import * as AuthMod from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  doc, getDoc, updateDoc, onSnapshot, collection, deleteDoc, serverTimestamp,
  addDoc, query, orderBy, limit, getDocs, setDoc, increment, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

function asset(p){ return new URL(p, import.meta.url).href; }

// ===================
// GAME LOOP FLAGS (HOIST SAFE)
// ===================
var loopRunning = false;
var lastT = 0;             // sera initialisé au 1er start
var gameStarted = false;
var lastRoomStatus = null;

// ===================
// DEBUG OVERLAY (affiche les erreurs à l'écran)
// ===================
(function installDebugOverlay(){
  const box = document.createElement("div");
  box.id = "debugOverlay";
  box.style.cssText = `
    position:fixed; inset:auto 10px 10px 10px;
    z-index:999999;
    padding:10px 12px;
    border-radius:12px;
    background:rgba(0,0,0,.78);
    border:1px solid rgba(255,255,255,.18);
    color:#fff;
    font:900 12px system-ui;
    white-space:pre-wrap;
    display:none;
  `;
  document.body.appendChild(box);

  function show(msg){
    box.style.display = "block";
    box.textContent = String(msg || "Erreur inconnue");
  }

  window.addEventListener("error", (e) => {
    show(`❌ JS ERROR:\n${e?.message}\n${e?.filename}:${e?.lineno}:${e?.colno}`);
    console.error("[WINDOW ERROR]", e?.message, e?.filename, e?.lineno, e?.colno, e?.error);
  });

  window.addEventListener("unhandledrejection", (e) => {
    show(`❌ PROMISE REJECT:\n${e?.reason?.message || e?.reason || "rejection"}`);
    console.error("[UNHANDLED PROMISE]", e?.reason);
  });
})();

// ===================
// STATE
// ===================
let phase = "lobby";
let myRole = null;
let myDead = false;
let myUid = null;
let voteSkipBound = false;

const auth = AuthMod.auth;
const db   = AuthMod.db;

// ===================
// DOM (base)
// ===================
const lobbyMusic     = document.getElementById("lobbyMusic");
const btnMusicToggle = document.getElementById("btnMusicToggle");
const iconOn         = document.getElementById("iconSoundOn");
const iconOff        = document.getElementById("iconSoundOff");

const uiPanel = document.querySelector(".ui");
function setUiPanelVisible(show){
  if (!uiPanel) return;
  uiPanel.style.display = show ? "" : "none";
}

// ✅ ADMIN OVERRIDE
const btnAdminStart = document.getElementById("btnAdminStart");
const ADMIN_UIDS = new Set(["b831dIbb3xPcn2qhfxUuVqkVSKF3"]);
let isAdmin = false;
let forceStart = false;

function renderPlayers(players){
  const playersEl = document.getElementById("playersList"); // ✅ récupère à chaque fois
  if (!playersEl) return;

  const sorted = [...(players || [])].sort((a,b) => {
    const ah = a?.isHost ? 1 : 0;
    const bh = b?.isHost ? 1 : 0;
    if (ah !== bh) return bh - ah;
    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });

  playersEl.innerHTML = "";

  for (const p of sorted){
    const name = p?.name || "Joueur";
    const isHost = !!p?.isHost;
    const isDead = !!p?.isDead;

    const row = document.createElement("div");
    row.className = "player-row";
    row.style.cssText = `
      display:flex; align-items:center; justify-content:space-between;
      gap:10px; padding:8px 10px;
      border-radius:12px;
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.08);
      margin: 6px 0;
      color:#fff;
      font: 900 12px system-ui;
    `;

    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; min-width:0;">
        <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${escapeHTML(name)}
        </div>
        ${isHost ? `<span style="opacity:.9;">👑</span>` : ""}
        ${isDead ? `<span style="opacity:.85;">(EXPULSÉ)</span>` : ""}
      </div>
      <div style="opacity:.7; font: 800 11px system-ui;">${escapeHTML((p?.uid||"").slice(0,6))}</div>
    `;

    playersEl.appendChild(row);
  }
}

window.renderPlayers = renderPlayers; // ✅ au cas où le HTML l'appelle

// =======================
// HELPERS (⚠️ UNE SEULE FOIS)
// =======================
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function escapeHTML(s=""){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function dist(a,b,c,d){ return Math.hypot(a-c, b-d); }

function cryptoRandInt(maxExclusive){
  // retourne un int dans [0, maxExclusive[
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % maxExclusive;
}

function shuffleCryptoInPlace(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = cryptoRandInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// =======================
// MUSIC (Lobby) - sync avec menu
// =======================
const LS_MUSIC = "tidoc_music_on";

function setMusicUI(isOn){
  if (iconOn)  iconOn.style.display  = isOn ? "" : "none";
  if (iconOff) iconOff.style.display = isOn ? "none" : "";
}

async function tryPlayAudio(){
  if (!lobbyMusic) return;
  try { await lobbyMusic.play(); } catch(e){ /* iOS bloque sans geste */ }
}

function setMusicOn(isOn){
  localStorage.setItem(LS_MUSIC, isOn ? "1" : "0");
  setMusicUI(isOn);

  if (!lobbyMusic) return;
  lobbyMusic.volume = 0.4;

  if (isOn) tryPlayAudio();
  else lobbyMusic.pause();
}

// init (respecte le choix du menu)
(function initMusic(){
  const isOn = (localStorage.getItem(LS_MUSIC) === "1"); // default OFF
  setMusicUI(isOn);
  if (lobbyMusic) lobbyMusic.volume = 0.35;
  if (isOn) tryPlayAudio();
})();

btnMusicToggle?.addEventListener("click", () => {
  const isOn = (localStorage.getItem(LS_MUSIC) === "1");
  setMusicOn(!isOn);
});

// ===================
// URL / ROOM
// ===================
const params = new URLSearchParams(location.search);
const roomId = (
  params.get("room") ||
  params.get("code") ||
  params.get("id")   ||
  params.get("r")    ||
  ""
).trim().toUpperCase();

console.log("[LOBBY] href =", location.href);
console.log("[LOBBY] roomId =", roomId);

window.addEventListener("error", (e) => {
  console.error("[WINDOW ERROR]", e?.message, e?.filename, e?.lineno, e?.colno, e?.error);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[UNHANDLED PROMISE]", e?.reason);
});

// ===================
// DOM (suite)
// ===================
const roomCodeEl = document.getElementById("roomCode");
const playersEl  = document.getElementById("playersList");
const btnStart   = document.getElementById("btnStart");
const btnLeave   = document.getElementById("btnLeave");
// ✅ SAFE refs (évite ReferenceError qui casse tout le JS)
const joy = document.getElementById("joystick"); // ton joystick HTML id="joystick"
// ✅ SAFE host flag (sera mis à jour plus tard via Firestore)
let myIsHost = false;

const startInfo = document.getElementById("startInfo");
function setStartInfo(msg){
  console.log("[START INFO]", msg || "");
  if (startInfo) startInfo.textContent = msg || "";
  else if (msg) alert(msg);
}

// ROLE overlay
const roleOverlay = document.getElementById("roleOverlay");
const roleImg     = document.getElementById("roleImg");
const roleTitle   = document.getElementById("roleTitle");
const roleSub     = document.getElementById("roleSub");
const btnRoleOk   = document.getElementById("btnRoleOk");

// Chat
const chatFab      = document.getElementById("btnChatToggle");
const chatBadge    = document.getElementById("chatBadge");
const chatOverlay  = document.getElementById("chatOverlay");
const btnChatClose = document.getElementById("btnChatClose");

function setChatFabVisible(show){
  if (!chatFab) return;

  // show/hide bouton flottant
  chatFab.style.display = show ? "" : "none";
  chatFab.style.pointerEvents = show ? "auto" : "none";

  // si on cache le chat => on cache aussi le badge
  if (!show){
    chatFab.classList.remove("has-unread");
    if (chatBadge) chatBadge.hidden = true;
  }
}

// au cas où le HTML l'appelle (rare, mais safe)
window.setChatFabVisible = setChatFabVisible;

const chatMessagesEl = document.getElementById("chatMessages");
const chatForm  = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

// ===================
// DEBATE BANNER (injection safe)
// ===================
let debateUiActive = false;

const debateBanner = document.createElement("div");
debateBanner.id = "debateBanner";
debateBanner.style.cssText = `
  position: sticky;
  top: 0;
  z-index: 999;
  padding: 10px 12px;
  margin: 0;
  font: 1000 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  letter-spacing: .2px;
  color: #fff;
  background: rgba(0,0,0,.72);
  border-bottom: 1px solid rgba(255,255,255,.12);
  display: none;
`;

(function mountDebateBanner(){
  if (!chatOverlay) return;
  const chatPanel = chatOverlay.querySelector(".chat-panel");
  if (!chatPanel) return;

  const chatHead = chatOverlay.querySelector(".chat-head");
  if (chatHead && chatHead.parentElement === chatPanel){
    chatPanel.insertBefore(debateBanner, chatHead.nextSibling);
  } else {
    // fallback : tout en haut
    chatPanel.insertBefore(debateBanner, chatPanel.firstChild);
  }
})();

let debateEndMs = 0;
let debateRaf = null;

function setDebateUI(on, { title = "Débat", subtitle = "", endMs = 0 } = {}){
  debateUiActive = !!on;
  if (!debateBanner) return;

  if (!debateUiActive){
    debateBanner.style.display = "none";
    debateBanner.innerHTML = "";
    debateEndMs = 0;
    if (debateRaf) cancelAnimationFrame(debateRaf);
    debateRaf = null;
    if (btnChatClose) btnChatClose.style.display = "";
    return;
  }

  if (btnChatClose) btnChatClose.style.display = "none";

  debateEndMs = endMs || (Date.now() + 60_000);

  debateBanner.style.display = "";
  debateBanner.innerHTML = `
    <div class="debate-head">
      <div class="debate-left">
        <div class="debate-title">${escapeHTML(title)}</div>
        <div class="debate-sub">${escapeHTML(subtitle)}</div>
      </div>
      <div class="debate-timer" id="debateTimer">60s</div>
    </div>
  `;

  const timerEl = debateBanner.querySelector("#debateTimer");

  const tick = () => {
    if (!debateUiActive) return;
    const s = Math.max(0, Math.ceil((debateEndMs - Date.now()) / 1000));
    if (timerEl) timerEl.textContent = `${s}s`;
    if (s <= 0) return;
    debateRaf = requestAnimationFrame(tick);
  };

  debateRaf = requestAnimationFrame(tick);
}

// ===================
// CANVAS (SAFE)
// ===================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas?.getContext?.("2d") || null;

function setCanvasInteract(on){
  if (!canvas) return;
  canvas.style.pointerEvents = on ? "auto" : "none";
}

if (canvas){
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.zIndex = "0";
  setCanvasInteract(false);
}
if (!canvas || !ctx){
  console.warn("[lobby.js] Canvas introuvable (#gameCanvas).");
}

// ===================
// INIT room code
// ===================
if (roomCodeEl) roomCodeEl.textContent = roomId || "----";
if (!roomId) setStartInfo("⚠️ Aucun code room dans l’URL (ex: lobby.html?room=ABCD).");

// ===================
// TOASTS
// ===================

// Toast “Vous avez été expulsé”
const expelledToast = document.createElement("div");
expelledToast.id = "expelledToast";
expelledToast.style.cssText = `
  position: fixed;
  left: 50%;
  top: calc(18px + env(safe-area-inset-top));
  transform: translateX(-50%);
  z-index: 120;
  padding: 12px 14px;
  border-radius: 14px;
  font: 900 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  letter-spacing: .2px;
  color: #fff;
  background: rgba(0,0,0,.70);
  border: 1px solid rgba(255,255,255,.14);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 10px 26px rgba(0,0,0,.28);
  display: none;
`;
expelledToast.textContent = "Vous avez été expulsé";
document.body.appendChild(expelledToast);

let expelledToastTimer = null;
function showExpelledToast(ms = 3200){
  expelledToast.style.display = "";
  clearTimeout(expelledToastTimer);
  expelledToastTimer = setTimeout(() => {
    expelledToast.style.display = "none";
  }, ms);
}

// Toast “X a quitté”
const leaveToast = document.createElement("div");
leaveToast.id = "leaveToast";
leaveToast.style.cssText = `
  position: fixed;
  left: 50%;
  top: calc(58px + env(safe-area-inset-top));
  transform: translateX(-50%);
  z-index: 119;
  padding: 10px 12px;
  border-radius: 14px;
  font: 900 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  letter-spacing: .2px;
  color: #fff;
  background: rgba(0,0,0,.62);
  border: 1px solid rgba(255,255,255,.12);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 10px 26px rgba(0,0,0,.22);
  display: none;
`;
document.body.appendChild(leaveToast);

let leaveToastTimer = null;
function showLeaveToast(text, ms = 2800){
  leaveToast.textContent = text || "";
  leaveToast.style.display = "";
  clearTimeout(leaveToastTimer);
  leaveToastTimer = setTimeout(() => {
    leaveToast.style.display = "none";
  }, ms);
}

// ===================
// HUD RÔLE (haut droite)
// ===================
const roleHud = document.createElement("div");
roleHud.id = "roleHud";
roleHud.style.cssText = `
  position: fixed;
  top: calc(12px + env(safe-area-inset-top));
  right: calc(12px + env(safe-area-inset-right));
  z-index: 60;
  padding: 10px 12px;
  border-radius: 14px;
  font: 800 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  letter-spacing: .2px;
  color: #fff;
  background: rgba(0,0,0,.45);
  border: 1px solid rgba(255,255,255,.12);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: none;
  pointer-events: none;
`;
document.body.appendChild(roleHud);

function setRoleHud(role){
  if (!role) { roleHud.style.display = "none"; roleHud.textContent = ""; return; }
  const isTruant = (role === "titruant" || role === "truant" || role === true);
  roleHud.textContent = `Rôle : ${isTruant ? "Ti’Truant 😈" : "Ti’Nocent 😇"}`;
  roleHud.style.display = "";
}

// ===================
// TI’NOCENT TASKS (TÂCHES + FLÈCHE + JAUGE)
// ===================
const TASKS_TOTAL = 40;

const TASK_POOL = [
  { id:"labo",     label:"Analyse au labo",         zoneId:"labo" },
  { id:"imagerie", label:"Imagerie",               zoneId:"imagerie" },
  { id:"pharma",   label:"Préparer un traitement", zoneId:"pharma" },
  { id:"exam",     label:"Anamnèse",               zoneId:"exam" },
  { id:"soins",    label:"Soins",                  zoneId:"soins" },
  { id:"admin",    label:"Dossiers",               zoneId:"admin" },
  { id:"rcp",      label:"RCP",                    zoneId:"rcp" },
];

const TASKS_PER_PLAYER = 6;

// HUD missions -> SOUS le rôle (haut droite)
const tasksHud = document.createElement("div");
tasksHud.id = "tasksHud";
tasksHud.style.cssText = `
  position: fixed;
  right: calc(12px + env(safe-area-inset-right));
  top: calc(58px + env(safe-area-inset-top));
  z-index: 59;
  padding: 10px 12px;
  border-radius: 14px;
  font: 800 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #fff;
  background: rgba(0,0,0,.45);
  border: 1px solid rgba(255,255,255,.12);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: none;
  width: min(320px, calc(100vw - 24px));
`;
tasksHud.innerHTML = `
  <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
    <div style="font:900 12px system-ui; opacity:.95;">Missions</div>
    <div id="tasksCount" style="font:900 12px system-ui; opacity:.95;">0/40</div>
  </div>

  <div style="height:10px; margin-top:8px; border-radius:999px; background: rgba(255,255,255,.12); overflow:hidden;">
    <div id="tasksBar" style="height:100%; width:0%; background: rgba(255,255,255,.85);"></div>
  </div>

  <div id="myTaskLine" style="margin-top:10px; display:none;">
    <div id="myTaskText" style="font:900 12px system-ui; opacity:.95;">—</div>
  </div>
`;

document.body.appendChild(tasksHud);

const tasksCountEl = tasksHud.querySelector("#tasksCount");
const tasksBarEl   = tasksHud.querySelector("#tasksBar");

const myTaskLineEl = tasksHud.querySelector("#myTaskLine");
const myTaskTextEl = tasksHud.querySelector("#myTaskText");

let roomTasksDone = 0;
let myTasks = [];
let myTaskIndex = 0;
let myTasksReady = false;

function showTasksHud(show){
  tasksHud.style.display = show ? "" : "none";
}
function setGlobalTasksProgress(done, total){
  const d = Math.max(0, Math.min(total, done || 0));
  if (tasksCountEl) tasksCountEl.textContent = `${d}/${total}`;
  const pct = total > 0 ? (d / total) * 100 : 0;
  if (tasksBarEl) tasksBarEl.style.width = `${pct}%`;
}
function currentTask(){
  if (!myTasks?.length) return null;
  return myTasks[clamp(myTaskIndex, 0, myTasks.length - 1)];
}
function updateMyTaskHud(){
  const t = currentTask();
  const showPersonal = (myRole === "tinocent" && !myDead && phase === "started");

  // sécurité DOM
  if (myTaskLineEl) myTaskLineEl.style.display = showPersonal ? "" : "none";
  if (!showPersonal) return;

  // Ligne "Ta mission"
  if (!t){
    if (myTaskTextEl) myTaskTextEl.textContent = "Ta mission : —";
  } else {
    if (myTaskTextEl) myTaskTextEl.textContent = `Ta mission : ${t.label}`;
  }

  // (OPTIONNEL) liste des missions si tu as un bloc HTML pour ça
  // Exemple: <div id="myTaskList"></div>
  const myTaskListEl = document.getElementById("myTaskList");
  if (myTaskListEl && Array.isArray(myTasks) && myTasks.length){
    const list = myTasks.map((x, i) => {
      const done = i < myTaskIndex;
      const cur  = i === myTaskIndex;
      const prefix = done ? "✅" : (cur ? "➡️" : "•");
      return `${prefix} ${escapeHTML(x.label)}`;
    }).join("<br/>");
    myTaskListEl.innerHTML = list;
  }
}

async function ensureMyTasksAssigned(){
  if (!myUid || !roomId) return;
  if (myTasksReady) return;

  try{
    const ref = doc(db, "rooms", roomId, "tasks", myUid);
    const snap = await getDoc(ref);

    if (snap.exists()){
      const d = snap.data() || {};
      if (Array.isArray(d.list) && d.list.length){
        myTasks = d.list;
        myTaskIndex = (typeof d.index === "number") ? d.index : 0;
        myTasksReady = true;
        updateMyTaskHud();
        return;
      }
    }

    const pool = shuffleCryptoInPlace([...TASK_POOL]);
    const list = pool.slice(0, Math.min(TASKS_PER_PLAYER, pool.length));

    await setDoc(ref, {
      uid: myUid,
      list,
      index: 0,
      updatedAt: serverTimestamp()
    }, { merge:true });

    myTasks = list;
    myTaskIndex = 0;
    myTasksReady = true;
    updateMyTaskHud();
  } catch(e){
    console.log("ensureMyTasksAssigned error:", e);
  }
}

// ===================
// MICRO-ACTIVITÉS (overlay)
// ===================
const activityOverlay = document.createElement("div");
activityOverlay.id = "activityOverlay";
activityOverlay.style.cssText = `
  position: fixed;
  inset: 0;
  z-index: 200;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.45);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
`;
activityOverlay.innerHTML = `
  <div id="activityCard" style="
    width: min(560px, calc(100vw - 24px));
    border-radius: 18px;
    padding: 14px;
    background: rgba(0,0,0,.72);
    border: 1px solid rgba(255,255,255,.14);
    box-shadow: 0 16px 40px rgba(0,0,0,.35);
    color: #fff;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  ">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
      <div>
        <div id="activityTitle" style="font: 1000 14px system-ui; letter-spacing:.2px;">Activité</div>
        <div id="activitySub" style="margin-top:4px; font: 800 12px system-ui; opacity:.9;">—</div>
      </div>
      <button id="activityClose" type="button" style="
        appearance:none; border:0; padding:10px 12px; border-radius:12px;
        font:900 12px system-ui; color:#000; background: rgba(255,255,255,.85);
      ">Fermer</button>
    </div>

    <div style="margin-top:12px; height:10px; border-radius:999px; background: rgba(255,255,255,.12); overflow:hidden;">
      <div id="activityBar" style="height:100%; width:0%; background: rgba(255,255,255,.85);"></div>
    </div>

    <div id="activityBody" style="margin-top:14px;"></div>
  </div>
`;
document.body.appendChild(activityOverlay);

const activityTitleEl = activityOverlay.querySelector("#activityTitle");
const activitySubEl   = activityOverlay.querySelector("#activitySub");
const activityBodyEl  = activityOverlay.querySelector("#activityBody");
const activityBarEl   = activityOverlay.querySelector("#activityBar");
const activityCloseBtn= activityOverlay.querySelector("#activityClose");

let activityOpen = false;
let activityDone = false;

function openActivityUI(title, sub){
  activityOpen = true;
  activityDone = false;
  activityOverlay.style.display = "flex";
  activityTitleEl.textContent = title || "Activité";
  activitySubEl.textContent = sub || "";
  activityBodyEl.innerHTML = "";
  activityBarEl.style.width = "0%";
}
function closeActivityUI(){
  activityOpen = false;
  activityDone = false; // ✅ reset
  activityOverlay.style.display = "none";
  activityBodyEl.innerHTML = "";
}
activityCloseBtn?.addEventListener("click", closeActivityUI);
activityOverlay.addEventListener("click", (e) => { if (e.target === activityOverlay) closeActivityUI(); });

// mini-jeu: “taper les pastilles dans l’ordre”
function startTapOrderMiniGame({ steps = 6 } = {}){
  const order = Array.from({length: steps}, (_,i)=>i+1);
  shuffleCryptoInPlace(order);

  let idx = 0;

  const wrap = document.createElement("div");
  wrap.style.cssText = `display:flex; flex-wrap:wrap; gap:10px; justify-content:center;`;

  function setProgress(){
    const pct = (idx/steps)*100;
    activityBarEl.style.width = `${pct}%`;
    activitySubEl.textContent = `Tape ${order[idx]} sur ${steps}`;
  }

  for (let n=1; n<=steps; n++){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(n);
    btn.style.cssText = `width:64px;height:64px;border-radius:16px;appearance:none;border:0;font:1000 18px system-ui;color:#000;background:rgba(255,255,255,.85);box-shadow:0 10px 22px rgba(0,0,0,.25);`;

    btn.addEventListener("click", async () => {
      if (activityDone) return;

      if (n !== order[idx]){
        idx = 0;
        setProgress();
        return;
      }

      btn.style.opacity = "0.45";
      btn.disabled = true;
      idx++;
      setProgress();

      if (idx >= steps){
        activityDone = true;
        activityBarEl.style.width = `100%`;
        activitySubEl.textContent = "Terminé ✅";
        await sleep(350);
        closeActivityUI();
        await completeCurrentTask();
      }
    });

    wrap.appendChild(btn);
  }

  // mélange l’affichage
  const children = Array.from(wrap.children);
  children.sort(() => (cryptoRandInt(2) ? 1 : -1));
  wrap.innerHTML = "";
  for (const c of children) wrap.appendChild(c);

  activityBodyEl.appendChild(wrap);
  setProgress();
}

function randInt(a, b){ // inclusif
  return a + cryptoRandInt((b - a + 1));
}

// ✅ Mini-jeu 1 : TAP ORDER (tu l’as déjà, je le laisse tel quel)
/// startTapOrderMiniGame ...

// ✅ Mini-jeu 2 : “Tape X fois vite” (spam contrôlé)
function startRapidTapMiniGame({ taps = 18, timeMs = 4500 } = {}){
  let count = 0;
  const endAt = Date.now() + timeMs;

  const box = document.createElement("div");
  box.style.cssText = `display:flex; flex-direction:column; gap:12px; align-items:center; text-align:center;`;

  const big = document.createElement("button");
  big.type = "button";
  big.textContent = "TAPE !";
  big.style.cssText = `
    width:min(360px, 92vw); height:110px; border-radius:22px;
    appearance:none; border:0; font:1000 22px system-ui;
    color:#000; background:rgba(255,255,255,.88); box-shadow:0 14px 28px rgba(0,0,0,.25);
  `;

  const info = document.createElement("div");
  info.style.cssText = `font:900 12px system-ui; opacity:.92;`;

  function tick(){
    const left = Math.max(0, endAt - Date.now());
    const pct = Math.max(0, Math.min(1, count / taps)) * 100;
    activityBarEl.style.width = `${pct}%`;
    info.textContent = `${count}/${taps} — Temps: ${Math.ceil(left/1000)}s`;

    if (left <= 0){
      if (count >= taps){
        activityDone = true;
        activityBarEl.style.width = "100%";
        activitySubEl.textContent = "Terminé ✅";
        setTimeout(async () => { closeActivityUI(); await completeCurrentTask(); }, 250);
      } else {
        // reset si échec
        count = 0;
        activitySubEl.textContent = "Trop lent… recommence !";
        activityBarEl.style.width = "0%";
        setTimeout(() => { activitySubEl.textContent = "Tape vite !"; }, 700);
      }
    } else if (!activityDone) {
      requestAnimationFrame(tick);
    }
  }

  big.addEventListener("click", () => {
    if (activityDone) return;
    count++;
  });

  box.appendChild(info);
  box.appendChild(big);
  activityBodyEl.appendChild(box);

  activitySubEl.textContent = "Tape vite !";
  requestAnimationFrame(tick);
}

// ✅ Mini-jeu 3 : “Maintiens pour remplir” (hold)
function startHoldToFillMiniGame({ holdMs = 1600 } = {}){
  let holding = false;
  let holdStart = 0;

  const box = document.createElement("div");
  box.style.cssText = `display:flex; flex-direction:column; gap:12px; align-items:center; text-align:center;`;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "MAINTIENS";
  btn.style.cssText = `
    width:min(360px, 92vw); height:110px; border-radius:22px;
    appearance:none; border:0; font:1000 20px system-ui;
    color:#000; background:rgba(255,255,255,.88); box-shadow:0 14px 28px rgba(0,0,0,.25);
    touch-action:none;
  `;

  const info = document.createElement("div");
  info.style.cssText = `font:900 12px system-ui; opacity:.92;`;
  info.textContent = "Reste appuyé jusqu’à 100%";

  function frame(){
    if (activityDone) return;

    let pct = 0;
    if (holding){
      const t = Date.now() - holdStart;
      pct = Math.max(0, Math.min(1, t / holdMs)) * 100;
      if (pct >= 100){
        activityDone = true;
        activityBarEl.style.width = "100%";
        activitySubEl.textContent = "Terminé ✅";
        setTimeout(async () => { closeActivityUI(); await completeCurrentTask(); }, 250);
        return;
      }
    }
    activityBarEl.style.width = `${pct}%`;
    requestAnimationFrame(frame);
  }

  function startHold(e){
    if (activityDone) return;
    holding = true;
    holdStart = Date.now();
    btn.style.opacity = "0.85";
    e?.preventDefault?.();
  }
  function endHold(e){
    if (activityDone) return;
    holding = false;
    btn.style.opacity = "1";
    activityBarEl.style.width = "0%";
    activitySubEl.textContent = "Relâché… recommence";
    setTimeout(() => { if (!activityDone) activitySubEl.textContent = "Maintiens…"; }, 600);
    e?.preventDefault?.();
  }

  btn.addEventListener("pointerdown", startHold, { passive:false });
  btn.addEventListener("pointerup", endHold, { passive:false });
  btn.addEventListener("pointercancel", endHold, { passive:false });
  btn.addEventListener("pointerleave", endHold, { passive:false });

  box.appendChild(info);
  box.appendChild(btn);
  activityBodyEl.appendChild(box);

  activitySubEl.textContent = "Maintiens…";
  requestAnimationFrame(frame);
}

// ✅ Mini-jeu 4 : “Clique la cible” (cible qui bouge)
function startMovingTargetMiniGame({ hits = 5 } = {}){
  let left = hits;

  const area = document.createElement("div");
  area.style.cssText = `
  position:relative;
  width: 100%;
  max-width: 520px;
  height: 280px;
  box-sizing: border-box;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.06);
  overflow: hidden;
  margin: 0 auto;
`;

  const target = document.createElement("button");
  target.type = "button";
  target.textContent = "●";
  target.style.cssText = `
    position:absolute; width:62px; height:62px; border-radius:999px;
    appearance:none; border:0; font:1000 26px system-ui;
    color:#000; background:rgba(255,255,255,.88);
    box-shadow:0 12px 26px rgba(0,0,0,.25);
  `;
  area.appendChild(target);

  function place(){
    const pad = 10;
    const w = area.clientWidth;
    const h = area.clientHeight;
    const x = randInt(pad, Math.max(pad, w - 62 - pad));
    const y = randInt(pad, Math.max(pad, h - 62 - pad));
    target.style.left = x + "px";
    target.style.top  = y + "px";
  }

  function updateBar(){
    const done = (hits - left);
    const pct = (done / hits) * 100;
    activityBarEl.style.width = `${pct}%`;
    activitySubEl.textContent = `Cible: ${done}/${hits}`;
  }

  target.addEventListener("click", async () => {
    if (activityDone) return;

    left--;
    if (left <= 0){
      activityDone = true;
      activityBarEl.style.width = "100%";
      activitySubEl.textContent = "Terminé ✅";
      await sleep(250);
      closeActivityUI();
      await completeCurrentTask();
      return;
    }
    updateBar();
    place();
  });

  activityBodyEl.appendChild(area);
  updateBar();
  place();
}

function startActivityForZone(zoneId){
  // Variations par zone (tu peux ajuster)
  const variants = {
    imagerie: () => {
      openActivityUI("Imagerie", "Activité en cours…");
      const r = cryptoRandInt(3);
      if (r === 0) return startTapOrderMiniGame({ steps: randInt(5, 7) });
      if (r === 1) return startMovingTargetMiniGame({ hits: randInt(4, 6) });
      return startHoldToFillMiniGame({ holdMs: randInt(1200, 1900) });
    },
    labo: () => {
      openActivityUI("Labo", "Activité en cours…");
      const r = cryptoRandInt(3);
      if (r === 0) return startTapOrderMiniGame({ steps: randInt(4, 6) });
      if (r === 1) return startRapidTapMiniGame({ taps: randInt(14, 22), timeMs: randInt(3500, 5200) });
      return startMovingTargetMiniGame({ hits: randInt(4, 6) });
    },
    pharma: () => {
      openActivityUI("Pharma", "Activité en cours…");
      const r = cryptoRandInt(3);
      if (r === 0) return startTapOrderMiniGame({ steps: randInt(5, 7) });
      if (r === 1) return startHoldToFillMiniGame({ holdMs: randInt(1400, 2100) });
      return startRapidTapMiniGame({ taps: randInt(16, 24), timeMs: randInt(3600, 5200) });
    },
    exam: () => {
      openActivityUI("Anamnèse", "Activité en cours…");
      const r = cryptoRandInt(3);
      if (r === 0) return startTapOrderMiniGame({ steps: randInt(4, 6) });
      if (r === 1) return startMovingTargetMiniGame({ hits: randInt(4, 6) });
      return startHoldToFillMiniGame({ holdMs: randInt(1200, 1800) });
    },
    soins: () => {
      openActivityUI("Soins", "Activité en cours…");
      const r = cryptoRandInt(3);
      if (r === 0) return startTapOrderMiniGame({ steps: randInt(5, 7) });
      if (r === 1) return startRapidTapMiniGame({ taps: randInt(16, 26), timeMs: randInt(3200, 5000) });
      return startHoldToFillMiniGame({ holdMs: randInt(1300, 2000) });
    },
    admin: () => {
      openActivityUI("Dossiers", "Activité en cours…");
      const r = cryptoRandInt(3);
      if (r === 0) return startTapOrderMiniGame({ steps: randInt(4, 6) });
      if (r === 1) return startHoldToFillMiniGame({ holdMs: randInt(1100, 1700) });
      return startMovingTargetMiniGame({ hits: randInt(4, 6) });
    },
    rcp: () => {
      openActivityUI("RCP", "Activité en cours…");
      const r = cryptoRandInt(3);
      if (r === 0) return startTapOrderMiniGame({ steps: randInt(4, 6) });
      if (r === 1) return startRapidTapMiniGame({ taps: randInt(14, 22), timeMs: randInt(3500, 5200) });
      return startMovingTargetMiniGame({ hits: randInt(4, 6) });
    }
  };

  const fn = variants[zoneId];
  if (fn) return fn();

  openActivityUI("Activité", "Mini-jeu…");
  startTapOrderMiniGame({ steps: 5 });
}

// valider tâche
async function completeCurrentTask(){
  if (!myUid || !roomId) return;
  if (phase !== "started") return;
  if (myDead) return;
  if (myRole !== "tinocent") return;

  if (typeof zones === "undefined" || typeof player === "undefined" || !Array.isArray(zones) || !player){
  setStartInfo("Zones/joueur non prêts.");
  return;
}

  const t = currentTask();
  if (!t) return;

  const z = zones.find(z => z.id === t.zoneId);
  if (!z){ setStartInfo("Zone de mission introuvable."); return; }

  const range = getZoneRange(t.zoneId);
  const d = dist(player.x, player.y, z.cx, z.cy);
  if (d > range){
    setStartInfo("Va sur la zone indiquée (flèche).");
    return;
  }

  const nextIndex = myTaskIndex + 1;

  // ✅ 1) Progress perso d'abord (sinon boucle infinie si le global échoue)
  try{
    await updateDoc(doc(db, "rooms", roomId, "tasks", myUid), {
      index: nextIndex,
      updatedAt: serverTimestamp()
    });

    myTaskIndex = nextIndex;

    if (myTaskIndex >= myTasks.length){
      myTasksReady = false;
      myTasks = [];
      myTaskIndex = 0;
      await ensureMyTasksAssigned();
    } else {
      updateMyTaskHud();
    }

  } catch(e){
    console.log("TASK INDEX update error:", e);
    setStartInfo(`Erreur validation mission (index): ${e?.code || ""}`);
    return;
  }

  // ✅ 2) Ensuite on tente le compteur global, mais si ça rate on bloque pas le joueur
  try{
    await updateDoc(doc(db, "rooms", roomId), { tasksDone: increment(1) });
  } catch(e){
  console.log("ROOM tasksDone increment error:", e);
  setStartInfo(`Mission validée ✅ mais compteur global bloqué (${e?.code || "rules"})`);
}

  setStartInfo("");
}

// ===================
// ACTION UI (Expulser / Rapporter / Activité)
// ===================
const actionWrap = document.createElement("div");
actionWrap.id = "actionWrap";
actionWrap.style.cssText = `
  position: fixed;
  left: 50%;
  bottom: calc(18px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 80;
  display: none;
  gap: 10px;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
`;
document.body.appendChild(actionWrap);

const actionBtn = document.createElement("button");
actionBtn.id = "actionBtn";
actionBtn.type = "button";
actionBtn.style.cssText = `
  appearance: none;
  border: 0;
  padding: 14px 18px;
  border-radius: 16px;
  font: 900 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  letter-spacing: .2px;
  color: #fff;
  background: rgba(0,0,0,.55);
  border: 1px solid rgba(255,255,255,.14);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 8px 22px rgba(0,0,0,.22);
`;
actionWrap.appendChild(actionBtn);

function setActionUI({ show=false, label="", disabled=false }){
  actionWrap.style.display = show ? "flex" : "none";
  actionBtn.textContent = label || "";
  actionBtn.disabled = !!disabled;
  actionBtn.style.opacity = disabled ? "0.65" : "1";
}

// Ranges
const REPORT_RANGE = 86;
const ZONE_RANGE_BASE = 92;

// ✅ zone plus facile à atteindre (RCP)
const ZONE_RANGE_BY_ID = {
  rcp: 180, // ajuste si tu veux encore plus (ex: 160)
};

function getZoneRange(zoneId){
  return ZONE_RANGE_BY_ID[zoneId] ?? ZONE_RANGE_BASE;
}

// Expulse anti-flicker (hystérésis + lock)
const EXPEL_SHOW_RANGE = 84;
const EXPEL_HIDE_RANGE = 104;
const EXPEL_LOCK_MS    = 240;

let expelLockedUid = null;
let expelLockUntil = 0;

// ✅ cooldown expulsion (1 minute ici)
const EXPEL_COOLDOWN_MS = 60_000;

// ===================
// CHAT OPEN/CLOSE + GATING (VIEW vs WRITE)
// ===================
let chatCanViewNow  = true;  // peut ouvrir/voir le chat
let chatCanWriteNow = true;  // peut envoyer

function applyChatWriteLock(){
  if (!chatInput || !chatForm) return;
  chatInput.disabled = !chatCanWriteNow;
  chatInput.placeholder = chatCanWriteNow ? "Écrire…" : "Lecture seule";
}

function openChat(){
  if (!chatOverlay) return;
  if (!chatCanViewNow) return;

  chatOverlay.classList.add("open");
  chatOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("chat-open");

  // ✅ Message d'aide si débat et chat vide
  if (chatMessagesEl && debateUiActive && !chatMessagesEl.children.length){
  chatMessagesEl.innerHTML = `
    <div style="opacity:.92;padding:14px;font:900 13px system-ui;color:#fff;">
      Débat en cours… discutez et accusez quelqu’un avant la fin du timer 👀
    </div>
  `;
}

  if (chatCanWriteNow){
    setTimeout(() => chatInput?.focus?.(), 80);
  }
}

function closeChat(force=false){
  if (!force && meetingLockActive) return;
  if (!chatOverlay) return;
  chatOverlay.classList.remove("open");
  chatOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("chat-open");
}

chatFab?.addEventListener("click", () => {
  if (!chatOverlay) return;

  if (!chatCanViewNow){
    chatFab.classList.remove("has-unread");
    if (chatBadge) chatBadge.hidden = true;
    return;
  }

  chatFab.classList.remove("has-unread");
  if (chatBadge) chatBadge.hidden = true;

  if (chatOverlay.classList.contains("open")) closeChat();
  else openChat();
});
btnChatClose?.addEventListener("click", () => closeChat(false));
chatOverlay?.addEventListener("click", (e) => { if (e.target === chatOverlay) closeChat(false); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeChat(false); });

// ===================
// CANVAS SETUP (DPR SAFE iPhone)
// ===================
let DPR = window.devicePixelRatio || 1;

function resize(){
  if (!canvas || !ctx) return;

  DPR = window.devicePixelRatio || 1;
  const vv = window.visualViewport;

  const cssW = Math.floor(vv?.width  || window.innerWidth);
  const cssH = Math.floor(vv?.height || window.innerHeight);

  canvas.width  = Math.floor(cssW * DPR);
  canvas.height = Math.floor(cssH * DPR);

  canvas.style.width  = cssW + "px";
  canvas.style.height = cssH + "px";

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

resize();
window.addEventListener("resize", resize);
window.visualViewport?.addEventListener("resize", resize);
window.visualViewport?.addEventListener("scroll", resize);

// room flags
let roomChatEnabled = false;
let lastTalliedVoteRound = 0;

// deadUids persistant (anti “revient debout”)
let deadUidsSet = new Set();

// ===================
// MEETING / REPORT SPLASH (expulsion.png) + LOCK CHAT
// ===================
const REPORT_SPLASH_MS = 10_000; // écran expulsion visible (10s)
const DEBATE_MS        = 60_000; // débat chat forcé (60s)
const VOTE_MS = 30_000; // ✅ vote 30s (ajuste)

let meetingLockActive = false;
let meetingAtMsLocal = 0;
let meetingTimers = { splash:null, debate:null, vote:null, tick:null };

function clearMeetingTimers(){
  clearTimeout(meetingTimers.splash);
  clearTimeout(meetingTimers.debate);
  clearTimeout(meetingTimers.vote);
  clearInterval(meetingTimers.tick);
  meetingTimers.splash = meetingTimers.debate = meetingTimers.vote = meetingTimers.tick = null;
}

function tsToMs(v){
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v?.toMillis === "function") return v.toMillis();
  return 0;
}

function getPlayerNameByUid(uid){
  if (!uid) return "";
  const p = playersMap.get(uid);
  if (p?.name) return p.name;
  const n = prevPlayersSnapshot?.get?.(uid);
  return n || "";
}

function setMeetingLock(on){
  meetingLockActive = !!on;

  if (meetingLockActive){
    setActionUI({ show:false });
    try{ closeActivityUI(); } catch(_) {}
    joy?.classList.add("is-hidden");
  } else {
    if (phase === "started") joy?.classList.remove("is-hidden");
  }
}

// ✅ SAFE: si ces éléments n’existent pas dans le HTML, on n’explose pas
const reportOverlay = document.getElementById("reportOverlay");
const reportCard    = document.getElementById("reportCard");
const reportLine1   = document.getElementById("reportLine1");

// ✅ debate pill: si absent dans le HTML, on le crée → timer garanti
let debatePill = document.getElementById("debatePill");

function ensureDebatePill(){
  if (debatePill) return debatePill;

  debatePill = document.createElement("div");
  debatePill.id = "debatePill";
  debatePill.style.cssText = `
    position: fixed;
    left: 50%;
    top: calc(12px + env(safe-area-inset-top));
    transform: translateX(-50%);
    z-index: 9999;
    padding: 10px 12px;
    border-radius: 999px;
    font: 1000 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    letter-spacing: .2px;
    color: #fff;
    background: rgba(0,0,0,.70);
    border: 1px solid rgba(255,255,255,.14);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: none;
    pointer-events: none;
  `;
  document.body.appendChild(debatePill);
  return debatePill;
}

function safeSet(el, prop, value){
  if (el) el[prop] = value;
}
function safeStyle(el, prop, value){
  if (el) el.style[prop] = value;
}

// ===================
// MEETING FLOW UNIQUE (Rapporter + Dénoncer)
// 1) report => splash 10s
// 2) débat chat forcé 60s (timer visible)
// 3) vote 30s (host)
// ===================
function startMeetingFlow({ meetingType, meetingAtMs, bodyUid }){
  // meetingType: "report" ou "meeting"
  // report => splash 10s puis débat
  // meeting => débat direct

  const pill = ensureDebatePill();

  clearMeetingTimers();
  setMeetingLock(true);

  const isReport = (meetingType === "report");
  const bodyName = getPlayerNameByUid(bodyUid) || "Un Ti’Doc";

  const startDebateAt = meetingAtMs + (isReport ? REPORT_SPLASH_MS : 0);
  const endDebate     = startDebateAt + DEBATE_MS;

  // --- splash uniquement pour report
  if (isReport){
    safeSet(reportLine1, "textContent",
      bodyUid ? `${bodyName} a été expulsé` : "Un Ti’Doc a été expulsé…"
    );
    safeStyle(reportOverlay, "display", "flex");

    requestAnimationFrame(() => {
      if (reportCard){
        reportCard.style.transition = "transform 260ms cubic-bezier(.2,.9,.2,1), opacity 260ms ease";
        reportCard.style.transform = "translateY(0px) scale(1)";
        reportCard.style.opacity = "1";
      }
    });

    meetingTimers.splash = setTimeout(() => {
      safeStyle(reportOverlay, "display", "none");
      forceOpenChat(); // ✅ chat forcé après splash
    }, REPORT_SPLASH_MS);
  } else {
    // meeting => chat direct
    safeStyle(reportOverlay, "display", "none");
    forceOpenChat();
  }

  // --- UI débat (bannière dans le chat) => timer garanti
  setDebateUI(true, {
    title: "Débat",
    subtitle: "Identifiez le Ti’Truant 🕵️‍♀️",
    endMs: endDebate
  });

  // --- pill timer en haut (maintenant garanti car créé si absent)
  meetingTimers.tick = setInterval(() => {
    const now = Date.now();

    // avant le débat (pendant splash report)
    if (now < startDebateAt){
      pill.style.display = "none";
      return;
    }

    // pendant débat
    if (now < endDebate){
      const s = Math.max(0, Math.ceil((endDebate - now) / 1000));
      pill.style.display = "";
      pill.textContent = `Débat : ${s}s`;
      return;
    }

    // après débat
    pill.style.display = "none";
    clearMeetingTimers();
  }, 250);

  // --- fin débat : unlock + vote (host)
  const delayToEndDebate = Math.max(0, endDebate - Date.now());

  meetingTimers.debate = setTimeout(async () => {
    pill.style.display = "none";

    setDebateUI(false);
    setMeetingLock(false);

    // ✅ vote pour report ET dénoncer
    if (typeof hostStartVote === "function") {
      await hostStartVote();
    }
  }, delayToEndDebate);
}

// (on garde ta fonction pour cacher au besoin)
function hideReportSplash(){
  safeStyle(reportOverlay, "display", "none");
}

// ===================
// VOTE UI (après le débat)
// ===================
let voteUiOpen = false;
let myVoteSent = false;

const voteOverlay = document.createElement("div");
voteOverlay.id = "voteOverlay";
voteOverlay.style.cssText = `
  position: fixed;
  inset: 0;
  z-index: 260;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
`;

voteOverlay.innerHTML = `
  <div style="
    width: min(560px, calc(100vw - 24px));
    border-radius: 20px;
    padding: 14px;
    background: rgba(0,0,0,.74);
    border: 1px solid rgba(255,255,255,.14);
    box-shadow: 0 18px 50px rgba(0,0,0,.40);
    color: #fff;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  ">
    <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
      <div>
        <div id="voteTitle" style="font:1000 14px system-ui; letter-spacing:.2px;">
          Vote : qui est le Ti’Truant ?
        </div>
        <div id="voteTimer" style="margin-top:4px; font:900 12px system-ui; opacity:.92;">
          —
        </div>
      </div>
      <button id="voteSkipBtn" type="button" style="
        appearance:none; border:0; padding:10px 12px; border-radius:12px;
        font:900 12px system-ui; color:#000; background: rgba(255,255,255,.88);
      ">Passer</button>
    </div>

    <div id="voteList" style="
      margin-top:12px;
      display:grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    "></div>

    <div id="voteStatus" style="margin-top:12px; font:900 12px system-ui; opacity:.9;"></div>
  </div>
`;
document.body.appendChild(voteOverlay);

const voteListEl   = voteOverlay.querySelector("#voteList");
const voteTimerEl  = voteOverlay.querySelector("#voteTimer");
const voteStatusEl = voteOverlay.querySelector("#voteStatus");
const voteSkipBtn  = voteOverlay.querySelector("#voteSkipBtn");

function hideVoteUI(){
  voteUiOpen = false;
  myVoteSent = false;
  voteOverlay.style.display = "none";
  if (voteListEl) voteListEl.innerHTML = "";
  if (voteStatusEl) voteStatusEl.textContent = "";
}

function setVoteDisabled(disabled){
  voteSkipBtn.disabled = !!disabled;
  voteSkipBtn.style.opacity = disabled ? "0.6" : "1";
  voteListEl?.querySelectorAll("button")?.forEach(btn => {
    btn.disabled = !!disabled;
    btn.style.opacity = disabled ? "0.6" : "1";
  });
}

async function sendVote(targetUid){ // targetUid null => skip
  if (!roomId || !myUid) return;
  if (myVoteSent) return;

  myVoteSent = true;
  setVoteDisabled(true);
  if (voteStatusEl) voteStatusEl.textContent = "Vote enregistré ✅";

  try{
    const ref = doc(db, "rooms", roomId, "votes", myUid);
    await setDoc(ref, {
      uid: myUid,
      targetUid: targetUid || null,
      kind: targetUid ? "vote" : "skip",
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    }, { merge:true });
  } catch(e){
    console.log("sendVote error:", e);
    // si échec, on permet de re-voter
    myVoteSent = false;
    setVoteDisabled(false);
    if (voteStatusEl) voteStatusEl.textContent = "Erreur envoi vote… réessaie.";
  }
}

function openVoteUI(endVoteMs){
  voteUiOpen = true;
  myVoteSent = false;
  voteOverlay.style.display = "flex";

  // construit la liste depuis playersMap (vivants)
  const alive = Array.from(playersMap.values())
    .filter(p => p && !p.isDead && p.uid && p.uid !== myUid)
    .sort((a,b) => (a.name||"").localeCompare(b.name||""));

  if (voteListEl){
    voteListEl.innerHTML = "";
    for (const p of alive){
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = p.name || "Joueur";
      b.style.cssText = `
        appearance:none; border:0;
        padding: 12px 12px;
        border-radius: 14px;
        font: 1000 13px system-ui;
        color:#000;
        background: rgba(255,255,255,.9);
        box-shadow: 0 10px 24px rgba(0,0,0,.25);
        text-align:center;
      `;
      b.addEventListener("click", () => sendVote(p.uid));
      voteListEl.appendChild(b);
    }
  }

// dans openVoteUI
if (!voteSkipBound && voteSkipBtn){
  voteSkipBound = true;
  voteSkipBtn.addEventListener("click", () => sendVote(null));
}
  // timer affiché
  const tick = () => {
    const s = Math.max(0, Math.ceil((endVoteMs - Date.now())/1000));
    if (voteTimerEl) voteTimerEl.textContent = `Temps restant : ${s}s`;
    if (s <= 0){
      // auto-skip si rien voté
      if (!myVoteSent) sendVote(null);
    } else if (voteUiOpen){
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

// ===================
// Résolution vote (HOST)
// ===================
async function resolveVoteAndMaybeExpel(){
  if (!myIsHost) return;
  if (!roomId) return;

  try{
    const snapPlayers = await getDocs(collection(db, "rooms", roomId, "players"));
    const aliveSet = new Set(
      snapPlayers.docs
        .map(d => d.data())
        .filter(p => p && !p.isDead && p.uid)
        .map(p => p.uid)
    );

    const snapVotes = await getDocs(collection(db, "rooms", roomId, "votes"));
    const tallies = new Map(); // uid -> count
    let skipCount = 0;

    for (const d of snapVotes.docs){
      const v = d.data() || {};
      const voter = v.uid;
      if (!aliveSet.has(voter)) continue; // ignore vote de morts/déco

      const target = v.targetUid || null;
      if (!target) { skipCount++; continue; }
      if (!aliveSet.has(target)) { skipCount++; continue; } // vote invalide -> skip

      tallies.set(target, (tallies.get(target) || 0) + 1);
    }

    // trouve top
    let bestUid = null;
    let best = 0;
    let tie = false;

    for (const [uid, c] of tallies.entries()){
      if (c > best){
        best = c;
        bestUid = uid;
        tie = false;
      } else if (c === best && c > 0){
        tie = true;
      }
    }

    // règle simple :
    // - si égalité OU aucun vote -> personne expulsée
    // - sinon bestUid expulsé
    if (!bestUid || best <= 0 || tie){
      await updateDoc(doc(db, "rooms", roomId), {
        meetingType: null,
        meetingAt: null,
        meetingBy: null,
        reportedBodyUid: null,
        chatEnabled: true
      }).catch(()=>{});
      return;
    }

    const now = Date.now();

    await updateDoc(doc(db, "rooms", roomId), {
      deadUids: arrayUnion(bestUid),
      meetingType: null,
      meetingAt: null,
      meetingBy: null,
      reportedBodyUid: null,
      chatEnabled: true
    }).catch(()=>{});

    await updateDoc(doc(db, "rooms", roomId, "players", bestUid), {
      isDead: true,
      deadAtMs: now,
      deadBy: "vote"
    }).catch(()=>{});

  } catch(e){
    console.log("resolveVoteAndMaybeExpel error:", e);
  }
}

async function hostClearVotes(){
  if (!myIsHost) return;

  try{
    const snapVotes = await getDocs(collection(db, "rooms", roomId, "votes"));
    await Promise.all(
      snapVotes.docs.map(d => deleteDoc(d.ref).catch(()=>{}))
    );
    console.log("[VOTE] votes nettoyés");
  }catch(e){
    console.warn("[VOTE] clear error", e);
  }
}

async function hostTallyAndApplyVote({ room, voteAtMs, voteDurMs, voteRound }){
  if (!myIsHost) return;

  const endVoteMs = voteAtMs + (voteDurMs || VOTE_MS);
  if (Date.now() < endVoteMs) return;

  // évite de re-calculer 15 fois si plusieurs snapshots arrivent
  if (voteRound === lastTalliedVoteRound) return;
  lastTalliedVoteRound = voteRound;

  await resolveVoteAndMaybeExpel();
  await hostClearVotes();

  // ferme le vote dans la room
  await updateDoc(doc(db, "rooms", roomId), {
    voteActive: false,
    voteAt: null
  }).catch(()=>{});
}

async function hostStartVote(){
  if (!myIsHost) return;

  await updateDoc(doc(db,"rooms",roomId), {
    voteActive: true,
    voteAt: serverTimestamp(),
    voteDurMs: VOTE_MS,
    voteRound: increment(1),
  }).catch(()=>{});
}

function handleMeetingState(room, status){
  // si pas en jeu => reset meeting UI
  if (status !== "started"){
    setMeetingLock(false);
    hideReportSplash();

    const pill = ensureDebatePill();
    pill.style.display = "none";

    setDebateUI(false);
    clearMeetingTimers();
    meetingAtMsLocal = 0;
    return;
  }

  const meetingType = room?.meetingType || "";
  const meetingAtMs = tsToMs(room?.meetingAt);
  const bodyUid     = room?.reportedBodyUid || "";

  const hasMeeting =
    !!meetingAtMs && (meetingType === "report" || meetingType === "meeting");

  if (!hasMeeting){
    setMeetingLock(false);
    hideReportSplash();

    const pill = ensureDebatePill();
    pill.style.display = "none";

    setDebateUI(false);
    clearMeetingTimers();
    meetingAtMsLocal = 0;
    return;
  }

  // évite de relancer le flow à chaque snapshot
  if (meetingAtMs !== meetingAtMsLocal){
    meetingAtMsLocal = meetingAtMs;
    startMeetingFlow({ meetingType, meetingAtMs, bodyUid });
  }
}

// ===================
// SELF EXPULSED CARD (victime) : 10s puis spectateur
// ===================
const SELF_EXPEL_MS = 10_000;

let selfExpelActive = false;
let selfExpelUntil = 0;
let selfExpelTimer = null;

const selfExpelOverlay = document.createElement("div");
selfExpelOverlay.id = "selfExpelOverlay";
selfExpelOverlay.style.cssText = `
  position: fixed;
  inset: 0;
  z-index: 300;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.65);
  backdrop-filter: blur(7px);
  -webkit-backdrop-filter: blur(7px);
`;

selfExpelOverlay.innerHTML = `
  <div id="selfExpelCard" style="
    width: min(520px, calc(100vw - 28px));
    border-radius: 22px;
    padding: 14px;
    background: rgba(0,0,0,.72);
    border: 1px solid rgba(255,255,255,.14);
    box-shadow: 0 18px 50px rgba(0,0,0,.40);
    transform: translateY(18px) scale(.96);
    opacity: 0;
  ">
    <div style="
      border-radius: 18px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
    ">
      <img src="./assets/expulsion.png" alt="Expulsion" style="display:block;width:100%;height:auto;"/>
    </div>

    <div style="margin-top: 12px; text-align:center; color:#fff; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
      <div style="font:1000 18px system-ui;">Vous avez été expulsé</div>
    </div>
  </div>
`;
document.body.appendChild(selfExpelOverlay);

const expImg = selfExpelOverlay.querySelector("img");
if (expImg) expImg.src = asset("./assets/expulsion.png");

const selfExpelCard = selfExpelOverlay.querySelector("#selfExpelCard");

function showSelfExpelledCard(ms = SELF_EXPEL_MS){
  clearTimeout(selfExpelTimer);

  selfExpelActive = true;
  selfExpelUntil = Date.now() + ms;

  selfExpelOverlay.style.display = "flex";
  requestAnimationFrame(() => {
    selfExpelCard.style.transition = "transform 260ms cubic-bezier(.2,.9,.2,1), opacity 260ms ease";
    selfExpelCard.style.transform = "translateY(0px) scale(1)";
    selfExpelCard.style.opacity = "1";
  });

  // pendant la carte : pas de map, pas de joystick
  joy?.classList.add("is-hidden");
  closeChat(true);

  selfExpelTimer = setTimeout(() => {
    selfExpelActive = false;
    selfExpelOverlay.style.display = "none";

    // après 10s : spectateur => joystick revient (si pas de meeting)
    if (phase === "started" && !meetingLockActive) joy?.classList.remove("is-hidden");

    // chat selon règles (vivant/expulsé)
    applyChatWriteLock();
  }, ms);
}

function forceOpenChat(){
  if (!chatOverlay) return;

  chatCanViewNow = true;
  setChatFabVisible(true);

  chatOverlay.classList.add("open");
  chatOverlay.setAttribute("aria-hidden","false");
  document.body.classList.add("chat-open");

  applyChatWriteLock();

  if (chatCanWriteNow){
    setTimeout(() => chatInput?.focus?.(), 80);
  }
}
  
// ===================
// MODES
// ===================
function setLobbyMode(){
  gameStarted = false;
  phase = "lobby";

  // ✅ menu visible
  setUiPanelVisible(true);

  joy?.classList.remove("is-hidden");

  setCanvasInteract(false);
  setMeetingLock(false);
  hideReportSplash();
  const pill = ensureDebatePill();
  pill.style.display = "none";
  clearMeetingTimers();
  meetingAtMsLocal = 0;

  // chat OK en lobby
  chatCanViewNow = true;
  chatCanWriteNow = true;
  setChatFabVisible(true);
  applyChatWriteLock();

  // actions / missions
  setActionUI({ show:false });
  showTasksHud(false);
  try{ closeActivityUI(); } catch(_) {}

  // ✅ Admin visible UNIQUEMENT dans le lobby (et seulement admin + host)
  if (btnAdminStart){
    btnAdminStart.style.display = (isAdmin && myIsHost) ? "grid" : "none";
  }
}

function setStartingMode(){
  gameStarted = false;
  phase = "starting";

  // ✅ menu caché pendant tirage
  setUiPanelVisible(false);

  joy?.classList.add("is-hidden");

  setMeetingLock(false);
  hideReportSplash();
  const pill = ensureDebatePill();
  pill.style.display = "none";
  clearMeetingTimers();
  meetingAtMsLocal = 0;

  // chat OK pendant tirage (selon ton choix)
  chatCanViewNow = true;
  chatCanWriteNow = true;
  setChatFabVisible(true);
  applyChatWriteLock();

  setActionUI({ show:false });
  showTasksHud(false);
  try{ closeActivityUI(); } catch(_) {}

  // ✅ Admin jamais visible hors lobby
  if (btnAdminStart){
    btnAdminStart.style.display = "none";
  }
}

function setGameMode(){
  gameStarted = true;
  phase = "started";

  // ✅ menu totalement caché en jeu
  setUiPanelVisible(false);

  // joystick
  if (!meetingLockActive) joy?.classList.remove("is-hidden");

  // chat (ta logique actuelle)
  chatCanViewNow  = !!roomChatEnabled;
  chatCanWriteNow = !!roomChatEnabled && !myDead;

  // canvas interact: spectateur peut drag
  setCanvasInteract(myDead && !meetingLockActive);

  setChatFabVisible(chatCanViewNow);
  if (!chatCanViewNow && chatOverlay?.classList.contains("open")){
    closeChat(true);
  }
  applyChatWriteLock();

  // missions (HUD) : affiché, mais sans bouton "valider" + sans liste si tu as appliqué mon patch missions
  showTasksHud(true);
  updateMyTaskHud();

  // actions
  setActionUI({ show:false });

  // ✅ Admin jamais visible en jeu
  if (btnAdminStart){
    btnAdminStart.style.display = "none";
  }
}

function startLoopOnce(){
  if (loopRunning) return;
  loopRunning = true;
  lastT = performance.now();     // lastT existe déjà (var)
  requestAnimationFrame(loop);
}

// ===================
// IMAGES (paths safe en module)
// ===================

const lobbyBgImg = new Image();
lobbyBgImg.src = asset("./assets/lobby.png");

const lobbyMaskImg = new Image();
lobbyMaskImg.src = asset("./assets/lobby-NB.png");

const mapImg = new Image();
mapImg.src = asset("./assets/map.png");

const collisionImg = new Image();
collisionImg.src = asset("./assets/collisions.png");

// rôle images
const tinocentImgSrc = asset("./assets/tinocent.png");
const titruantImgSrc = asset("./assets/titruant.png");

// expulsé sprite
const pleurImg = new Image();
pleurImg.src = asset("./assets/pleure.png");
watchImg(pleurImg, "pleure.png");

lobbyBgImg.decode?.().catch(()=>{});

function watchImg(img, name){
  img.onload = () => console.log(`[IMG OK] ${name}`, img.src, img.naturalWidth, img.naturalHeight);
  img.onerror = () => console.error(`[IMG FAIL] ${name}`, img.src);
}

watchImg(lobbyBgImg, "lobby.png");
watchImg(lobbyMaskImg, "lobby-NB.png");
watchImg(mapImg, "map.png");
watchImg(collisionImg, "collisions.png");
watchImg(pleurImg, "pleure.png/pleure.png");

// ===================
// WORLD SIZES
// ===================
let MAP_W = 1536;
let MAP_H = 1024;

mapImg.onload = () => {
  MAP_W = mapImg.width || MAP_W;
  MAP_H = mapImg.height || MAP_H;
};

// collisions map
let collisionData = null;
collisionImg.onload = () => {
  MAP_W = collisionImg.width || MAP_W;
  MAP_H = collisionImg.height || MAP_H;

  const tmp = document.createElement("canvas");
  tmp.width = MAP_W;
  tmp.height = MAP_H;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(collisionImg, 0, 0);
  collisionData = tctx.getImageData(0, 0, MAP_W, MAP_H);

  buildZonesFromCollision();
};

// collisions lobby
let lobbyMaskData = null;
let LOBBY_W = 0;
let LOBBY_H = 0;

lobbyMaskImg.onload = async () => {
  LOBBY_W = lobbyMaskImg.width;
  LOBBY_H = lobbyMaskImg.height;

  const tmp = document.createElement("canvas");
  tmp.width = LOBBY_W;
  tmp.height = LOBBY_H;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(lobbyMaskImg, 0, 0);

  lobbyMaskData = tctx.getImageData(0, 0, LOBBY_W, LOBBY_H);

  // ✅ si on est en lobby et déjà connecté, replace proprement
  if (phase !== "started" && myUid && roomId){
    await ensureSpawnCenter();
  }
};

// ===================
// CAMERA + ZOOM
// ===================
const ZOOM_GAME  = 1.7;
const CAM_LERP   = 0.12;
let camX = 0, camY = 0;

// Vision: on utilise une "taille écran de référence" clampée
const VISION_SCREEN_FACTOR = 0.58;

// Réglages: adapte si tu veux plus/moins de vision
const VISION_MIN_PX = 360; // évite que petits téléphones aient trop peu
const VISION_MAX_PX = 520; // empêche tablettes d'avoir trop

function getVisionRadiusWorld(){
  const minWH = Math.min(window.innerWidth, window.innerHeight);

  // clamp écran
  const ref = Math.max(VISION_MIN_PX, Math.min(VISION_MAX_PX, minWH));

  const rScreen = ref * VISION_SCREEN_FACTOR;
  return rScreen / ZOOM_GAME;
}

// spectate pan si expulsé
let specCamX = null, specCamY = null;
let specDragActive = false;
let specPointerId = null;
let specLast = { x: 0, y: 0 };

function ensureSpectateCamInit(){
  if (!player) return;
  if (specCamX == null || specCamY == null){
    specCamX = player.x;
    specCamY = player.y;
  }
}

// drag sur canvas pour bouger la caméra quand expulsé
canvas?.addEventListener("pointerdown", (e) => {
  if (phase !== "started") return;
  if (!myDead) return;
  if (meetingLockActive) return;

  ensureSpectateCamInit();
  specDragActive = true;
  specPointerId = e.pointerId;
  specLast.x = e.clientX;
  specLast.y = e.clientY;
  canvas.setPointerCapture?.(specPointerId);
  e.preventDefault();
}, { passive:false });

canvas?.addEventListener("pointermove", (e) => {
  if (!specDragActive) return;
  if (specPointerId !== null && e.pointerId !== specPointerId) return;
  if (meetingLockActive) return;

  const dx = e.clientX - specLast.x;
  const dy = e.clientY - specLast.y;
  specLast.x = e.clientX;
  specLast.y = e.clientY;

  const scale = 1 / ZOOM_GAME;
  specCamX -= dx * scale;
  specCamY -= dy * scale;

  const halfW = (window.innerWidth  / ZOOM_GAME) / 2;
  const halfH = (window.innerHeight / ZOOM_GAME) / 2;
  specCamX = clamp(specCamX, halfW, MAP_W - halfW);
  specCamY = clamp(specCamY, halfH, MAP_H - halfH);

  e.preventDefault();
}, { passive:false });

function endSpecDrag(){
  specDragActive = false;
  specPointerId = null;
}
canvas?.addEventListener("pointerup", endSpecDrag);
canvas?.addEventListener("pointercancel", endSpecDrag);
window.addEventListener("blur", endSpecDrag);

// ===================
// LOBBY DEAD ZONE (tablette)
// ===================
// % de l’écran (monde visible) qui reste “stable” au centre
// Plus c'est petit => caméra bouge plus tôt
const LOBBY_DEADZONE_X = 0.55; // 55% de la largeur visible
const LOBBY_DEADZONE_Y = 0.55; // 55% de la hauteur visible

function applyDeadZoneToCam(targetCam, playerPos, halfView, deadZoneRatio){
  // dead zone en “half” (ex: si ratio=0.55, deadHalf = 0.275 * view)
  const deadHalf = halfView * deadZoneRatio;

  const minFollow = targetCam - deadHalf;
  const maxFollow = targetCam + deadHalf;

  if (playerPos < minFollow) targetCam = playerPos + deadHalf;
  else if (playerPos > maxFollow) targetCam = playerPos - deadHalf;

  return targetCam;
}

// ===================
// ZONES (sur collisions.png)
// ===================
const ZONE_COLORS = {
  red:     { rgb:[255,0,0],    id:"meeting",   label:"DÉNONCER" },
  blue:    { rgb:[0,0,255],    id:"labo",      label:"LABO" },
  green:   { rgb:[0,128,0],    id:"imagerie",  label:"IMAGERIE" },
  yellow:  { rgb:[255,255,0],  id:"pharma",    label:"PHARMA" },
  orange:  { rgb:[255,128,0],  id:"exam",      label:"ANAMNÈSE" },
  magenta: { rgb:[255,0,255],  id:"soins",     label:"SOINS" },
  purple:  { rgb:[128,0,128],  id:"admin",     label:"DOSSIERS" },
  cyan:    { rgb:[0,255,200],  id:"rcp",       label:"RCP" },
};
const COLOR_TOL = 85;
let zones = [];

function colorDist(r,g,b, tr,tg,tb){
  const dr = r-tr, dg=g-tg, db=b-tb;
  return Math.sqrt(dr*dr + dg*dg + db*db);
}
function zoneKeyFromColor(r,g,b){
  for (const k of Object.keys(ZONE_COLORS)){
    const [tr,tg,tb] = ZONE_COLORS[k].rgb;
    if (colorDist(r,g,b,tr,tg,tb) < COLOR_TOL) return k;
  }
  return null;
}

function buildZonesFromCollision(){
  if (!collisionData) return;

  const sums = {};
  const counts = {};
  for (const k of Object.keys(ZONE_COLORS)){
    sums[k] = { x:0, y:0 };
    counts[k] = 0;
  }

  const d = collisionData.data;
  for (let y=0; y<MAP_H; y+=2){
    for (let x=0; x<MAP_W; x+=2){
      const i = (y*MAP_W + x)*4;
      const r = d[i], g = d[i+1], b = d[i+2];

      if (r > 220 && g > 220 && b > 220) continue;

      const k = zoneKeyFromColor(r,g,b);
      if (k){
        sums[k].x += x;
        sums[k].y += y;
        counts[k] += 1;
      }
    }
  }

  zones = [];
  for (const k of Object.keys(ZONE_COLORS)){
    if (counts[k] < 200) continue;
    zones.push({
      color: k,
      id: ZONE_COLORS[k].id,
      label: ZONE_COLORS[k].label,
      cx: sums[k].x / counts[k],
      cy: sums[k].y / counts[k],
    });
  }
}

// ===================
// PLAYER + COLLISIONS
// ===================
const player = { x: 220, y: 320, speed: 2.2 };
let move = { x: 0, y: 0 };

const PLAYER_RADIUS_LOBBY = 22;
const PLAYER_RADIUS_GAME  = 22;

// ===================
// LOBBY WORLD BASE (évite que MAP_W/MAP_H change et casse le lobby)
// ===================
const WORLD_W = 1536;
const WORLD_H = 1024;

// Blanc = walkable (lobby-NB.png)
function isWalkableLobby(wx, wy){
  if (!lobbyMaskData || !LOBBY_W || !LOBBY_H) return true;

  const mx = Math.floor(wx * (LOBBY_W / WORLD_W));
  const my = Math.floor(wy * (LOBBY_H / WORLD_H));

  if (mx < 0 || my < 0 || mx >= LOBBY_W || my >= LOBBY_H) return false;

  const i = (my * LOBBY_W + mx) * 4;
  const r = lobbyMaskData.data[i];
  const g = lobbyMaskData.data[i+1];
  const b = lobbyMaskData.data[i+2];

  return (r > 220 && g > 220 && b > 220);
}

// collisions.png : blanc = walkable, COULEURS = OBSTACLES
function isWalkableGame(wx, wy){
  if (!collisionData) return true;

  const x = Math.floor(wx);
  const y = Math.floor(wy);
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;

  const i = (y * MAP_W + x) * 4;
  const r = collisionData.data[i];
  const g = collisionData.data[i+1];
  const b = collisionData.data[i+2];

  const isWhite = (r > 220 && g > 220 && b > 220);
  if (isWhite) return true;

  const k = zoneKeyFromColor(r,g,b);
  if (k) return false;

  return false;
}

function isWalkable(wx, wy){
  return gameStarted ? isWalkableGame(wx, wy) : isWalkableLobby(wx, wy);
}

function canMoveWorld(nx, ny){
  const R = gameStarted ? PLAYER_RADIUS_GAME : PLAYER_RADIUS_LOBBY;
  return (
    isWalkable(nx, ny) &&
    isWalkable(nx - R, ny) &&
    isWalkable(nx + R, ny) &&
    isWalkable(nx, ny - R) &&
    isWalkable(nx, ny + R)
  );
}

function findSpawnNearCenter(){
  const cx = MAP_W * 0.5;
  const cy = MAP_H * 0.5;

  const step = 14;
  const maxR = 260;

  for (let r = 0; r <= maxR; r += step){
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 10){
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (canMoveWorld(x, y)) return { x, y };
    }
  }
  return { x: cx, y: cy };
}

// ===================
// SPRITES
// ===================
const SPRITE_SIZE_GAME  = 96;
const SPRITE_SIZE_LOBBY = 124;

const FOOT_OFFSET_Y = 16;
const FOOT_ADJUST = new Map();

const SEND_EVERY_MS = 90;

function loadImg(src){
  const im = new Image();
  im.src = src;
  return im;
}

// IMPORTANT : asset() déjà défini plus haut
const spritePose1 = loadImg(asset("./assets/pose-1.png"));
const marche1     = loadImg(asset("./assets/marche1.png"));
const marche2     = loadImg(asset("./assets/marche2.png"));
const WALK_SEQUENCE = [marche1, spritePose1, marche1, marche2, spritePose1, marche2];

watchImg(spritePose1, "pose-1.png");
watchImg(marche1, "marche1.png");
watchImg(marche2, "marche2.png");

// local walk anim
let walking = false;
let walkTimer = 0;
let walkIndex = 0;

function getLocalSprite(){
  if (!walking) return spritePose1;
  return WALK_SEQUENCE[walkIndex];
}
function getRemoteSprite(p){
  if (!p.moving) return spritePose1;
  return WALK_SEQUENCE[p.walkIndex % WALK_SEQUENCE.length];
}

// ===================
// PLAYERS STATE
// ===================
let myName = "";
myIsHost = false;

let myLastExpelAtMs = 0;  // cooldown

const playersMap = new Map();

// pour toast départ
let prevPlayersSnapshot = new Map(); // uid -> name

function ensurePlayerState(p){
  const prev = playersMap.get(p.uid);
  const x = (typeof p.x === "number") ? p.x : undefined;
  const y = (typeof p.y === "number") ? p.y : undefined;

  // “dead” = player doc OU deadUids persistant room
  const isDead = !!p.isDead || deadUidsSet.has(p.uid);
  const deadAtMs = (typeof p.deadAtMs === "number") ? p.deadAtMs : 0;

  if (!prev){
    playersMap.set(p.uid, {
      uid: p.uid,
      name: p.name || "Joueur",
      isHost: !!p.isHost,
      x, y,
      isDead,
      deadAtMs,
      lastX: x, lastY: y,
      moving: false,
      walkIndex: 0,
      walkTimer: 0,
      lastMoveAt: performance.now()
    });
    return;
  }

  prev.name = p.name || prev.name;
  prev.isHost = !!p.isHost;
  prev.isDead = isDead;
  prev.deadAtMs = deadAtMs;

  if (isDead){
    prev.moving = false;
    prev.walkIndex = 0;
    prev.walkTimer = 0;
  }

  if (typeof x === "number" && typeof y === "number"){

  // 🔒 Si le joueur est mort → on ne met PLUS à jour sa position
  if (!isDead){
    prev.x = x;
    prev.y = y;

    const dx = (prev.lastX ?? x) - x;
    const dy = (prev.lastY ?? y) - y;
    const d = Math.hypot(dx, dy);

    if (d > 0.6){
      prev.moving = true;
      prev.lastMoveAt = performance.now();
    }

    prev.lastX = x;
    prev.lastY = y;
  }
}

function settleRemoteIdle(){
  const now = performance.now();
  for (const [uid, p] of playersMap){
    if (uid === myUid) continue;
    if (p.isDead) continue;
    if (p.moving && now - p.lastMoveAt > 350){
      p.moving = false;
      p.walkIndex = 0;
      p.walkTimer = 0;
    }
  }
}

let lastSend = 0;
async function sendMyPosition(){
  if (!myUid || !roomId) return;
  if (myDead) return;
  if (meetingLockActive) return;

  const now = performance.now();
  if (now - lastSend < SEND_EVERY_MS) return;
  lastSend = now;

  try{
    await updateDoc(doc(db,"rooms",roomId,"players",myUid), {
      x: player.x,
      y: player.y,
      updatedAt: serverTimestamp()
    });
  } catch(e){
    console.log("pos update error:", e);
  }
}

// ===================
// ROLE / TIRAGE AU SORT
// ===================
let spinRunning = false;

function showRoleOverlayBase(){
  if (!roleOverlay) return;
  roleOverlay.classList.add("open");
  roleOverlay.setAttribute("aria-hidden","false");
  if (btnRoleOk) btnRoleOk.style.display = "none";
  if (roleTitle) roleTitle.textContent = "Tirage au sort…";
  if (roleSub) roleSub.textContent = "Ça tourne…";
}
function hideRoleOverlay(){
  if (!roleOverlay) return;
  roleOverlay.classList.remove("open");
  roleOverlay.setAttribute("aria-hidden","true");
}
function setOverlayFace(which){
  if (!roleImg) return;

  // relance anim même en spam
  roleImg.classList.remove("spin");
  void roleImg.offsetWidth;

  roleImg.src = (which === "titruant") ? titruantImgSrc : tinocentImgSrc;
  roleImg.classList.add("spin");
}

function setOverlayFinal(role){
  const isTruant = (role === "titruant");
  if (roleTitle) roleTitle.textContent = "Ton rôle";
  if (roleSub) roleSub.textContent = isTruant ? "Tu es Ti’Truant 😈" : "Tu es Ti’Nocent 😇";
  setOverlayFace(isTruant ? "titruant" : "tinocent");
}
// =========================
// PATCH anti spin infini
// =========================
async function playSpinThenReveal(finalRole){
  if (!roleOverlay) return;

  showRoleOverlayBase();
  spinRunning = true;

  let flip = false;
let delay = 40;           // démarre rapide

const minSpinMs = 2800;   // durée minimum du tirage (~2.8s)
const endMin = performance.now() + minSpinMs;

const timeoutMs = 6000;
const deadline = performance.now() + timeoutMs;

while (performance.now() < deadline){
  flip = !flip;
  setOverlayFace(flip ? "titruant" : "tinocent");

  await sleep(delay);

  // ✅ ralentissement progressif (effet machine à sous)
  delay = Math.min(120, delay + 6);

  if (performance.now() >= endMin && (finalRole || myRole)) break;
}

  const roleToShow = finalRole || myRole;

  if (!roleToShow){
    roleTitle.textContent = "Erreur";
    roleSub.textContent = "Aucun rôle reçu";
    setOverlayFace("tinocent");
    await sleep(1200);
    hideRoleOverlay();
    spinRunning = false;
    return;
  }

  setOverlayFinal(roleToShow);
  await sleep(1400); // ✅ laisse le résultat plus longtemps (au lieu de 900)
  hideRoleOverlay();
  spinRunning = false;
}

// écoute mon privateRole
function listenMyRole(){
  if (!myUid || !roomId) return () => {};
  const ref = doc(db, "rooms", roomId, "privateRoles", myUid);

  const unsub = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;

    const d = snap.data() || {};
    const role = d.role;
    if (!role) return;

   if (!myRole){
  myRole = role;
  setRoleHud(myRole);
  updateMyTaskHud();

  // ✅ SAFE : ne relance pas si déjà ouvert/spinning
  if (phase === "starting" && !spinRunning && roleOverlay && !roleOverlay.classList.contains("open")){
    playSpinThenReveal(null);
  }
}
  });

  return unsub;
}

// HOST: crée les roles (1 truant si 4-8, sinon 2) — ÉQUITABLE
async function hostAssignRoles(players){
  const uids = players.map(p => p.uid).filter(Boolean);

  if (uids.length < 1) throw new Error("no_players");

  const nbPlayers = uids.length;

  // ✅ règle simple :
  // 1 truant si 1 à 8 joueurs, 2 truants au-dessus
  const truantsCount = (nbPlayers <= 8) ? 1 : 2;

  const pool = shuffleCryptoInPlace([...uids]);
  const truants = new Set(pool.slice(0, Math.min(truantsCount, nbPlayers)));

  for (const uid of uids){
    const role = truants.has(uid) ? "titruant" : "tinocent";
    await setDoc(doc(db, "rooms", roomId, "privateRoles", uid), {
      uid, role, updatedAt: serverTimestamp()
    }, { merge: true });
  }

  await updateDoc(doc(db, "rooms", roomId), {
    playersCount: nbPlayers,
    truantsCount: Math.min(truantsCount, nbPlayers),
    tasksTotal: TASKS_TOTAL,
    tasksDone: 0,
    deadUids: []
  }).catch(()=>{});
}

// ===================
// ACTION LOGIC (Expulser / Rapporter / Zones)
// ===================
function getClosestAliveTargetForExpel(){
  const now = performance.now();

  if (expelLockedUid && now < expelLockUntil){
    const p = playersMap.get(expelLockedUid);
    if (p && !p.isDead && typeof p.x === "number" && typeof p.y === "number"){
      const d = dist(player.x, player.y, p.x, p.y);
      if (d <= EXPEL_HIDE_RANGE){
        return { target: p, d };
      }
    }
    expelLockedUid = null;
  }

  let best = null;
  let bestD = Infinity;

  for (const p of playersMap.values()){
    if (!p || p.uid === myUid) continue;
    if (p.isDead) continue;
    if (typeof p.x !== "number" || typeof p.y !== "number") continue;

    const d = dist(player.x, player.y, p.x, p.y);
    if (d < bestD){
      bestD = d;
      best = p;
    }
  }

  if (best && bestD <= EXPEL_SHOW_RANGE){
    expelLockedUid = best.uid;
    expelLockUntil = now + EXPEL_LOCK_MS;
    return { target: best, d: bestD };
  }

  return null;
}

function getClosestDeadBody(){
  let best = null;
  let bestD = Infinity;

  for (const p of playersMap.values()){
    if (!p || p.uid === myUid) continue;
    if (!p.isDead) continue;
    if (typeof p.x !== "number" || typeof p.y !== "number") continue;

    const d = dist(player.x, player.y, p.x, p.y);
    if (d < bestD){
      bestD = d;
      best = p;
    }
  }

  if (best && bestD <= REPORT_RANGE) return { body: best, d: bestD };
  return null;
}

function getClosestZoneNearMe(){
  if (!zones?.length) return null;

  let best = null;
  let bestD = Infinity;

  for (const z of zones){
    const d = dist(player.x, player.y, z.cx, z.cy);
    if (d < bestD){
      bestD = d;
      best = z;
    }
  }

  if (!best) return null;

  const range = getZoneRange(best.id);
  if (bestD <= range) return { zone: best, d: bestD };
  return null;
}

async function doExpulse(targetUid){
  if (!targetUid) return;
  if (targetUid === myUid) return;

  const target = playersMap.get(targetUid);
  if (!target || target.isDead) return;

  if (myRole !== "titruant") return;

  if (!myUid || !roomId) return;
  if (phase !== "started") return;
  if (myDead) return;
  if (meetingLockActive) return;

  const now = Date.now();
  const remain = EXPEL_COOLDOWN_MS - (now - (myLastExpelAtMs || 0));
  if (remain > 0){
    setStartInfo(`Cooldown expulsion: ${Math.ceil(remain/1000)}s`);
    return;
  }

  try{
    await updateDoc(doc(db, "rooms", roomId), {
      deadUids: arrayUnion(targetUid)
    }).catch(()=>{});

    await updateDoc(doc(db, "rooms", roomId, "players", targetUid), {
      isDead: true,
      deadAtMs: now,
      deadBy: myUid
    });

    await updateDoc(doc(db, "rooms", roomId, "players", myUid), {
      lastExpelAtMs: now
    });

    myLastExpelAtMs = now;
  } catch(e){
    console.log("expulse error:", e);
    setStartInfo("Erreur expulsion.");
  }
}

async function doReport(bodyUid){
  if (meetingLockActive) return;
  try{
    await updateDoc(doc(db, "rooms", roomId), {
  chatEnabled: true,
  meetingType: "report",
  meetingAt: serverTimestamp(),
  meetingAtMs: Date.now(),   // ✅ AJOUT IMPORTANT
  meetingBy: myUid,
  reportedBodyUid: bodyUid
});
    });
    setStartInfo("Rapport envoyé.");
  } catch(e){
    console.log("report error:", e);
    setStartInfo("Erreur rapport.");
  }
}

async function doZoneAction(zone){
  if (!zone) return;
  if (meetingLockActive) return;

  if (zone.id === "meeting"){
    try{
      await updateDoc(doc(db, "rooms", roomId), {
        chatEnabled: true,
        meetingType: "meeting",
        meetingAt: serverTimestamp(),
        meetingBy: myUid
      });
      setStartInfo("Réunion lancée (chat activé).");
    } catch(e){
      console.log("meeting error:", e);
      setStartInfo("Erreur réunion.");
    }
    return;
  }

  if (myRole !== "tinocent" || myDead) return;

  const t = currentTask();
  if (!t || t.zoneId !== zone.id){
    setStartInfo("Ce n’est pas ta mission actuelle.");
    return;
  }

  const d = dist(player.x, player.y, zone.cx, zone.cy);
  const range = getZoneRange(zone.id);
if (d > range){
  setStartInfo("Approche-toi encore un peu.");
  return;
}

  startActivityForZone(zone.id);
}

// ===================
// DRAW HELPERS + VIGNETTE + CLIP + FLÈCHE
// ===================
function drawPlayerSprite(px, py, img){
  const size = gameStarted ? SPRITE_SIZE_GAME : SPRITE_SIZE_LOBBY;
  const W = size, H = size;

  const toDraw = (img && img.complete && img.naturalWidth > 0) ? img : spritePose1;
  const foot = FOOT_ADJUST.get(toDraw) ?? FOOT_OFFSET_Y;

  const dx = Math.round(px - W / 2);
  const dy = Math.round(py - H + foot);

  if (toDraw.complete && toDraw.naturalWidth > 0){
    ctx.drawImage(toDraw, dx, dy, W, H);
  } else {
    ctx.fillStyle = "#ff4d4d";
    ctx.beginPath();
    ctx.arc(px, py, 16, 0, Math.PI*2);
    ctx.fill();
  }
}

function roundRectPath(ctx, x, y, w, h, r){
  r = Math.min(r, w/2, h/2);
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
}

// badge “EXPULSÉ”
function drawNameTag(px, py, name, isHost, isDead){
  if (!name) return;

  const main = isHost ? `${name} 👑` : name;
  const sub  = isDead ? "EXPULSÉ" : "";

  const size = gameStarted ? SPRITE_SIZE_GAME : SPRITE_SIZE_LOBBY;
  const y = Math.round(py - size - 18);

  ctx.save();
  ctx.font = "1000 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const metricsMain = ctx.measureText(main);
  const metricsSub  = sub ? ctx.measureText(sub) : { width: 0 };

  const padX = 10;
  const w = Math.ceil(Math.max(metricsMain.width, metricsSub.width) + padX * 2);
  const lines = sub ? 2 : 1;
  const h = lines === 2 ? 40 : 24;

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  roundRectPath(ctx, px - w/2, y - h/2, w, h, 12);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#fff";
  if (!sub){
    ctx.fillText(main, px, y);
  } else {
    ctx.fillText(main, px, y - 9);
    ctx.font = "1000 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.globalAlpha = 0.92;
    ctx.fillText(sub, px, y + 10);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawVignette(){
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w / 2;
  const cy = h / 2;

  const rInner = Math.min(w, h) * 0.50;
  const rOuter = Math.min(w, h) * 0.94;

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  const g = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
  g.addColorStop(0.0, "rgba(0,0,0,0)");
  g.addColorStop(0.62, "rgba(0,0,0,0.18)");
  g.addColorStop(1.0, "rgba(0,0,0,0.72)");

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// flèche “mission” (Ti’Nocent vivant)
function drawTaskArrow(){
  if (phase !== "started") return;
  if (myDead) return;
  if (myRole !== "tinocent") return;
  if (meetingLockActive) return;

  const t = currentTask();
  if (!t) return;

  const z = zones.find(z => z.id === t.zoneId);
  if (!z) return;

  const dx = z.cx - player.x;
  const dy = z.cy - player.y;
  const ang = Math.atan2(dy, dx);

  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const r  = Math.min(window.innerWidth, window.innerHeight) * 0.30;

  const ax = cx + Math.cos(ang) * r;
  const ay = cy + Math.sin(ang) * r;

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.translate(ax, ay);
  ctx.rotate(ang);

  ctx.globalAlpha = 0.58;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(-10, -10);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-10, 10);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#000";
  ctx.stroke();

  ctx.restore();
}

// ===================
// UPDATE / DRAW / LOOP
// ===================
function update(dt){
  // meeting lock => pas de move / pas d’actions
  if (meetingLockActive){
    move.x = 0; move.y = 0;
  }

  if (phase === "starting"){
    move.x = 0; move.y = 0;
  }

  const dtNorm = Math.min(2, dt / 16.6667);

  // mort = joystick pan caméra
  if (myDead && phase === "started" && !meetingLockActive){
    ensureSpectateCamInit();

    const CAM_PAN_SPEED = 7.2;
    specCamX += move.x * CAM_PAN_SPEED * dtNorm;
    specCamY += move.y * CAM_PAN_SPEED * dtNorm;

    const halfW = (window.innerWidth  / ZOOM_GAME) / 2;
    const halfH = (window.innerHeight / ZOOM_GAME) / 2;
    specCamX = clamp(specCamX, halfW, MAP_W - halfW);
    specCamY = clamp(specCamY, halfH, MAP_H - halfH);
  }

  const nx = player.x + move.x * player.speed * dtNorm;
  const ny = player.y + move.y * player.speed * dtNorm;

  const wasWalking = walking;
  walking = !myDead && (Math.abs(move.x) + Math.abs(move.y)) > 0.15 && !meetingLockActive;

  const speed01 = Math.min(1, (Math.abs(move.x) + Math.abs(move.y)) / 1.4);
  const swapMs  = 140 - speed01 * 70;

  if (walking){
    walkTimer += dt;
    if (walkTimer > swapMs){
      walkTimer = 0;
      walkIndex = (walkIndex + 1) % WALK_SEQUENCE.length;
    }
  } else {
    walkTimer = 0;
    walkIndex = 0;
  }

  let moved = false;

  // déplacement vivant
  if (!myDead && !meetingLockActive){
    if (canMoveWorld(nx, player.y)){
      player.x = nx; moved = true;
    }
    if (canMoveWorld(player.x, ny)){
      player.y = ny; moved = true;
    }
  }

  if (moved && (walking || wasWalking)) sendMyPosition();

  // anim remote
  for (const [uid, p] of playersMap){
    if (uid === myUid) continue;
    if (!p.moving) continue;
    if (p.isDead) continue;

    p.walkTimer += dt;
    if (p.walkTimer > 120){
      p.walkTimer = 0;
      p.walkIndex = (p.walkIndex + 1) % WALK_SEQUENCE.length;
    }
  }

  settleRemoteIdle();

  // ACTION UI refresh (map uniquement)
  if (phase !== "started") return;

  if (myDead || activityOpen || meetingLockActive){
    setActionUI({ show:false });
    return;
  }

  const now = Date.now();

  // priorité 1: Rapporter
  const bodyHit = getClosestDeadBody();
  if (bodyHit){
    setActionUI({ show:true, label:"Rapporter", disabled:false });
    actionBtn.onclick = () => doReport(bodyHit.body.uid);
    return;
  }

  // priorité 2: Expulser
  if (myRole === "titruant"){
    const hit = getClosestAliveTargetForExpel();
    if (hit){
      const remain = EXPEL_COOLDOWN_MS - (now - (myLastExpelAtMs || 0));
      if (remain > 0){
        setActionUI({
          show:true,
          label:`Expulser (${Math.ceil(remain/1000)}s)`,
          disabled:true
        });
        actionBtn.onclick = null;
      } else {
        setActionUI({ show:true, label:"Expulser", disabled:false });
        actionBtn.onclick = () => doExpulse(hit.target.uid);
      }
      return;
    }
  }

  // priorité 3: Zones
  const nearZone = getClosestZoneNearMe();
  if (nearZone){
    const z = nearZone.zone;

    if (z.id === "meeting"){
      setActionUI({ show:true, label:"Dénoncer", disabled:false });
      actionBtn.onclick = () => doZoneAction(z);
      return;
    }

    if (myRole === "tinocent"){
      setActionUI({ show:true, label:`Faire: ${z.label}`, disabled:false });
      actionBtn.onclick = () => doZoneAction(z);
      return;
    }
  }

  // rien à faire
  setActionUI({ show:false });
}

// ===================
// LOBBY CAMERA (tablette) : suit le joueur + clamp
// ===================
let lobbyCamX = null;
let lobbyCamY = null;
const LOBBY_CAM_LERP = 0.14; // 0.10-0.18 selon feeling

function lerp(a, b, t){ return a + (b - a) * t; }

function draw(){
  if (!ctx) return;

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0,0,window.innerWidth, window.innerHeight);
  ctx.fillStyle = "#0b3440";
  ctx.fillRect(0,0,window.innerWidth, window.innerHeight);

  // ======================
  // LOBBY
  // ======================
  if (!gameStarted){

    const bgOk = lobbyBgImg.complete && lobbyBgImg.naturalWidth > 0;

    if (!bgOk){
      ctx.fillStyle = "#0b3440";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.font = "900 22px system-ui";
      ctx.fillText("Chargement lobby…", 24, 46);
      return;
    }

    const bg = lobbyBgImg;
    const bw = bg.naturalWidth;
    const bh = bg.naturalHeight;

    const isTabletLandscape =
      window.matchMedia("(min-width: 900px) and (orientation: landscape)").matches;

    const s = isTabletLandscape
      ? (window.innerWidth / bw)
      : Math.max(window.innerWidth / bw, window.innerHeight / bh);

    const scaleX = bw / WORLD_W;
    const scaleY = bh / WORLD_H;

    const viewWorldW = window.innerWidth  / (scaleX * s);
    const viewWorldH = window.innerHeight / (scaleY * s);
    const halfW = viewWorldW / 2;
    const halfH = viewWorldH / 2;

    // === CAMERA TABLETTE ===
    if (isTabletLandscape){

      if (lobbyCamX == null || lobbyCamY == null){
        lobbyCamX = player.x;
        lobbyCamY = player.y;
      }

      let targetCamX = lobbyCamX;
      let targetCamY = lobbyCamY;

      targetCamX = applyDeadZoneToCam(targetCamX, player.x, halfW, LOBBY_DEADZONE_X);
      targetCamY = applyDeadZoneToCam(targetCamY, player.y, halfH, LOBBY_DEADZONE_Y);

      targetCamX = clamp(targetCamX, halfW, WORLD_W - halfW);
      targetCamY = clamp(targetCamY, halfH, WORLD_H - halfH);

      lobbyCamX = lerp(lobbyCamX, targetCamX, LOBBY_CAM_LERP);
      lobbyCamY = lerp(lobbyCamY, targetCamY, LOBBY_CAM_LERP);

    } else {
      lobbyCamX = null;
      lobbyCamY = null;
    }

    let ox, oy;

    if (isTabletLandscape){
      const camIx = lobbyCamX * scaleX;
      const camIy = lobbyCamY * scaleY;

      ox = window.innerWidth  / 2 - camIx * s;
      oy = window.innerHeight / 2 - camIy * s;

      const minOx = window.innerWidth  - bw * s;
      const minOy = window.innerHeight - bh * s;
      ox = clamp(ox, minOx, 0);
      oy = clamp(oy, minOy, 0);
    } else {
      ox = (window.innerWidth  - bw * s) / 2;
      oy = (window.innerHeight - bh * s) / 2;
    }

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);

    ctx.drawImage(bg, 0, 0, bw, bh);

    const arr = Array.from(playersMap.values())
      .map(p => ({
        ...p,
        wx: (p.uid === myUid) ? player.x : (typeof p.x === "number" ? p.x : player.x),
        wy: (p.uid === myUid) ? player.y : (typeof p.y === "number" ? p.y : player.y),
      }))
      .sort((a,b) => a.wy - b.wy);

    for (const p of arr){
      const ix = p.wx * scaleX;
      const iy = p.wy * scaleY;

      const sprite = (p.isDead)
        ? pleurImg
        : ((p.uid === myUid) ? getLocalSprite() : getRemoteSprite(p));

      drawPlayerSprite(ix, iy, sprite);
      drawNameTag(ix, iy, p.name, !!p.isHost, !!p.isDead);
    }

    ctx.restore();
    return;
  }

  // ======================
  // GAME
  // ======================

  const targetX = myDead ? (specCamX ?? player.x) : player.x;
  const targetY = myDead ? (specCamY ?? player.y) : player.y;

  camX += (targetX - camX) * CAM_LERP;
  camY += (targetY - camY) * CAM_LERP;

  const halfW = (window.innerWidth  / ZOOM_GAME) / 2;
  const halfH = (window.innerHeight / ZOOM_GAME) / 2;

  camX = clamp(camX, halfW, MAP_W - halfW);
  camY = clamp(camY, halfH, MAP_H - halfH);

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  ctx.translate(window.innerWidth / 2, window.innerHeight / 2);
  ctx.scale(ZOOM_GAME, ZOOM_GAME);
  ctx.translate(-camX, -camY);

  if (mapImg.complete && mapImg.naturalWidth > 0){
    ctx.drawImage(mapImg, 0, 0, MAP_W, MAP_H);
  } else {
    ctx.fillStyle = "#0b3440";
    ctx.fillRect(0, 0, MAP_W, MAP_H);
  }

  const visR = getVisionRadiusWorld();
  const clipCX = myDead ? camX : player.x;
  const clipCY = myDead ? camY : player.y;

  ctx.save();
  ctx.beginPath();
  ctx.arc(clipCX, clipCY, visR, 0, Math.PI * 2);
  ctx.clip();

  const arr = Array.from(playersMap.values())
    .map(p => ({
      ...p,
      drawX: (p.uid === myUid) ? player.x : (typeof p.x === "number" ? p.x : player.x),
      drawY: (p.uid === myUid) ? player.y : (typeof p.y === "number" ? p.y : player.y),
    }))
    .sort((a,b) => a.drawY - b.drawY);

  for (const p of arr){
    const sprite = (p.isDead)
      ? pleurImg
      : ((p.uid === myUid) ? getLocalSprite() : getRemoteSprite(p));

    drawPlayerSprite(p.drawX, p.drawY, sprite);
    drawNameTag(p.drawX, p.drawY, p.name, !!p.isHost, !!p.isDead);
  }

  ctx.restore();
  ctx.restore();

  drawVignette();
  drawTaskArrow();
}

function loop(t){
  if (!lastT) lastT = t;
  const dt = t - lastT;
  lastT = t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

// ===================
// JOYSTICK
// ===================
const stick = joy?.querySelector(".stick");

let active = false;
let pointerId = null;
let center = { x: 0, y: 0 };
const max = 40;

function setStick(dx, dy){
  if (!stick) return;
  stick.style.transform = `translate(${dx}px, ${dy}px)`;
}

function endJoystick(){
  active = false;
  pointerId = null;
  move.x = 0;
  move.y = 0;
  setStick(0, 0);
}

joy?.addEventListener("pointerdown", (e) => {
  if (!joy) return;
  if (phase === "starting") return;
  if (activityOpen) return;
  if (meetingLockActive) return;

  active = true;
  pointerId = e.pointerId;
  joy.setPointerCapture(pointerId);

  const r = joy.getBoundingClientRect();
  center.x = r.left + r.width / 2;
  center.y = r.top + r.height / 2;

  e.preventDefault();
}, { passive: false });

joy?.addEventListener("pointermove", (e) => {
  if (!active) return;
  if (pointerId !== null && e.pointerId !== pointerId) return;
  if (meetingLockActive) return;

  let dx = e.clientX - center.x;
  let dy = e.clientY - center.y;

  const d = Math.hypot(dx, dy);
  if (d > max){
    dx = dx * (max / d);
    dy = dy * (max / d);
  }

  setStick(dx, dy);
  move.x = dx / max;
  move.y = dy / max;

  e.preventDefault();
}, { passive: false });

joy?.addEventListener("pointerup", (e) => {
  if (pointerId !== null && e.pointerId !== pointerId) return;
  endJoystick();
});
joy?.addEventListener("pointercancel", (e) => {
  if (pointerId !== null && e.pointerId !== pointerId) return;
  endJoystick();
});
window.addEventListener("blur", endJoystick);

// ===================
// CHAT LIVE
// ===================
function renderChat(messages){
  if (!chatMessagesEl) return;
  chatMessagesEl.innerHTML = "";

  for (const m of messages){
    const div = document.createElement("div");
    div.className = "chat-msg" + (m.uid === myUid ? " me" : "");
    div.innerHTML = `
      <div class="chat-meta">${escapeHTML(m.name || "Joueur")}</div>
      <div class="chat-text">${escapeHTML(m.text || "")}</div>
    `;
    chatMessagesEl.appendChild(div);
  }
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

async function sendChat(text){
  const t = (text || "").trim();
  if (!t || !roomId || !myUid) return;
  await addDoc(collection(db, "rooms", roomId, "messages"), {
    uid: myUid,
    name: myName || "Joueur",
    text: t,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now()
  });
}

// ===================
// FIREBASE (STRUCTURE PROPRE)
// 1 snapshot room + 1 snapshot players + 1 snapshot chat
// + bind start/leave/chat submit une seule fois
// ===================
let unsubRoom = null;
let unsubPlayers = null;
let unsubChat = null;

let startBtnBound = false;
let adminBtnBound = false;   // ✅ AJOUT
let leaveBtnBound = false;
let chatBound = false;

// cache status room accessible dans players snapshot
let roomStatusCache = null;
let unsubMyRole = null;
let localPosReady = false;

function canMoveLobby(nx, ny){
  const R = PLAYER_RADIUS_LOBBY;
  return (
    isWalkableLobby(nx, ny) &&
    isWalkableLobby(nx - R, ny) &&
    isWalkableLobby(nx + R, ny) &&
    isWalkableLobby(nx, ny - R) &&
    isWalkableLobby(nx, ny + R)
  );
}

function findSpawnNearLobbyCenter(){
  const cx = WORLD_W * 0.5;
  const cy = WORLD_H * 0.5;

  const step = 14;
  const maxR = 420;

  // spiral autour du centre
  for (let r = 0; r <= maxR; r += step){
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12){
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (canMoveLobby(x, y)) return { x, y };
    }
  }

  // fallback centre
  return { x: cx, y: cy };
}

async function ensureSpawnCenter(){
  if (!myUid || !roomId) return;

  // Choix du monde selon l’état actuel
  const inGame = (phase === "started"); // ou gameStarted

  // Trouve un point walkable près du centre
  const pos = inGame ? findSpawnNearCenter() : findSpawnNearLobbyCenter();

  // Applique localement
  player.x = pos.x;
  player.y = pos.y;

  // Reset cam spectateur
  specCamX = null;
  specCamY = null;

  // Enregistre sur Firestore (comme ça tout le monde te voit au bon endroit)
  try{
    await updateDoc(doc(db,"rooms",roomId,"players",myUid), {
      x: player.x,
      y: player.y,
      updatedAt: serverTimestamp()
    });
  } catch(e){
    console.log("ensureSpawnCenter updateDoc error:", e);
  }
}

function refreshChatGating(status){
  if (!chatOverlay) return;

  // Lobby / Starting => chat libre
  if (status !== "started"){
    chatCanViewNow = true;
    chatCanWriteNow = true;
  }
  else {
    // En jeu
    chatCanViewNow = !!roomChatEnabled;
    chatCanWriteNow = !!roomChatEnabled && !myDead;
  }

  setChatFabVisible(chatCanViewNow);
  applyChatWriteLock();

  if (!chatCanViewNow && chatOverlay.classList.contains("open")){
    closeChat(true);
  }
}

function checkEndConditions(){ /* TODO */ }

onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = "./login.html"; return; }
  if (!roomId) { setStartInfo("⚠️ Code de partie manquant."); return; }

  myUid = u.uid;

  isAdmin = ADMIN_UIDS.has(myUid);

// Affiche le diamant seulement si admin (mais on attend aussi de savoir si host via room snapshot)
if (btnAdminStart){
  // ✅ admin voit toujours le diamant, même si pas host
  btnAdminStart.style.display = isAdmin ? "grid" : "none";

  // ✅ au cas où un CSS le met derrière
  btnAdminStart.style.zIndex = "999";
  btnAdminStart.style.pointerEvents = "auto";
}
  
  // écoute mon rôle (1 fois)
  if (!unsubMyRole) unsubMyRole = listenMyRole();

  // ===================
// START button (bind 1 fois)
// ===================
if (!startBtnBound){
  startBtnBound = true;

  btnStart?.addEventListener("click", async (e) => {
    e.preventDefault();

    const n = playersMap.size;

    // ✅ Start normal = 4 joueurs minimum
    if (n < 4){
      setStartInfo(`Il faut au moins 4 joueurs (actuellement ${n}).`);
      return;
    }

    setStartInfo("");

    try{
      await updateDoc(doc(db, "rooms", roomId), {
        status: "starting",
        startingAt: serverTimestamp(),
        chatEnabled: false,
        tasksTotal: TASKS_TOTAL,
        tasksDone: 0,
        deadUids: [],
        meetingType: null,
        meetingAt: null,
        meetingBy: null,
        reportedBodyUid: null
      });

      const snapPlayers = await getDocs(collection(db, "rooms", roomId, "players"));
      const players = snapPlayers.docs.map(d => d.data());

      await hostAssignRoles(players);

      await sleep(3200);

      await updateDoc(doc(db, "rooms", roomId), {
        status: "started",
        startedAt: serverTimestamp()
      });

    } catch (err){
      console.log("START ERROR:", err);
      setStartInfo(`Erreur démarrage: ${err?.code || ""} ${err?.message || err}`);
    }
  });
}

// ===================
// ADMIN FORCE START (diamant) (bind 1 fois)
// ===================
if (!adminBtnBound){
  adminBtnBound = true;

  btnAdminStart?.addEventListener("click", async (e) => {
    e.preventDefault();

    if (!isAdmin){
      setStartInfo("Réservé admin.");
      return;
    }
    if (!myIsHost){
      setStartInfo("Tu dois être l’hôte pour forcer le démarrage.");
      return;
    }

    const n = playersMap.size;
    if (n < 1){
      setStartInfo("Aucun joueur dans la room.");
      return;
    }

    setStartInfo("🧪 Mode test : démarrage forcé (même si vous êtes moins de 4). Le jeu se comporte ensuite comme une partie normale.");

    try{
      await updateDoc(doc(db, "rooms", roomId), {
        status: "starting",
        startingAt: serverTimestamp(),
        chatEnabled: false,
        tasksTotal: TASKS_TOTAL,
        tasksDone: 0,
        deadUids: [],
        meetingType: null,
        meetingAt: null,
        meetingBy: null,
        reportedBodyUid: null
      });

      const snapPlayers = await getDocs(collection(db, "rooms", roomId, "players"));
      const players = snapPlayers.docs.map(d => d.data());

      // ✅ roles même si 1/2/3 joueurs
      await hostAssignRoles(players);

      await sleep(3200);

      await updateDoc(doc(db, "rooms", roomId), {
        status: "started",
        startedAt: serverTimestamp()
      });

    } catch (err){
      console.log("ADMIN FORCE START ERROR:", err);
      setStartInfo(`Erreur: ${err?.code || ""} ${err?.message || err}`);
    }
  });
}

  // ===================
  // LEAVE button (bind 1 fois)
  // ===================
  if (!leaveBtnBound){
    leaveBtnBound = true;

    btnLeave?.addEventListener("click", async ()=>{
      try{
        await deleteDoc(doc(db,"rooms",roomId,"players",myUid));
        const roomSnap = await getDoc(doc(db,"rooms",roomId));
        const room = roomSnap.data();
        if (room?.hostUid === myUid){
          await deleteDoc(doc(db,"rooms",roomId));
        }
      } catch(e){
        console.log("leave error:", e);
      }
      window.location.href = "./game.html";
    });
  }

  // ===================
  // CHAT snapshot + submit (1 fois)
  // ===================
  if (!chatBound && chatForm && chatInput){
    chatBound = true;

    const q = query(
      collection(db, "rooms", roomId, "messages"),
      orderBy("createdAtMs", "asc"),
      limit(120)
    );

    unsubChat = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => d.data());
      renderChat(msgs);

      // badge unread
      const canBadge = (phase !== "started") ? true : chatCanViewNow;
      if (msgs.length && canBadge && !chatOverlay?.classList.contains("open")){
        const last = msgs[msgs.length - 1];
        if (last?.uid && last.uid !== myUid){
          chatFab?.classList.add("has-unread");
          if (chatBadge) chatBadge.hidden = false;
        }
      }
    }, (err) => console.log("chat snapshot error:", err));

    chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!chatCanWriteNow) return;

      const val = chatInput.value;
      chatInput.value = "";
      try { await sendChat(val); }
      catch (err) { console.log("chat send error:", err); }
    });
  }

  // ===================
  // ROOM snapshot (1 seul)
  // ===================
  if (!unsubRoom){
    unsubRoom = onSnapshot(doc(db,"rooms",roomId), async (snap)=>{
      if (!snap.exists()){
        alert("Partie supprimée");
        location.href="./game.html";
        return;
      }

      const room = snap.data() || {};
      const status = room.status || "lobby";
      roomStatusCache = status;

      // flags room
      roomChatEnabled = !!room.chatEnabled;

      // deadUids persistant
      const deadArr = Array.isArray(room.deadUids) ? room.deadUids : [];
      deadUidsSet = new Set(deadArr);

      // tasks global
      roomTasksDone = (typeof room.tasksDone === "number") ? room.tasksDone : 0;
      const tasksTotalRoom = (typeof room.tasksTotal === "number") ? room.tasksTotal : TASKS_TOTAL;
      setGlobalTasksProgress(roomTasksDone, tasksTotalRoom);

      // host
      myIsHost = (room.hostUid === myUid);
      if (btnStart) btnStart.style.display = myIsHost ? "" : "none";

// IMPORTANT: admin-fab est display:none en CSS, donc pour l'afficher il faut "grid"
if (btnAdminStart){
  btnAdminStart.style.display = (isAdmin && myIsHost) ? "grid" : "none";
}

      // meeting/report (lock + splash)
      handleMeetingState(room, status);
      
// --- vote state depuis Firestore ---
const voteActive = !!room.voteActive;
const voteAtMs   = tsToMs(room.voteAt);
const voteDurMs  = (typeof room.voteDurMs === "number") ? room.voteDurMs : VOTE_MS;
const voteRound  = (typeof room.voteRound === "number") ? room.voteRound : 0;

// UI vote pour tout le monde (sauf morts si tu veux)
if (status === "started" && voteActive && voteAtMs){
  const endVoteMs = voteAtMs + voteDurMs;

  // ouvre l'UI vote si pas déjà ouverte
  if (!voteUiOpen && !myDead){
    openVoteUI(endVoteMs);
  }
} else {
  // si le vote n'est plus actif, on ferme l'UI
  if (voteUiOpen) hideVoteUI();
}

if (
  typeof voteActive !== "undefined" &&
  typeof voteAtMs !== "undefined" &&
  typeof voteRound !== "undefined" &&
  typeof voteDurMs !== "undefined" &&
  typeof hostTallyAndApplyVote === "function" &&
  voteActive && voteAtMs && voteRound
){
  hostTallyAndApplyVote({ room, voteAtMs, voteDurMs, voteRound });
}
     // END screen (safe)
try { checkEndConditions(room); } catch(_) {}

// ✅ switch d'état propre
if (status === "starting") {
  // ne force PAS spinRunning=false ici, sinon ça casse l'anim si plusieurs snapshots arrivent
  setStartingMode();

  // ✅ IMPORTANT : déclenche le spin dès qu'on ENTRE en starting
  // (même si myRole a déjà été reçu avant)
  if (!spinRunning && !roleOverlay.classList.contains("open")) {
  playSpinThenReveal(null);
}
}
else if (status === "started") {
  // en jeu -> on ferme l'overlay de tirage
  spinRunning = false;
  hideRoleOverlay();
  setGameMode();
}
else {
  spinRunning = false;
  hideRoleOverlay();
  setLobbyMode();
}

      // gating chat
      refreshChatGating(status);

      // spawn on change status
      if (lastRoomStatus !== status){
        await ensureSpawnCenter();
      }
      lastRoomStatus = status;
    });
  }

  // ===================
  // PLAYERS snapshot (1 seul)
  // ===================
  if (!unsubPlayers){
    unsubPlayers = onSnapshot(collection(db,"rooms",roomId,"players"), async (snap)=>{
      const status = roomStatusCache || lastRoomStatus || "lobby";
      const players = snap.docs.map(d=>d.data());

      // toast “X a quitté”
      const nowMap = new Map(players.map(p => [p.uid, p.name || "Joueur"]));
      if (prevPlayersSnapshot.size){
        for (const [uid, name] of prevPlayersSnapshot.entries()){
          if (!nowMap.has(uid) && uid !== myUid){
            showLeaveToast(`${name} a quitté la partie`);
          }
        }
      }
      prevPlayersSnapshot = nowMap;

      renderPlayers(players);

      // maj playersMap
      for (const p of players) ensurePlayerState(p);

      // cleanup disconnected
      const live = new Set(players.map(p => p.uid));
      for (const uid of Array.from(playersMap.keys())){
        if (!live.has(uid)) playersMap.delete(uid);
      }

      // me
      const me = players.find(p => p.uid === myUid);
      if (me?.name) myName = me.name;

      if (me){
        const wasDead = myDead;

        myDead = !!me.isDead || deadUidsSet.has(myUid);
        myLastExpelAtMs = (typeof me.lastExpelAtMs === "number")
          ? me.lastExpelAtMs
          : (myLastExpelAtMs || 0);

        if (!wasDead && myDead){
          showSelfExpelledCard(10_000);
          setCanvasInteract(true);

          specCamX = (typeof me.x === "number") ? me.x : player.x;
          specCamY = (typeof me.y === "number") ? me.y : player.y;

          updateMyTaskHud();
          try{ closeActivityUI(); } catch(_) {}
        }

        if (wasDead && !myDead){
          specCamX = null; specCamY = null;
          setCanvasInteract(false);
        }

        // position locale init
        if (!localPosReady){
          if (typeof me.x === "number" && typeof me.y === "number"){
            player.x = me.x;
            player.y = me.y;
          } else {
            await ensureSpawnCenter();
          }
          localPosReady = true;
        }

        // moi dans playersMap avec coords locales
        ensurePlayerState({ ...me, x: player.x, y: player.y });

        // gating chat après myDead connu
        refreshChatGating(status);

        // tasks uniquement en started + nocent + vivant
        if (status === "started" && myRole === "tinocent" && !myDead){
          await ensureMyTasksAssigned();
        }

        updateMyTaskHud();
      }

      startLoopOnce();
    });
  }
});
