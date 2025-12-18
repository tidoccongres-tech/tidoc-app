// header-user-menu.js (MODULE)
import { auth, db, AVATARS, logout, getUserProfile } from "./auth.js";
import { onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

function pickRandomAvatar() {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

async function ensureAvatarForUser(user) {
  // 1) photoURL Firebase Auth
  let avatarUrl = user.photoURL || "";

  // 2) sinon Firestore users/{uid}
  if (!avatarUrl) {
    const prof = await getUserProfile(user.uid);
    avatarUrl = prof?.avatarUrl || "";
  }

  // 3) sinon on attribue aléatoire
  if (!avatarUrl) {
    avatarUrl = pickRandomAvatar();

    // écrit dans Auth + Firestore
    await updateProfile(user, { photoURL: avatarUrl });

    await setDoc(
      doc(db, "users", user.uid),
      {
        email: (user.email || "").toLowerCase(),
        displayName: user.displayName || "Utilisateur",
        avatarUrl,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  return avatarUrl;
}

function renderMenu(slot, { avatarUrl }) {
  slot.innerHTML = `
    <div class="user-menu">
      <button class="user-btn" id="userBtn" type="button" aria-label="Profil">
        <img class="user-avatar" src="${avatarUrl}" alt="avatar">
      </button>

      <div class="user-dd" id="userDd" style="display:none;">
        <button class="user-dd-item" id="btnSettings" type="button">Paramètres</button>
        <button class="user-dd-item danger" id="btnLogout" type="button">Se déconnecter</button>
      </div>
    </div>
  `;

  const btn = slot.querySelector("#userBtn");
  const dd  = slot.querySelector("#userDd");

  btn.addEventListener("click", () => {
    dd.style.display = dd.style.display === "none" ? "block" : "none";
  });

  // ferme si clic ailleurs
  document.addEventListener("click", (e) => {
    if (!slot.contains(e.target)) dd.style.display = "none";
  });

  slot.querySelector("#btnSettings").addEventListener("click", () => {
    // page à créer ensuite : profile.html (ou settings.html)
    window.location.href = "./profile.html";
  });

  slot.querySelector("#btnLogout").addEventListener("click", async () => {
    await logout();
    window.location.href = "./login.html";
  });
}

function injectCSS() {
  if (document.getElementById("userMenuCSS")) return;
  const style = document.createElement("style");
  style.id = "userMenuCSS";
  style.textContent = `
    .user-menu{position:relative;display:inline-block}
    .user-btn{width:44px;height:44px;border-radius:50%;border:none;background:transparent;padding:0;cursor:pointer}
    .user-avatar{width:44px;height:44px;border-radius:50%;object-fit:cover;box-shadow:0 2px 10px rgba(0,0,0,.15)}
    .user-dd{position:absolute;top:52px;left:0;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:12px;min-width:160px;box-shadow:0 12px 30px rgba(0,0,0,.18);overflow:hidden;z-index:9999}
    .user-dd-item{width:100%;text-align:left;padding:12px 12px;border:none;background:#fff;cursor:pointer;font-weight:600}
    .user-dd-item:hover{background:#f5f7f9}
    .user-dd-item.danger{color:#b00020}
  `;
  document.head.appendChild(style);
}

window.addEventListener("DOMContentLoaded", () => {
  injectCSS();

  const slot = document.getElementById("userMenuSlot");
  if (!slot) return;

  onAuthStateChanged(auth, async (u) => {
    if (!u) {
      // si pas connecté → renvoie login sur pages protégées si tu veux :
      // window.location.href = "./login.html";
      slot.innerHTML = ""; // ou un bouton "Se connecter"
      return;
    }

    const avatarUrl = await ensureAvatarForUser(u);
    renderMenu(slot, { avatarUrl });
  });
});
