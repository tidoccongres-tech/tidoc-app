const btnCreate = document.getElementById("btnCreate");
const btnJoin   = document.getElementById("btnJoin");
const btnHome   = document.getElementById("btnHome");

btnCreate.onclick = () => {
  sessionStorage.setItem("lobbyMode", "create");
  sessionStorage.removeItem("lobbyCode");
  window.location.href = "./lobby.html";
};

btnJoin.onclick = () => {
  const code = prompt("Entre le code de la partie :");
  if (!code) return;
  sessionStorage.setItem("lobbyMode", "join");
  sessionStorage.setItem("lobbyCode", code.trim().toUpperCase());
  window.location.href = "./lobby.html";
};

btnHome.onclick = () => {
  window.location.href = "./home.html";
};
