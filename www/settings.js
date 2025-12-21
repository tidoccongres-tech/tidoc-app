// settings.js
import { auth, db, changePasswordWithReauth } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ===== Profil UI =====
const avatarBox = document.getElementById("currentAvatar");
const nameEl = document.getElementById("profileName");
const emailEl = document.getElementById("profileEmail");
const changeAvatarBtn = document.getElementById("changeAvatarBtn");

// ===== Password UI =====
const pwdMsg = document.getElementById("pwdMsg");
const oldPass = document.getElementById("oldPass");
const newPass = document.getElementById("newPass");
const newPass2 = document.getElementById("newPass2");
const btnChangePwd = document.getElementById("btnChangePwd");

function setPwdMsg(t = "") {
  if (pwdMsg) pwdMsg.textContent = t;
}

// ===== Change password =====
btnChangePwd?.addEventListener("click", async () => {
  setPwdMsg("");

  const o = (oldPass?.value || "").trim();
  const n1 = (newPass?.value || "").trim();
  const n2 = (newPass2?.value || "").trim();

  if (!o || !n1 || !n2) { setPwdMsg("❌ Remplis tous les champs."); return; }
  if (n1 !== n2) { setPwdMsg("❌ Les nouveaux mots de passe ne correspondent pas."); return; }
  if (n1.length < 6) { setPwdMsg("❌ Nouveau mot de passe trop court (min 6)."); return; }

  try {
    setPwdMsg("Modification…");
    btnChangePwd.disabled = true;

    await changePasswordWithReauth(o, n1);

    oldPass.value = "";
    newPass.value = "";
    newPass2.value = "";
    setPwdMsg("✅ Mot de passe modifié.");
  } catch (e) {
    const code = e?.code || "";
    if (code === "auth/wrong-password") setPwdMsg("❌ Ancien mot de passe incorrect.");
    else if (code === "auth/too-many-requests") setPwdMsg("⏳ Trop de tentatives, réessaie plus tard.");
    else setPwdMsg("Erreur: " + (e?.message || e));
    console.log("change password error:", e);
  } finally {
    btnChangePwd.disabled = false;
  }
});

// ===== Load profile =====
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "./login.html"; return; }

  // ✅ pseudo Firestore en priorité
  let prettyName = (user.displayName || "").trim() || "Utilisateur";

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const d = snap.data() || {};
      const n = (d.displayName || d.username || "").trim();
      if (n) prettyName = n;
    }
  } catch (e) {
    console.log("Firestore name fallback error:", e);
  }

  if (nameEl) nameEl.textContent = prettyName;
  if (emailEl) emailEl.textContent = user.email || "";

  // ✅ avatar
  let avatarUrl = user.photoURL || "";

  if (!avatarUrl) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) avatarUrl = snap.data()?.avatarUrl || "";
    } catch (e) {
      console.error("Erreur récupération avatar Firestore", e);
    }
  }

  if (avatarBox) {
    avatarBox.innerHTML = avatarUrl
      ? `<img src="${avatarUrl}" alt="Avatar utilisateur">`
      : `<div style="width:100%;height:100%;border-radius:50%;background:#e9f7fb;"></div>`;
  }
});

// ===== Avatar page =====
changeAvatarBtn?.addEventListener("click", () => {
  window.location.href = "./avatars.html";
});
