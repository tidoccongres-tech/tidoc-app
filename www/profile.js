import { auth, db } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const avatarBox = document.getElementById("currentAvatar");
const nameEl = document.getElementById("profileName");
const emailEl = document.getElementById("profileEmail");
const changeBtn = document.getElementById("changeAvatarBtn");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }

  nameEl.textContent = user.displayName || "Utilisateur";
  emailEl.textContent = user.email || "";

  let avatarUrl = user.photoURL || "";

  // fallback Firestore
  if (!avatarUrl) {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) avatarUrl = snap.data().avatarUrl || "";
  }

  avatarBox.innerHTML = avatarUrl
    ? `<img src="${avatarUrl}" alt="Avatar">`
    : `<div class="avatar-placeholder">?</div>`;
});

changeBtn.addEventListener("click", () => {
  window.location.href = "./avatars.html";
});
