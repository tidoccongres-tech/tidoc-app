// settings.js
import { auth, db } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// éléments HTML
const avatarBox = document.getElementById("currentAvatar");
const nameEl = document.getElementById("profileName");
const emailEl = document.getElementById("profileEmail");
const changeAvatarBtn = document.getElementById("changeAvatarBtn");

// sécurité : redirection si non connecté
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }

  /* ===== NOM & EMAIL ===== */
  nameEl.textContent = user.displayName || "Utilisateur";
  emailEl.textContent = user.email || "";

  /* ===== AVATAR ===== */
  let avatarUrl = user.photoURL || "";

  // fallback Firestore (si jamais photoURL pas encore synchro)
  if (!avatarUrl) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        avatarUrl = snap.data().avatarUrl || "";
      }
    } catch (e) {
      console.error("Erreur récupération avatar Firestore", e);
    }
  }

  // affichage avatar ou placeholder
  avatarBox.innerHTML = avatarUrl
    ? `<img src="${avatarUrl}" alt="Avatar utilisateur">`
    : `<div style="
        width:100%;
        height:100%;
        border-radius:50%;
        background:#e9f7fb;
      "></div>`;
});

/* ===== BOUTON CHANGER D’AVATAR ===== */
changeAvatarBtn.addEventListener("click", () => {
  window.location.href = "./avatars.html";
});
