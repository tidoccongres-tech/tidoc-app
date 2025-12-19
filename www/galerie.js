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
  doc
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

// ✅ TON EMAIL ADMIN (le même que dans le header)
const ADMIN_EMAIL = "tidoc.congres@gmail.com";

// UI
const grid = document.getElementById("galleryGrid");
const addPhotosBtn = document.getElementById("addPhotosBtn");
const yearBtns = Array.from(document.querySelectorAll(".year-btn"));

let currentYear = "2025";
let IS_ADMIN = false;

// ---------- helpers ----------
function requireLogin(actionText = "faire ça") {
  if (!auth.currentUser) {
    alert("Connexion requise 🔒\n\nPour " + actionText + ", connecte-toi.");
    return false;
  }
  return true;
}

function isAdminNow() {
  const email = (auth.currentUser?.email || "").toLowerCase();
  return !!email && email === ADMIN_EMAIL.toLowerCase();
}

function escapeHTML(s = "") {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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

  let snap;
  try {
    snap = await getDocs(qy);
  } catch (e) {
    console.error(e);
    // ⚠️ Si Firestore te demande un index (error failed-precondition), tu devras le créer
    grid.innerHTML = `<div class="card"><p>Erreur chargement galerie (voir console).</p></div>`;
    return;
  }

  if (snap.empty) {
    grid.innerHTML = `<div class="card"><p>Aucune photo pour l’instant.</p></div>`;
    return;
  }

  grid.innerHTML = "";

  for (const d of snap.docs) {
    const item = d.data();

    const wrap = document.createElement("div");
    wrap.className = "gallery-item";

    // ✅ tout le monde peut “télécharger” (ouvre l'image en grand)
    // ✅ seuls admins voient 🗑️
    wrap.innerHTML = `
      <img src="${escapeHTML(item.url)}" alt="" loading="lazy">

      <div class="gallery-actions">
        <a class="gallery-btn" href="${escapeHTML(item.url)}" target="_blank" rel="noopener" title="Télécharger / ouvrir">⬇️</a>
        ${IS_ADMIN ? `<button class="gallery-btn" type="button" title="Supprimer" data-del="${d.id}">🗑️</button>` : ""}
      </div>
    `;

    grid.appendChild(wrap);

    if (IS_ADMIN) {
      wrap.querySelector(`[data-del="${d.id}"]`)?.addEventListener("click", async () => {
        if (!confirm("Supprimer cette photo de la galerie ?")) return;
        await deleteDoc(doc(db, "gallery", d.id));
        await loadGallery(currentYear);
      });
    }
  }
}

function setActiveYear(year) {
  currentYear = year;
  yearBtns.forEach((b) => b.classList.toggle("active", b.dataset.year === year));
  loadGallery(year);
}

// ---------- upload ----------
function openCloudinaryWidget() {
  // ✅ bouton doit être invisible si pas admin,
  // mais on protège aussi ici au cas où
  if (!IS_ADMIN) return;
  if (!requireLogin("ajouter des photos")) return;

  if (!window.cloudinary?.createUploadWidget) {
    alert("Cloudinary n’a pas chargé. Rafraîchis la page.");
    return;
  }

  const uploads = []; // ✅ on collecte les addDoc à attendre

  const widget = window.cloudinary.createUploadWidget(
    {
      cloudName: CLOUD_NAME,
      uploadPreset: UPLOAD_PRESET,
      multiple: true,
      maxFiles: 30,
      folder: `tidoc/galerie/${currentYear}`, // ✅ range aussi côté Cloudinary
      sources: ["local", "camera"],
      clientAllowedFormats: ["png", "jpg", "jpeg", "webp", "heic"],
      showCompletedButton: true
    },
    async (error, result) => {
      if (error) {
        console.log("Cloudinary error:", error);
        alert("Erreur upload Cloudinary. Réessaie.");
        return;
      }

      // ✅ 1 event "success" par fichier
      if (result?.event === "success") {
        const info = result.info;

        uploads.push(
          addDoc(collection(db, "gallery"), {
            year: currentYear,                 // ✅ IMPORTANT : 2025 / 2026
            url: info.secure_url,
            publicId: info.public_id,
            width: info.width || null,
            height: info.height || null,
            uploadedBy: auth.currentUser?.email || "",
            createdAt: serverTimestamp()
          })
        );
      }

      // ✅ à la fin de la queue → on attend les écritures et on reload
      if (result?.event === "queues-end") {
        try {
          await Promise.allSettled(uploads);
        } catch (_) {}
        await loadGallery(currentYear);
      }

      // fallback : si l’event queues-end n’arrive pas selon le device
      if (result?.event === "close") {
        try {
          await Promise.allSettled(uploads);
        } catch (_) {}
        await loadGallery(currentYear);
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

  // upload
  addPhotosBtn?.addEventListener("click", openCloudinaryWidget);

  // ✅ calc admin dès que Auth est prêt + affiche/masque bouton
  onAuthStateChanged(auth, async (user) => {
    IS_ADMIN = !!user && isAdminNow();

    // ✅ si pas admin : on cache totalement le bouton
    if (addPhotosBtn) addPhotosBtn.style.display = IS_ADMIN ? "" : "none";

    // reload galerie (pour afficher/masquer les 🗑️)
    await loadGallery(currentYear);
  });

  // load initial
  setActiveYear("2025");
});
