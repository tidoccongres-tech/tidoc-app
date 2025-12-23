// login.js (MODULE) — Premium Auth (signup/login) + pseudo unique + eye toggle
console.log("✅ login.js chargé");

import { auth, db, signupEmail, loginEmail, resetPassword } from "./auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const LS_NAME = "tidoc_name";
const ADMIN_EMAIL = "tidoc.congres@gmail.com";

// =====================
// DOM
// =====================
const msg = document.getElementById("authMsg");

const tabs = Array.from(document.querySelectorAll(".auth-tab"));
const panels = Array.from(document.querySelectorAll(".auth-panel"));

const signupPseudo = document.getElementById("signupPseudo");
const signupEmail  = document.getElementById("signupEmail");
const signupPass   = document.getElementById("signupPassword");
const signupBtn    = document.getElementById("signupBtn");

const loginEmailEl = document.getElementById("loginEmail");
const loginPassEl  = document.getElementById("loginPassword");
const loginBtn     = document.getElementById("loginBtn");

// (Optionnel : si tu ajoutes un bouton reset dans ton HTML)
const resetBtn = document.getElementById("resetBtn");

// =====================
// Helpers UI
// =====================
function setMsg(t = "") { if (msg) msg.textContent = t; }

function setTab(which) {
  tabs.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === which));
  panels.forEach(p => {
    const on = p.dataset.panel === which;
    p.style.display = on ? "" : "none";
  });
  setMsg("");
}

tabs.forEach(btn => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab || "signup"));
});

// =====================
// Redirect si déjà connecté (avec lock)
// =====================
let authRedirectLock = false;

onAuthStateChanged(auth, (u) => {
  if (authRedirectLock) return;
  if (u) window.location.href = "./index.html";
});

// =====================
// Username unique LIVE
// =====================
function normalizeUsername(v = "") {
  return v
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

const RESERVED = new Set(["admin", "moderateur", "mod", "support", "tidoc", "tidocteam"]);
let nameCheckTimer = null;

async function checkUsername(norm) {
  if (!norm) return { ok: true, norm: "" };
  if (norm.length < 3) return { ok: false, norm, msg: "❌ Pseudo trop court (min 3)." };
  if (RESERVED.has(norm)) return { ok: false, norm, msg: "❌ Ce pseudo est réservé." };

  try {
    const snap = await getDoc(doc(db, "usernames", norm));
    if (snap.exists()) return { ok: false, norm, msg: "❌ Pseudo déjà pris." };
    return { ok: true, norm, msg: "✅ Pseudo disponible." };
  } catch (e) {
    console.log("checkUsername error:", e);
    // on n'empêche pas le signup si réseau KO
    return { ok: true, norm, msg: "⚠️ Vérif impossible (réseau)." };
  }
}

// Affichage petit feedback sous le champ (optionnel si tu as une zone dédiée)
function ensurePseudoHint() {
  let el = document.getElementById("signupPseudoHint");
  if (el) return el;

  // crée une ligne de hint juste après le champ pseudo (le field-premium)
  el = document.createElement("div");
  el.id = "signupPseudoHint";
  el.className = "auth-hint";

  const wrap = signupPseudo?.closest(".field-premium");
  if (wrap) wrap.insertAdjacentElement("afterend", el);

  return el;
}

const pseudoHint = signupPseudo ? ensurePseudoHint() : null;

async function checkUsernameLive() {
  if (!signupPseudo) return { ok: true, norm: "" };

  const raw = signupPseudo.value || "";
  const norm = normalizeUsername(raw);

  if (!norm) {
    if (pseudoHint) pseudoHint.textContent = "";
    signupBtn && (signupBtn.disabled = false);
    return { ok: true, norm: "" };
  }

  signupBtn && (signupBtn.disabled = true);
  if (pseudoHint) pseudoHint.textContent = "⏳ Vérification…";

  const r = await checkUsername(norm);

  if (pseudoHint) pseudoHint.textContent = r.msg || "";
  if (signupBtn) signupBtn.disabled = !r.ok;

  return r;
}

signupPseudo?.addEventListener("input", () => {
  clearTimeout(nameCheckTimer);
  nameCheckTimer = setTimeout(checkUsernameLive, 250);
});

// =====================
// Eye toggle (premium)
// =====================
const EYE_OPEN = `
<svg viewBox="0 0 24 24" aria-hidden="true">
  <path fill-rule="evenodd" clip-rule="evenodd"
    d="M6.30147 15.5771C4.77832 14.2684 3.6904 12.7726 3.18002 12C3.6904 11.2274 4.77832 9.73158 6.30147 8.42294C7.87402 7.07185 9.81574 6 12 6C14.1843 6 16.1261 7.07185 17.6986 8.42294C19.2218 9.73158 20.3097 11.2274 20.8201 12C20.3097 12.7726 19.2218 14.2684 17.6986 15.5771C16.1261 16.9282 14.1843 18 12 18C9.81574 18 7.87402 16.9282 6.30147 15.5771ZM12 4C9.14754 4 6.75717 5.39462 4.99812 6.90595C3.23268 8.42276 2.00757 10.1376 1.46387 10.9698C1.05306 11.5985 1.05306 12.4015 1.46387 13.0302C2.00757 13.8624 3.23268 15.5772 4.99812 17.0941C6.75717 18.6054 9.14754 20 12 20C14.8525 20 17.2429 18.6054 19.002 17.0941C20.7674 15.5772 21.9925 13.8624 22.5362 13.0302C22.947 12.4015 22.947 11.5985 22.5362 10.9698C21.9925 10.1376 20.7674 8.42276 19.002 6.90595C17.2429 5.39462 14.8525 4 12 4ZM10 12C10 10.8954 10.8955 10 12 10C13.1046 10 14 10.8954 14 12C14 13.1046 13.1046 14 12 14C10.8955 14 10 13.1046 10 12Z"/>
</svg>
`;

const EYE_OFF = `
<svg viewBox="0 0 24 24" aria-hidden="true">
  <path fill-rule="evenodd" clip-rule="evenodd"
    d="M19.7071 5.70711C20.0976 5.31658 20.0976 4.68342 19.7071 4.29289C19.3166 3.90237 18.6834 3.90237 18.2929 4.29289L14.032 8.55382C13.4365 8.20193 12.7418 8 12 8C9.79086 8 8 9.79086 8 12C8 12.7418 8.20193 13.4365 8.55382 14.032L4.29289 18.2929C3.90237 18.6834 3.90237 19.3166 4.29289 19.7071C4.68342 20.0976 5.31658 20.0976 5.70711 19.7071L9.96803 15.4462C10.5635 15.7981 11.2582 16 12 16C14.2091 16 16 14.2091 16 12C16 11.2582 15.7981 10.5635 15.4462 9.96803L19.7071 5.70711ZM12.518 10.0677C12.3528 10.0236 12.1792 10 12 10C10.8954 10 10 10.8954 10 12C10 12.1792 10.0236 12.3528 10.0677 12.518L12.518 10.0677ZM11.482 13.9323L13.9323 11.482C13.9764 11.6472 14 11.8208 14 12C14 13.1046 13.1046 14 12 14C11.8208 14 11.6472 13.9764 11.482 13.9323Z"/>
</svg>
`;

function initEyeButtons() {
  document.querySelectorAll(".pw-eye").forEach((btn) => {
    const targetId = btn.getAttribute("data-target");
    const input = document.getElementById(targetId);
    if (!input) return;

    btn.innerHTML = EYE_OPEN;
    btn.classList.add("ready"); // ✅ ICI

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const hidden = input.type === "password";
      input.type = hidden ? "text" : "password";
      btn.innerHTML = hidden ? EYE_OFF : EYE_OPEN;

      input.focus();
      try {
        const len = input.value.length;
        input.setSelectionRange(len, len);
      } catch (_) {}
    });
  });
}
initEyeButtons();

// =====================
// Actions
// =====================
signupBtn?.addEventListener("click", async () => {
  authRedirectLock = true;

  try {
    setMsg("");

    const displayName = (signupPseudo?.value || "").trim();
    const email = (signupEmail?.value || "").trim();
    const password = signupPass?.value || "";

    if (!displayName || !email || !password) {
      setMsg("❌ Remplis pseudo, email et mot de passe.");
      authRedirectLock = false;
      return;
    }

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      setMsg("❌ Adresse email invalide.");
      authRedirectLock = false;
      return;
    }

    if (password.length < 6) {
      setMsg("❌ Mot de passe trop court (min 6 caractères).");
      authRedirectLock = false;
      return;
    }

    setMsg("⏳ Création du compte…");

    const norm = normalizeUsername(displayName);
    const r = await checkUsername(norm);
    if (!r.ok) {
      setMsg(r.msg || "❌ Pseudo invalide.");
      authRedirectLock = false;
      return;
    }

    await signupEmail({ email, password, displayName });

    localStorage.setItem(LS_NAME, displayName);
    window.dispatchEvent(new CustomEvent("tidoc:auth"));
    window.location.href = "./index.html";
  } catch (e) {
    authRedirectLock = false;

    const code = (e?.code || "").toLowerCase();
    const m = (e?.message || "").toLowerCase();

    if (code === "auth/email-already-in-use" || (m.includes("email") && m.includes("already"))) {
      setMsg("❌ Email déjà utilisé.");
    } else {
      setMsg("Erreur: " + (e?.message || String(e)));
    }
  }
});

loginBtn?.addEventListener("click", async () => {
  authRedirectLock = true;

  try {
    setMsg("⏳ Connexion…");

    const email = (loginEmailEl?.value || "").trim();
    const password = loginPassEl?.value || "";

    await loginEmail({ email, password });

    const dn = (auth.currentUser?.displayName || "").trim();
    if (dn) localStorage.setItem(LS_NAME, dn);

    window.dispatchEvent(new CustomEvent("tidoc:auth"));
    window.location.href = "./index.html";
  } catch (e) {
    authRedirectLock = false;
    setMsg("Erreur: " + (e?.message || String(e)));
  }
});

// Reset (optionnel)
// Ajoute un bouton dans ton HTML si tu veux : <button id="resetBtn" ...>Mot de passe oublié</button>
resetBtn?.addEventListener("click", async () => {
  const email = (loginEmailEl?.value || "").trim();
  if (!email) { setMsg("Mets ton email d’abord."); return; }

  try {
    setMsg("⏳ Envoi de l’email…");
    await resetPassword(email, { redirectUrl: location.origin + "/login.html" });
    setMsg("✅ Email de réinitialisation envoyé (check spam aussi).");
  } catch (e) {
    const code = (e?.code || "");
    if (code === "auth/user-not-found") setMsg("❌ Aucun compte avec cet email.");
    else if (code === "auth/invalid-email") setMsg("❌ Email invalide.");
    else if (code === "auth/too-many-requests") setMsg("⏳ Trop de tentatives, réessaie plus tard.");
    else setMsg("Erreur: " + (e?.message || String(e)));
  }
});

// Bonus UX: Entrée = submit
signupPass?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") signupBtn?.click();
});
loginPassEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn?.click();
});

// Par défaut on reste sur signup
setTab("signup");
