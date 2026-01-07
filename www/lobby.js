// lobby.js (MODULE) — Lobby (lobby.png + lobby-NB.png) -> Game (map.png + collisions.png)
// + Tirage au sort animé (rapide -> ralenti -> rôle final) + auto start
// + Zones activité = obstacles
// + Vignette (noir autour) sur MAP uniquement
// + HUD rôle en haut à droite
// + Chat: lobby = toujours / map = seulement si room.chatEnabled === true
// + ✅ Expulser (Ti’Truant) + cooldown 60s
// + ✅ Joueur expulsé = ne bouge plus + sprite pleur.png
// + ✅ Message “Vous avez été expulsé” côté expulsé
// + ✅ Joueur expulsé: perso fixe, MAIS peut “pan” la caméra pour observer (drag sur canvas + joystick)
// + ✅ Joueur expulsé: chat = lecture seule (peut voir / ne peut pas écrire)
// + ✅ Icône chat: visible lobby / en game seulement si room.chatEnabled === true (vivant ou mort)
// + ✅ Rapporter (près d’un joueur expulsé)
// + ✅ Bouton activité (Ti’Nocent) selon zones (rouge = dénoncer)
// + ✅ Personnages visibles uniquement dans le champ de vision (map visible partout)
// + ✅ Tirage équitable (host = même proba)
// + ✅ Hint “Zone activité” supprimé
// + ✅ Système de tâches Ti’Nocent: liste aléatoire + flèche + jauge globale (progression commune)
// + ✅ FIX: expulsion “revient debout” -> deadUids persistant côté room
// + ✅ FIX: bouton Expulser qui clignote -> hystérésis + lock cible
// + ✅ FIX: FOV téléphone trop petit -> FOV augmenté
// + ✅ FIX: player caché en bas de map -> FOV centré sur le player (pas sur caméra clamp)
// + ✅ HUD missions sous le rôle (pas au-dessus des persos)
// + ✅ Micro-activités (mini overlays) pour chaque zone (style “crew tasks” sans copier)
// + ✅ Toast: “X a quitté la partie”
// + ✅ Badge sous pseudo: “EXPULSÉ” sur les morts
// + ✅ NEW: Splash report "expulsion.png" (30s) -> chat forcé + débat 60s (lock map)

import * as AuthMod from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  doc, getDoc, updateDoc, onSnapshot, collection, deleteDoc, serverTimestamp,
  addDoc, query, orderBy, limit, getDocs, setDoc, increment, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const auth = AuthMod.auth;
const db   = AuthMod.db;

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
// ===================
// DOM
// ===================
const roomCodeEl = document.getElementById("roomCode");
const playersEl  = document.getElementById("playersList");
const btnStart   = document.getElementById("btnStart");
const btnLeave   = document.getElementById("btnLeave");

// message start (si absent => alert fallback)
const startInfo = document.getElementById("startInfo");
function setStartInfo(msg){
  console.log("[START INFO]", msg || "");
  if (startInfo) startInfo.textContent = msg || "";
  else if (msg) alert(msg);
}

// ROLE OVERLAY (déjà dans ton HTML)
const roleOverlay = document.getElementById("roleOverlay");
const roleImg     = document.getElementById("roleImg");
const roleTitle   = document.getElementById("roleTitle");
const roleSub     = document.getElementById("roleSub");
const btnRoleOk   = document.getElementById("btnRoleOk"); // pas utilisé (auto)

// chat
const chatFab      = document.getElementById("btnChatToggle");
const chatBadge    = document.getElementById("chatBadge");
const chatOverlay  = document.getElementById("chatOverlay");
const btnChatClose = document.getElementById("btnChatClose");

// chat DOM
const chatMessagesEl = document.getElementById("chatMessages");
const chatForm  = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

// CANVAS (SAFE)
const canvas = document.getElementById("gameCanvas");
const ctx = canvas?.getContext?.("2d") || null;

if (!canvas || !ctx){
  console.warn("[lobby.js] Canvas introuvable (#gameCanvas). Le lobby ne pourra pas se dessiner.");
}

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
// HELPERS
// ===================
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function escapeHTML(s=""){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderPlayers(players){
  if (!playersEl) return;
  playersEl.innerHTML = players.map(p => {
    const crown = p.isHost ? " 👑" : "";
    return `<div class="player">${escapeHTML(p.name || "Joueur")}${crown}</div>`;
  }).join("");
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

if (!globalThis.crypto?.getRandomValues){
  console.warn("crypto.getRandomValues indisponible → tirage moins fiable");
}

function cryptoRandInt(maxExclusive){
  const arr = new Uint32Array(1);
  const limit = Math.floor(0xFFFFFFFF / maxExclusive) * maxExclusive;
  let x;
  do {
    crypto.getRandomValues(arr);
    x = arr[0];
  } while (x >= limit);
  return x % maxExclusive;
}

function shuffleCryptoInPlace(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = cryptoRandInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function dist(a,b,c,d){ return Math.hypot(a-c, b-d); }

function setChatFabVisible(show){
  if (!chatFab) return;
  chatFab.style.display = show ? "" : "none";
  if (!show){
    chatFab.classList.remove("has-unread");
    if (chatBadge) chatBadge.hidden = true;
    if (chatOverlay?.classList.contains("open")) closeChat();
  }
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

if (roomCodeEl) roomCodeEl.textContent = roomId || "----";

if (!roomId){
  setStartInfo("⚠️ Aucun code room dans l’URL (ex: lobby.html?room=ABCD).");
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

  <div id="myTaskLine" style="margin-top:10px; display:none; gap:10px; align-items:center;">
    <div id="myTaskText" style="font:900 12px system-ui; opacity:.95; flex:1;">—</div>
    <button id="btnTaskDone" type="button" style="
      appearance:none; border:0; padding:10px 12px; border-radius:12px;
      font:900 12px system-ui; color:#000; background: rgba(255,255,255,.85);
    ">Valider</button>
  </div>

  <div id="myTaskList" style="margin-top:8px; display:none; font:800 11px system-ui; opacity:.92; line-height:1.35;"></div>
`;
document.body.appendChild(tasksHud);

const tasksCountEl = tasksHud.querySelector("#tasksCount");
const tasksBarEl   = tasksHud.querySelector("#tasksBar");
const myTaskLineEl = tasksHud.querySelector("#myTaskLine");
const myTaskTextEl = tasksHud.querySelector("#myTaskText");
const btnTaskDone  = tasksHud.querySelector("#btnTaskDone");
const myTaskListEl = tasksHud.querySelector("#myTaskList");

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
  myTaskLineEl.style.display = showPersonal ? "" : "none";
  myTaskListEl.style.display = showPersonal ? "" : "none";
  if (!showPersonal) return;

  if (!t){
    myTaskTextEl.textContent = "Ta mission: —";
    myTaskListEl.textContent = "";
    return;
  }

  myTaskTextEl.textContent = `Ta mission: ${t.label}`;

  const list = myTasks.map((x, i) => {
    const done = i < myTaskIndex;
    const cur  = i === myTaskIndex;
    const prefix = done ? "✅" : (cur ? "➡️" : "•");
    return `${prefix} ${x.label}`;
  }).join("<br/>");
  myTaskListEl.innerHTML = list;
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
  activityOverlay.style.display = "none";
  activityBodyEl.innerHTML = "";
}
activityCloseBtn?.addEventListener("click", closeActivityUI);
activityOverlay.addEventListener("click", (e) => { if (e.target === activityOverlay) closeActivityUI(); });

// mini-jeu: “taper les pastilles dans l’ordre”
function startTapOrderMiniGame({ steps = 6 } = {}){
  const order = Array.from({length: steps}, (_,i)=>i+1);
  shuffleCryptoInPlace(order);

  let need = 1;

  const wrap = document.createElement("div");
  wrap.style.cssText = `display:flex; flex-wrap:wrap; gap:10px; justify-content:center;`;

  function setProgress(){
    const pct = ((need-1)/steps)*100;
    activityBarEl.style.width = `${pct}%`;
    activitySubEl.textContent = `Tape ${need} sur ${steps}`;
  }

  for (let n=1; n<=steps; n++){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(n);
    btn.style.cssText = `
      width: 64px; height: 64px;
      border-radius: 16px;
      appearance:none; border:0;
      font: 1000 18px system-ui;
      color: #000;
      background: rgba(255,255,255,.85);
      box-shadow: 0 10px 22px rgba(0,0,0,.25);
    `;
    btn.addEventListener("click", async () => {
      if (activityDone) return;

      if (n !== need){
        need = 1;
        setProgress();
        return;
      }

      btn.style.opacity = "0.45";
      btn.disabled = true;
      need++;
      setProgress();

      if (need > steps){
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

  const children = Array.from(wrap.children);
  children.sort(() => (cryptoRandInt(2) ? 1 : -1));
  wrap.innerHTML = "";
  for (const c of children) wrap.appendChild(c);

  activityBodyEl.appendChild(wrap);
  setProgress();
}

function startActivityForZone(zoneId){
  if (zoneId === "imagerie"){ openActivityUI("Imagerie", "Scanne les repères dans l’ordre"); startTapOrderMiniGame({ steps: 6 }); return; }
  if (zoneId === "labo"){ openActivityUI("Labo", "Valide la série d’échantillons"); startTapOrderMiniGame({ steps: 5 }); return; }
  if (zoneId === "pharma"){ openActivityUI("Pharma", "Prépare la séquence de doses"); startTapOrderMiniGame({ steps: 6 }); return; }
  if (zoneId === "exam"){ openActivityUI("Anamnèse", "Classe les infos dans l’ordre"); startTapOrderMiniGame({ steps: 5 }); return; }
  if (zoneId === "soins"){ openActivityUI("Soins", "Stabilise le patient (séquence)"); startTapOrderMiniGame({ steps: 6 }); return; }
  if (zoneId === "admin"){ openActivityUI("Dossiers", "Valide les documents"); startTapOrderMiniGame({ steps: 5 }); return; }
  if (zoneId === "rcp"){ openActivityUI("RCP", "Confirme les étapes"); startTapOrderMiniGame({ steps: 5 }); return; }
  openActivityUI("Activité", "Mini-jeu à brancher");
  startTapOrderMiniGame({ steps: 5 });
}

// valider tâche
async function completeCurrentTask(){
  if (!myUid || !roomId) return;
  if (phase !== "started") return;
  if (myDead) return;
  if (myRole !== "tinocent") return;

  const t = currentTask();
  if (!t) return;

  const z = zones.find(z => z.id === t.zoneId);
  if (!z){ setStartInfo("Zone de mission introuvable."); return; }

  const d = dist(player.x, player.y, z.cx, z.cy);
  if (d > ZONE_RANGE){ setStartInfo("Va sur la zone indiquée (flèche)."); return; }

  try{
    const nextIndex = myTaskIndex + 1;

    await updateDoc(doc(db, "rooms", roomId), { tasksDone: increment(1) });

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

    setStartInfo("");
  } catch(e){
    console.log("completeCurrentTask error:", e);
    setStartInfo("Erreur validation mission.");
  }
}

btnTaskDone?.addEventListener("click", () => {
  if (myRole !== "tinocent" || myDead || phase !== "started") return;
  const t = currentTask();
  if (!t) return;
  startActivityForZone(t.zoneId);
});

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
const REPORT_RANGE  = 86;
const ZONE_RANGE    = 92;

// Expulse anti-flicker (hystérésis + lock)
const EXPEL_SHOW_RANGE = 84;
const EXPEL_HIDE_RANGE = 104;
const EXPEL_LOCK_MS    = 240;

let expelLockedUid = null;
let expelLockUntil = 0;

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

  if (chatCanWriteNow){
    setTimeout(() => chatInput?.focus?.(), 80);
  }
}
function closeChat(){
  if (meetingLockActive) return; // ✅ pendant débat: impossible de fermer
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
btnChatClose?.addEventListener("click", closeChat);
chatOverlay?.addEventListener("click", (e) => { if (e.target === chatOverlay) closeChat(); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeChat(); });

// ===================
// CANVAS SETUP (DPR SAFE iPhone)
// ===================
let DPR = window.devicePixelRatio || 1;

function resize(){
  if (!canvas || !ctx) return; // évite crash si canvas absent

  DPR = window.devicePixelRatio || 1;
  canvas.width  = Math.floor(window.innerWidth * DPR);
  canvas.height = Math.floor(window.innerHeight * DPR);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

resize();
window.addEventListener("resize", resize);

// ===================
// GAME STATE
// ===================
let gameStarted = false;
let loopRunning = false;
let phase = "lobby";
let lastRoomStatus = null;

// room flags
let roomChatEnabled = false;

// deadUids persistant (anti “revient debout”)
let deadUidsSet = new Set();

// ===================
// MEETING / REPORT SPLASH (expulsion.png) + LOCK CHAT
// ===================
const REPORT_SPLASH_MS = 10_000; // écran expulsion visible (10s)
const DEBATE_MS        = 60_000; // débat chat forcé (60s)

let meetingLockActive = false;
let meetingAtMsLocal = 0;
let meetingTimers = { splash:null, debate:null, tick:null };

function clearMeetingTimers(){
  clearTimeout(meetingTimers.splash);
  clearTimeout(meetingTimers.debate);
  clearInterval(meetingTimers.tick);
  meetingTimers.splash = meetingTimers.debate = meetingTimers.tick = null;
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

// (reportOverlay / reportCard / reportLine1 / debatePill : inchangés)

// lock
function setMeetingLock(on){
  meetingLockActive = !!on;

  if (meetingLockActive){
    setActionUI({ show:false });
    closeActivityUI();
    joy?.classList.add("is-hidden");
  } else {
    if (phase === "started") joy?.classList.remove("is-hidden");
  }
}

// SAFE: évite crash si les éléments report UI n’existent pas dans le DOM
const reportOverlay = document.getElementById("reportOverlay");
const reportCard    = document.getElementById("reportCard");
const reportLine1   = document.getElementById("reportLine1");
const debatePill    = document.getElementById("debatePill");

function safeSet(el, prop, value){
  if (el) el[prop] = value;
}
function safeStyle(el, prop, value){
  if (el) el.style[prop] = value;
}

function showReportSplash(bodyName, meetingAtMs){
  safeSet(reportLine1, "textContent", bodyName ? `${bodyName} a été expulsé` : "Un Ti’Doc a été expulsé…");
  safeStyle(reportOverlay, "display", "flex");

requestAnimationFrame(() => {
  if (reportCard){
    reportCard.style.transition = "transform 260ms cubic-bezier(.2,.9,.2,1), opacity 260ms ease";
    reportCard.style.transform = "translateY(0px) scale(1)";
    reportCard.style.opacity = "1";
  }
});

  const endSplash = meetingAtMs + REPORT_SPLASH_MS;
  const endDebate = endSplash + DEBATE_MS;

  clearMeetingTimers();

  meetingTimers.tick = setInterval(() => {
    const now = Date.now();

    if (now < endSplash) return;

    if (now < endDebate){
      const s = Math.max(0, Math.ceil((endDebate - now)/1000));
      debatePill.style.display = "";
      debatePill.textContent = `Débat : ${s}s`;
      return;
    }

    debatePill.style.display = "none";
    clearMeetingTimers();
  }, 250);

  meetingTimers.splash = setTimeout(() => {
    reportOverlay.style.display = "none";
    forceOpenChat(); // ✅ ouverture forcée après le splash
  }, REPORT_SPLASH_MS);

  meetingTimers.debate = setTimeout(() => {
    debatePill.style.display = "none";
    setMeetingLock(false);
  }, REPORT_SPLASH_MS + DEBATE_MS);
}

function hideReportSplash(){
  reportOverlay.style.display = "none";
}

function handleMeetingState(room, status){
  if (status !== "started"){
    setMeetingLock(false);
    hideReportSplash();
    debatePill.style.display = "none";
    clearMeetingTimers();
    meetingAtMsLocal = 0;
    return;
  }

  const meetingType = room?.meetingType || "";
  const meetingAtMs = tsToMs(room?.meetingAt);
  const bodyUid = room?.reportedBodyUid || "";
  const hasMeeting = !!meetingAtMs && (meetingType === "report" || meetingType === "meeting");

  if (!hasMeeting){
    setMeetingLock(false);
    hideReportSplash();
    debatePill.style.display = "none";
    clearMeetingTimers();
    meetingAtMsLocal = 0;
    return;
  }

  setMeetingLock(true);

  if (meetingAtMs && meetingAtMs !== meetingAtMsLocal){
    meetingAtMsLocal = meetingAtMs;

    if (meetingType === "report"){
      const bodyName = getPlayerNameByUid(bodyUid) || "Un Ti’Doc";
      showReportSplash(bodyName, meetingAtMs);
    } else {
      // meeting “dénoncer” => chat direct + débat 60s
      clearMeetingTimers();
      debatePill.style.display = "";
      const endDebate = meetingAtMs + DEBATE_MS;

      meetingTimers.tick = setInterval(() => {
        const now = Date.now();
        const s = Math.max(0, Math.ceil((endDebate - now)/1000));
        debatePill.textContent = `Débat : ${s}s`;
        if (s <= 0){
          debatePill.style.display = "none";
          clearMeetingTimers();
        }
      }, 250);

      openChat();
      meetingTimers.debate = setTimeout(() => {
        debatePill.style.display = "none";
        setMeetingLock(false);
      }, DEBATE_MS);
    }
  }
} // ✅ fin handleMeetingState

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
  closeChat();

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
  joy?.classList.remove("is-hidden");

  setMeetingLock(false);
  hideReportSplash();
  debatePill.style.display = "none";
  clearMeetingTimers();
  meetingAtMsLocal = 0;

  chatCanViewNow = true;
  chatCanWriteNow = true;
  setChatFabVisible(true);
  applyChatWriteLock();

  setActionUI({ show:false });
  showTasksHud(false);
  closeActivityUI();
}
function setStartingMode(){
  gameStarted = false;
  phase = "starting";
  joy?.classList.add("is-hidden");

  setMeetingLock(false);
  hideReportSplash();
  debatePill.style.display = "none";
  clearMeetingTimers();
  meetingAtMsLocal = 0;

  chatCanViewNow = true;
  chatCanWriteNow = true;
  setChatFabVisible(true);
  applyChatWriteLock();

  setActionUI({ show:false });
  showTasksHud(false);
  closeActivityUI();
}
function setGameMode(){
  gameStarted = true;
  phase = "started";

  // joystick visible en game (vivant = move / mort = pan caméra)
  if (!meetingLockActive) joy?.classList.remove("is-hidden");

  // chat: visible si room.chatEnabled
  chatCanViewNow  = !!roomChatEnabled;
  chatCanWriteNow = !!roomChatEnabled && !myDead;

  setChatFabVisible(chatCanViewNow);
  if (!chatCanViewNow && chatOverlay?.classList.contains("open")) closeChat();
  applyChatWriteLock();

  showTasksHud(true);
  updateMyTaskHud();
}

function startLoopOnce(){
  if (loopRunning) return;
  loopRunning = true;
  lastT = performance.now();
  requestAnimationFrame(loop);
}

// ===================
// IMAGES
// ===================
const lobbyBgImg = new Image();
lobbyBgImg.src = "./assets/lobby.png";

const lobbyMaskImg = new Image();
lobbyMaskImg.src = "./assets/lobby-NB.png";

const mapImg = new Image();
mapImg.src = "./assets/map.png";

const collisionImg = new Image();
collisionImg.src = "./assets/collisions.png";

// rôle images
const tinocentImgSrc = "./assets/tinocent.png";
const titruantImgSrc = "./assets/titruant.png";

// expulsé sprite
const pleurImg = new Image();
pleurImg.src = "./assets/pleur.png";
pleurImg.onerror = () => {
  if (pleurImg.src.includes("pleur.png")) pleurImg.src = "./assets/pleure.png";
};

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

lobbyMaskImg.onload = () => {
  LOBBY_W = lobbyMaskImg.width;
  LOBBY_H = lobbyMaskImg.height;

  const tmp = document.createElement("canvas");
  tmp.width = LOBBY_W;
  tmp.height = LOBBY_H;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(lobbyMaskImg, 0, 0);
  lobbyMaskData = tctx.getImageData(0, 0, LOBBY_W, LOBBY_H);
};

// ===================
// CAMERA + ZOOM
// ===================
const ZOOM_GAME  = 1.7;
const CAM_LERP   = 0.12;

let camX = 0, camY = 0;

// FOV plus grand (téléphone)
const VISION_SCREEN_FACTOR = 0.58;

function getVisionRadiusWorld(){
  const rScreen = Math.min(window.innerWidth, window.innerHeight) * VISION_SCREEN_FACTOR;
  return rScreen / ZOOM_GAME;
}

// spectate pan si expulsé
let specCamX = null, specCamY = null;
let specDragActive = false;
let specPointerId = null;
let specLast = { x: 0, y: 0 };

function ensureSpectateCamInit(){
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

// Blanc = walkable (lobby-NB.png)
function isWalkableLobby(wx, wy){
  if (!lobbyMaskData || !LOBBY_W || !LOBBY_H) return true;

  const mx = Math.floor(wx * (LOBBY_W / MAP_W));
  const my = Math.floor(wy * (LOBBY_H / MAP_H));

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

const spritePose1 = loadImg("./assets/pose-1.png");
const marche1     = loadImg("./assets/marche1.png");
const marche2     = loadImg("./assets/marche2.png");
const WALK_SEQUENCE = [marche1, spritePose1, marche1, marche2, spritePose1, marche2];

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
let myUid = null;
let myName = "";
let myIsHost = false;

let myRole = null;        // "tinocent" | "titruant"
let myDead = false;       // expulsé ?
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
    prev.x = x; prev.y = y;

    const dx = (prev.lastX ?? x) - x;
    const dy = (prev.lastY ?? y) - y;
    const d = Math.hypot(dx, dy);

    if (!isDead && d > 0.6){
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
  roleImg.src = (which === "titruant") ? titruantImgSrc : tinocentImgSrc;
}
function setOverlayFinal(role){
  const isTruant = (role === "titruant");
  if (roleTitle) roleTitle.textContent = "Ton rôle";
  if (roleSub) roleSub.textContent = isTruant ? "Tu es Ti’Truant 😈" : "Tu es Ti’Nocent 😇";
  setOverlayFace(isTruant ? "titruant" : "tinocent");
}
async function playSpinThenReveal(finalRole){
  if (!roleOverlay) return;

  showRoleOverlayBase();
  spinRunning = true;

  let flip = false;
  let delay = 45;
  const startT = performance.now();
  while (performance.now() - startT < 900 && spinRunning){
    flip = !flip;
    setOverlayFace(flip ? "titruant" : "tinocent");
    await sleep(delay);
  }

  const slowStart = performance.now();
  while (performance.now() - slowStart < 1200 && spinRunning){
    flip = !flip;
    setOverlayFace(flip ? "titruant" : "tinocent");
    const t = (performance.now() - slowStart) / 1200;
    delay = 60 + t * 190;
    await sleep(delay);
  }

  if (!spinRunning) return;
  setOverlayFinal(finalRole);
  await sleep(900);
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
    }
  });

  return unsub;
}

// HOST: crée les roles (1 truant si 4-8, sinon 2) — ÉQUITABLE
async function hostAssignRoles(players){
  const uids = players.map(p => p.uid).filter(Boolean);
  if (uids.length < 4) throw new Error("not_enough_players");

  const nbPlayers = uids.length;
  const truantsCount = (nbPlayers >= 4 && nbPlayers <= 8) ? 1 : 2;

  const pool = shuffleCryptoInPlace([...uids]);
  const truants = new Set(pool.slice(0, truantsCount));

  for (const uid of uids){
    const role = truants.has(uid) ? "titruant" : "tinocent";
    await setDoc(doc(db, "rooms", roomId, "privateRoles", uid), {
      uid,
      role,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  await updateDoc(doc(db, "rooms", roomId), {
    playersCount: nbPlayers,
    truantsCount: truantsCount,
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
  if (best && bestD <= ZONE_RANGE) return { zone: best, d: bestD };
  return null;
}

async function doExpulse(targetUid){
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
      meetingBy: myUid,
      reportedBodyUid: bodyUid
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
  if (d > ZONE_RANGE){
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
    setActionUI({ show:false });
  }

  if (phase === "starting") {
    move.x = 0; move.y = 0;
  }

  const dtNorm = Math.min(2, dt / 16.6667);

  // mort = joystick pan caméra (et drag déjà géré)
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
  if (phase === "started"){
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
    const isTruant = (myRole === "titruant");
    if (isTruant){
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

    // priorité 3: Activité (Ti’Nocent)
    const isNocent = (myRole === "tinocent");
    if (isNocent){
      const nearZone = getClosestZoneNearMe();
      if (nearZone){
        const z = nearZone.zone;
        const label = (z.id === "meeting") ? "Dénoncer" : `Faire: ${z.label}`;
        setActionUI({ show:true, label, disabled:false });
        actionBtn.onclick = () => doZoneAction(z);
        return;
      }
    }

    setActionUI({ show:false });
  } else {
    setActionUI({ show:false });
  }
}

function draw(){
  if (!ctx) return; // évite crash si canvas absent
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0,0,window.innerWidth, window.innerHeight);

  // LOBBY
  if (!gameStarted){
    const bg = (lobbyBgImg.complete && lobbyBgImg.naturalWidth > 0) ? lobbyBgImg : mapImg;
    if (!(bg.complete && bg.naturalWidth > 0)) return;

    const bw = bg.naturalWidth;
    const bh = bg.naturalHeight;

    const s  = Math.max(window.innerWidth / bw, window.innerHeight / bh);
    const ox = (window.innerWidth  - bw * s) / 2;
    const oy = (window.innerHeight - bh * s) / 2;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);

    ctx.drawImage(bg, 0, 0, bw, bh);

    const scaleX = bw / MAP_W;
    const scaleY = bh / MAP_H;

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

  // GAME: map + camera
  const targetX = myDead ? (specCamX ?? player.x) : player.x;
  const targetY = myDead ? (specCamY ?? player.y) : player.y;

  camX += (targetX - camX) * CAM_LERP;
  camY += (targetY - camY) * CAM_LERP;

  const halfW = (window.innerWidth  / ZOOM_GAME) / 2;
  const halfH = (window.innerHeight / ZOOM_GAME) / 2;
  camX = clamp(camX, halfW, MAP_W - halfW);
  camY = clamp(camY, halfH, MAP_H - halfH);

  // draw map
  ctx.save();
  ctx.translate(window.innerWidth/2, window.innerHeight/2);
  ctx.scale(ZOOM_GAME, ZOOM_GAME);
  ctx.translate(-camX, -camY);

  if (mapImg.complete && mapImg.naturalWidth > 0){
    ctx.drawImage(mapImg, 0, 0, MAP_W, MAP_H);
  }

  // clip FOV
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

  ctx.restore(); // clip
  ctx.restore(); // world

  drawVignette();
  drawTaskArrow();
}

let lastT = performance.now();
function loop(t){
  const dt = t - lastT;
  lastT = t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

// ===================
// JOYSTICK
// ===================
const joy = document.getElementById("joystick");
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
// FIREBASE
// ===================
let localPosReady = false;
let spawning = false;
let unsubMyRole = null;
let startTriggeredLocal = false;

async function ensureSpawnCenter(){
  if (!myUid || !roomId) return;
  if (spawning) return;
  spawning = true;

  const spawn = findSpawnNearCenter();
  player.x = spawn.x;
  player.y = spawn.y;

  try{
    await updateDoc(doc(db,"rooms",roomId,"players",myUid), {
      x: player.x,
      y: player.y,
      updatedAt: serverTimestamp()
    });
  } catch (e){
    console.log("spawn write error:", e);
  } finally {
    spawning = false;
  }
}

onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = "./login.html"; return; }
  if (!roomId){
  // on reste sur la page pour que tu voies le problème au lieu d’être renvoyée
  console.warn("[LOBBY] roomId manquant -> pas de connexion Firestore");
  setStartInfo("⚠️ Code de partie manquant. Reviens via “Créer une partie” ou utilise ?room=XXXX");
  return;
}

  myUid = u.uid;

  if (!unsubMyRole){
    unsubMyRole = listenMyRole();
  }

  // START button
  btnStart?.addEventListener("click", async (e) => {
    e.preventDefault();

    if (!myIsHost){
      setStartInfo("Seul l’hôte peut démarrer.");
      return;
    }

    const n = playersMap.size;
    if (n < 4){
      setStartInfo(`Il faut au moins 4 joueurs pour démarrer (actuellement ${n}).`);
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

  // room status + flags + tasks + deadUids + meeting/report
  onSnapshot(doc(db,"rooms",roomId), async (snap)=>{
    if (!snap.exists()){
      alert("Partie supprimée");
      location.href="./game.html";
      return;
    }

    const room = snap.data() || {};
    const status = room.status;

    roomChatEnabled = !!room.chatEnabled;

    // deadUids persistant
    const deadArr = Array.isArray(room.deadUids) ? room.deadUids : [];
    deadUidsSet = new Set(deadArr);

    // tasks global
    roomTasksDone = (typeof room.tasksDone === "number") ? room.tasksDone : 0;
    const tasksTotalRoom = (typeof room.tasksTotal === "number") ? room.tasksTotal : TASKS_TOTAL;
    setGlobalTasksProgress(roomTasksDone, tasksTotalRoom);

    if (status === "started" && roomTasksDone >= tasksTotalRoom){
      setStartInfo("✅ Les Ti’Nocents ont gagné (missions terminées) !");
    }

    myIsHost = (room.hostUid === myUid);
    if (btnStart) btnStart.style.display = myIsHost ? "" : "none";

    // ✅ meeting/report (splash + lock)
    handleMeetingState(room, status);

    if (status === "starting"){
      if (lastRoomStatus !== "starting"){
        setStartingMode();
        startTriggeredLocal = false;
      }

      if (!startTriggeredLocal){
        startTriggeredLocal = true;

        showRoleOverlayBase();
        spinRunning = true;

        (async ()=>{
          let flip = false;
          while (spinRunning && !myRole){
            flip = !flip;
            setOverlayFace(flip ? "titruant" : "tinocent");
            await sleep(55);
          }
          if (myRole){
            await playSpinThenReveal(myRole);
          } else {
            hideRoleOverlay();
            spinRunning = false;
          }
        })();
      }

    } else if (status === "started"){
      spinRunning = false;
      hideRoleOverlay();
      setGameMode();

      if (myRole === "tinocent" && !myDead){
        await ensureMyTasksAssigned();
        updateMyTaskHud();
      }

    } else {
      spinRunning = false;
      hideRoleOverlay();
      setLobbyMode();
    }

    // chat gating (si meeting actif, on force view true)
    if (status === "started"){
      chatCanViewNow  = meetingLockActive ? true : !!roomChatEnabled;
      chatCanWriteNow = (meetingLockActive ? true : !!roomChatEnabled) && !myDead; // vivant écrit, mort lecture seule
      setChatFabVisible(chatCanViewNow);
      if (!chatCanViewNow && chatOverlay?.classList.contains("open")) closeChat();
      applyChatWriteLock();

      // pendant meeting: on force chat ouvert (après le splash, openChat() est appelé)
      if (meetingLockActive && roomChatEnabled){
        // on ne force pas ici pour éviter de couper le splash,
        // l'ouverture est gérée par showReportSplash() / meetingType === "meeting"
      }
    } else {
      chatCanViewNow = true;
      chatCanWriteNow = true;
      setChatFabVisible(true);
      applyChatWriteLock();
    }

    if (lastRoomStatus !== status){
      ensureSpawnCenter();
    }

    lastRoomStatus = status;
  });

  // players snapshot
 onSnapshot(collection(db,"rooms",roomId,"players"), async (snap)=>{
  const roomSnap = await getDoc(doc(db,"rooms",roomId));
  const room = roomSnap.data() || {};
  const status = room.status;

  const players = snap.docs.map(d=>d.data());
   
    // toast “X a quitté”
    const nowMap = new Map(players.map(p => [p.uid, p.name || "Joueur"]));
    if (prevPlayersSnapshot.size){
      for (const [uid, name] of prevPlayersSnapshot.entries()){
        if (!nowMap.has(uid)){
          if (uid !== myUid){
            showLeaveToast(`${name} a quitté la partie`);
          }
        }
      }
    }
    prevPlayersSnapshot = nowMap;

    renderPlayers(players);

    if (myIsHost && players.length >= 4) setStartInfo("");

    for (const p of players) ensurePlayerState(p);

    const live = new Set(players.map(p => p.uid));
    for (const uid of Array.from(playersMap.keys())){
      if (!live.has(uid)) playersMap.delete(uid);
    }

    const me = players.find(p => p.uid === myUid);
    if (me?.name) myName = me.name;

    if (me){
      const wasDead = myDead;
      myDead = !!me.isDead || deadUidsSet.has(myUid);
      myLastExpelAtMs = (typeof me.lastExpelAtMs === "number") ? me.lastExpelAtMs : (myLastExpelAtMs || 0);

      if (!wasDead && myDead){
        showSelfExpelledCard(10_000);  // ✅ carte expulsion victime 30s

        specCamX = (typeof me.x === "number") ? me.x : player.x;
        specCamY = (typeof me.y === "number") ? me.y : player.y;

        // mort: chat lecture seule si room.chatEnabled
        chatCanViewNow  = meetingLockActive ? true : !!roomChatEnabled;
        chatCanWriteNow = false;
        setChatFabVisible(chatCanViewNow);
        applyChatWriteLock();
        if (!chatCanViewNow && chatOverlay?.classList.contains("open")) closeChat();

        updateMyTaskHud();
        closeActivityUI();
      }

      if (wasDead && !myDead){
        specCamX = null; specCamY = null;
      }

      if (!localPosReady){
        if (typeof me.x === "number" && typeof me.y === "number"){
          player.x = me.x;
          player.y = me.y;
        } else {
          await ensureSpawnCenter();
        }
        localPosReady = true;
      }

      ensurePlayerState({ ...me, x: player.x, y: player.y });

      if (status === "started"){
  chatCanViewNow  = meetingLockActive ? true : !!roomChatEnabled;
  chatCanWriteNow = (!myDead) && (meetingLockActive ? true : !!roomChatEnabled);

  setChatFabVisible(chatCanViewNow);
  if (!chatCanViewNow && chatOverlay?.classList.contains("open")) closeChat();
  applyChatWriteLock();
}

        if (myRole === "tinocent" && !myDead){
          await ensureMyTasksAssigned();
        }
        updateMyTaskHud();
      }
    }

    startLoopOnce();
  });

  // chat snapshot + submit
  if (chatForm && chatInput){
    const q = query(
      collection(db, "rooms", roomId, "messages"),
      orderBy("createdAtMs", "asc"),
      limit(120)
    );

    onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => d.data());
      renderChat(msgs);

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

  // leave
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
});
