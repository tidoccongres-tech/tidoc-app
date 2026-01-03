import * as AuthMod from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  doc, getDoc, getDocs, updateDoc, onSnapshot, collection, deleteDoc, serverTimestamp,
  addDoc, query, orderBy, limit, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const auth = AuthMod.auth;
const db = AuthMod.db;

const params = new URLSearchParams(location.search);
const roomId = (params.get("room") || "").trim().toUpperCase();

const roomCodeEl = document.getElementById("roomCode");
const playersEl  = document.getElementById("playersList");
const btnStart   = document.getElementById("btnStart");
const btnLeave   = document.getElementById("btnLeave");

// ✅ ROLE OVERLAY
const roleOverlay = document.getElementById("roleOverlay");
const roleImg     = document.getElementById("roleImg");
const roleTitle   = document.getElementById("roleTitle");
const roleSub     = document.getElementById("roleSub");
const btnRoleOk   = document.getElementById("btnRoleOk");

// ✅ chat
const chatFab      = document.getElementById("btnChatToggle");
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

function getSpawnPosition(){
  const baseX = MAP_W * 0.50;
  const baseY = MAP_H * 0.45;

  const offsetX = Math.floor(Math.random() * 60) - 30;
  const offsetY = Math.floor(Math.random() * 60) - 30;

  return { x: baseX + offsetX, y: baseY + offsetY };
}

function renderPlayers(players){
  if (!playersEl) return;
  playersEl.innerHTML = players.map(p => {
    const crown = p.isHost ? " 👑" : "";
    return `<div class="player">${p.name || "Joueur"}${crown}</div>`;
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
  chatFab?.classList.remove("has-unread");
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
// CANVAS SETUP
// ===================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

chatOverlay?.classList.remove("is-hidden");

function resize(){
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener("resize", resize);

// ===================
// MAP + CAMERA + COLLISIONS
// ===================

// ✅ ta vraie map
const mapImg = new Image();
mapImg.src = "./assets/map.png";

// ✅ ta collision colorée (noir/blanc + zones couleur)
const collisionImg = new Image();
collisionImg.src = "./assets/collisions.png";

let collisionData = null;
let MAP_W = 1536;
let MAP_H = 1024;

// zoom caméra
const ZOOM = 1.7;           // ajuste (1.4 / 1.7 / 2.0)
const CAM_LERP = 0.12;      // fluidité caméra (0.1–0.2)

// caméra (centre dans les coords monde)
let camX = 0;
let camY = 0;

mapImg.onload = () => {
  MAP_W = mapImg.width || MAP_W;
  MAP_H = mapImg.height || MAP_H;
};

collisionImg.onload = () => {
  MAP_W = collisionImg.width;
  MAP_H = collisionImg.height;

  const tmp = document.createElement("canvas");
  tmp.width = MAP_W;
  tmp.height = MAP_H;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(collisionImg, 0, 0);
  collisionData = tctx.getImageData(0, 0, MAP_W, MAP_H);

  buildZonesFromCollision();
};

// ===================
// ZONES COULEUR = INTERACTIONS
// ===================

// couleurs cibles (tolérance)
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
const ZONE_RADIUS = 85;

let zones = [];

function colorDist(r,g,b, tr,tg,tb){
  const dr = r-tr, dg=g-tg, db=b-tb;
  return Math.sqrt(dr*dr + dg*dg + db*db);
}

// ✅ détecte si une couleur appartient à une zone
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

      // ignore blancs
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

  console.log("zones détectées:", zones);
}

// ✅ UNE SEULE fonction getNearbyZone, propre
function getNearbyZone(worldX = player.x, worldY = player.y){
  for (const z of zones){
    const dx = worldX - z.cx;
    const dy = worldY - z.cy;
    if (Math.hypot(dx, dy) <= ZONE_RADIUS) return z;
  }
  return null;
}

// ===================
// COLLISIONS
// ===================
// blanc = sol, couleurs zones = sol, noir/autres = obstacle
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

  // ✅ zones colorées = walkable (sinon tu ne peux jamais déclencher l’action)
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

// ===================
// DRAW avec caméra
// ===================
function draw(){
  ctx.clearRect(0,0,window.innerWidth, window.innerHeight);

  camX += (player.x - camX) * CAM_LERP;
  camY += (player.y - camY) * CAM_LERP;

  const halfW = (window.innerWidth  / ZOOM) / 2;
  const halfH = (window.innerHeight / ZOOM) / 2;
  camX = clamp(camX, halfW, MAP_W - halfW);
  camY = clamp(camY, halfH, MAP_H - halfH);

  ctx.save();
  ctx.translate(window.innerWidth/2, window.innerHeight/2);
  ctx.scale(ZOOM, ZOOM);
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

  // debug zone proche
  const z = getNearbyZone();
  if (z){
    ctx.beginPath();
    ctx.arc(z.cx, z.cy, ZONE_RADIUS, 0, Math.PI*2);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();

  drawActionUI();
}

// ===================
// UI ACTION (simple)
// ===================
let actionBtn = null;

function ensureActionBtn(){
  if (actionBtn) return actionBtn;

  actionBtn = document.createElement("button");
  actionBtn.id = "btnAction";
  actionBtn.textContent = "ACTION";
  actionBtn.style.position = "fixed";
  actionBtn.style.left = "50%";
  actionBtn.style.bottom = "110px";
  actionBtn.style.transform = "translateX(-50%)";
  actionBtn.style.zIndex = "200";
  actionBtn.style.padding = "14px 18px";
  actionBtn.style.borderRadius = "999px";
  actionBtn.style.border = "0";
  actionBtn.style.fontWeight = "900";
  actionBtn.style.display = "none";
  document.body.appendChild(actionBtn);

  actionBtn.addEventListener("click", () => {
    const z = getNearbyZone();
    if (!z) return;

    console.log("ACTION on zone:", z.id);
    alert(`Zone: ${z.label}`);
  });

  return actionBtn;
}

function drawActionUI(){
  const btn = ensureActionBtn();
  const z = getNearbyZone();

  if (!z){
    btn.style.display = "none";
    return;
  }

  btn.style.display = "";
  btn.textContent = z.label;
  btn.style.background = "linear-gradient(180deg, #48c6ff 0%, #1479ff 100%)";
  btn.style.color = "#fff";
}

// ===================
// PLAYER LOCAL
// ===================
const player = { x: 220, y: 320, speed: 2.2 };
let move = { x: 0, y: 0 };

let myUid = null;
let myName = "";
let myIsHost = false;

// uid -> state remote
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

// ⚠️ supposé existants ailleurs dans ton projet :
/*
const SPRITE_SIZE = ...
const FOOT_OFFSET_Y = ...
const FOOT_ADJUST = new Map()
const spritePose1 = new Image()
const WALK_SEQUENCE = [...]
const WALK_SWAP_MS = ...
const SEND_EVERY_MS = ...
*/

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
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI*2);
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
    walkIndex = 1;
  }

  if (canMoveWorld(nx, ny)){
    player.x = nx;
    player.y = ny;
    if (walking || wasWalking) sendMyPosition();
  }

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

let lastT = performance.now();
function loop(t){
  const dt = t - lastT;
  lastT = t;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ===================
// JOYSTICK
// ===================
const joy = document.getElementById("joystick");
const stick = joy?.querySelector(".stick");

let active = false;
let center = { x: 0, y: 0 };
const max = 40;

function setStick(dx, dy){
  if (!stick) return;
  stick.style.transform = `translate(${dx}px, ${dy}px)`;
}

joy?.addEventListener("pointerdown", (e) => {
  active = true;
  joy.setPointerCapture?.(e.pointerId);

  const r = joy.getBoundingClientRect();
  center.x = r.left + r.width / 2;
  center.y = r.top + r.height / 2;

  e.preventDefault?.();
}, { passive: false });

window.addEventListener("pointerup", () => {
  active = false;
  move.x = 0;
  move.y = 0;
  setStick(0, 0);
});

window.addEventListener("pointercancel", () => {
  active = false;
  move.x = 0;
  move.y = 0;
  setStick(0, 0);
});

window.addEventListener("pointermove", (e) => {
  if (!active) return;

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
}, { passive: true });

// ===================
// CHAT
// ===================
function escapeHTML(s=""){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

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
// ROLE SPINNER (corrigé: role-open au lieu de chat-open)
// ===================
const ROLE_IMG = {
  innocent: "./assets/tinocent.png",
  truant:   "./assets/titruant.png",
};

let myRole = null;
let spinTimer = null;
let spinStart = 0;
let pendingStopRole = null;
let overlayShown = false;

const SPIN_MS = 70;
const MIN_SPIN_TOTAL = 1400;

function openRoleOverlay(){
  if (!roleOverlay) return;
  roleOverlay.classList.add("open");
  roleOverlay.setAttribute("aria-hidden","false");
  document.body.classList.add("role-open");
}

function closeRoleOverlay(){
  if (!roleOverlay) return;
  roleOverlay.classList.remove("open");
  roleOverlay.setAttribute("aria-hidden","true");
  document.body.classList.remove("role-open");
}

function startSpinner(){
  if (!roleImg) return;
  overlayShown = true;
  openRoleOverlay();

  roleTitle.textContent = "Tirage au sort…";
  roleSub.textContent   = "Ça tourne…";
  btnRoleOk.style.display = "none";

  spinStart = performance.now();
  let toggle = false;

  clearInterval(spinTimer);
  spinTimer = setInterval(() => {
    toggle = !toggle;
    roleImg.src = toggle ? ROLE_IMG.truant : ROLE_IMG.innocent;
  }, SPIN_MS);
}

function stopSpinner(finalRole){
  if (!finalRole) return;
  myRole = finalRole;

  const elapsed = performance.now() - spinStart;
  const wait = Math.max(0, MIN_SPIN_TOTAL - elapsed);

  pendingStopRole = finalRole;

  setTimeout(() => {
    clearInterval(spinTimer);
    spinTimer = null;

    roleImg.src = ROLE_IMG[pendingStopRole];
    roleTitle.textContent = pendingStopRole === "truant" ? "TI’TRUANT" : "TI’NOCENT";
    roleSub.textContent   = "Garde ton rôle secret 🤫";
    btnRoleOk.style.display = "";
  }, wait);
}

btnRoleOk?.addEventListener("click", closeRoleOverlay);

// ===================
// START GAME (HOST)
// ===================
function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function computeTruants(count){
  if (count >= 8) return 2;
  return 1;
}

// ===================
// FIREBASE
// ===================
onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = "./login.html"; return; }
  if (!roomId) { location.href = "./game.html"; return; }

  myUid = u.uid;

  // ✅ écoute rôle privé
  onSnapshot(doc(db, "rooms", roomId, "privateRoles", myUid), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (!data?.role) return;

    if (!overlayShown) startSpinner();
    stopSpinner(data.role);
  });

  // ✅ chat live
  if (chatForm && chatInput){
    const q = query(
      collection(db, "rooms", roomId, "messages"),
      orderBy("createdAtMs", "asc"),
      limit(120)
    );

    onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => d.data());
      renderChat(msgs);

      // ✅ pastille rouge si nouveau msg d'un autre + chat fermé
      if (msgs.length && !chatOverlay?.classList.contains("open")){
        const last = msgs[msgs.length - 1];
        if (last?.uid && last.uid !== myUid){
          chatFab?.classList.add("has-unread");
        }
      }
    }, (err) => {
      console.log("chat snapshot error:", err);
    });

    chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const val = chatInput.value;
      chatInput.value = "";
      try { await sendChat(val); }
      catch (err) { console.log("chat send error:", err); }
    });
  }

  // room status + host
  onSnapshot(doc(db,"rooms",roomId), (snap)=>{
    if (!snap.exists()){
      alert("Partie supprimée");
      location.href="./game.html";
      return;
    }

    const room = snap.data() || {};
    const status = room.status;

    if ((status === "starting" || status === "started") && !overlayShown){
      startSpinner();
    }

    myIsHost = (room.hostUid === myUid);
    if (btnStart) btnStart.style.display = myIsHost ? "" : "none";
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

    if (me){
      ensurePlayerState(me);

      if (typeof me.x !== "number" || typeof me.y !== "number"){
        const spawn = getSpawnPosition();
        player.x = spawn.x;
        player.y = spawn.y;
        try{
          await updateDoc(doc(db,"rooms",roomId,"players",myUid), { x: spawn.x, y: spawn.y });
        } catch(e){
          console.log("spawn write error:", e);
        }
      } else {
        player.x = me.x;
        player.y = me.y;
      }
    }
  });

  // host start
  btnStart?.addEventListener("click", async ()=>{
    if (!myIsHost) return;

    try{
      const snapPlayers = await getDocs(collection(db, "rooms", roomId, "players"));
      const players = snapPlayers.docs.map(d => d.data()).filter(p => p?.uid);

      const n = players.length;
      if (n < 4){ alert("Il faut au moins 4 joueurs pour démarrer."); return; }
      if (n > 12){ alert("Maximum 12 joueurs."); return; }

      await updateDoc(doc(db,"rooms",roomId), {
        status: "starting",
        startingAt: serverTimestamp(),
      });

      const truantsCount = computeTruants(n);
      const uids = shuffle(players.map(p => p.uid));
      const truants = new Set(uids.slice(0, truantsCount));

      const batch = writeBatch(db);
      for (const uid of uids){
        const role = truants.has(uid) ? "truant" : "innocent";
        batch.set(doc(db, "rooms", roomId, "privateRoles", uid), {
          uid,
          role,
          createdAt: serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();

      await updateDoc(doc(db,"rooms",roomId), {
        status: "started",
        startedAt: serverTimestamp(),
        truantsCount,
        playersCount: n,
      });

    } catch(e){
      console.log("start error:", e);
      alert("Erreur au démarrage : " + (e?.message || e));
    }
  });

  // leave
  btnLeave?.addEventListener("click", async ()=>{
    overlayShown = false;
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

  window.addEventListener("beforeunload", async ()=>{
    try{ await deleteDoc(doc(db,"rooms",roomId,"players",myUid)); } catch {}
  });
});
