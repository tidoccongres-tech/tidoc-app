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

// ✅ badge chat
const chatFab = document.getElementById("btnChatToggle");

const btnChatToggle = document.getElementById("btnChatToggle");
const chatOverlay   = document.getElementById("chatOverlay");
const btnChatClose  = document.getElementById("btnChatClose");

if (roomCodeEl) roomCodeEl.textContent = roomId || "----";

function renderPlayers(players){
  if (!playersEl) return;
  playersEl.innerHTML = players.map(p => {
    const crown = p.isHost ? " 👑" : "";
    return `<div class="player">${p.name || "Joueur"}${crown}</div>`;
  }).join("");
}

function openChat(){
  if (!chatOverlay) return;
  chatOverlay.classList.add("open");
  chatOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("chat-open");

  // focus input (mobile friendly)
  setTimeout(() => {
    const input = document.getElementById("chatInput");
    input?.focus?.();
  }, 80);
}

function closeChat(){
  if (!chatOverlay) return;
  chatOverlay.classList.remove("open");
  chatOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("chat-open");
}

btnChatToggle?.addEventListener("click", () => {
  if (!chatOverlay) return;
  if (chatOverlay.classList.contains("open")) closeChat();
  else openChat();
});

btnChatClose?.addEventListener("click", closeChat);

// clic sur le fond sombre = close
chatOverlay?.addEventListener("click", (e) => {
  if (e.target === chatOverlay) closeChat();
});

// ESC = close (desktop)
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeChat();
});

// ===================
// CANVAS SETUP
// ===================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// ✅ sécurité : si tu as laissé "is-hidden" quelque part, on le retire
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

function getSpawnPosition(){
  const offsetX = Math.floor(Math.random() * 40) - 20; // -20 .. +19
  const offsetY = Math.floor(Math.random() * 40) - 20; // -20 .. +19

  return {
    x: window.innerWidth / 2 + offsetX,
    y: window.innerHeight / 2 + 60 + offsetY // +60 pour éviter l’UI
  };
}

// ===================
// IMAGES
// ===================
const bg = new Image();
bg.src = "./assets/lobby.png";

const collisionImg = new Image();
collisionImg.src = "./assets/lobby-NB.png";

let collisionData = null;
collisionImg.onload = () => {
  const tmp = document.createElement("canvas");
  tmp.width = collisionImg.width;
  tmp.height = collisionImg.height;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(collisionImg, 0, 0);
  collisionData = tctx.getImageData(0, 0, tmp.width, tmp.height);
};

// sprites
const spritePose1 = new Image();
spritePose1.src = "./assets/pose-1.png";

const spriteWalk1 = new Image();
spriteWalk1.src = "./assets/marche1.png";

const spriteWalk2 = new Image();
spriteWalk2.src = "./assets/marche2.png";

const FOOT_ADJUST = new Map([
  [spritePose1, 4],
  [spriteWalk1, 6],
  [spriteWalk2, 6],
]);

// ===================
// TUNING
// ===================
const SPRITE_SIZE = 90;
const FOOT_OFFSET_Y = 4;

const PLAYER_RADIUS = 22;          // collisions
const SEND_EVERY_MS = 120;         // sync position
const WALK_SWAP_MS = 70;          // alternance marche

const WALK_SEQUENCE = [ spriteWalk1, spritePose1, spriteWalk2, spritePose1 ];
// ===================
// COLLISIONS
// ===================
function isWalkable(px, py){
  if (!collisionData) return true;

  const cx = Math.floor(px / window.innerWidth  * collisionImg.width);
  const cy = Math.floor(py / window.innerHeight * collisionImg.height);

  if (cx < 0 || cy < 0 || cx >= collisionImg.width || cy >= collisionImg.height) return false;

  const i = (cy * collisionImg.width + cx) * 4;
  const val = collisionData.data[i];
  return val > 200; // blanc = sol
}

function canMove(nx, ny){
  const R = PLAYER_RADIUS;
  return (
    isWalkable(nx, ny) &&
    isWalkable(nx - R, ny) &&
    isWalkable(nx + R, ny) &&
    isWalkable(nx, ny - R) &&
    isWalkable(nx, ny + R)
  );
}

// ===================
// PLAYER LOCAL
// ===================
const player = { x: 220, y: 320, speed: 2.2 };
let move = { x: 0, y: 0 };

let myUid = null;
let myName = "";
let myIsHost = false;

// ===================
// AUTRES JOUEURS + ANIM
// ===================
// uid -> { uid,name,isHost,x,y,lastX,lastY,moving,walkIndex,walkTimer,lastMoveAt }
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

  // update infos
  prev.name = p.name || prev.name;
  prev.isHost = !!p.isHost;

  // detect mouvement
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

// si le joueur n’a pas bougé depuis X ms → idle
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

// ===================
// LOCAL WALK ANIM
// ===================
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
// FIRESTORE POS SYNC
// ===================
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
// UPDATE / DRAW
// ===================
function update(dt){
  const dtNorm = Math.min(2, dt / 16.6667); // clamp pour éviter les gros sauts

  const nx = player.x + move.x * player.speed * dtNorm;
  const ny = player.y + move.y * player.speed * dtNorm;

  const wasWalking = walking;
  walking = (Math.abs(move.x) + Math.abs(move.y)) > 0.15;

  // ✅ anim locale
const speed01 = Math.min(1, (Math.abs(move.x) + Math.abs(move.y)) / 1.4);
const swapMs  = 140 - speed01 * 70; // 140ms lent -> 70ms rapide

if (walking){
  walkTimer += dt;
  if (walkTimer > swapMs){
    walkTimer = 0;
    walkIndex = (walkIndex + 1) % WALK_SEQUENCE.length;
  }
} else {
  walkTimer = 0;
  walkIndex = 1; // pose-1 dans ta séquence
}

  if (canMove(nx, ny)){
    player.x = nx;
    player.y = ny;

    // update Firestore quand on bouge ou qu’on vient de s’arrêter
    if (walking || wasWalking) sendMyPosition();
  }

  // ✅ anim remote
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

function drawPlayerSprite(px, py, img){
  const W = SPRITE_SIZE;
  const H = SPRITE_SIZE;

  const toDraw = (img && img.complete && img.naturalWidth > 0) ? img : spritePose1;

  // ✅ point d’ancrage aux pieds (important)
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

function draw(){
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (bg.complete) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // draw players triés par y (depth)
  const arr = Array.from(playersMap.values())
    .map(p => ({
      ...p,
      drawX: (p.uid === myUid) ? player.x : (typeof p.x === "number" ? p.x : 220),
      drawY: (p.uid === myUid) ? player.y : (typeof p.y === "number" ? p.y : 320),
    }))
    .sort((a,b) => a.drawY - b.drawY);

  for (const p of arr){
    const sprite = (p.uid === myUid) ? getLocalSprite() : getRemoteSprite(p);
    drawPlayerSprite(p.drawX, p.drawY, sprite);
    drawNameTag(p.drawX, p.drawY, p.name, !!p.isHost);
  }
}

// loop
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
// CHAT (rooms/{roomId}/messages)
// ===================
const chatMessagesEl = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

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
    createdAt: serverTimestamp(),   // timestamp serveur (pour plus tard)
    createdAtMs: Date.now()         // ✅ timestamp client (affichage instant)
  });
}

// ===================
// FIREBASE
// ===================
onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = "./login.html"; return; }
  if (!roomId) { location.href = "./game.html"; return; }

  myUid = u.uid;

 // ---- CHAT LIVE
if (chatForm && chatInput){
  const q = query(
    collection(db, "rooms", roomId, "messages"),
    orderBy("createdAtMs", "asc"),
    limit(120)
  );

  onSnapshot(q, (snap) => {
    const msgs = snap.docs.map(d => d.data());
    renderChat(msgs);
  }, (err) => {
    console.log("chat snapshot error:", err);
  });

  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const val = chatInput.value;
    chatInput.value = "";

    try {
      await sendChat(val);
    } catch (err) {
      console.log("chat send error:", err);
      alert("Message non envoyé (permissions Firestore ?). Regarde la console.");
    }
  });
}
  
  onSnapshot(doc(db,"rooms",roomId), (snap)=>{
    if (!snap.exists()){
      alert("Partie supprimée");
      location.href="./game.html";
      return;
    }
   const status = room.status;
   if ((status === "starting" || status === "started") && !overlayShown){
  startSpinner();
   }
    const room = snap.data() || {};
    myIsHost = (room.hostUid === u.uid);
    if (btnStart) btnStart.style.display = myIsHost ? "" : "none";
  });

  onSnapshot(collection(db,"rooms",roomId,"players"), async (snap)=>{
    const players = snap.docs.map(d=>d.data());
    renderPlayers(players);

    // build map + movement detection
    for (const p of players) ensurePlayerState(p);

    // remove players not in snapshot anymore
    const live = new Set(players.map(p => p.uid));
    for (const uid of Array.from(playersMap.keys())){
      if (!live.has(uid)) playersMap.delete(uid);
    }

    // get my name
    const me = players.find(p => p.uid === u.uid);
    if (me?.name) myName = me.name;

    // ensure me exists in map
    if (me){
  ensurePlayerState(me);

  if (typeof me.x !== "number" || typeof me.y !== "number"){
    const spawn = getSpawnPosition();

    player.x = spawn.x;
    player.y = spawn.y;

    try{
      await updateDoc(doc(db,"rooms",roomId,"players",u.uid), {
        x: spawn.x,
        y: spawn.y
      });
    } catch(e){
      console.log("spawn write error:", e);
    }
  } else {
    player.x = me.x;
    player.y = me.y;
  }
}
  });

const ROLE_IMG = {
  innocent: "./assets/tinocent.png",
  truant:   "./assets/titruant.png",
};

let myRole = null;                 // "innocent" | "truant"
let spinTimer = null;
let spinStart = 0;
let pendingStopRole = null;
let overlayShown = false;

const SPIN_MS = 70;                // vitesse switch
const MIN_SPIN_TOTAL = 1400;       // au moins 1.4s de roulette

function openRoleOverlay(){
  if (!roleOverlay) return;
  roleOverlay.classList.add("open");
  roleOverlay.setAttribute("aria-hidden","false");
  document.body.classList.add("chat-open"); // bloque joystick/canvas events
}

function closeRoleOverlay(){
  if (!roleOverlay) return;
  roleOverlay.classList.remove("open");
  roleOverlay.setAttribute("aria-hidden","true");
  document.body.classList.remove("chat-open");
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

btnRoleOk?.addEventListener("click", () => {
  closeRoleOverlay();
});

  
  function shuffle(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function computeTruants(count){
  // ✅ règle simple
  if (count >= 8) return 2;
  return 1; // 4..7
}

btnStart?.addEventListener("click", async ()=>{
  if (!myIsHost) return;

  try{
    // 1) récup joueurs
    const snapPlayers = await getDocs(collection(db, "rooms", roomId, "players"));
    const players = snapPlayers.docs.map(d => d.data()).filter(p => p?.uid);

    const n = players.length;

    if (n < 4){
      alert("Il faut au moins 4 joueurs pour démarrer.");
      return;
    }
    if (n > 12){
      alert("Maximum 12 joueurs.");
      return;
    }

    // 2) passage en starting (déclenche roulette chez tout le monde)
    await updateDoc(doc(db,"rooms",roomId), {
      status: "starting",
      startingAt: serverTimestamp(),
    });

    // 3) tirage rôles
    const truantsCount = computeTruants(n);
    const uids = shuffle(players.map(p => p.uid));

    const truants = new Set(uids.slice(0, truantsCount));

    // 4) writeBatch dans privateRoles
    const batch = writeBatch(db);

    for (const uid of uids){
      const role = truants.has(uid) ? "truant" : "innocent";
      const ref = doc(db, "rooms", roomId, "privateRoles", uid);
      batch.set(ref, {
        uid,
        role,
        createdAt: serverTimestamp(),
      }, { merge: true });
    }

    await batch.commit();

    // 5) start officiel
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

  btnLeave?.addEventListener("click", async ()=>{
    try{
      await deleteDoc(doc(db,"rooms",roomId,"players",u.uid));

      const roomSnap = await getDoc(doc(db,"rooms",roomId));
      const room = roomSnap.data();
      if (room?.hostUid === u.uid){
        await deleteDoc(doc(db,"rooms",roomId));
      }
    } catch(e){
      console.log("leave error:", e);
    }
    window.location.href = "./game.html";
  });

  window.addEventListener("beforeunload", async ()=>{
    try{ await deleteDoc(doc(db,"rooms",roomId,"players",u.uid)); } catch {}
  });
});
