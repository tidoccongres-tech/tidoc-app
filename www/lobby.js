import * as AuthMod from "./auth.js";
import { doc, updateDoc, onSnapshot, collection } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const auth = AuthMod.auth;
const db = AuthMod.db;

const params = new URLSearchParams(location.search);
const roomId = (params.get("room") || "").trim().toUpperCase();

const roomCodeEl = document.getElementById("roomCode");
const playersEl  = document.getElementById("playersList");
const btnStart   = document.getElementById("btnStart");

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

// ✅ sprite au spawn
const spritePose1 = new Image();
spritePose1.src = "./assets/pose-1.png";

// ===================
// COLLISIONS
// ===================
const PLAYER_RADIUS = 16;

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
// PLAYER
// ===================
// x,y = position "au sol" (pieds)
const player = { x: 200, y: 260, speed: 2 };
let move = { x: 0, y: 0 };

// ✅ pseudo local (et host)
let myName = "";
let myIsHost = false;

function update(){
  const nx = player.x + move.x * player.speed;
  const ny = player.y + move.y * player.speed;

  if (canMove(nx, ny)){
    player.x = nx;
    player.y = ny;
  }
}

function draw(){
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // fond
  if (bg.complete) ctx.drawImage(bg, 0, 0, window.innerWidth, window.innerHeight);

  // perso
  drawPlayerSprite(player.x, player.y);

  // pseudo au-dessus
  drawNameTag(player.x, player.y, myName, myIsHost);
}

// ✅ taille du perso (mets 64 / 72 / 80 selon ton goût)
const SPRITE_SIZE = 150;

// petit offset pour que les pieds touchent le sol
const FOOT_OFFSET_Y = 4;

function drawPlayerSprite(px, py){
  const W = SPRITE_SIZE;
  const H = SPRITE_SIZE;

  // ancre bas-centre
  const dx = Math.round(px - W / 2);
  const dy = Math.round(py - H + FOOT_OFFSET_Y);

  if (spritePose1.complete && spritePose1.naturalWidth > 0){
    ctx.drawImage(spritePose1, dx, dy, W, H);
  } else {
    // fallback si l’image n’est pas chargée
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI*2);
    ctx.fill();
  }
}

function drawNameTag(px, py, name, isHost){
  if (!name) return;

  const text = isHost ? `${name} 👑` : name;

  // position au-dessus de la tête
  const y = Math.round(py - SPRITE_SIZE - 14);

  ctx.save();
  ctx.font = "800 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(text);
  const padX = 10;
  const w = Math.ceil(metrics.width + padX * 2);
  const h = 22;

  // fond arrondi
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.roundRect(px - w/2, y - h/2, w, h, 999);
  ctx.fill();

  // liseré léger
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // texte
  ctx.fillStyle = "#fff";
  ctx.fillText(text, px, y);

  ctx.restore();
}

function loop(){
  update();
  draw();
  requestAnimationFrame(loop);
}
loop();

// ===================
// JOYSTICK (iOS safe)
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

  // players list live (UI html)
  onSnapshot(collection(db,"rooms",roomId,"players"), (snap)=>{
    const players = snap.docs.map(d=>d.data());
    renderPlayers(players);

    // récupère mon pseudo depuis la liste (simple)
    const me = players.find(p => p.uid === u.uid);
    if (me?.name) myName = me.name;
  });

  btnStart?.addEventListener("click", async ()=>{
    await updateDoc(doc(db,"rooms",roomId), { status:"started", startedAt: serverTimestamp() });
    alert("Partie lancée (status=started)");
  });

  window.addEventListener("beforeunload", async ()=>{
    try{ await deleteDoc(doc(db,"rooms",roomId,"players",u.uid)); } catch {}
  });
});
