import { auth, db } from "./auth.js";
import { onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const AVATARS = Array.from({ length: 10 }, (_, i) => `./avatars/avatar-${i+1}.png`);

const grid = document.getElementById("avatarGrid");
const saveBtn = document.getElementById("saveAvatarBtn");

let selected = "";

function render() {
  grid.innerHTML = "";
  AVATARS.forEach(url => {
    const btn = document.createElement("button");
    btn.className = "avatar-item-small";
    btn.innerHTML = `<img src="${url}">`;
    btn.onclick = () => {
      selected = url;
      grid.querySelectorAll(".avatar-item-small").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    };
    grid.appendChild(btn);
  });
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }
  render();
});

saveBtn.onclick = async () => {
  if (!selected) return;

  const u = auth.currentUser;

  await setDoc(doc(db, "users", u.uid), {
    avatarUrl: selected
  }, { merge: true });

  await updateProfile(u, { photoURL: selected });

  window.location.href = "./profile.html";
};
