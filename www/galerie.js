/* ===== GALERIE : switch années ===== */
// galerie.js (MODULE)
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  deleteDoc,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ✅ Evite double init
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ====== CONFIG CLOUDINARY ======
const CLOUD_NAME = "dctwkkvn1";
const UPLOAD_PRESET = "tidoc_galerie";

// ✅ Admin email (source de vérité simple)
const ADMIN_EMAIL = "tidoc.congres@gmail.com";

// UI (match ton galerie.html)
const grid = document.getElementById("galleryGrid");
const addPhotosBtn = document.getElementById("addPhotosBtn");
const yearBtns = Array.from(document.querySelectorAll(".year-btn"));

let currentYear = "2025";
let IS_ADMIN = false;

// ---------- helpers ----------
function requireLogin(actionText = "faire ça") {
  if (!auth.currentUser) {
    alert(
      `Connexion requise 🔒\n\n` +
      `Pour ${actionText}, connecte-toi via l’icône Profil (en haut à gauche).`
    );
    return false;
  }
  return true;
}

function escapeHTML(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ✅ Admin = email OU role Firestore (fallback)
async function computeIsAdmin(user) {
  if (!user) return false;

  const email = (user.email || "").toLowerCase();
  if (email === ADMIN_EMAIL.toLowerCase()) return true;

  // fallback si tu utilises users/{uid}.role
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists() && snap.data()?.role === "admin") return true;
  } catch (_) {}

  return false;
}

// ---------- gallery ----------
async function loadGallery(year) {
  if (!grid) return;

  grid.innerHTML = `<div class="card"><p>Chargement…</p></div>`;

  const qy = query(
    collection(db, "gallery"),
    where("year", "==", year),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(qy);

  if (snap.empty) {
    grid.innerHTML = `<div class="card"><p>Aucune photo pour l’instant.</p></div>`;
    return;
  }

  grid.innerHTML = "";

  for (const d of snap.docs) {
    const item = d.data();
    const canDelete = IS_ADMIN;

    const wrap = document.createElement("div");
    wrap.className = "gallery-item";

    wrap.innerHTML = `
      <img src="${escapeHTML(item.url)}" alt="" loading="lazy">
      ${canDelete ? `<button class="gallery-del" type="button" title="Supprimer" data-del="${d.id}">🗑️</button>` : ""}
    `;

    grid.appendChild(wrap);

    if (canDelete) {
      wrap.querySelector(`[data-del="${d.id}"]`)?.addEventListener("click", async () => {
        if (!confirm("Supprimer cette photo de la galerie ?")) return;
        await deleteDoc(doc(db, "gallery", d.id));
        await loadGallery(currentYear);
        alert("Photo supprimée ✅");
      });
    }
  }
}

function setActiveYear(year) {
  currentYear = year;
  yearBtns.forEach((b) => b.classList.toggle("active", b.dataset.year === year));
  loadGallery(year);
}

function openCloudinaryWidget() {
  if (!IS_ADMIN) {
    alert("Réservé à l’admin Ti’Doc.");
    return;
  }
  if (!requireLogin("ajouter des photos")) return;

  if (!window.cloudinary || !window.cloudinary.createUploadWidget) {
    alert("Cloudinary n’a pas chargé. Rafraîchis la page.");
    return;
  }

  const widget = window.cloudinary.createUploadWidget(
    {
      cloudName: CLOUD_NAME,
      uploadPreset: UPLOAD_PRESET,
      multiple: true,
      maxFiles: 30,
      folder: "tidoc/galerie",
      sources: ["local", "camera"],
      clientAllowedFormats: ["png", "jpg", "jpeg", "webp", "heic"],
      showCompletedButton: true
    },
    async (error, result) => {
      if (error) {
        console.log("Cloudinary error:", error);
        alert("Erreur upload. Réessaie.");
        return;
      }

      if (result?.event === "success") {
        const info = result.info;

        await addDoc(collection(db, "gallery"), {
          year: currentYear,
          url: info.secure_url,
          publicId: info.public_id,
          width: info.width || null,
          height: info.height || null,
          uploadedBy: auth.currentUser?.email || "",
          createdAt: serverTimestamp()
        });
      }

      if (result?.event === "close") {
        loadGallery(currentYear);
      }
    }
  );

  widget.open();
}

// ===== Boot =====
document.addEventListener("DOMContentLoaded", () => {
  // années
  yearBtns.forEach((btn) => {
    btn.addEventListener("click", () => setActiveYear(btn.dataset.year));
  });

  // bouton upload
  addPhotosBtn?.addEventListener("click", openCloudinaryWidget);

  // ✅ auth => calc admin + affiche bouton
  onAuthStateChanged(auth, async (user) => {
    IS_ADMIN = await computeIsAdmin(user);
    if (addPhotosBtn) addPhotosBtn.style.display = IS_ADMIN ? "" : "none";
  });

  // load initial
  setActiveYear("2025");
});
