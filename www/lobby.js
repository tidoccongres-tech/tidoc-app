import * as AuthMod from "./auth.js";
import {
  doc, setDoc, getDoc, updateDoc, onSnapshot, collection
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const auth = AuthMod.auth;
const db = AuthMod.db;

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

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

const R = 12; // rayon perso

function isWalkable(px, py){
  if (!collisionData) return true;
  const cx = Math.floor(px / canvas.width  * collisionImg.width);
  const cy = Math.floor(py / canvas.height * collisionImg.height);
  if (cx < 0 || cy < 0 || cx >= collisionImg.width || cy >= collisionImg.height) return false;
  const i = (cy * collisionImg.width + cx) * 4;
  const val = collisionData.data[i]; // rouge
  return val > 200; // blanc = sol
}

function canMove(nx, ny){
  return (
    isWalkable(nx, ny) &&
    isWalkable(nx - R, ny) &&
    isWalkable(nx + R, ny) &&
    isWalkable(nx, ny - R) &&
    isWalkable(nx, ny + R)
  );
}

onAuthStateChanged(auth, async (u)=>{
  if (!u) { location.href="./login.html"; return; }
  if (!roomId) { location.href="./game.html"; return; }

  // room + players live
  onSnapshot(doc(db,"rooms",roomId), (snap)=>{
    if (!snap.exists()){
      alert("Partie supprimée");
      location.href="./game.html";
      return;
    }
    const room = snap.data() || {};
    const isHost = room.hostUid === u.uid;

    // bouton démarrer seulement pour l’hôte
    if (btnStart){
      btnStart.style.display = isHost ? "" : "none";
    }
  });

  onSnapshot(collection(db,"rooms",roomId,"players"), (snap)=>{
    const players = snap.docs.map(d=>d.data());
    renderPlayers(players);
  });

  // Start game (hôte)
  btnStart?.addEventListener("click", async ()=>{
    const roomRef = doc(db,"rooms",roomId);
    await updateDoc(roomRef, { status:"started", startedAt: serverTimestamp() });
    // plus tard: rediriger vers la vraie map / partie
    alert("Partie lancée (status=started)");
  });

  // Quitter (simple: touche back iOS ou ajoute un bouton)
  window.addEventListener("beforeunload", async ()=>{
    try{ await deleteDoc(doc(db,"rooms",roomId,"players",u.uid)); } catch {}
  });
});

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

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
  tctx.drawImage(collisionImg,0,0);
  collisionData = tctx.getImageData(0,0,tmp.width,tmp.height);
};

const player = { x: 200, y: 200, speed: 2 };

let move = { x:0, y:0 };

function update() {
  const nx = player.x + move.x * player.speed;
  const ny = player.y + move.y * player.speed;

  if (canMove(nx, ny)) {
    player.x = nx;
    player.y = ny;
  }
}

function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(bg,0,0,canvas.width,canvas.height);

  // ❌ old:
  // ctx.fillStyle = "red";
  // ctx.beginPath();
  // ctx.arc(player.x, player.y, 10, 0, Math.PI*2);
  // ctx.fill();

  // ✅ new:
  drawPlayer(player.x, player.y);
}

function drawPlayer(px, py){
  // petit perso type "avatar boule" + jambes
  // (tout en shapes, facile à remplacer par sprite plus tard)

  const bodyR = 16;
  const legW = 7;
  const legH = 10;

  // ombre au sol
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(px, py + 18, 18, 7, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // jambes
  ctx.fillStyle = "#1b2a3a";
  ctx.fillRect(px - 10, py + 12, legW, legH);
  ctx.fillRect(px + 3,  py + 12, legW, legH);

  // chaussures
  ctx.fillStyle = "#0c1520";
  ctx.fillRect(px - 11, py + 20, 10, 5);
  ctx.fillRect(px + 2,  py + 20, 10, 5);

  // corps (bleu)
  const grad = ctx.createRadialGradient(px-6, py-8, 6, px, py, bodyR+6);
  grad.addColorStop(0, "#3fb6ff");
  grad.addColorStop(1, "#0e5ea8");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(px, py, bodyR, 0, Math.PI*2);
  ctx.fill();

  // masque (simple)
  ctx.fillStyle = "#cfefff";
  ctx.beginPath();
  ctx.roundRect(px - 14, py - 2, 28, 12, 6);
  ctx.fill();

  // liseré masque
  ctx.strokeStyle = "rgba(20,80,140,.35)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // highlight
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(px-6, py-10, 10, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();

const joy = document.getElementById("joystick");
const stick = joy.querySelector(".stick");

let active = false;
let center = {x:0,y:0};

joy.addEventListener("pointerdown", e => {
  active = true;
  const r = joy.getBoundingClientRect();
  center.x = r.left + r.width/2;
  center.y = r.top + r.height/2;
});

window.addEventListener("pointerup", () => {
  active = false;
  move.x = 0;
  move.y = 0;
  stick.style.transform = "translate(0,0)";
});

window.addEventListener("pointermove", e => {
  if (!active) return;

  let dx = e.clientX - center.x;
  let dy = e.clientY - center.y;

  const dist = Math.hypot(dx,dy);
  const max = 40;
  if (dist > max) {
    dx *= max/dist;
    dy *= max/dist;
  }

  stick.style.transform = `translate(${dx}px, ${dy}px)`;

  move.x = dx / max;
  move.y = dy / max;
});
