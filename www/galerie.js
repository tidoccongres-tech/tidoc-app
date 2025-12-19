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

// ⚠️ Mets ici EXACTEMENT l’email admin (celui qui doit pouvoir upload/delete)
const ADMIN_EMAILS = [
  "tidoc.congres@gmail.com",
];

// UI
const grid = document.getElementById("galleryGrid");
const addPhotosBtn = document.getElementById("addPhotosBtn");
const yearBtns = Array.from(document.querySelectorAll(".year-btn"));

let currentYear = "2025";

// ===== Helpers =====
function isAdmin() {
  const email = (auth.currentUser?.email || "").toLowerCase();
  // Priorité : ta logique globale si elle existe
  if (window.TIDOC_AUTH && typeof window.TIDOC_AUTH.isAdmin === "boolean") {
    return !!window.TIDOC_AUTH.isAdmin;
  }
  // Fallback fiable : email list
  return ADMIN_EMAILS.includes(email);
}

function requireLogin(actionText = "faire ça") {
  if (!auth.currentUser) {
    alert("Connexion requise 🔒\n\nPour " + actionText + ", connecte-toi.");
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

function showError(msg) {
  if (!grid) return;
  grid.innerHTML = `<div class="card"><p>${escapeHTML(msg)}</p></div>`;
}

function tsToMs(ts) {
  try {
    if (!ts) return 0;
    if (ts.toDate) return ts.toDate().getTime();
    const d = new Date(ts);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  } catch {
    return 0;
  }
}

// ===== Load gallery (avec fallback si index Firestore) =====
async function loadGallery(year) {
  if (!grid) return;

  grid.innerHTML = `<div class="card"><p>Chargement…</p></div>`;

  try {
    // 1) essai normal (plus propre)
    const q1 = query(
      collection(db, "gallery"),
      where("year", "==", year),
      orderBy("createdAt", "desc")
    );

    const snap = await getDocs(q1);
    renderGalleryFromSnap(snap);
    return;
  } catch (err) {
    console.log("Firestore gallery error:", err);

    // 2) si Firestore demande un index, on fallback sans orderBy et on trie côté client
    const code = err?.code || "";
    const msg = String(err?.message || "");

    if (code === "failed-precondition" || msg.toLowerCase().includes("index")) {
      try {
        const q2 = query(
          collection(db, "gallery"),
          where("year", "==", year)
        );

        const snap2 = await getDocs(q2);

        // tri client-side
        const docs = snap2.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));

        renderGalleryFromArray(docs);
        return;
      } catch (err2) {
        console.log("Fallback query error:", err2);
        showError("Erreur chargement galerie (fallback).");
        return;
      }
    }

    // 3) permissions
    if (code === "permission-denied" || msg.toLowerCase().includes("insufficient permissions")) {
      showError("Accès refusé (permissions Firestore). Vérifie tes Rules.");
      return;
    }

    showError("Erreur chargement galerie (voir console).");
  }
}

function renderGalleryFromSnap(snap) {
  if (!grid) return;

  if (snap.empty) {
    grid.innerHTML = `<div class="card"><p>Aucune photo pour l’instant.</p></div>`;
    return;
  }

  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderGalleryFromArray(docs);
}

function renderGalleryFromArray(items) {
  if (!grid) return;

  if (!items.length) {
    grid.innerHTML = `<div class="card"><p>Aucune photo pour l’instant.</p></div>`;
    return;
  }

  grid.innerHTML = "";

  const admin = isAdmin();

  for (const item of items) {
    const wrap = document.createElement("div");
    wrap.className = "gallery-item";

    wrap.innerHTML = `
      <a href="${escapeHTML(item.url)}" download style="display:block;">
        <img src="${escapeHTML(item.url)}" alt="" loading="lazy">
      </a>
      ${admin ? `<button class="gallery-del" type="button" title="Supprimer" data-del="${item.id}">🗑️</button>` : ""}
    `;

    grid.appendChild(wrap);

    if (admin) {
      wrap.querySelector(`[data-del="${item.id}"]`)?.addEventListener("click", async () => {
        if (!confirm("Supprimer cette photo de la galerie ?")) return;
        await deleteDoc(doc(db, "gallery", item.id));
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
  if (!requireLogin("ajouter des photos")) return;

  if (!isAdmin()) {
    alert("Réservé à l’admin Ti’Doc.");
    return;
  }

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
      folder: `tidoc/galerie/${currentYear}`, // ✅ range par année côté Cloudinary aussi
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

      // 1 event par fichier uploadé
      if (result?.event === "success") {
        const info = result.info;

        await addDoc(collection(db, "gallery"), {
          year: currentYear,                 // ✅ l’année active
          url: info.secure_url,
          publicId: info.public_id,
          width: info.width || null,
          height: info.height || null,
          uploadedBy: auth.currentUser?.email || "",
          createdAt: serverTimestamp()
        });
      }

      // quand tu fermes → reload
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

  // ✅ Affiche/masque le bouton admin au bon moment
  onAuthStateChanged(auth, () => {
    if (addPhotosBtn) addPhotosBtn.style.display = isAdmin() ? "" : "none";
  });

  // load initial
  setActiveYear("2025");
});
