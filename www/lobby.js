// lobby.js (MODULE) — Lobby (lobby.png) -> Game (map.png) quand status="started"

import * as AuthMod from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  doc, getDoc, getDocs, updateDoc, onSnapshot, collection, deleteDoc, serverTimestamp,
  addDoc, query, orderBy, limit, writeBatch
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

// ROLE OVERLAY
const roleOverlay = document.getElementById("roleOverlay");
const roleImg     = document.getElementById("roleImg");
const roleTitle   = document.getElementById("roleTitle");
const roleSub     = document.getElementById("roleSub");
const btnRoleOk   = document.getElementById("btnRoleOk");

// chat
const chatFab      = document.getElementById("btnChatToggle");
const chatBadge    = document.getElementById("chatBadge");
const chatOverlay  = document.getElementById("chatOverlay");
const btnChatClose = document.getElementById("btnChatClose");

// chat DOM
const chatMessagesEl = document.getElementById("chatMessages");
const chatForm  = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

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

// ===================
// CHAT OPEN/CLOSE
// ===================
function openChat(){
  if (!chatOverlay) return;
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

  chatFab.classList.remove("has-unread");
  if (chatBadge) chatBadge.hidden = true;

  if (chatOverlay.classList.contains("open")) closeChat();
  else openChat();
});

btnChatClose?.addEventListener("click", closeChat);

chatOverlay?.addEventListener("click", (e) => {
  if (e.target === chatOverlay) closeChat();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeChat();
});

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
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // coords en px CSS
}
resize();
window.addEventListener("resize", resize);

// ===================
// GAME STATE
// ===================
let gameStarted = false;
let loopRunning = false;

function setLobbyMode(){
  gameStarted = false;
  joy?.classList.remove("is-hidden");
  if (actionBtn) actionBtn.style.display = "none";
}

function setGameMode(){
  gameStarted = true;
  joy?.classList.remove("is-hidden");
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

const mapImg = new Image();
mapImg.src = "./assets/map.png";

const collisionImg = new Image();
collisionImg.src = "./assets/collisions.png";

let collisionData = null;
let MAP_W = 1536;
let MAP_H = 1024;

mapImg.onload = () => {
  MAP_W = mapImg.width || MAP_W;
  MAP_H = mapImg.height || MAP_H;
};

// collisions = source de taille monde
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

// ===================
// CAMERA + ZOOM (GAME ONLY)
// ===================
const ZOOM_GAME  = 1.7;
const CAM_LERP   = 0.12;
let camX = 0, camY = 0;

// ===================
// ZONES
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
function isZoneColor(r,g,b){
  for (const k of Object.keys(ZONE_COLORS)){
    const [tr,tg,tb] = ZONE_COLORS[k].rgb;
    if (colorDist(r,g,b,tr,tg,tb) < COLOR_TOL) return true;
  }
  return false;
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

      for (const k of Object.keys(ZONE_COLORS)){
        const [tr,tg,tb] = ZONE_COLORS[k].rgb;
        if (colorDist(r,g,b,tr,tg,tb) < COLOR_TOL){
          sums[k].x += x;
          sums[k].y += y;
          counts[k] += 1;
          break;
        }
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
// PLAYER + COLLISION
// ===================
const player = { x: 220, y: 320, speed: 2.2 };
let move = { x: 0, y: 0 };

function isWalkableWorld(wx, wy){
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
  if (isZoneColor(r,g,b)) return true;

  return false;
}

const PLAYER_RADIUS = 22;
function canMoveWorld(nx, ny){
  const R = PLAYER_RADIUS;
  return (
    isWalkableWorld(nx, ny) &&
    isWalkableWorld(nx - R, ny) &&
    isWalkableWorld(nx + R, ny) &&
    isWalkableWorld(nx, ny - R) &&
    isWalkableWorld(nx, ny + R)
  );
}

// ✅ Spawn centre “propre” (cherche un point walkable proche du centre)
function findSpawnNearCenter(){
  const cx = MAP_W * 0.5;
  const cy = MAP_H * 0.5;

  // si pas de collisionData encore, on spawn direct au centre
  if (!collisionData) return { x: cx, y: cy };

  // mini recherche en spirale
  const step = 14;
  const maxR = 260;
  for (let r = 0; r <= maxR; r += step){
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8){
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
const SPRITE_SIZE = 96;
const FOOT_OFFSET_Y = 16;
const FOOT_ADJUST = new Map();

const SEND_EVERY_MS = 90;
const WALK_SWAP_MS  = 120;

function loadImg(src){
  const im = new Image();
  im.src = src;
  return im;
}

const spritePose1 = loadImg("./assets/pose-1.png");
const marche1     = loadImg("./assets/marche1.png");
const marche2     = loadImg("./assets/marche2.png");
const WALK_SEQUENCE = [marche1, marche2, marche1, marche2];

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
// DRAW HELPERS
// ===================
function drawPlayerSprite(px, py, img){
  const W = SPRITE_SIZE;
  const H = SPRITE_SIZE;

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
  const y = Math.round(py - SPRITE_SIZE - 14);

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

// ===================
// UPDATE / DRAW / LOOP
// ===================
function update(dt){
  const dtNorm = Math.min(2, dt / 16.6667);

  const nx = player.x + move.x * player.speed * dtNorm;
  const ny = player.y + move.y * player.speed * dtNorm;

  const wasWalking = walking;
  walking = (Math.abs(move.x) + Math.abs(move.y)) > 0.15;

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

  // ✅ mouvement local + envoi position
  if (canMoveWorld(nx, ny)){
    player.x = nx;
    player.y = ny;
    if (walking || wasWalking) sendMyPosition();
  }

  // anim remote
  for (const [uid, p] of playersMap){
    if (uid === myUid) continue;
    if (!p.moving) continue;

    p.walkTimer += dt;
    if (p.walkTimer > WALK_SWAP_MS){
      p.walkTimer = 0;
      p.walkIndex = (p.walkIndex + 1) % WALK_SEQUENCE.length;
    }
  }

  settleRemoteIdle();
}

function draw(){
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0,0,window.innerWidth, window.innerHeight);

  // =========================
  // LOBBY: cover non déformé + joueurs
  // =========================
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

    // mapping monde -> image lobby si tailles diff
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

  // =========================
  // GAME: caméra + zoom
  // =========================
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
// JOYSTICK (actif lobby + game)
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
// CHAT LIVE (stable + pas de reload)
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
let lastStatus = null;
let localPosReady = false;     // ✅ on ne prend x/y depuis Firestore qu'une fois
let spawning = false;

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

  // room status + host
  onSnapshot(doc(db,"rooms",roomId), (snap)=>{
    if (!snap.exists()){
      alert("Partie supprimée");
      location.href="./game.html";
      return;
    }

    const room = snap.data() || {};
    const status = room.status;

    myIsHost = (room.hostUid === myUid);
    if (btnStart) btnStart.style.display = myIsHost ? "" : "none";

    // transition
    if (status === "started") setGameMode();
    else setLobbyMode();

    // ✅ si on vient d'arriver en lobby : spawn centre (option)
    // (Si tu veux uniquement au premier join, commente ce bloc)
    if (lastStatus !== null && lastStatus === "started" && status !== "started"){
      // retour lobby -> recentrer
      ensureSpawnCenter();
    }

    lastStatus = status;
  });

  // players
  onSnapshot(collection(db,"rooms",roomId,"players"), async (snap)=>{
    const players = snap.docs.map(d=>d.data());
    renderPlayers(players);

    for (const p of players) ensurePlayerState(p);

    const live = new Set(players.map(p => p.uid));
    for (const uid of Array.from(playersMap.keys())){
      if (!live.has(uid)) playersMap.delete(uid);
    }

    const me = players.find(p => p.uid === myUid);
    if (me?.name) myName = me.name;

    // ✅ IMPORTANT: on ne ré-écrase plus player.x/y à chaque snapshot
    if (me){
      // 1) init position UNE SEULE FOIS
      if (!localPosReady){
        if (typeof me.x === "number" && typeof me.y === "number"){
          player.x = me.x;
          player.y = me.y;
        } else {
          // pas de coords -> spawn centre lobby
          await ensureSpawnCenter();
        }
        localPosReady = true;
      }

      // 2) on garde la state locale autoritaire et on alimente le rendu
      ensurePlayerState({ ...me, x: player.x, y: player.y });
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

      if (msgs.length && !chatOverlay?.classList.contains("open")){
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
