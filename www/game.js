const btnCreate = document.getElementById("btnCreate");
const btnJoin   = document.getElementById("btnJoin");
const btnHome   = document.getElementById("btnHome");
const mode = sessionStorage.getItem("gameMode");
const code = sessionStorage.getItem("gameCode");

if (mode === "create") {
  console.log("Création automatique de partie");
  createRoom(); // ta fonction existante
}

if (mode === "join" && code) {
  console.log("Connexion automatique à", code);
  joinRoom(code); // ta fonction existante
}


btnCreate.onclick = () => {
  sessionStorage.setItem("gameMode", "create");
  sessionStorage.removeItem("gameCode");
  window.location.href = "./game.html";
};

btnJoin.onclick = () => {
  const code = prompt("Entre le code de la partie :");
  if (!code) return;
  sessionStorage.setItem("gameMode", "join");
  sessionStorage.setItem("gameCode", code.trim().toUpperCase());
  window.location.href = "./game.html";
};

btnHome.onclick = () => {
  window.location.href = "./index.html";
};
