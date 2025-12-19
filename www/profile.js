import { auth, db } from "./auth.js";
import { onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const AVATAR_COUNT = 10;
const AVATAR_BASE = "./avatars/";
const AVATARS = Array.from({ length: AVATAR_COUNT }, (_, i) => `${AVATAR_BASE}avatar-${i + 1}.png`);

const grid = document.getElementById("avatarGrid");
const statusEl = document.getElementById("profileStatus");
const saveBtn = document.getElementById("saveAvatarBtn");

let selectedAvatar = "";

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

function renderGrid(currentUrl = "") {
  if (!grid) return;
  grid.innerHTML = "";

  AVATARS.forEach((url) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "avatar-item";
    btn.dataset.url = url;

    btn.innerHTML = `
      <img src="${url}" alt="Avatar" />
    `;

    // sélection initiale
    if (url === currentUrl) btn.classList.add("active");

    btn.addEventListener("click", () => {
      selectedAvatar = url;
      grid.querySelectorAll(".avatar-item").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      setStatus("Avatar sélectionné ✅");
    });

    grid.appendChild(btn);
  });
}

async function loadExistingAvatar(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const url = snap.exists() ? (snap.data().avatarUrl || "") : "";
    return url || "";
  } catch {
    return "";
  }
}

async function saveAvatar(uid, email, displayName) {
  if (!selectedAvatar) {
    setStatus("Choisis un avatar avant d’enregistrer 🙂");
    return;
  }

  setStatus("Enregistrement…");

  // 1) Firestore users/{uid}
  await setDoc(doc(db, "users", uid), {
    email: (email || "").toLowerCase(),
    displayName: displayName || "Utilisateur",
    avatarUrl: selectedAvatar,
    updatedAt: serverTimestamp()
  }, { merge: true });

  // 2) Optionnel : met aussi photoURL dans Firebase Auth (pratique)
  try {
    await updateProfile(auth.currentUser, { photoURL: selectedAvatar });
  } catch {}

  // 3) met à jour le cache local du header
  localStorage.setItem(`tidoc_avatar_${uid}`, selectedAvatar);

  setStatus("Avatar enregistré ✅");
  // recharge pour que le header prenne direct le nouvel avatar
  window.location.reload();
}

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, async (u) => {
    if (!u) {
      // si pas connecté → renvoie login
      window.location.href = "./login.html";
      return;
    }

    const current = await loadExistingAvatar(u.uid);
    selectedAvatar = current || "";
    renderGrid(current);

    setStatus(current ? "Ton avatar actuel est sélectionné." : "Aucun avatar enregistré : choisis-en un.");

    saveBtn?.addEventListener("click", () =>
      saveAvatar(u.uid, u.email, u.displayName)
    );
  });
});
