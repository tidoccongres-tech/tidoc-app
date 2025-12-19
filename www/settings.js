// settings.js
import { auth, db, AVATARS, requireAuthOrRedirect } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// 🔐 page protégée
requireAuthOrRedirect("./login.html");

const grid = document.getElementById("avatarGrid");

async function loadProfile(uid){
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

function renderAvatars(currentAvatar){
  grid.innerHTML = "";

  AVATARS.forEach((url) => {
    const div = document.createElement("div");
    div.className = "avatar-item" + (url === currentAvatar ? " selected" : "");

    div.innerHTML = `<img src="${url}" alt="avatar">`;

    div.onclick = async () => {
      await setDoc(
        doc(db, "users", auth.currentUser.uid),
        { avatarUrl: url },
        { merge: true }
      );

      renderAvatars(url);
      alert("Avatar mis à jour ✅");
    };

    grid.appendChild(div);
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const profile = await loadProfile(user.uid);
  renderAvatars(profile?.avatarUrl);
});
