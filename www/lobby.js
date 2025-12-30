import * as AuthMod from "./auth.js";
import {
  doc, setDoc, getDoc, updateDoc, onSnapshot, collection
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const auth = AuthMod.auth;
const db = AuthMod.db;

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

function canMove(nx, ny) {
  if (!collisionData) return true;
  const cx = Math.floor(nx / canvas.width * collisionImg.width);
  const cy = Math.floor(ny / canvas.height * collisionImg.height);
  const i = (cy * collisionImg.width + cx) * 4;
  const val = collisionData.data[i]; 
  return val > 200; // blanc = sol
}

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

  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(player.x, player.y, 10, 0, Math.PI*2);
  ctx.fill();
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();
