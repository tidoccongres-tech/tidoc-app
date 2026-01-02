import * as AuthMod from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  doc, getDoc, updateDoc, onSnapshot, collection, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const auth = AuthMod.auth;
const db = AuthMod.db;

const params = new URLSearchParams(location.search);
const roomId = (params.get("room") || "").trim().toUpperCase();

const roomCodeEl = document.getElementById("roomCode");
const playersEl  = document.getElementById("playersList");
const btnStart   = document.getElementById("btnStart");
const btnLeave   = document.getElementById("btnLeave");

if (roomCodeEl) roomCodeEl.textContent = roomId || "----";

function renderPlayers(players){
  if (!playersEl) return;
  playersEl.innerHTML = players.map(p => {
    const crown = p.isHost ? " 👑" : "";
    return `<div class="player">${p.name || "Joueur"}${crown}</div>`;
  }).join("");
}

// ===================
// CANVAS SETUP
// ===================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

function resize(){
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // dessin en coords CSS pixels
}
resize();
window.addEventListener("resize", resize);

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

// ===================
// COLLISIONS
// ===================
const PLAYER_RADIUS = 22; // ✅ augmente ici si tu veux moins coller aux murs

function isWalkable(px, py){
  if (!collisionData) return true;

  const cx = Math.floor(px / window.innerWidth  * collisionImg.width);
  const cy = Math.floor(py / window.innerHeight * collisionImg.height);

  if (cx < 0 || cy < 0 || cx >= collisionImg.width || cy >= collisionImg.height) return false;

  const i = (cy * collisionImg.width + cx) * 4;
  const val = collisionData.data[i]; // canal rouge
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
const player = { x: 220, y: 320, speed: 2.2 }; // x,y = position "pieds"
let move = { x: 0, y: 0 };

// infos locales
let myName = "";
let myIsHost = false;
let myUid = null;

// ===================
// AUTRES JOUEURS
// ===================
const playersMap = new Map(); // uid -> {uid,name,isHost,x,y}

// ===================
// SPRITE / ANIM
// ===================
const SPRITE_SIZE = 90;     // ✅ taille visible
const FOOT_OFFSET_Y = 4;    // pour coller les pieds au sol

let walking = false;
let walkTimer = 0;
let walkFrame = 0;          // 0 => marche1, 1 => marche2

function getMySprite(){
  if (!walking) return spritePose1;
  return walkFrame === 0 ? spriteWalk1 : spriteWalk2;
}

// ===================
// FIRESTORE POS SYNC (throttle)
// ===================
let lastSend = 0;
const SEND_EVERY_MS = 120; // ~8 fois/sec (nickel mobile)

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
  const nx = player.x + move.x * player.speed;
  const ny = player.y + move.y * player.speed;

  const wasWalking = walking;
  walking = (Math.abs(move.x) + Math.abs(move.y)) > 0.05;

  // anim marche : switch toutes les 150ms
  if (walking){
    walkTimer += dt;
    if (walkTimer > 150){
      walkTimer = 0;
      walkFrame = (walkFrame + 1) % 2;
    }
  } else {
    walkTimer = 0;
    walkFrame = 0;
  }

  if (canMove(nx, ny)){
    player.x = nx;
    player.y = ny;

    // ✅ push position quand on bouge (ou fin de mouvement)
    if (walking || wasWalking) sendMyPosition();
  }
}

function drawPlayerSprite(px, py, img){
  const W = SPRITE_SIZE;
  const H = SPRITE_SIZE;

  const dx = Math.round(px - W / 2);
  const dy = Math.round(py - H + FOOT_OFFSET_Y);

  if (img && img.complete && img.naturalWidth > 0){
    ctx.drawImage(img, dx, dy, W, H);
  } else if (spritePose1.complete) {
    ctx.drawImage(spritePose1, dx, dy, W, H);
  } else {
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI*2);
    ctx.fill();
  }
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
  ctx.roundRect(px - w/2, y - h/2, w, h, 999);
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

  // fond
  if (bg.complete) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // dessine tous les joueurs (toi inclus)
  for (const [uid, p] of playersMap.entries()){
    const px = (uid === myUid) ? player.x : (p.x ?? 220);
    const py = (uid === myUid) ? player.y : (p.y ?? 320);

    const sprite = (uid === myUid) ? getMySprite() : spritePose1;

    drawPlayerSprite(px, py, sprite);
    drawNameTag(px, py, p.name || "Joueur", !!p.isHost);
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
// FIREBASE
// ===================
onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = "./login.html"; return; }
  if (!roomId) { location.href = "./game.html"; return; }

  myUid = u.uid;

  // room live (host)
  onSnapshot(doc(db,"rooms",roomId), (snap)=>{
    if (!snap.exists()){
      alert("Partie supprimée");
      location.href="./game.html";
      return;
    }
    const room = snap.data() || {};
    myIsHost = (room.hostUid === u.uid);
    if (btnStart) btnStart.style.display = myIsHost ? "" : "none";
  });

  // players live
  onSnapshot(collection(db,"rooms",roomId,"players"), async (snap)=>{
    const players = snap.docs.map(d=>d.data());
    renderPlayers(players);

    playersMap.clear();
    for (const p of players){
      playersMap.set(p.uid, {
        uid: p.uid,
        name: p.name || "Joueur",
        isHost: !!p.isHost,
        x: p.x,
        y: p.y,
      });
    }

    // récupère mon pseudo
    const me = players.find(p => p.uid === u.uid);
    if (me?.name) myName = me.name;

    // ✅ si j'ai pas de position => spawn + write
    if (me && (typeof me.x !== "number" || typeof me.y !== "number")){
      try{
        await updateDoc(doc(db,"rooms",roomId,"players",u.uid), {
          x: player.x, y: player.y
        });
      } catch(e){
        console.log("spawn write error:", e);
      }
    }

    // ✅ si j'ai une position => je la prends (utile au join)
    if (me && typeof me.x === "number" && typeof me.y === "number"){
      player.x = me.x;
      player.y = me.y;
    }
  });

  btnStart?.addEventListener("click", async ()=>{
    await updateDoc(doc(db,"rooms",roomId), { status:"started", startedAt: serverTimestamp() });
    alert("Partie lancée (status=started)");
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
