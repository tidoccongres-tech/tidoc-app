// login.js
import { signupEmail, loginEmail } from "./auth.js";

// ====== ÉLÉMENTS HTML ======
const form = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const nameInput = document.getElementById("name"); // uniquement pour inscription
const submitBtn = document.getElementById("submitBtn");
const msg = document.getElementById("loginMsg");

// ====== MODE ======
// true = inscription / false = connexion
let isSignup = false;

// ====== HELPERS ======
function showMsg(t = "") {
  if (msg) msg.textContent = t;
}

// ====== TOGGLE LOGIN / SIGNUP ======
document.getElementById("toggleMode")?.addEventListener("click", () => {
  isSignup = !isSignup;

  if (nameInput) nameInput.style.display = isSignup ? "" : "none";
  submitBtn.textContent = isSignup ? "Créer mon compte" : "Se connecter";
});

// ====== SUBMIT ======
form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const name = nameInput?.value.trim();

  if (!email || !password || (isSignup && !name)) {
    showMsg("Champs requis manquants.");
    return;
  }

  submitBtn.disabled = true;
  showMsg("⏳ Connexion...");

  try {
    if (isSignup) {
      await signupEmail({
        email,
        password,
        displayName: name
      });
    } else {
      await loginEmail({ email, password });
    }

    window.location.href = "./index.html";
  } catch (e) {
    showMsg("❌ " + (e?.message || "Erreur inconnue"));
  } finally {
    submitBtn.disabled = false;
  }
});
