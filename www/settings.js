// settings.js
import { auth, db, changePasswordWithReauth } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const avatarBox = document.getElementById("currentAvatar");
const nameEl = document.getElementById("profileName");
const emailEl = document.getElementById("profileEmail");
const changeAvatarBtn = document.getElementById("changeAvatarBtn");

const msg = document.getElementById("pwdMsg");
const oldP = document.getElementById("oldPass");
const newP = document.getElementById("newPass");
const newP2 = document.getElementById("newPass2");

document.getElementById("btnChangePwd").onclick = async () => {
  msg.textContent = "";

  if (newP.value !== newP2.value) {
    msg.textContent = "❌ Les deux nouveaux mots de passe ne correspondent pas.";
    return;
  }

  try {
    msg.textContent = "Modification…";
    await changePasswordWithReauth(oldP.value, newP.value); // ta fonction auth.js
    msg.textContent = "✅ Mot de passe modifié.";
    oldP.value = newP.value = newP2.value = "";
  } catch (e) {
    msg.textContent = "❌ " + (e?.message || e);
  }
};

function setPassMsg(t=""){ if (passMsg) passMsg.textContent = t; }

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "./login.html"; return; }

    // ✅ Firestore en priorité pour le pseudo
  let prettyName = (user.displayName || "").trim();

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

  nameEl.textContent = prettyName || "Utilisateur";
  emailEl.textContent = user.email || "";

  let avatarUrl = user.photoURL || "";
  if (!avatarUrl) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) avatarUrl = snap.data().avatarUrl || "";
    } catch (e) {
      console.error("Erreur récupération avatar Firestore", e);
    }
  }

  avatarBox.innerHTML = avatarUrl
    ? `<img src="${avatarUrl}" alt="Avatar utilisateur">`
    : `<div style="width:100%;height:100%;border-radius:50%;background:#e9f7fb;"></div>`;
});

changeAvatarBtn?.addEventListener("click", () => {
  window.location.href = "./avatars.html";
});

// ✅ changer mot de passe
changePassBtn?.addEventListener("click", async () => {
  try {
    setPassMsg("");

    const o = oldPass?.value || "";
    const n1 = newPass1?.value || "";
    const n2 = newPass2?.value || "";

    if (!o || !n1 || !n2) { setPassMsg("❌ Remplis tous les champs."); return; }
    if (n1 !== n2) { setPassMsg("❌ Les nouveaux mots de passe ne correspondent pas."); return; }
    if (n1.length < 6) { setPassMsg("❌ Nouveau mot de passe trop court (min 6)."); return; }

    setPassMsg("Mise à jour…");
    changePassBtn.disabled = true;

    await changePasswordWithReauth(o, n1);

    oldPass.value = "";
    newPass1.value = "";
    newPass2.value = "";
    setPassMsg("✅ Mot de passe modifié.");
  } catch (e) {
    const code = e?.code || "";
    if (code === "auth/wrong-password") setPassMsg("❌ Ancien mot de passe incorrect.");
    else if (code === "auth/too-many-requests") setPassMsg("⏳ Trop de tentatives, réessaie plus tard.");
    else setPassMsg("Erreur: " + (e?.message || e));
    console.log("change password error:", e);
  } finally {
    changePassBtn.disabled = false;
  }
});
