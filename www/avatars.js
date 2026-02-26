// avatars.js (MODULE)
import { auth, db } from "./auth.js";
import {
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ✅ Tes avatars : /avatars/avatar-1.png ... avatar-10.png
const AVATAR_PATH = "./avatars/";
const AVATAR_COUNT = 10;

// ✅ Cache local pour affichage immédiat dans le header
const LS_KEY = "tidoc_avatar";

const grid = document.getElementById("avatarGrid");
const saveBtn = document.getElementById("saveAvatarBtn");
const msg = document.getElementById("avatarMsg");

let selectedUrl = "";
let currentUrl = "";

function show(t) {
  if (msg) msg.textContent = t || "";
}

function setActiveButton(url) {
  grid.querySelectorAll(".avatar-item-small").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-url") === url);
  });
}

function renderGrid() {
  if (!grid) return;
  grid.innerHTML = "";

  for (let i = 1; i <= AVATAR_COUNT; i++) {
    const url = `${AVATAR_PATH}avatar-${i}.png`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "avatar-item-small";
    btn.setAttribute("data-url", url);

    btn.innerHTML = `<img src="${url}" alt="Avatar ${i}">`;

    btn.addEventListener("click", () => {
      selectedUrl = url;
      setActiveButton(selectedUrl);

      // ✅ active le bouton seulement si changement
      saveBtn.disabled = (selectedUrl === currentUrl);
      show("");
    });

    grid.appendChild(btn);
  }

  // active visuel
  setActiveButton(selectedUrl);
}

async function loadCurrentAvatar(user) {
  // 1) photoURL
  currentUrl = user.photoURL || "";

  // 2) fallback Firestore users/{uid}.avatarUrl
  if (!currentUrl) {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) currentUrl = snap.data().avatarUrl || "";
  }

  // 3) fallback localStorage
  if (!currentUrl) {
    currentUrl = localStorage.getItem(LS_KEY) || "";
  }

  // 4) si rien du tout : pré-sélectionne avatar-1 (sans enregistrer)
  selectedUrl = currentUrl || `${AVATAR_PATH}avatar-1.png`;

  renderGrid();

  // bouton activé seulement si changement
  saveBtn.disabled = (selectedUrl === currentUrl);
}

async function saveAvatar(user) {
  if (!selectedUrl) {
    show("Choisis un avatar d’abord 🙂");
    return;
  }

  if (selectedUrl === currentUrl) {
    show("Déjà sélectionné ✅");
    return;
  }

  saveBtn.disabled = true;
  show("Enregistrement…");

  // ✅ 1) update Auth (photoURL)
  await updateProfile(user, { photoURL: selectedUrl });

  // ✅ 2) update Firestore
  await setDoc(
    doc(db, "users", user.uid),
    { avatarUrl: selectedUrl, updatedAt: serverTimestamp() },
    { merge: true }
  );

  // ✅ 3) cache local + notif header (update immédiat)
  localStorage.setItem(LS_KEY, selectedUrl);
  window.dispatchEvent(new CustomEvent("tidoc:avatar", { detail: { url: selectedUrl } }));

  // ✅ 4) refresh user en mémoire (utile)
  await user.reload();

  currentUrl = selectedUrl;
  show("Avatar enregistré ✅");

  // (option) si tu veux revenir auto :
  // window.location.href = "./profile.html";
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }

  try {
    await loadCurrentAvatar(user);
  } catch (e) {
    console.log(e);
    show("Erreur chargement: " + (e?.message || e));
  }

  saveBtn?.addEventListener("click", async () => {
    try {
      await saveAvatar(user);
    } catch (e) {
      console.log(e);
      show("Erreur: " + (e?.message || e));
      saveBtn.disabled = false;
    }
  });
});
