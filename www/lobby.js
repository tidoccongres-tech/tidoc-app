// lobby.js (MODULE) — Bloc 1/…
// Imports + Globals + DOM + Helpers + HUD rôle + Réglages Missions (5 / Ti’Nocent)

import * as AuthMod from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  doc, getDoc, updateDoc, onSnapshot, collection, deleteDoc, serverTimestamp,
  addDoc, query, orderBy, limit, getDocs, setDoc, increment, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ===================
// GLOBALS
// ===================
let phase = "lobby";
let myRole = null;     // "tinocent" | "titruant"
let myDead = false;
let myUid = null;

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

// Chat DOM (existe déjà chez toi)
const chatFab      = document.getElementById("btnChatToggle");
const chatBadge    = document.getElementById("chatBadge");
const chatOverlay  = document.getElementById("chatOverlay");
const btnChatClose = document.getElementById("btnChatClose");
const chatMessagesEl = document.getElementById("chatMessages");
const chatForm  = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

// Canvas (SAFE)
const canvas = document.getElementById("gameCanvas");
const ctx = canvas?.getContext?.("2d") || null;

if (!canvas || !ctx){
  console.warn("[lobby.js] Canvas introuvable (#gameCanvas).");
}

// room code UI
if (roomCodeEl) roomCodeEl.textContent = roomId || "----";
if (!roomId){
  setStartInfo("⚠️ Aucun code room dans l’URL (ex: lobby.html?room=ABCD).");
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

function dist(ax, ay, bx, by){ return Math.hypot(ax - bx, ay - by); }

// Crypto random (tirage propre)
function cryptoRandInt(maxExclusive){
  if (!globalThis.crypto?.getRandomValues){
    return Math.floor(Math.random() * maxExclusive);
  }
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

function setChatFabVisible(show){
  if (!chatFab) return;
  chatFab.style.display = show ? "" : "none";
  if (!show){
    chatFab.classList.remove("has-unread");
    if (chatBadge) chatBadge.hidden = true;
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
  if (!role) {
    roleHud.style.display = "none";
    roleHud.textContent = "";
    return;
  }
  const isTruant = (role === "titruant");
  roleHud.textContent = `Rôle : ${isTruant ? "Ti’Truant 😈" : "Ti’Nocent 😇"}`;
  roleHud.style.display = "";
}

// ===================
// RÈGLES MISSIONS (TES RÈGLES)
// ===================

// ✅ pool zones missions (les Ti’Truants ne font pas de missions)
const TASK_POOL = [
  { id:"labo",     label:"Analyse au labo",         zoneId:"labo" },
  { id:"imagerie", label:"Imagerie",               zoneId:"imagerie" },
  { id:"pharma",   label:"Préparer un traitement", zoneId:"pharma" },
  { id:"exam",     label:"Anamnèse",               zoneId:"exam" },
  { id:"soins",    label:"Soins",                  zoneId:"soins" },
  { id:"admin",    label:"Dossiers",               zoneId:"admin" },
  { id:"rcp",      label:"RCP",                    zoneId:"rcp" },
];

// ✅ 5 missions par Ti’Nocent (comme tu veux)
const TASKS_PER_TINOCENT = 5;

// Total missions de la partie = 5 × nb Ti’Nocents
// (sera calculé quand on connaît nb joueurs & nb truants)
let tasksTotalRoom = 0;

// Missions perso
let myTasks = [];
let myTaskIndex = 0;
let myTasksReady = false;

// ===================
// COOLDOWN EXPULSION (TES RÈGLES)
// ===================
const EXPEL_COOLDOWN_MS = 3 * 60_000; // ✅ 3 minutes
let myLastExpelAtMs = 0;

// ===================
// BLOC 2 — HUD MISSIONS + ACTIVITÉS + MINI-JEU LABO
// ===================

// ===================
// HUD MISSIONS (haut droite sous le rôle)
// ===================
const tasksHud = document.createElement("div");
tasksHud.id = "tasksHud";
tasksHud.style.cssText = `
  position: fixed;
  right: calc(12px + env(safe-area-inset-right));
  top: calc(58px + env(safe-area-inset-top));
  z-index: 59;
  padding: 10px 12px;
  border-radius: 14px;
  font: 800 12px system-ui;
  color: #fff;
  background: rgba(0,0,0,.45);
  border: 1px solid rgba(255,255,255,.12);
  backdrop-filter: blur(6px);
  display: none;
  width: min(320px, calc(100vw - 24px));
`;
tasksHud.innerHTML = `
  <div style="display:flex; justify-content:space-between;">
    <div>Missions</div>
    <div id="tasksCount">0/0</div>
  </div>
  <div style="height:10px; margin-top:6px; border-radius:999px; background: rgba(255,255,255,.12); overflow:hidden;">
    <div id="tasksBar" style="height:100%; width:0%; background:#fff;"></div>
  </div>
  <div id="myTaskLine" style="margin-top:8px; display:none; align-items:center; gap:8px;">
    <div id="myTaskText" style="flex:1;"></div>
    <button id="btnTaskDone" type="button">Faire</button>
  </div>
`;
document.body.appendChild(tasksHud);

const tasksCountEl = tasksHud.querySelector("#tasksCount");
const tasksBarEl   = tasksHud.querySelector("#tasksBar");
const myTaskLineEl = tasksHud.querySelector("#myTaskLine");
const myTaskTextEl = tasksHud.querySelector("#myTaskText");
const btnTaskDone  = tasksHud.querySelector("#btnTaskDone");

function showTasksHud(show){
  tasksHud.style.display = show ? "" : "none";
}

function setGlobalTasksProgress(done, total){
  if (tasksCountEl) tasksCountEl.textContent = `${done}/${total}`;
  const pct = total ? (done / total) * 100 : 0;
  if (tasksBarEl) tasksBarEl.style.width = `${pct}%`;
}

function currentTask(){
  return myTasks[myTaskIndex] || null;
}

function updateMyTaskHud(){
  const show = (myRole === "tinocent" && !myDead && phase === "started");
  myTaskLineEl.style.display = show ? "flex" : "none";
  if (!show) return;

  const t = currentTask();
  myTaskTextEl.textContent = t ? t.label : "—";
}

// ===================
// ASSIGNATION MISSIONS PERSO
// ===================
async function ensureMyTasksAssigned(){
  if (!myUid || !roomId || myTasksReady) return;

  const ref = doc(db, "rooms", roomId, "tasks", myUid);
  const snap = await getDoc(ref);

  if (snap.exists()){
    const d = snap.data();
    myTasks = d.list || [];
    myTaskIndex = d.index || 0;
    myTasksReady = true;
    updateMyTaskHud();
    return;
  }

  const pool = shuffleCryptoInPlace([...TASK_POOL]);
  myTasks = pool.slice(0, TASKS_PER_TINOCENT);
  myTaskIndex = 0;

  await setDoc(ref, {
    uid: myUid,
    list: myTasks,
    index: 0,
    updatedAt: serverTimestamp()
  });

  myTasksReady = true;
  updateMyTaskHud();
}

// ===================
// OVERLAY ACTIVITÉ
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
  background: rgba(0,0,0,.5);
`;
activityOverlay.innerHTML = `
  <div style="background:#111; padding:16px; border-radius:16px; width: min(420px, 90vw);">
    <div id="activityTitle" style="font-weight:900;"></div>
    <div id="activitySub" style="opacity:.8; margin-bottom:8px;"></div>
    <div id="activityBody"></div>
  </div>
`;
document.body.appendChild(activityOverlay);

const activityTitleEl = activityOverlay.querySelector("#activityTitle");
const activitySubEl   = activityOverlay.querySelector("#activitySub");
const activityBodyEl  = activityOverlay.querySelector("#activityBody");

function openActivityUI(title, sub){
  activityTitleEl.textContent = title;
  activitySubEl.textContent = sub;
  activityBodyEl.innerHTML = "";
  activityOverlay.style.display = "flex";
}

function closeActivityUI(){
  activityOverlay.style.display = "none";
  activityBodyEl.innerHTML = "";
}

// ===================
// MINI-JEU LABO — 5 MANCHES, CLIQUER LA BONNE COULEUR
// ===================
const LAB_TUBES = [
  { id:"b",  label:"Bleu",   file:"tube-b.png"  },
  { id:"v",  label:"Violet", file:"tube-v.png"  },
  { id:"ve", label:"Vert",   file:"tube-ve.png" },
  { id:"j",  label:"Jaune",  file:"tube-j.png"  },
  { id:"r",  label:"Rouge",  file:"tube-r.png"  },
];

async function startLaboMiniGame(){
  openActivityUI("Labo", "Compose le produit final");

  let round = 0;
  const order = shuffleCryptoInPlace([...LAB_TUBES]);

  function renderRound(){
    const target = order[round];
    activitySubEl.textContent = `Manche ${round+1}/5 — Choisis : ${target.label}`;
    activityBodyEl.innerHTML = "";

    LAB_TUBES.forEach(t => {
      const img = document.createElement("img");
      img.src = `./assets/${t.file}`;
      img.style.cssText = "width:64px; margin:8px; cursor:pointer;";
      img.onclick = async () => {
        if (t.id === target.id){
          round++;
          if (round >= 5){
            closeActivityUI();
            await completeCurrentTask();
          } else {
            renderRound();
          }
        } else {
          activitySubEl.textContent = "❌ Mauvaise couleur, recommence la manche";
        }
      };
      activityBodyEl.appendChild(img);
    });
  }

  renderRound();
}

// ===================
// VALIDATION MISSION
// ===================
async function completeCurrentTask(){
  if (!myUid || !roomId) return;

  myTaskIndex++;

  await updateDoc(doc(db,"rooms",roomId), { tasksDone: increment(1) });
  await updateDoc(doc(db,"rooms",roomId,"tasks",myUid), { index: myTaskIndex });

  if (myTaskIndex >= myTasks.length){
    myTasksReady = false;
    myTasks = [];
    myTaskIndex = 0;
    await ensureMyTasksAssigned();
  }

  updateMyTaskHud();
}

// Bouton HUD
btnTaskDone?.addEventListener("click", () => {
  const t = currentTask();
  if (!t) return;

  if (t.zoneId === "labo"){
    startLaboMiniGame();
  } else {
    openActivityUI(t.label, "Mini-jeu générique à venir…");
  }
});

// ===================
// BLOCK 3 — VOTES + ENDGAME + RESET MISSIONS + SABOTAGES + LABO (tubes)
// ===================

// ----------
// Helpers
// ----------
function nowMs(){ return Date.now(); }

function randInt(min, maxInclusive){
  const span = maxInclusive - min + 1;
  return min + cryptoRandInt(span);
}

function scrambleAlien(str=""){
  // brouillage simple lisible (remplace lettres par alphabet “alien”)
  const alpha = "ΔΛΞЖЙФЩЮѪѦѬѮӨƛѰϞϠϢϤ";
  return String(str).split("").map(ch=>{
    if (/[a-zA-ZÀ-ÿ0-9]/.test(ch)) return alpha[cryptoRandInt(alpha.length)];
    return ch;
  }).join("");
}

// ----------
// UI: SABOTAGE splash (ATTENTION SABOTAGE)
// ----------
const sabotageSplash = document.createElement("div");
sabotageSplash.id = "sabotageSplash";
sabotageSplash.style.cssText = `
  position:fixed; inset:0; z-index:260;
  display:none; align-items:center; justify-content:center;
  background: rgba(0,0,0,.72);
  color:#fff; text-align:center;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
`;
sabotageSplash.innerHTML = `
  <div style="padding:22px 18px; border-radius:18px; background: rgba(0,0,0,.55);
              border:1px solid rgba(255,255,255,.14); box-shadow:0 18px 55px rgba(0,0,0,.35);">
    <div style="font:1000 22px system-ui; letter-spacing:.4px;">ATTENTION SABOTAGE</div>
    <div id="sabotageSplashSub" style="margin-top:10px; font:900 13px system-ui; opacity:.92;">—</div>
  </div>
`;
document.body.appendChild(sabotageSplash);

const sabotageSplashSub = sabotageSplash.querySelector("#sabotageSplashSub");

let sabotageLocal = {
  type: null,           // "lights" | "comms" | "admin"
  untilMs: 0,
  splashUntilMs: 0
};

function showSabotageSplash(subText=""){
  if (sabotageSplashSub) sabotageSplashSub.textContent = subText || "";
  sabotageSplash.style.display = "flex";
  setTimeout(()=>{ sabotageSplash.style.display = "none"; }, 2000);
}

// ----------
// UI: bouton “Saboter” (Ti’Truant)
// ----------
const sabotageBtnWrap = document.createElement("div");
sabotageBtnWrap.id = "sabotageBtnWrap";
sabotageBtnWrap.style.cssText = `
  position: fixed;
  right: calc(12px + env(safe-area-inset-right));
  bottom: calc(92px + env(safe-area-inset-bottom));
  z-index: 90;
  display: none;
`;
sabotageBtnWrap.innerHTML = `
  <button id="btnSabotage" type="button" style="
    appearance:none; border:0;
    padding: 12px 14px;
    border-radius: 16px;
    font: 1000 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    color:#fff;
    background: rgba(0,0,0,.55);
    border: 1px solid rgba(255,255,255,.14);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 8px 22px rgba(0,0,0,.22);
  ">Saboter</button>
`;
document.body.appendChild(sabotageBtnWrap);

const btnSabotage = sabotageBtnWrap.querySelector("#btnSabotage");

function setSabotageBtnVisible(show){
  sabotageBtnWrap.style.display = show ? "" : "none";
}

// ----------
// SABOTAGES — synchro via room.sabotageActive + room.nextSabotageAtMs
// ----------
function sabotageIsActive(type){
  return sabotageLocal.type === type && nowMs() < sabotageLocal.untilMs;
}

function applySabotageFromRoom(room){
  const active = room?.sabotageActive || null;
  if (!active || !active.type || !active.untilMs){
    sabotageLocal.type = null;
    sabotageLocal.untilMs = 0;
    return;
  }

  const until = (typeof active.untilMs === "number") ? active.untilMs : 0;
  const type  = active.type;

  const wasDifferent = (sabotageLocal.type !== type) || (sabotageLocal.untilMs !== until);

  sabotageLocal.type = type;
  sabotageLocal.untilMs = until;

  if (wasDifferent){
    if (type === "lights") showSabotageSplash("Lumières coupées (20s)");
    else if (type === "comms") showSabotageSplash("Brouillage communications");
    else if (type === "admin") showSabotageSplash("Blocage administratif");
  }
}

// Durées (tu peux ajuster)
const SABOTAGE_DUR = {
  lights: 20_000,
  comms:  25_000,
  admin:  25_000
};

// Cooldown random entre 3 et 5 minutes
function nextSabotageDelayMs(){
  return randInt(180_000, 300_000);
}

async function tryTriggerSabotage(room){
  if (myRole !== "titruant" || myDead || phase !== "started") return;
  if (!room) return;

  // si un sabotage est déjà actif, stop
  if (room?.sabotageActive?.untilMs && nowMs() < room.sabotageActive.untilMs) return;

  const nextAt = (typeof room.nextSabotageAtMs === "number") ? room.nextSabotageAtMs : 0;
  if (nextAt && nowMs() < nextAt){
    const s = Math.ceil((nextAt - nowMs())/1000);
    setStartInfo(`Sabotage dispo dans ${s}s`);
    return;
  }

  // Choix aléatoire 1/3
  const types = ["lights","comms","admin"];
  const type = types[cryptoRandInt(types.length)];
  const untilMs = nowMs() + (SABOTAGE_DUR[type] || 20_000);

  try{
    await updateDoc(doc(db,"rooms",roomId), {
      sabotageActive: { type, untilMs, by: myUid, atMs: nowMs() },
      nextSabotageAtMs: nowMs() + nextSabotageDelayMs()
    });
    setStartInfo("");
  } catch(e){
    console.log("trigger sabotage error:", e);
    setStartInfo("Erreur sabotage.");
  }
}

// ----------
// MISSIONS — reset jauge + reroll nouvelles missions après meeting/report
// Strategy propre sans delete massif : on utilise room.tasksSeed
// Quand tasksSeed change => chaque joueur reroll sa liste.
// ----------
let tasksSeed = 0;

async function bumpTasksSeedAndResetProgress(){
  // appel côté host quand meeting/report se termine (après vote)
  try{
    await updateDoc(doc(db,"rooms",roomId), {
      tasksDone: 0,
      tasksSeed: increment(1)
    });
  } catch(e){
    console.log("bumpTasksSeed error:", e);
  }
}

// Modif de ensureMyTasksAssigned : on reroll si seed change
async function ensureMyTasksAssignedSeeded(){
  if (!myUid || !roomId) return;
  if (myRole !== "tinocent") return;

  try{
    const ref = doc(db, "rooms", roomId, "tasks", myUid);
    const snap = await getDoc(ref);

    const roomSnap = await getDoc(doc(db,"rooms",roomId));
    const room = roomSnap.data() || {};
    const seedNow = (typeof room.tasksSeed === "number") ? room.tasksSeed : 0;

    // si doc existe + même seed => on reprend
    if (snap.exists()){
      const d = snap.data() || {};
      if (d.seed === seedNow && Array.isArray(d.list) && d.list.length){
        myTasks = d.list;
        myTaskIndex = (typeof d.index === "number") ? d.index : 0;
        myTasksReady = true;
        updateMyTaskHud();
        return;
      }
    }

    // sinon reroll
    const pool = shuffleCryptoInPlace([...TASK_POOL]);
    const list = pool.slice(0, Math.min(TASKS_PER_PLAYER, pool.length));

    await setDoc(ref, {
      uid: myUid,
      list,
      index: 0,
      seed: seedNow,
      updatedAt: serverTimestamp()
    }, { merge:true });

    myTasks = list;
    myTaskIndex = 0;
    myTasksReady = true;
    updateMyTaskHud();
  } catch(e){
    console.log("ensureMyTasksAssignedSeeded error:", e);
  }
}

// Remplace les appels existants (sans casser si oublié)
async function ensureMyTasksAssignedCompat(){
  // si la version seeded existe, on l’utilise
  return ensureMyTasksAssignedSeeded();
}

// ----------
// MINI-JEU LABO — 5 manches “clique la bonne couleur”
// Assets: tube-b.png / tube-v.png / tube-ve.png / tube-j.png / tube-r.png
// ----------
const TUBE_ASSETS = [
  { id:"b",  label:"Bleu",   src:"./assets/tube-b.png"  },
  { id:"v",  label:"Violet", src:"./assets/tube-v.png"  },
  { id:"ve", label:"Vert",   src:"./assets/tube-ve.png" },
  { id:"j",  label:"Jaune",  src:"./assets/tube-j.png"  },
  { id:"r",  label:"Rouge",  src:"./assets/tube-r.png"  },
];

function startLaboColorMixMiniGame(){
  openActivityUI("Labo", "Compose le produit final (5 manches)");

  const rounds = 5;
  let round = 1;

  const wrap = document.createElement("div");
  wrap.style.cssText = `display:flex; flex-direction:column; gap:14px; align-items:center;`;

  const title = document.createElement("div");
  title.style.cssText = "font:1000 14px system-ui; opacity:.95; text-align:center;";
  wrap.appendChild(title);

  const grid = document.createElement("div");
  grid.style.cssText = "display:flex; gap:12px; flex-wrap:wrap; justify-content:center; margin-top:6px;";
  wrap.appendChild(grid);

  // on choisit une “recette” : 5 couleurs (peut répéter)
  const recipe = Array.from({length: rounds}, ()=> TUBE_ASSETS[cryptoRandInt(TUBE_ASSETS.length)].id);

  function setProgress(){
    const pct = ((round-1)/rounds)*100;
    activityBarEl.style.width = `${pct}%`;
  }

  function renderRound(){
    grid.innerHTML = "";

    const needId = recipe[round-1];
    const need = TUBE_ASSETS.find(t=>t.id===needId);

    title.textContent = `Manche ${round}/${rounds} : clique ${need?.label || "la bonne couleur"}`;

    for (const t of TUBE_ASSETS){
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.cssText = `
        width: 92px;
        padding: 10px 10px 8px;
        border-radius: 16px;
        background: rgba(255,255,255,.08);
        border: 1px solid rgba(255,255,255,.12);
        box-shadow: 0 10px 22px rgba(0,0,0,.18);
        color:#fff;
      `;
      btn.innerHTML = `
        <img src="${t.src}" alt="${t.label}" style="display:block; width:64px; height:auto; margin:0 auto;"/>
        <div style="margin-top:8px; font:900 12px system-ui; opacity:.95;">${t.label}</div>
      `;

      btn.addEventListener("click", async ()=>{
        if (activityDone) return;

        if (t.id !== needId){
          // faux -> petite pénalité : reset manche courante (tu peux changer)
          activitySubEl.textContent = "Mauvaise couleur ❌ Réessaie";
          setTimeout(()=>{ activitySubEl.textContent = "Compose le produit final (5 manches)"; }, 650);
          return;
        }

        // bon
        round++;
        setProgress();

        if (round > rounds){
          activityDone = true;
          activityBarEl.style.width = "100%";
          activitySubEl.textContent = "Produit final validé ✅";
          await sleep(450);
          closeActivityUI();
          await completeCurrentTask();
          return;
        }

        renderRound();
      });

      grid.appendChild(btn);
    }
  }

  activityBodyEl.appendChild(wrap);
  setProgress();
  renderRound();
}

// Patch: on branche ton labo sur ce mini-jeu
// (si tu veux garder les autres mini jeux plus tard, ok)
const __oldStartActivityForZone = startActivityForZone;
startActivityForZone = function(zoneId){
  if (zoneId === "labo"){
    startLaboColorMixMiniGame();
    return;
  }
  return __oldStartActivityForZone(zoneId);
};

// ----------
// VOTE SYSTEM (débat 1m30 + vote 30s + égalité => personne)
// On utilise:
// room.voteState: "debate" | "vote" | null
// room.voteAtMs: timestamp ms
// sous-collection: rooms/{roomId}/votes/{uid}  { choice: "<uid>|pass", atMs }
// Host clôture et applique.
// ----------
const DEBATE_TIME_MS = 90_000;
const VOTE_TIME_MS   = 30_000;

const voteOverlay = document.createElement("div");
voteOverlay.id = "voteOverlay";
voteOverlay.style.cssText = `
  position: fixed; inset: 0; z-index: 280;
  display: none; align-items: center; justify-content: center;
  background: rgba(0,0,0,.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
`;
voteOverlay.innerHTML = `
  <div style="
    width:min(560px, calc(100vw - 24px));
    border-radius: 18px;
    padding: 14px;
    background: rgba(0,0,0,.78);
    border: 1px solid rgba(255,255,255,.14);
    box-shadow: 0 18px 55px rgba(0,0,0,.35);
    color:#fff;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  ">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
      <div>
        <div id="voteTitle" style="font:1000 16px system-ui;">Vote</div>
        <div id="voteSub" style="margin-top:6px; font:900 12px system-ui; opacity:.92;">—</div>
      </div>
      <div id="voteTimer" style="font:1000 14px system-ui; opacity:.95;">—</div>
    </div>

    <div id="voteList" style="margin-top:12px; display:flex; flex-direction:column; gap:10px;"></div>
  </div>
`;
document.body.appendChild(voteOverlay);

const voteTitleEl = voteOverlay.querySelector("#voteTitle");
const voteSubEl   = voteOverlay.querySelector("#voteSub");
const voteTimerEl = voteOverlay.querySelector("#voteTimer");
const voteListEl  = voteOverlay.querySelector("#voteList");

let voteUiTimer = null;
function closeVoteUI(){ voteOverlay.style.display = "none"; clearInterval(voteUiTimer); voteUiTimer=null; }
function openVoteUI(){ voteOverlay.style.display = "flex"; }

async function submitVote(choice){
  if (!myUid || !roomId) return;
  try{
    await setDoc(doc(db,"rooms",roomId,"votes",myUid), {
      uid: myUid,
      choice: choice || "pass",
      atMs: nowMs()
    }, { merge:true });
  } catch(e){
    console.log("submitVote error:", e);
  }
}

function renderVoteList(alivePlayers, locked=false){
  if (!voteListEl) return;
  voteListEl.innerHTML = "";

  // bouton PASSER
  const btnPass = document.createElement("button");
  btnPass.type = "button";
  btnPass.disabled = !!locked;
  btnPass.textContent = "Passer";
  btnPass.style.cssText = `
    width:100%;
    padding: 12px 12px;
    border-radius: 14px;
    border:1px solid rgba(255,255,255,.14);
    background: rgba(255,255,255,.10);
    color:#fff;
    font: 1000 13px system-ui;
    text-align:left;
  `;
  btnPass.onclick = ()=> submitVote("pass");
  voteListEl.appendChild(btnPass);

  for (const p of alivePlayers){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.disabled = !!locked;
    btn.textContent = p.name || "Joueur";
    btn.style.cssText = btnPass.style.cssText;
    btn.onclick = ()=> submitVote(p.uid);
    voteListEl.appendChild(btn);
  }
}

// Host tally
async function hostCloseVoteAndApply(room){
  if (!myIsHost) return;
  if (!room || room.status !== "started") return;

  // récupérer votes
  let votes = [];
  try{
    const snap = await getDocs(collection(db,"rooms",roomId,"votes"));
    votes = snap.docs.map(d=>d.data()).filter(Boolean);
  } catch(e){
    console.log("get votes error:", e);
  }

  // compter seulement votes valides
  const tally = new Map(); // choice -> count
  for (const v of votes){
    const c = v.choice || "pass";
    tally.set(c, (tally.get(c)||0) + 1);
  }

  // déterminer max (en ignorant "pass")
  let bestChoice = null;
  let bestCount = 0;
  for (const [choice,count] of tally.entries()){
    if (choice === "pass") continue;
    if (count > bestCount){
      bestCount = count;
      bestChoice = choice;
    } else if (count === bestCount && count > 0){
      // égalité
      bestChoice = null;
    }
  }

  // appliquer résultat
  try{
    // reset meeting/vote + chat off
    await updateDoc(doc(db,"rooms",roomId), {
      chatEnabled: false,
      meetingType: null,
      meetingAt: null,
      meetingBy: null,
      reportedBodyUid: null,
      voteState: null,
      voteAtMs: null
    });

    // clear votes collection (best effort)
    try{
      const snap = await getDocs(collection(db,"rooms",roomId,"votes"));
      for (const d of snap.docs){
        await deleteDoc(d.ref);
      }
    } catch(_) {}

    if (bestChoice){
      // élimination par vote
      await updateDoc(doc(db,"rooms",roomId), { deadUids: arrayUnion(bestChoice) }).catch(()=>{});
      await updateDoc(doc(db,"rooms",roomId,"players",bestChoice), {
        isDead: true,
        deadAtMs: nowMs(),
        deadBy: "vote"
      });
    }

    // ✅ reset missions: jauge à 0 + reroll
    await bumpTasksSeedAndResetProgress();

  } catch(e){
    console.log("hostCloseVoteAndApply error:", e);
  }
}

// ----------
// ENDGAME (Among Us classique)
// - Ti’Nocents gagnent: tasksDone >= tasksTotal
// - Ti’Truants gagnent: truantsAlive >= nocentsAlive (ou nocentsAlive==0)
// Host écrit room.status="ended" + room.winner
// ----------
const endOverlay = document.createElement("div");
endOverlay.id = "endOverlay";
endOverlay.style.cssText = `
  position: fixed; inset:0; z-index: 290;
  display:none; align-items:center; justify-content:center;
  background: rgba(0,0,0,.72);
  color:#fff; text-align:center;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
`;
endOverlay.innerHTML = `
  <div style="width:min(560px, calc(100vw - 24px));
              padding:14px; border-radius:18px;
              background: rgba(0,0,0,.70);
              border:1px solid rgba(255,255,255,.14);
              box-shadow:0 18px 55px rgba(0,0,0,.35);">
    <img id="endImg" src="./assets/tinocent.png" alt="role" style="display:block;width:100%;max-width:360px;margin:0 auto;border-radius:16px;border:1px solid rgba(255,255,255,.12);"/>
    <div id="endText" style="margin-top:14px; font:1000 24px system-ui; letter-spacing:.6px;">VICTOIRE</div>
  </div>
`;
document.body.appendChild(endOverlay);

const endImgEl = endOverlay.querySelector("#endImg");
const endTextEl = endOverlay.querySelector("#endText");

function showEndScreen(winner){
  // winner: "tinocent"|"titruant"
  const myCamp = (myRole === "titruant") ? "titruant" : "tinocent";
  const win = (winner === myCamp);

  if (endImgEl){
    endImgEl.src = (myCamp === "titruant") ? "./assets/titruant.png" : "./assets/tinocent.png";
  }
  if (endTextEl){
    endTextEl.textContent = win ? "VICTOIRE" : "DÉFAITE";
  }

  endOverlay.style.display = "flex";

  // retour auto menu
  setTimeout(()=>{
    window.location.href = "./game.html";
  }, 5500);
}

// ----------
// Hook sur updateMyTaskHud pour sabotage comms (brouillage)
// ----------
const __oldUpdateMyTaskHud = updateMyTaskHud;
updateMyTaskHud = function(){
  __oldUpdateMyTaskHud();

  // Si brouillage comm actif => on brouille la ligne mission (texte seulement)
  if (sabotageIsActive("comms") && myTaskTextEl && myRole === "tinocent" && !myDead && phase==="started"){
    const t = currentTask();
    if (t?.label){
      myTaskTextEl.textContent = `Ta mission: ${scrambleAlien(t.label)}`;
    }
  }
};

// ----------
// Patch completeCurrentTask : utilise seeded assign + message sans flèche
// ----------
const __oldCompleteCurrentTask = completeCurrentTask;
completeCurrentTask = async function(){
  return __oldCompleteCurrentTask();
};

// ----------
// Patch ensureMyTasksAssigned : on remplace par version seeded
// ----------
const __oldEnsureMyTasksAssigned = ensureMyTasksAssigned;
ensureMyTasksAssigned = async function(){
  return ensureMyTasksAssignedCompat();
};

// ----------
// Patch doZoneAction pour sabotage admin (zone admin bloquée)
// ----------
const __oldDoZoneAction = doZoneAction;
doZoneAction = async function(zone){
  if (zone?.id === "admin" && sabotageIsActive("admin")){
    setStartInfo("Blocage administratif : zone indisponible.");
    return;
  }
  return __oldDoZoneAction(zone);
};

// ----------
// Effet lumières : on réduit la vision (simple)
// Tu as déjà vignette + clip, ici on réduit le radius
// ----------
const __oldGetVisionRadiusWorld = getVisionRadiusWorld;
getVisionRadiusWorld = function(){
  const base = __oldGetVisionRadiusWorld();
  if (sabotageIsActive("lights")) return base * 0.55;
  return base;
};

// ----------
// Branch sabotage button click (on a besoin du dernier room snapshot)
// ----------
let lastRoomData = null;
btnSabotage?.addEventListener("click", ()=> tryTriggerSabotage(lastRoomData));



