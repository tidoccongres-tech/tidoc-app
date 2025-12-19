// settings.js (MODULE)
import { auth, db } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const avatarBox = document.getElementById("currentAvatar");
const nameEl = document.getElementById("profileName");
const emailEl = document.getElementById("profileEmail");
const changeBtn = document.getElementById("changeAvatarBtn");

function setAvatar(url) {
  if (!avatarBox) return;

  if (url) {
    avatarBox.innerHTML = `<img src="${url}" alt="Avatar" />`;
  } else {
    // placeholder propre (cercle)
    avatarBox.innerHTML = `<div style="
      width:100%;height:100%;
      border-radius:50%;
      background:rgba(23,140,168,.12);
    "></div>`;
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }

  // ✅ fallback immédiat (même si Firestore met du temps)
  if (nameEl) nameEl.textContent = user.displayName || "Utilisateur";
  if (emailEl) emailEl.textContent = user.email || "";

  // ✅ avatar : Auth d’abord
  let avatarUrl = user.photoURL || "";

  // ✅ fallback Firestore si besoin
  if (!avatarUrl) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) avatarUrl = snap.data().avatarUrl || "";
    } catch (e) {
      console.log("Firestore avatar error:", e);
    }
  }

  setAvatar(avatarUrl);
});

// bouton changer avatar
if (changeBtn) {
  changeBtn.addEventListener("click", () => {
    window.location.href = "./avatars.html";
  });
}
