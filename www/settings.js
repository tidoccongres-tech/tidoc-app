// settings.js (MODULE)
// Page "Paramètres" = affiche directement le profil + bouton changer d’avatar

import { auth, db } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const avatarBox = document.getElementById("currentAvatar");
const nameEl = document.getElementById("profileName");
const emailEl = document.getElementById("profileEmail");
const changeBtn = document.getElementById("changeAvatarBtn");

function setAvatar(url) {
  if (!avatarBox) return;

  avatarBox.innerHTML = url
    ? `<img src="${url}" alt="Avatar">`
    : `<div class="avatar-placeholder">?</div>`;
}

onAuthStateChanged(auth, async (user) => {
  // 🔒 sécurité : si pas connecté -> login
  if (!user) {
    window.location.href = "./login.html";
    return;
  }

  // Nom / email
  if (nameEl) nameEl.textContent = user.displayName || "Utilisateur";
  if (emailEl) emailEl.textContent = user.email || "";

  // Avatar : Auth d’abord, sinon Firestore
  let avatarUrl = user.photoURL || "";

  if (!avatarUrl) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) avatarUrl = snap.data().avatarUrl || "";
    } catch (e) {
      console.log("Firestore read users error:", e);
    }
  }

  setAvatar(avatarUrl);
});

// Bouton -> page avatars
if (changeBtn) {
  changeBtn.addEventListener("click", () => {
    window.location.href = "./avatars.html";
  });
}
