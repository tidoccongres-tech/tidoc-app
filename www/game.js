// game.js (MODULE) — Create/Join room -> redirect lobby + vrai pseudo

import * as AuthMod from "./auth.js";
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const auth = AuthMod.auth;
const db   = AuthMod.db;

// =======================
// PRIVATE ACCESS (STYLED)
// =======================
const GAME_LOCK = true;
const GAME_PASS = "TIDOC2026*";

if (GAME_LOCK && sessionStorage.getItem("tidoc_game_ok") !== "1") {

  document.body.innerHTML = `
    <div style="
      position:fixed;
      inset:0;
      background: radial-gradient(circle at center, #0f2b33, #07181d);
      display:flex;
      align-items:center;
      justify-content:center;
      font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      z-index:9999;
    ">
      <div style="
        width:min(420px,90%);
        padding:28px;
        border-radius:24px;
        background:rgba(0,0,0,.6);
        border:1px solid rgba(255,255,255,.12);
        backdrop-filter:blur(12px);
        box-shadow:0 25px 60px rgba(0,0,0,.5);
        text-align:center;
        color:#fff;
      ">
        <h2 style="margin:0 0 10px 0;font-weight:1000;">
          🧢 Ti’Truant
        </h2>
        <p style="opacity:.8;font-weight:600;margin-bottom:20px;">
          Arrive bientôt…
        </p>

        <input id="privatePassInput" type="password" placeholder="Code d’accès"
          style="
            width:100%;
            padding:12px 14px;
            border-radius:14px;
            border:1px solid rgba(255,255,255,.2);
            background:rgba(255,255,255,.08);
            color:#fff;
            font-weight:700;
            outline:none;
          "
        />

        <button id="privatePassBtn"
          style="
            margin-top:14px;
            width:100%;
            padding:12px;
            border-radius:14px;
            border:none;
            font-weight:900;
            background:#1fc2e0;
            color:#00242c;
            cursor:pointer;
          "
        >
          Accéder
        </button>

        <div id="privateError"
          style="margin-top:10px;color:#ff6b6b;font-weight:700;display:none;">
          Code incorrect
        </div>
      </div>
    </div>
  `;

  document.getElementById("privatePassBtn").addEventListener("click", () => {
    const val = document.getElementById("privatePassInput").value.trim();
    if (val === GAME_PASS) {
      sessionStorage.setItem("tidoc_game_ok", "1");
      location.reload();
    } else {
      document.getElementById("privateError").style.display = "block";
    }
  });

  throw new Error("Game locked");
}

// =======================
// UI
// =======================
const screenMenu  = document.getElementById("screenMenu") || document.getElementById("menuRoot");
const screenLobby = document.getElementById("screenLobby"); // peut être null

function showScreen(which){
  if (which === "menu"){
    if (screenMenu)  screenMenu.style.display = "";
    if (screenLobby) screenLobby.style.display = "none";
  } else {
    if (screenMenu)  screenMenu.style.display = "none";
    if (screenLobby) screenLobby.style.display = "";
  }
}
const btnCreate   = document.getElementById("btnCreate");
const btnJoin     = document.getElementById("btnJoin");
const btnHome     = document.getElementById("btnHome");

const btnCopyCode = document.getElementById("btnCopyCode");
const btnLeaveRoom= document.getElementById("btnLeaveRoom");

const roomCodeText   = document.getElementById("roomCodeText");
const roomStatusText = document.getElementById("roomStatusText");
const playersList    = document.getElementById("playersList");
const gameMsg        = document.getElementById("gameMsg");

function msg(t=""){ if (gameMsg) gameMsg.textContent = t; }

// =======================
// MUSIC (Menu principal)
// =======================
const LS_MUSIC = "tidoc_music_on";

const audioEl = document.getElementById("menuMusic");
const btnMusic = document.getElementById("btnMusicToggle");
const iconOn = document.getElementById("iconSoundOn");
const iconOff = document.getElementById("iconSoundOff");

function setMusicUI(isOn){
  if (iconOn) iconOn.style.display = isOn ? "" : "none";
  if (iconOff) iconOff.style.display = isOn ? "none" : "";
}

async function tryPlayAudio(){
  if (!audioEl) return;
  try{
    await audioEl.play();
  } catch (e){
    // iOS / navigateurs: play bloqué tant que pas de geste user -> ok
  }
}

function setMusicOn(isOn){
  localStorage.setItem(LS_MUSIC, isOn ? "1" : "0");
  setMusicUI(isOn);

  if (!audioEl) return;
  audioEl.volume = 0.35;

  if (isOn) tryPlayAudio();
  else audioEl.pause();
}

// init
(function initMusic(){
  const saved = localStorage.getItem(LS_MUSIC);
  const isOn = (saved === "1");     // par défaut OFF
  setMusicUI(isOn);
  if (audioEl) audioEl.volume = 0.35;
  if (isOn) tryPlayAudio();        // ✅ tente (sera bloqué iOS sans geste)
})();

btnMusic?.addEventListener("click", async () => {
  const isOn = localStorage.getItem(LS_MUSIC) === "1";
  setMusicOn(!isOn);
});


// =======================
// STATE
// =======================
let currentRoomId = null;
let unsubPlayers = null;
let unsubRoom = null;

// =======================
// HELPERS
// =======================
const LS_NAME = "tidoc_name";

function escapeHTML(s=""){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ✅ VRAI PSEUDO : localStorage -> displayName -> fallback email
function getPseudo(u){
  const ls = (localStorage.getItem(LS_NAME) || "").trim();
  if (ls) return ls;

  const dn = (u?.displayName || "").trim();
  if (dn) return dn;

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
  unsubPlayers = null;
  unsubRoom = null;
}

function renderPlayers(players){
  if (!playersList) return;
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
      div.innerHTML = `
        <div>
          <strong>${escapeHTML(p.name || "Joueur")}</strong>
          <div style="font-size:12px;font-weight:900;color:var(--muted);margin-top:2px">
            ${p.isHost ? "👑 Hôte" : "👤 Participant"}
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
// FIRESTORE
// rooms/{roomId}
// rooms/{roomId}/players/{uid}
// =======================
async function createRoom(){
  const u = auth.currentUser;
  if (!u) { location.href="./login.html"; return; }

  msg("Création…");
  const roomId = genCode(6);

  await setDoc(doc(db, "rooms", roomId), {
    roomId,
    createdAt: serverTimestamp(),
    hostUid: u.uid,
    status: "lobby",
  });

  await setDoc(doc(db, "rooms", roomId, "players", u.uid), {
    uid: u.uid,
    name: getPseudo(u), // ✅ vrai pseudo
    isHost: true,
    status: "prêt",
    joinedAt: serverTimestamp(),
  });

  window.location.href = `./lobby.html?room=${encodeURIComponent(roomId)}`;
}

async function joinRoom(roomIdRaw){
  const u = auth.currentUser;
  if (!u) { location.href="./login.html"; return; }

  const roomId = String(roomIdRaw || "").trim().toUpperCase();
  if (!roomId){ msg("Entre un code."); return; }

  msg("Connexion…");

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
    name: getPseudo(u), // ✅ vrai pseudo
    isHost: false,
    status: "prêt",
    joinedAt: serverTimestamp(),
  }, { merge:true });

  window.location.href = `./lobby.html?room=${encodeURIComponent(roomId)}`;
}

// (tu ne l’utilises plus trop car tu rediriges direct lobby.html,
// mais je te laisse ton code intact au cas où)
async function enterRoom(roomId){
  cleanupSubs();
  currentRoomId = roomId;

  showScreen("lobby");
  if (roomCodeText) roomCodeText.textContent = roomId;

  unsubRoom = onSnapshot(doc(db, "rooms", roomId), (snap)=>{
    if (!snap.exists()){
      msg("❌ La partie a été supprimée.");
      leaveRoom(true);
      return;
    }
    const data = snap.data() || {};
    if (roomStatusText) roomStatusText.textContent = `Statut : ${data.status || "—"}`;
  });

  unsubPlayers = onSnapshot(collection(db, "rooms", roomId, "players"), (snap)=>{
    const players = snap.docs.map(d=>d.data());
    renderPlayers(players);
  });

  msg("✅ Lobby prêt.");
}

async function leaveRoom(silent=false){
  const u = auth.currentUser;

  if (currentRoomId && u){
    try{
      await deleteDoc(doc(db, "rooms", currentRoomId, "players", u.uid));
    } catch {}
  }

  cleanupSubs();
  currentRoomId = null;

  if (!silent) msg("");
  showScreen("menu");
}

// =======================
// EVENTS UI
// =======================
btnCreate?.addEventListener("click", async ()=>{
  try{
    if (!auth.currentUser) { location.href="./login.html"; return; }
    await createRoom();
  } catch(e){
    console.log(e);
    msg("❌ " + (e?.message || e));
    showScreen("menu");
  }
});

btnJoin?.addEventListener("click", async ()=>{
  try{
    if (!auth.currentUser) { location.href="./login.html"; return; }
    const code = prompt("Entre le code de la partie :");
    if (!code) return;
    await joinRoom(code);
  } catch(e){
    console.log(e);
    msg("❌ " + (e?.message || e));
    showScreen("menu");
  }
});

btnHome?.addEventListener("click", ()=>{
  window.location.href = "./index.html";
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

btnLeaveRoom?.addEventListener("click", ()=> leaveRoom());

document.querySelectorAll(".menu-btn").forEach(btn => {
  const play = () => {
    btn.classList.remove("tap");
    void btn.offsetWidth;
    btn.classList.add("tap");
  };
  btn.addEventListener("pointerdown", play, { passive: true });
});

// =======================
// AUTH BOOT
// =======================
onAuthStateChanged(auth, (u)=>{
  if (!u){
    showScreen("menu");
    msg("Connecte-toi pour jouer.");
  } else {
    showScreen("menu");
    msg("");
  }
});

showScreen("menu");
