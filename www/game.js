// game.js (MODULE) — V1 Lobby (créer / rejoindre / liste joueurs)
import * as AuthMod from "./auth.js";
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const auth = AuthMod.auth;
const db   = AuthMod.db;

const btnCreateRoom = document.getElementById("btnCreateRoom");
const btnJoinRoom   = document.getElementById("btnJoinRoom");
const btnCopyCode   = document.getElementById("btnCopyCode");
const btnStartGame  = document.getElementById("btnStartGame");
const btnLeaveRoom  = document.getElementById("btnLeaveRoom");

const joinCode      = document.getElementById("joinCode");
const gameMsg       = document.getElementById("gameMsg");

const lobbyCard     = document.getElementById("lobbyCard");
const roomCodeText  = document.getElementById("roomCodeText");
const playersList   = document.getElementById("playersList");

let currentRoomId = null;
let unsubPlayers = null;
let unsubRoom = null;

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
  unsubPlayers = null;
  unsubRoom = null;
}

function showLobby(show){
  if (!lobbyCard) return;
  lobbyCard.style.display = show ? "" : "none";
}

function renderPlayers(players){
  if (!playersList) return;
  playersList.innerHTML = "";

  if (!players.length){
    playersList.innerHTML = `<div class="game-msg">Aucun joueur pour l’instant.</div>`;
    return;
  }

  players.forEach(p=>{
    const div = document.createElement("div");
    div.className = "player-row";
    div.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
        <div style="font-weight:950;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${escapeHTML(p.name || "Joueur")}
        </div>
        <div class="player-badge">${p.isHost ? "Hôte" : "Participant"}</div>
      </div>
      <div class="player-badge">${escapeHTML(p.status || "")}</div>
    `;
    playersList.appendChild(div);
  });
}

// =======================
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
    status: "lobby", // lobby | playing | ended
  });

  await setDoc(doc(db, "rooms", roomId, "players", u.uid), {
    uid: u.uid,
    name: safeName(u),
    isHost: true,
    status: "prêt",
    joinedAt: serverTimestamp(),
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
    joinedAt: serverTimestamp(),
  }, { merge:true });

  await enterRoom(roomId);
}

async function enterRoom(roomId){
  cleanupSubs();
  currentRoomId = roomId;

  showLobby(true);
  if (roomCodeText) roomCodeText.textContent = roomId;

  unsubRoom = onSnapshot(doc(db, "rooms", roomId), (snap)=>{
    if (!snap.exists()){
      msg("❌ La partie a été supprimée.");
      leaveRoom(true);
      return;
    }
    const data = snap.data() || {};
    if (data.status === "playing"){
      msg("✅ Partie lancée ! (V1: gameplay à venir)");
      // plus tard : redirection vers la map
    }
  });

  unsubPlayers = onSnapshot(collection(db, "rooms", roomId, "players"), (snap)=>{
    const players = snap.docs.map(d=>d.data());
    players.sort((a,b)=> (b.isHost === true) - (a.isHost === true));
    renderPlayers(players);
  });

  msg("✅ Connecté au lobby.");
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

  alert("✅ Partie lancée (V1). Prochaine étape : la map + rôles.");
}

async function leaveRoom(silent=false){
  const u = auth.currentUser;

  if (!currentRoomId || !u) {
    cleanupSubs();
    currentRoomId = null;
    showLobby(false);
    return;
  }

  try{
    await deleteDoc(doc(db, "rooms", currentRoomId, "players", u.uid));
  } catch {}

  cleanupSubs();
  currentRoomId = null;
  showLobby(false);
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
    await joinRoom(joinCode?.value);
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

// Auth boot
onAuthStateChanged(auth, (u)=>{
  if (!u){
    msg("Connecte-toi pour jouer.");
    showLobby(false);
  } else {
    msg("");
  }
});
