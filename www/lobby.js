// lobby.js (MODULE) — Lobby (lobby.png + lobby-NB.png) -> Game (map.png + collisions.png)
// + Tirage au sort animé (rapide -> ralenti -> rôle final) + auto start
// + Zones activité = obstacles
// + Vignette (noir autour) sur MAP uniquement
// + HUD rôle en haut à droite
// + Chat: lobby = toujours / map = seulement si room.chatEnabled === true

import * as AuthMod from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  doc, getDoc, updateDoc, onSnapshot, collection, deleteDoc, serverTimestamp,
  addDoc, query, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const auth = AuthMod.auth;
const db   = AuthMod.db;

const params = new URLSearchParams(location.search);
const roomId = (params.get("room") || "").trim().toUpperCase();

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

// HUD rôle (créé dynamiquement)
const roleHud = document.createElement("div");
roleHud.id = "roleHud";
roleHud.style.cssText = `
  position: fixed;
  top: calc(12px + env(safe-area-inset-top));
  right: calc(12px + env(safe-area-inset-right));
  z-index: 50;
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

function shuffleInPlace(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===================
// CHAT OPEN/CLOSE + GATING
// ===================
let chatAllowedNow = true; // lobby true, map dépend room.chatEnabled

function openChat(){
  if (!chatOverlay) return;

  if (!chatAllowedNow){
    setStartInfo("Chat dispo sur la map seulement pendant expulsion / dénonciation.");
    return;
  }

  chatOverlay.classList.add("open");
  chatOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("chat-open");
  setTimeout(() => chatInput?.focus?.(), 80);
}
function closeChat(){
  if (!chatOverlay) return;
  chatOverlay.classList.remove("open");
  chatOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("chat-open");
}

chatFab?.addEventListener("click", () => {
  if (!chatOverlay) return;

  if (!chatAllowedNow){
    // pas d'ouverture, et pas de badge
    chatFab.classList.remove("has-unread");
    if (chatBadge) chatBadge.hidden = true;
    openChat(); // affichera le message via setStartInfo
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
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
let DPR = window.devicePixelRatio || 1;

function resize(){
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
let gameStarted = false;       // rendu map + collisions map
let loopRunning = false;
let phase = "lobby";           // "lobby" | "starting" | "started"
let lastRoomStatus = null;

// room flags (chat map)
let roomChatEnabled = false;

function setLobbyMode(){
  gameStarted = false;
  phase = "lobby";
  joy?.classList.remove("is-hidden");
  chatAllowedNow = true; // lobby toujours
}
function setStartingMode(){
  gameStarted = false;
  phase = "starting";
  joy?.classList.add("is-hidden");
  chatAllowedNow = true; // tu peux discuter pendant le tirage si tu veux (sinon mets false)
}
function setGameMode(){
  gameStarted = true;
  phase = "started";
  joy?.classList.remove("is-hidden");

  // map: chat seulement si roomChatEnabled
  chatAllowedNow = !!roomChatEnabled;

  // si le chat est ouvert mais plus autorisé, on ferme
  if (!chatAllowedNow && chatOverlay?.classList.contains("open")) closeChat();
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

const lobbyMaskImg = new Image(); // collisions lobby
lobbyMaskImg.src = "./assets/lobby-NB.png";

const mapImg = new Image();
mapImg.src = "./assets/map.png";

const collisionImg = new Image(); // collisions map
collisionImg.src = "./assets/collisions.png";

// rôle images
const tinocentImgSrc = "./assets/tinocent.png";
const titruantImgSrc = "./assets/titruant.png";

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
// CAMERA + ZOOM (GAME ONLY)
// ===================
const ZOOM_GAME  = 1.7;
const CAM_LERP   = 0.12;
let camX = 0, camY = 0;

// ===================
// ZONES (sur collisions.png)
// ===================
const ZONE_COLORS = {
  red:     { rgb:[255,0,0],    id:"meeting",   label:"DÉNONCER" },
  blue:    { rgb:[0,0,255],    id:"labo",      label:"MISSION LABO" },
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

// collisions.png : blanc = walkable, COULEURS = OBSTACLES (✅)
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

  // zone color = obstacle
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

// ✅ séquence demandée
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

const playersMap = new Map();

function ensurePlayerState(p){
  const prev = playersMap.get(p.uid);
  const x = (typeof p.x === "number") ? p.x : undefined;
  const y = (typeof p.y === "number") ? p.y : undefined;

  if (!prev){
    playersMap.set(p.uid, {
      uid: p.uid,
      name: p.name || "Joueur",
      isHost: !!p.isHost,
      x, y,
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

  if (typeof x === "number" && typeof y === "number"){
    prev.x = x; prev.y = y;

    const dx = (prev.lastX ?? x) - x;
    const dy = (prev.lastY ?? y) - y;
    const dist = Math.hypot(dx, dy);

    if (dist > 0.6){
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
// ROLE / TIRAGE AU SORT (HOST écrit privateRoles + tous jouent l'anim)
// ===================
let myRole = null;

// animation state
let spinRunning = false;
let spinIntervalId = null;

// affiche overlay (ouverture)
function showRoleOverlayBase(){
  if (!roleOverlay) return;
  roleOverlay.classList.add("open");
  roleOverlay.setAttribute("aria-hidden","false");
  if (btnRoleOk) btnRoleOk.style.display = "none";
  if (roleTitle) roleTitle.textContent = "Tirage au sort…";
  if (roleSub) roleSub.textContent = "Ça tourne…";
}

// ferme overlay
function hideRoleOverlay(){
  if (!roleOverlay) return;
  roleOverlay.classList.remove("open");
  roleOverlay.setAttribute("aria-hidden","true");
}

// change rapidement image
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

// anim: très vite puis ralentit sur le rôle
async function playSpinThenReveal(finalRole){
  if (!roleOverlay) return;

  showRoleOverlayBase();
  spinRunning = true;

  // phase 1: ultra rapide
  let flip = false;
  let delay = 45; // ms
  const startT = performance.now();
  while (performance.now() - startT < 900 && spinRunning){
    flip = !flip;
    setOverlayFace(flip ? "titruant" : "tinocent");
    await sleep(delay);
  }

  // phase 2: ralentissement progressif
  // (on monte de 60ms -> 250ms sur ~1.2s)
  const slowStart = performance.now();
  while (performance.now() - slowStart < 1200 && spinRunning){
    flip = !flip;
    setOverlayFace(flip ? "titruant" : "tinocent");
    const t = (performance.now() - slowStart) / 1200;
    delay = 60 + t * 190;
    await sleep(delay);
  }

  // final
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
    const role = d.role; // attendu: "tinocent" | "titruant"
    if (!role) return;

    if (!myRole){
      myRole = role;
      setRoleHud(myRole);
    }
  });

  return unsub;
}

// HOST: crée les roles (1 truant si 4-8, sinon 2)
async function hostAssignRolesAndStart(players){
  // players = array docs data
  const uids = players.map(p => p.uid).filter(Boolean);
  if (uids.length < 4) throw new Error("not_enough_players");

  const nbPlayers = uids.length;
  const truantsCount = (nbPlayers >= 4 && nbPlayers <= 8) ? 1 : 2;

  const pool = shuffleInPlace([...uids]);
  const truants = new Set(pool.slice(0, truantsCount));

  // écrit privateRoles
  for (const uid of uids){
    const role = truants.has(uid) ? "titruant" : "tinocent";
    await updateDoc(doc(db, "rooms", roomId, "privateRoles", uid), {
      role,
      updatedAt: serverTimestamp()
    }).catch(async () => {
      // si le doc n'existe pas encore, updateDoc échoue -> on fait create via set/update
      // (mais tu n'as pas importé setDoc ici, donc on fait un "update" room-friendly:
      // on crée d'abord en ajoutant un champ via updateDoc en fallback => pas possible sans setDoc)
      // => on utilise une astuce: try create by updateDoc sur doc vide ne marche pas.
      // Donc on importe setDoc proprement.
    });
  }
}

// on a besoin de setDoc pour créer privateRoles si absent
import { setDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

async function hostAssignRoles(players){
  const uids = players.map(p => p.uid).filter(Boolean);
  if (uids.length < 4) throw new Error("not_enough_players");

  const nbPlayers = uids.length;
  const truantsCount = (nbPlayers >= 4 && nbPlayers <= 8) ? 1 : 2;

  const pool = shuffleInPlace([...uids]);
  const truants = new Set(pool.slice(0, truantsCount));

  for (const uid of uids){
    const role = truants.has(uid) ? "titruant" : "tinocent";
    await setDoc(doc(db, "rooms", roomId, "privateRoles", uid), {
      uid,
      role,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  // garde aussi dans room si tu veux
  await updateDoc(doc(db, "rooms", roomId), {
    playersCount: nbPlayers,
    truantsCount: truantsCount
  }).catch(()=>{});
}

// ===================
// DRAW HELPERS + VIGNETTE MAP
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

function drawNameTag(px, py, name, isHost){
  if (!name) return;
  const text = isHost ? `${name} 👑` : name;

  const size = gameStarted ? SPRITE_SIZE_GAME : SPRITE_SIZE_LOBBY;
  const y = Math.round(py - size - 14);

  ctx.save();
  ctx.font = "800 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(text);
  const padX = 10;
  const w = Math.ceil(metrics.width + padX * 2);
  const h = 22;

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  roundRectPath(ctx, px - w/2, y - h/2, w, h, 12);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.fillText(text, px, y);
  ctx.restore();
}

function drawVignette(){
  // noir autour pour réduire le champ de vision (MAP uniquement)
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w / 2;
  const cy = h / 2;

  const rInner = Math.min(w, h) * 0.22;
  const rOuter = Math.min(w, h) * 0.60;

  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  const g = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
  g.addColorStop(0.0, "rgba(0,0,0,0)");
  g.addColorStop(0.55, "rgba(0,0,0,0.25)");
  g.addColorStop(1.0, "rgba(0,0,0,0.75)");

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ===================
// UPDATE / DRAW / LOOP
// ===================
function update(dt){
  if (phase === "starting") {
    // bloque le mouvement pendant l'anim
    move.x = 0; move.y = 0;
  }

  const dtNorm = Math.min(2, dt / 16.6667);

  const nx = player.x + move.x * player.speed * dtNorm;
  const ny = player.y + move.y * player.speed * dtNorm;

  const wasWalking = walking;
  walking = (Math.abs(move.x) + Math.abs(move.y)) > 0.15;

  // anim local
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

  // déplacement slide
  let moved = false;
  if (canMoveWorld(nx, player.y)){
    player.x = nx; moved = true;
  }
  if (canMoveWorld(player.x, ny)){
    player.y = ny; moved = true;
  }

  if (moved && (walking || wasWalking)) sendMyPosition();

  // anim remote
  for (const [uid, p] of playersMap){
    if (uid === myUid) continue;
    if (!p.moving) continue;

    p.walkTimer += dt;
    if (p.walkTimer > 120){
      p.walkTimer = 0;
      p.walkIndex = (p.walkIndex + 1) % WALK_SEQUENCE.length;
    }
  }

  settleRemoteIdle();
}

function draw(){
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0,0,window.innerWidth, window.innerHeight);

  // LOBBY VISUEL (lobby.png) tant qu'on n'est pas started
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

      const sprite = (p.uid === myUid) ? getLocalSprite() : getRemoteSprite(p);
      drawPlayerSprite(ix, iy, sprite);
      drawNameTag(ix, iy, p.name, !!p.isHost);
    }

    ctx.restore();
    return;
  }

  // GAME: map + camera
  camX += (player.x - camX) * CAM_LERP;
  camY += (player.y - camY) * CAM_LERP;

  const halfW = (window.innerWidth  / ZOOM_GAME) / 2;
  const halfH = (window.innerHeight / ZOOM_GAME) / 2;
  camX = clamp(camX, halfW, MAP_W - halfW);
  camY = clamp(camY, halfH, MAP_H - halfH);

  ctx.save();
  ctx.translate(window.innerWidth/2, window.innerHeight/2);
  ctx.scale(ZOOM_GAME, ZOOM_GAME);
  ctx.translate(-camX, -camY);

  if (mapImg.complete && mapImg.naturalWidth > 0){
    ctx.drawImage(mapImg, 0, 0, MAP_W, MAP_H);
  }

  const arr = Array.from(playersMap.values())
    .map(p => ({
      ...p,
      drawX: (p.uid === myUid) ? player.x : (typeof p.x === "number" ? p.x : player.x),
      drawY: (p.uid === myUid) ? player.y : (typeof p.y === "number" ? p.y : player.y),
    }))
    .sort((a,b) => a.drawY - b.drawY);

  for (const p of arr){
    const sprite = (p.uid === myUid) ? getLocalSprite() : getRemoteSprite(p);
    drawPlayerSprite(p.drawX, p.drawY, sprite);
    drawNameTag(p.drawX, p.drawY, p.name, !!p.isHost);
  }

  ctx.restore();

  // ✅ vignette sur map
  drawVignette();
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

  let dx = e.clientX - center.x;
  let dy = e.clientY - center.y;

  const dist = Math.hypot(dx, dy);
  if (dist > max){
    dx = dx * (max / dist);
    dy = dy * (max / dist);
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
  if (!roomId) { location.href = "./game.html"; return; }

  myUid = u.uid;

  // écoute mon role (dès connexion)
  if (!unsubMyRole){
    unsubMyRole = listenMyRole();
  }

  // ✅ START button: status="starting" + host assign roles + auto pass "started"
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
      // 1) starting
      await updateDoc(doc(db, "rooms", roomId), {
        status: "starting",
        startingAt: serverTimestamp(),
        // sur map: chat fermé par défaut
        chatEnabled: false
      });

      // 2) récupère les players live et assigne les roles
      const snapPlayers = await getDocs(collection(db, "rooms", roomId, "players"));
      const players = snapPlayers.docs.map(d => d.data());
      await hostAssignRoles(players);

      // 3) auto start après le temps d’animation
      // (tout le monde aura eu le temps de voir son rôle)
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

  // room status + host + flags
  onSnapshot(doc(db,"rooms",roomId), async (snap)=>{
    if (!snap.exists()){
      alert("Partie supprimée");
      location.href="./game.html";
      return;
    }

    const room = snap.data() || {};
    const status = room.status;

    // chat map: activable via room.chatEnabled = true (à mettre lors d’expulsion/dénonciation)
    roomChatEnabled = !!room.chatEnabled;

    myIsHost = (room.hostUid === myUid);
    if (btnStart) btnStart.style.display = myIsHost ? "" : "none";

    // transitions
    if (status === "starting"){
      if (lastRoomStatus !== "starting"){
        setStartingMode();
        startTriggeredLocal = false;
      }

      // lance l’anim une fois dès qu’on a mon rôle (ou sinon “attente”)
      if (!startTriggeredLocal){
        startTriggeredLocal = true;

        // on affiche un spin même si rôle pas encore reçu
        showRoleOverlayBase();
        spinRunning = true;
        // mini boucle rapide en attendant le rôle
        (async ()=>{
          let flip = false;
          while (spinRunning && !myRole){
            flip = !flip;
            setOverlayFace(flip ? "titruant" : "tinocent");
            await sleep(55);
          }
          // dès que rôle dispo -> anim complète -> reveal -> auto close
          if (myRole){
            await playSpinThenReveal(myRole);
          } else {
            // sécurité
            hideRoleOverlay();
            spinRunning = false;
          }
        })();
      }

    } else if (status === "started"){
      // stop anim si encore active
      spinRunning = false;
      hideRoleOverlay();
      setGameMode();
    } else {
      // lobby
      spinRunning = false;
      hideRoleOverlay();
      setLobbyMode();
    }

    // chat gating update si on est en map
    if (status === "started"){
      chatAllowedNow = !!roomChatEnabled;
      if (!chatAllowedNow && chatOverlay?.classList.contains("open")) closeChat();
    } else {
      chatAllowedNow = true;
    }

    if (lastRoomStatus !== status){
      ensureSpawnCenter();
    }

    lastRoomStatus = status;
  });

  // players
  onSnapshot(collection(db,"rooms",roomId,"players"), async (snap)=>{
    const players = snap.docs.map(d=>d.data());
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
    }

    startLoopOnce();
  });

  // chat snapshot + submit (toujours actif, mais l’UI est “gated” sur map)
  if (chatForm && chatInput){
    const q = query(
      collection(db, "rooms", roomId, "messages"),
      orderBy("createdAtMs", "asc"),
      limit(120)
    );

    onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => d.data());
      renderChat(msgs);

      // badge uniquement si chat autorisé OU si on est lobby
      const canBadge = (phase !== "started") ? true : chatAllowedNow;

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

      if (phase === "started" && !chatAllowedNow){
        setStartInfo("Chat dispo sur la map seulement pendant expulsion / dénonciation.");
        return;
      }

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
