// map-scene.js
// Si tu veux le brancher à Firebase après, on le fait juste après. Là c’est le core.

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d", { alpha: false });

function resize() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
}
window.addEventListener("resize", resize);
resize();

// --- Assets ---
const mapImg = new Image();
mapImg.src = "./assets/map.png";

const maskImg = new Image();
maskImg.src = "./assets/collision.png";

// mask data
const maskCanvas = document.createElement("canvas");
const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
let maskData = null;

function buildMask() {
  maskCanvas.width = maskImg.width;
  maskCanvas.height = maskImg.height;
  maskCtx.drawImage(maskImg, 0, 0);
  maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
}

// noir = mur
function isWall(worldX, worldY) {
  if (!maskData) return false;
  const x = Math.floor(worldX);
  const y = Math.floor(worldY);

  // dehors map = mur
  if (x < 0 || y < 0 || x >= maskCanvas.width || y >= maskCanvas.height) return true;

  const idx = (y * maskCanvas.width + x) * 4;
  const r = maskData[idx]; // 0..255
  return r < 128;
}

// collision cercle (simple et efficace)
function collidesCircle(cx, cy, radius) {
  const points = 14;
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const px = cx + Math.cos(a) * radius;
    const py = cy + Math.sin(a) * radius;
    if (isWall(px, py)) return true;
  }
  if (isWall(cx, cy)) return true;
  return false;
}

// --- Player ---
const player = {
  x: 0,
  y: 0,
  radius: 14,
  speed: 230,  // px/s
};

// caméra (smooth)
const camera = {
  x: 0,
  y: 0,
  smooth: 0.12, // plus petit = plus “lourd”
};

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function spawnCenter() {
  player.x = mapImg.width / 2;
  player.y = mapImg.height / 2;

  // si centre tombe dans un mur, on “spirale” un peu
  let tries = 0;
  while (collidesCircle(player.x, player.y, player.radius) && tries < 300) {
    player.x += (Math.random() - 0.5) * 50;
    player.y += (Math.random() - 0.5) * 50;
    tries++;
  }
  camera.x = player.x;
  camera.y = player.y;
}

// --- Input (joystick) ---
const joy = document.getElementById("joy");
const stick = joy.querySelector(".stick");

const input = { dx: 0, dy: 0, active: false };
let joyCenter = { x: 0, y: 0 };

function setStickVisual(nx, ny) {
  // nx,ny in [-1..1]
  const max = 42;
  stick.style.transform = `translate(${nx * max}px, ${ny * max}px)`;
}

function onPointerDown(e) {
  input.active = true;
  const rect = joy.getBoundingClientRect();
  joyCenter.x = rect.left + rect.width / 2;
  joyCenter.y = rect.top + rect.height / 2;
  onPointerMove(e);
}
function onPointerMove(e) {
  if (!input.active) return;
  const x = e.clientX ?? (e.touches && e.touches[0]?.clientX);
  const y = e.clientY ?? (e.touches && e.touches[0]?.clientY);
  if (x == null || y == null) return;

  const dx = x - joyCenter.x;
  const dy = y - joyCenter.y;

  const maxDist = 52;
  const dist = Math.hypot(dx, dy);
  const nx = dist > 0 ? dx / Math.max(dist, maxDist) : 0;
  const ny = dist > 0 ? dy / Math.max(dist, maxDist) : 0;

  input.dx = clamp(nx, -1, 1);
  input.dy = clamp(ny, -1, 1);
  setStickVisual(input.dx, input.dy);
}
function onPointerUp() {
  input.active = false;
  input.dx = 0; input.dy = 0;
  setStickVisual(0, 0);
}

joy.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);

// --- Mouvement avec collisions ---
function move(dt) {
  const len = Math.hypot(input.dx, input.dy);
  if (len < 0.05) return;

  const vx = (input.dx / len) * player.speed;
  const vy = (input.dy / len) * player.speed;

  // essai X puis Y (glisse le long des murs)
  const nx = player.x + vx * dt;
  if (!collidesCircle(nx, player.y, player.radius)) player.x = nx;

  const ny = player.y + vy * dt;
  if (!collidesCircle(player.x, ny, player.radius)) player.y = ny;

  // clamp dans la map
  player.x = clamp(player.x, 0, mapImg.width);
  player.y = clamp(player.y, 0, mapImg.height);
}

function updateCamera() {
  // caméra veut être sur player
  camera.x += (player.x - camera.x) * camera.smooth;
  camera.y += (player.y - camera.y) * camera.smooth;

  // clamp caméra (pour éviter de voir hors map)
  const halfW = window.innerWidth / 2;
  const halfH = window.innerHeight / 2;

  camera.x = clamp(camera.x, halfW, mapImg.width - halfW);
  camera.y = clamp(camera.y, halfH, mapImg.height - halfH);
}

function draw() {
  // fond
  ctx.fillStyle = "#06222a";
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  // offset caméra
  const offX = camera.x - window.innerWidth / 2;
  const offY = camera.y - window.innerHeight / 2;

  // map
  ctx.drawImage(mapImg, -offX, -offY);

  // joueur (placeholder, tu remplaceras par ton sprite)
  ctx.beginPath();
  ctx.arc(player.x - offX, player.y - offY, player.radius, 0, Math.PI * 2);
  ctx.fillStyle = "#ffd166";
  ctx.fill();

  // petite ombre
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.ellipse(player.x - offX, player.y - offY + player.radius + 6, player.radius * 0.9, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.globalAlpha = 1;
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  move(dt);
  updateCamera();
  draw();

  requestAnimationFrame(loop);
}

// boot
Promise.all([
  new Promise(res => mapImg.onload = res),
  new Promise(res => maskImg.onload = res),
]).then(() => {
  buildMask();
  spawnCenter();
  requestAnimationFrame(loop);
});
