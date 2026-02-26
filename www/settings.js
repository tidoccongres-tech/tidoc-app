import { auth, db, changePasswordWithReauth } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ✅ pour vérifier l'ancien MDP sans changer
import {
  EmailAuthProvider,
  reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import { initFocusMode } from "./ui-fullscreen.js";
initFocusMode();

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
const oldPassStatus = document.getElementById("oldPassStatus");

function setPwdMsg(t = "") {
  if (pwdMsg) pwdMsg.textContent = t;
}
function setOldStatus(t = "", ok = false) {
  if (!oldPassStatus) return;
  oldPassStatus.textContent = t;
  oldPassStatus.classList.toggle("ok", ok);
  oldPassStatus.classList.toggle("bad", !ok && !!t);
}

function lockNewFields(locked) {
  if (newPass) newPass.disabled = locked;
  if (newPass2) newPass2.disabled = locked;
  if (btnChangePwd) btnChangePwd.disabled = locked;
}

// 🔒 au départ : on bloque tout
lockNewFields(true);

let verifyTimer = null;
let lastVerifiedOld = "";
let oldIsValid = false;

async function verifyOldPassword(user, plainOldPassword) {
  const cred = EmailAuthProvider.credential(user.email, plainOldPassword);
  await reauthenticateWithCredential(user, cred);
}

function setupOldPasswordGate(user){
  if (!oldPass) return;

  const run = async () => {
    setPwdMsg("");

    const o = (oldPass.value || "").trim();
    oldIsValid = false;

    // vide -> on rebloque
    if (!o) {
      setOldStatus("");
      lockNewFields(true);
      return;
    }

    // évite de re-vérifier le même mdp en boucle
    if (o === lastVerifiedOld && oldIsValid) {
      lockNewFields(false);
      return;
    }

    setOldStatus("⏳ Vérification de l’ancien mot de passe…", false);
    lockNewFields(true);

    try {
      await verifyOldPassword(user, o);
      oldIsValid = true;
      lastVerifiedOld = o;
      setOldStatus("✅ Ancien mot de passe validé.", true);
      lockNewFields(false);
      // focus direct sur nouveau
      newPass?.focus();
    } catch (e) {
      oldIsValid = false;
      lastVerifiedOld = "";
      const code = e?.code || "";
      if (code === "auth/wrong-password") setOldStatus("❌ Ancien mot de passe incorrect.", false);
      else if (code === "auth/too-many-requests") setOldStatus("⏳ Trop de tentatives, réessaie plus tard.", false);
      else setOldStatus("❌ Erreur de vérification.", false);
    }
  };

  // ✅ on vérifie quand tu quittes le champ + debounce quand tu tapes
  oldPass.addEventListener("blur", run);
  oldPass.addEventListener("input", () => {
    clearTimeout(verifyTimer);
    verifyTimer = setTimeout(run, 600);
  });
}

// ===== Change password =====
btnChangePwd?.addEventListener("click", async () => {
  setPwdMsg("");

  const o = (oldPass?.value || "").trim();
  const n1 = (newPass?.value || "").trim();
  const n2 = (newPass2?.value || "").trim();

  if (!o || !n1 || !n2) { setPwdMsg("❌ Remplis tous les champs."); return; }
  if (!oldIsValid) { setPwdMsg("❌ Valide d’abord l’ancien mot de passe."); return; }
  if (n1 !== n2) { setPwdMsg("❌ Les nouveaux mots de passe ne correspondent pas."); return; }
  if (n1.length < 6) { setPwdMsg("❌ Nouveau mot de passe trop court (min 6)."); return; }

  try {
    setPwdMsg("Modification…");
    btnChangePwd.disabled = true;

    await changePasswordWithReauth(o, n1);

    oldPass.value = "";
    newPass.value = "";
    newPass2.value = "";

    oldIsValid = false;
    lastVerifiedOld = "";
    setOldStatus("");
    lockNewFields(true);

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

// ===== Password eye toggle (identique au login) =====
const EYE_OPEN = `
<svg viewBox="0 0 24 24" aria-hidden="true">
  <path fill-rule="evenodd" clip-rule="evenodd"
    d="M6.30147 15.5771C4.77832 14.2684 3.6904 12.7726 3.18002 12C3.6904 11.2274 4.77832 9.73158 6.30147 8.42294C7.87402 7.07185 9.81574 6 12 6C14.1843 6 16.1261 7.07185 17.6986 8.42294C19.2218 9.73158 20.3097 11.2274 20.8201 12C20.3097 12.7726 19.2218 14.2684 17.6986 15.5771C16.1261 16.9282 14.1843 18 12 18C9.81574 18 7.87402 16.9282 6.30147 15.5771ZM12 4C9.14754 4 6.75717 5.39462 4.99812 6.90595C3.23268 8.42276 2.00757 10.1376 1.46387 10.9698C1.05306 11.5985 1.05306 12.4015 1.46387 13.0302C2.00757 13.8624 3.23268 15.5772 4.99812 17.0941C6.75717 18.6054 9.14754 20 12 20C14.8525 20 17.2429 18.6054 19.002 17.0941C20.7674 15.5772 21.9925 13.8624 22.5362 13.0302C22.947 12.4015 22.947 11.5985 22.5362 10.9698C21.9925 10.1376 20.7674 8.42276 19.002 6.90595C17.2429 5.39462 14.8525 4 12 4ZM10 12C10 10.8954 10.8955 10 12 10C13.1046 10 14 10.8954 14 12C14 13.1046 13.1046 14 12 14C10.8955 14 10 13.1046 10 12ZM12 8C9.7909 8 8.00004 9.79086 8.00004 12C8.00004 14.2091 9.7909 16 12 16C14.2092 16 16 14.2091 16 12C16 9.79086 14.2092 8 12 8Z"/>
</svg>
`;

const EYE_OFF = `
<svg viewBox="0 0 24 24" aria-hidden="true">
  <path fill-rule="evenodd" clip-rule="evenodd"
    d="M19.7071 5.70711C20.0976 5.31658 20.0976 4.68342 19.7071 4.29289C19.3166 3.90237 18.6834 3.90237 18.2929 4.29289L14.032 8.55382C13.4365 8.20193 12.7418 8 12 8C9.79086 8 8 9.79086 8 12C8 12.7418 8.20193 13.4365 8.55382 14.032L4.29289 18.2929C3.90237 18.6834 3.90237 19.3166 4.29289 19.7071C4.68342 20.0976 5.31658 20.0976 5.70711 19.7071L9.96803 15.4462C10.5635 15.7981 11.2582 16 12 16C14.2091 16 16 14.2091 16 12C16 11.2582 15.7981 10.5635 15.4462 9.96803L19.7071 5.70711ZM12.518 10.0677C12.3528 10.0236 12.1792 10 12 10C10.8954 10 10 10.8954 10 12C10 12.1792 10.0236 12.3528 10.0677 12.518L12.518 10.0677ZM11.482 13.9323L13.9323 11.482C13.9764 11.6472 14 11.8208 14 12C14 13.1046 13.1046 14 12 14C11.8208 14 11.6472 13.9764 11.482 13.9323ZM15.7651 4.8207C14.6287 4.32049 13.3675 4 12 4C9.14754 4 6.75717 5.39462 4.99812 6.90595C3.23268 8.42276 2.00757 10.1376 1.46387 10.9698C1.05306 11.5985 1.05306 12.4015 1.46387 13.0302C1.92276 13.7326 2.86706 15.0637 4.21194 16.3739L5.62626 14.9596C4.4555 13.8229 3.61144 12.6531 3.18002 12C3.6904 11.2274 4.77832 9.73158 6.30147 8.42294C7.87402 7.07185 9.81574 6 12 6C12.7719 6 13.5135 6.13385 14.2193 6.36658L15.7651 4.8207ZM12 18C11.2282 18 10.4866 17.8661 9.78083 17.6334L8.23496 19.1793C9.37136 19.6795 10.6326 20 12 20C14.8525 20 17.2429 18.6054 19.002 17.0941C20.7674 15.5772 21.9925 13.8624 22.5362 13.0302C22.947 12.4015 22.947 11.5985 22.5362 10.9698C22.0773 10.2674 21.133 8.93627 19.7881 7.62611L18.3738 9.04043C19.5446 10.1771 20.3887 11.3469 20.8201 12C20.3097 12.7726 19.2218 14.2684 17.6986 15.5771C16.1261 16.9282 14.1843 18 12 18Z"/>
</svg>
`;

function initPwToggles(){
  document.querySelectorAll(".pw-toggle").forEach(btn=>{
    const targetId = btn.getAttribute("data-target");
    const input = document.getElementById(targetId);
    if (!input) return;

    btn.innerHTML = EYE_OPEN;

    btn.addEventListener("click", (e)=>{
      e.preventDefault();
      e.stopPropagation();

      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      btn.innerHTML = isHidden ? EYE_OFF : EYE_OPEN;

      input.focus();
      try {
        const len = input.value.length;
        input.setSelectionRange(len, len);
      } catch(_) {}
    });
  });
}

// ===== Load profile =====
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "./login.html"; return; }

  initPwToggles();
  setupOldPasswordGate(user);

  // pseudo Firestore en priorité
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

  // avatar
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
    avatarBox.className = "profile-avatar-lg";
    avatarBox.innerHTML = avatarUrl
      ? `<img src="${avatarUrl}" alt="Avatar utilisateur">`
      : `<div style="width:100%;height:100%;opacity:.55;"></div>`;
  }
});

// ===== Avatar page =====
changeAvatarBtn?.addEventListener("click", () => {
  window.location.href = "./avatars.html";
});
