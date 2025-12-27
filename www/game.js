// game.js (MODULE) — V2 Lobby + Map + Déplacements salle→salle
import * as AuthMod from "./auth.js";
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const auth = AuthMod.auth;
const db   = AuthMod.db;

// UI
const btnCreateRoom = document.getElementById("btnCreateRoom");
const btnJoinRoom   = document.getElementById("btnJoinRoom");
const btnCopyCode   = document.getElementById("btnCopyCode");
const btnStartGame  = document.getElementById("btnStartGame");
const btnLeaveRoom  = document.getElementById("btnLeaveRoom");
const btnToggleMap  = document.getElementById("btnToggleMap");

const joinCode      = document.getElementById("joinCode");
const gameMsg       = document.getElementById("gameMsg");

const lobbyCard     = document.getElementById("lobbyCard");
const mapCard       = document.getElementById("mapCard");

const roomCodeText  = document.getElementById("roomCodeText");
const roomStatusText= document.getElementById("roomStatusText");

const playersList   = document.getElementById("playersList");

const myRoomText    = document.getElementById("myRoomText");
const mapGrid       = document.getElementById("mapGrid");
const roomPlayersHere = document.getElementById("roomPlayersHere");

const canvas = document.getElementById("gameCanvas");
const hud    = document.getElementById("hud");
const joy    = document.getElementById("joy");
const joyStick = joy?.querySelector(".joy-stick");

let ctx = null;
if (canvas) ctx = canvas.getContext("2d");

// state
let currentRoomId = null;
let unsubPlayers = null;
let unsubRoom = null;
let unsubMe = null;

let myRoom = "hall";         // salle actuelle
let lastMoveAt = 0;          // anti spam
const MOVE_COOLDOWN_MS = 1200;

let myPos = { x: 180, y: 260 };
let myVel = { x: 0, y: 0 };
let lastNetSyncAt = 0;
const NET_SYNC_MS = 120; // ~8 updates/sec
// =======================
// MAP (compacte + symétrique)
// =======================
const MAP = {
  hall:     { label: "Hall",      neighbors: ["pharma","couloir"] },
  pharma:   { label: "Pharma",    neighbors: ["hall","veto"] },
  veto:     { label: "Véto",      neighbors: ["pharma","medecine"] },
  medecine: { label: "Médecine",  neighbors: ["veto","dentaire"] },
  dentaire: { label: "Dentaire",  neighbors: ["medecine","couloir"] },
  couloir:  { label: "Couloir",   neighbors: ["hall","dentaire"] },
};

function labelRoom(key){ return MAP[key]?.label || key; }

function msg(t=""){ if (gameMsg) gameMsg.textContent = t; }

function escapeHTML(s=""){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function safeName(u){
  const n = (u?.displayName || "").trim();
  if (n) return n;
  const email = (u?.email || "").trim();
  if (email) return email.split("@")[0];
  return "Joueur";
}

function genCode(len=6){
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}

function cleanupSubs(){
  try{ unsubPlayers?.(); } catch {}
  try{ unsubRoom?.(); } catch {}
  try{ unsubMe?.(); } catch {}
  unsubPlayers = null;
  unsubRoom = null;
  unsubMe = null;
}

function showLobby(show){
  lobbyCard.style.display = show ? "" : "none";
}

function showMap(show){
  mapCard.style.display = show ? "" : "none";
}

function renderPlayers(players){
  playersList.innerHTML = "";
  if (!players.length){
    playersList.innerHTML = `<div class="hint">Aucun joueur pour l’instant.</div>`;
    return;
  }
  players
    .slice()
    .sort((a,b)=> (b.isHost?1:0) - (a.isHost?1:0))
    .forEach(p=>{
      const div = document.createElement("div");
      div.className = "player";
      div.style.cssText = `
        display:flex;justify-content:space-between;align-items:center;
        padding:10px 12px;border:1px solid rgba(0,0,0,.06);
        border-radius:14px;background:rgba(255,255,255,.75);
        margin-top:8px;
      `;
      div.innerHTML = `
        <div>
          <strong>${escapeHTML(p.name || "Joueur")}</strong>
          <div style="font-size:12px;font-weight:900;color:var(--muted);margin-top:2px">
            ${p.isHost ? "👑 Hôte" : "👤 Participant"} • Salle: ${escapeHTML(labelRoom(p.room || "hall"))}
          </div>
        </div>
        <div style="font-size:12px;font-weight:900;color:var(--tidoc)">
          ${escapeHTML(p.status || "")}
        </div>
      `;
      playersList.appendChild(div);
    });
}

// =======================
// MAP UI
// =======================
function renderMapButtons(){
  if (!mapGrid) return;
  mapGrid.innerHTML = "";

  // ordre sympa en 3x2 (tu peux changer)
  const order = ["pharma","hall","couloir","veto","medecine","dentaire"];

  order.forEach((key)=>{
    const btn = document.createElement("button");
    const isMe = (key === myRoom);
    const isNeighbor = MAP[myRoom]?.neighbors?.includes(key);

    btn.type = "button";
    btn.textContent = (isMe ? "📍 " : "") + labelRoom(key);

    btn.style.cssText = `
      height:54px;border-radius:16px;font-weight:950;
      border:1px solid rgba(23,140,168,.18);
      background:${isMe ? "linear-gradient(135deg, rgba(23,140,168,.18), rgba(255,255,255,.9))" : "rgba(255,255,255,.85)"};
      color:${isMe ? "var(--tidoc)" : "rgba(31,75,86,.88)"};
      box-shadow:0 14px 26px rgba(0,0,0,.07);
      cursor:${isNeighbor && !isMe ? "pointer" : "not-allowed"};
      opacity:${isNeighbor || isMe ? "1" : ".45"};
    `;

    btn.disabled = !(isNeighbor && !isMe);

    btn.addEventListener("click", ()=> moveToRoom(key));
    mapGrid.appendChild(btn);
  });

  if (myRoomText) myRoomText.textContent = labelRoom(myRoom);
}

function renderPlayersHere(players){
  const here = players.filter(p => (p.room || "hall") === myRoom);
  if (!here.length){
    roomPlayersHere.textContent = "Personne pour l’instant.";
    return;
  }
  roomPlayersHere.textContent = here.map(p => p.name || "Joueur").join(", ");
}

function setupJoystick(){
  if (!joy || !joyStick) return;

  let active = false;
  let center = { x: 0, y: 0 };
  const max = 40; // amplitude du stick

  function setStick(dx, dy){
    const dist = Math.hypot(dx, dy);
    const k = dist > max ? (max / dist) : 1;
    const sx = dx * k;
    const sy = dy * k;

    joyStick.style.transform = `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px))`;

    // vitesse normalisée (-1..1)
    myVel.x = (sx / max) * 3.2;
    myVel.y = (sy / max) * 3.2;
  }

  function reset(){
    joyStick.style.transform = "translate(-50%,-50%)";
    myVel.x = 0;
    myVel.y = 0;
  }

  function onDown(e){
    active = true;
    const r = joy.getBoundingClientRect();
    center.x = r.left + r.width/2;
    center.y = r.top + r.height/2;
    onMove(e);
  }
  function onMove(e){
    if (!active) return;
    const t = e.touches ? e.touches[0] : e;
    setStick(t.clientX - center.x, t.clientY - center.y);
  }
  function onUp(){
    active = false;
    reset();
  }

  joy.addEventListener("touchstart", onDown, { passive:false });
  window.addEventListener("touchmove", onMove, { passive:false });
  window.addEventListener("touchend", onUp);

  joy.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function gameLoop(){
  if (!ctx || !canvas) return;

  // move
  myPos.x += myVel.x;
  myPos.y += myVel.y;

  myPos.x = clamp(myPos.x, 20, canvas.width - 20);
  myPos.y = clamp(myPos.y, 20, canvas.height - 20);

  // draw bg
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // (V3.1) Map simple: rectangles de zones (plus tard on met ton image)
  ctx.globalAlpha = 0.10;
  ctx.fillRect(80,80,220,140);
  ctx.fillRect(320,80,220,140);
  ctx.fillRect(560,80,220,140);
  ctx.globalAlpha = 1;

  // player
  ctx.fillStyle = "#178CA8";
  ctx.beginPath();
  ctx.arc(myPos.x, myPos.y, 18, 0, Math.PI*2);
  ctx.fill();

  // pseudo
  ctx.fillStyle = "rgba(15,55,66,.9)";
  ctx.font = "900 14px system-ui";
  ctx.fillText("Moi", myPos.x - 14, myPos.y - 26);

  // hud
  if (hud) hud.textContent = `x:${myPos.x.toFixed(0)} y:${myPos.y.toFixed(0)}`;

  requestAnimationFrame(gameLoop);
}

// =======================
// Firestore structure
// rooms/{roomId}
// rooms/{roomId}/players/{uid}
// =======================
async function createRoom(){
  const u = auth.currentUser;
  if (!u) { location.href="./login.html"; return; }

  const roomId = genCode(6);

  await setDoc(doc(db, "rooms", roomId), {
    roomId,
    createdAt: serverTimestamp(),
    hostUid: u.uid,
    status: "lobby", // lobby | playing
  });

  await setDoc(doc(db, "rooms", roomId, "players", u.uid), {
    uid: u.uid,
    name: safeName(u),
    isHost: true,
    status: "prêt",
    room: "hall",
    joinedAt: serverTimestamp(),
    lastMoveAt: serverTimestamp(),
  });

  await enterRoom(roomId);
}

async function joinRoom(roomIdRaw){
  const u = auth.currentUser;
  if (!u) { location.href="./login.html"; return; }

  const roomId = String(roomIdRaw || "").trim().toUpperCase();
  if (!roomId) { msg("Entre un code."); return; }

  const roomRef = doc(db, "rooms", roomId);
  const snap = await getDoc(roomRef);
  if (!snap.exists()){
    msg("❌ Partie introuvable.");
    return;
  }

  const room = snap.data() || {};
  if (room.status !== "lobby"){
    msg("❌ Partie déjà commencée.");
    return;
  }

  await setDoc(doc(db, "rooms", roomId, "players", u.uid), {
    uid: u.uid,
    name: safeName(u),
    isHost: false,
    status: "prêt",
    room: "hall",
    joinedAt: serverTimestamp(),
    lastMoveAt: serverTimestamp(),
  }, { merge:true });

  await enterRoom(roomId);
}

async function enterRoom(roomId){
  cleanupSubs();
  currentRoomId = roomId;

  showLobby(true);
  showMap(true);

  roomCodeText.textContent = roomId;

  // listen room
  unsubRoom = onSnapshot(doc(db, "rooms", roomId), (snap)=>{
    if (!snap.exists()){
      msg("❌ La partie a été supprimée.");
      leaveRoom(true);
      return;
    }
    const data = snap.data() || {};
    if (roomStatusText) roomStatusText.textContent = `Statut : ${data.status || "—"}`;

    if (data.status === "playing"){
      msg("✅ Partie lancée ! (V2: déplacements ok, gameplay V3)");
    }
  });

  // listen players
  unsubPlayers = onSnapshot(collection(db, "rooms", roomId, "players"), (snap)=>{
    const players = snap.docs.map(d=>d.data());
    renderPlayers(players);
    renderPlayersHere(players);
  });

  // listen me (mon doc joueur)
  const u = auth.currentUser;
  if (u){
    unsubMe = onSnapshot(doc(db, "rooms", roomId, "players", u.uid), (snap)=>{
      if (!snap.exists()) return;
      const me = snap.data() || {};
      myRoom = me.room || "hall";
      renderMapButtons();
    });
  }

  // initial
  myRoom = "hall";
  renderMapButtons();

  msg("✅ Connecté au lobby.");
}

async function moveToRoom(targetRoom){
  const u = auth.currentUser;
  if (!u || !currentRoomId) return;

  const now = Date.now();
  if (now - lastMoveAt < MOVE_COOLDOWN_MS) return;

  const neighbors = MAP[myRoom]?.neighbors || [];
  if (!neighbors.includes(targetRoom)) return;

  lastMoveAt = now;

  await updateDoc(doc(db, "rooms", currentRoomId, "players", u.uid), {
    room: targetRoom,
    status: "en déplacement",
    lastMoveAt: serverTimestamp(),
  });

  // petit retour “feel good”
  setTimeout(async ()=>{
    try{
      await updateDoc(doc(db, "rooms", currentRoomId, "players", u.uid), {
        status: "ok",
      });
    } catch {}
  }, 450);
}

async function startGame(){
  const u = auth.currentUser;
  if (!u || !currentRoomId) return;

  const roomSnap = await getDoc(doc(db, "rooms", currentRoomId));
  const room = roomSnap.exists() ? (roomSnap.data() || {}) : {};
  if (room.hostUid !== u.uid){
    alert("Seul l’hôte peut lancer la partie.");
    return;
  }

  await updateDoc(doc(db, "rooms", currentRoomId), {
    status: "playing",
    startedAt: serverTimestamp(),
  });

  alert("✅ Partie lancée. (V3: rôles + truanderies + chat)");
}

async function leaveRoom(silent=false){
  const u = auth.currentUser;
  if (!currentRoomId || !u) {
    cleanupSubs();
    currentRoomId = null;
    showLobby(false);
    showMap(false);
    return;
  }

  try{
    await deleteDoc(doc(db, "rooms", currentRoomId, "players", u.uid));
  } catch {}

  cleanupSubs();
  currentRoomId = null;
  showLobby(false);
  showMap(false);
  if (!silent) msg("Tu as quitté la partie.");
}

// =======================
// UI binds
// =======================
btnCreateRoom?.addEventListener("click", async ()=>{
  try{
    msg("Création…");
    btnCreateRoom.disabled = true;
    await createRoom();
  } catch(e){
    console.log(e);
    msg("❌ " + (e?.message || e));
  } finally {
    btnCreateRoom.disabled = false;
  }
});

btnJoinRoom?.addEventListener("click", async ()=>{
  try{
    msg("Connexion…");
    btnJoinRoom.disabled = true;
    await joinRoom(joinCode.value);
  } catch(e){
    console.log(e);
    msg("❌ " + (e?.message || e));
  } finally {
    btnJoinRoom.disabled = false;
  }
});

btnCopyCode?.addEventListener("click", async ()=>{
  if (!currentRoomId) return;
  try{
    await navigator.clipboard.writeText(currentRoomId);
    btnCopyCode.textContent = "✅ Copié";
    setTimeout(()=> btnCopyCode.textContent = "Copier le code", 1200);
  } catch {
    alert("Copie impossible sur cet appareil.");
  }
});

btnStartGame?.addEventListener("click", async ()=>{
  try{
    btnStartGame.disabled = true;
    await startGame();
  } catch(e){
    console.log(e);
    alert("❌ " + (e?.message || e));
  } finally {
    btnStartGame.disabled = false;
  }
});

btnLeaveRoom?.addEventListener("click", ()=> leaveRoom());

btnToggleMap?.addEventListener("click", ()=>{
  const isOn = mapCard.style.display !== "none";
  showMap(!isOn);
});

// Auth boot
onAuthStateChanged(auth, (u)=>{
  if (!u){
    msg("Connecte-toi pour jouer.");
    showLobby(false);
    showMap(false);
  } else {
    msg("");
  }
});
