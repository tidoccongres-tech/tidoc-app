// avatars.js (MODULE)
import { auth, db } from "./auth.js";
import { onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// ⚠️ Tes avatars sont dans /avatars/ et se nomment avatar-1.png ... avatar-10.png
// Adapte le dossier si besoin (ex: "./avatars/avatar-1.png")
const AVATAR_PATH = "./avatars/";
const AVATAR_COUNT = 10;

const grid = document.getElementById("avatarGrid");
const saveBtn = document.getElementById("saveAvatarBtn");
const msg = document.getElementById("avatarMsg");

let selectedUrl = "";
let currentUrl = "";

function show(t) {
  if (msg) msg.textContent = t || "";
}

function renderGrid() {
  grid.innerHTML = "";

  for (let i = 1; i <= AVATAR_COUNT; i++) {
    const url = `${AVATAR_PATH}avatar-${i}.png`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "avatar-item-small";
    btn.setAttribute("data-url", url);
    btn.style.border = "2px solid transparent";

    btn.innerHTML = `<img src="${url}" alt="Avatar ${i}">`;

    // actif si déjà sélectionné
    if (url === selectedUrl) btn.classList.add("active");

    btn.addEventListener("click", () => {
      selectedUrl = url;

      // active visuellement
      grid.querySelectorAll(".avatar-item-small").forEach(el => el.classList.remove("active"));
      btn.classList.add("active");

      // bouton enregistrer activé
      saveBtn.disabled = false;
      show("");
    });

    grid.appendChild(btn);
  }
}

async function loadCurrentAvatar(user) {
  currentUrl = user.photoURL || "";

  // fallback Firestore
  if (!currentUrl) {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) currentUrl = snap.data().avatarUrl || "";
  }

  // si toujours rien -> on pré-sélectionne le 1 (mais sans enregistrer)
  selectedUrl = currentUrl || `${AVATAR_PATH}avatar-1.png`;

  // bouton enregistrer seulement si changement
  saveBtn.disabled = (selectedUrl === currentUrl);
  renderGrid();
}

async function saveAvatar(user) {
  if (!selectedUrl) {
    show("Choisis un avatar d’abord 🙂");
    return;
  }

  // si pas de changement : pas besoin
  if (selectedUrl === currentUrl) {
    show("Déjà sélectionné ✅");
    return;
  }

  saveBtn.disabled = true;
  show("Enregistrement…");

  // 1) met à jour Auth (pour que le header le voit direct)
  await updateProfile(user, { photoURL: selectedUrl });

  // 2) stocke dans Firestore
  await setDoc(doc(db, "users", user.uid), {
    avatarUrl: selectedUrl,
    updatedAt: serverTimestamp()
  }, { merge: true });

  currentUrl = selectedUrl;
  show("Avatar enregistré ✅");

  // option : retour auto sur Profil
  // window.location.href = "./profile.html";
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }

  await loadCurrentAvatar(user);

  saveBtn.addEventListener("click", async () => {
    try {
      await saveAvatar(user);
    } catch (e) {
      console.log(e);
      show("Erreur: " + (e?.message || e));
      saveBtn.disabled = false;
    }
  });
});
