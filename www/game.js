const btnCreate = document.getElementById("btnCreate");
const btnJoin = document.getElementById("btnJoin");
const btnHome = document.getElementById("btnHome");

btnCreate.onclick = () => {
  window.location.href = "./lobby.html?mode=create";
};

btnJoin.onclick = () => {
  const code = prompt("Entre le code de la partie :");
  if (code) {
    window.location.href = "./lobby.html?mode=join&code=" + encodeURIComponent(code.trim().toUpperCase());
  }
};

btnHome.onclick = () => {
  window.location.href = "./home.html";
};
