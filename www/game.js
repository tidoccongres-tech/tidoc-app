const screenMenu  = document.getElementById("screenMenu");
const screenLobby = document.getElementById("screenLobby");

function showScreen(which){
  if (which === "menu"){
    screenMenu.style.display = "";
    screenLobby.style.display = "none";
  } else {
    screenMenu.style.display = "none";
    screenLobby.style.display = "";
  }
}

const btnCreate = document.getElementById("btnCreate");
const btnJoin   = document.getElementById("btnJoin");
const btnHome   = document.getElementById("btnHome");

const screenMenu  = document.getElementById("screenMenu");
const screenLobby = document.getElementById("screenLobby");

function showScreen(which){
  if (which === "menu"){
    screenMenu.style.display = "";
    screenLobby.style.display = "none";
  } else if (which === "lobby") {
    screenMenu.style.display = "none";
    screenLobby.style.display = "";
  }
}

// Boutons menu
const btnCreate = document.getElementById("btnCreate");
const btnJoin   = document.getElementById("btnJoin");
const btnHome   = document.getElementById("btnHome");

// Actions
btnCreate?.addEventListener("click", async ()=>{
  showScreen("lobby");
  await createRoom();
});

btnJoin?.addEventListener("click", async ()=>{
  const code = prompt("Entre le code de la partie :");
  if (!code) return;
  showScreen("lobby");
  await joinRoom(code.trim().toUpperCase());
});

btnHome?.addEventListener("click", ()=>{
  window.location.href = "./index.html";
});

// Au chargement on affiche le menu
showScreen("menu");
