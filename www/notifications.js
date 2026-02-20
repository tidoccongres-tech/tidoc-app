// notifications.js (MODULE) — Clean + Admin-only newsletter create + Cloudinary image+logo
import { auth, db, requireAuthOrRedirect, isAdminUser } from "./auth.js";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ===== Cloudinary (newsletter uploads) =====
const CLOUD_NAME = "dctwkkvn1";
const UPLOAD_PRESET_NEWSLETTER = "tidoc_galerie";

async function uploadToCloudinary(file, folder = "tidoc/newsletter") {
  if (!file) throw new Error("Aucun fichier.");

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", UPLOAD_PRESET_NEWSLETTER);
  fd.append("folder", folder);

  const res = await fetch(url, { method: "POST", body: fd });
  const data = await res.json();

  if (!res.ok || !data?.secure_url) {
    console.log("Cloudinary upload error:", data);
    throw new Error(data?.error?.message || "Upload Cloudinary impossible.");
  }

  return {
    secureUrl: data.secure_url,
    publicId: data.public_id,
    width: data.width || null,
    height: data.height || null,
  };
}

requireAuthOrRedirect("./login.html");

const root = document.getElementById("notifRoot");
const adminTools = document.getElementById("adminTools"); // (si tu l’as quelque part)
const btnAddNewsletter = document.getElementById("btnAddNewsletter");

// =========================
// Helpers
// =========================
function escapeHTML(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeHref(u=""){
  const url = String(u||"").trim();
  if (!url) return "";
  // optionnel : force http(s)
  if (!/^https?:\/\//i.test(url)) return "";
  return url.replaceAll('"', "%22").replaceAll("'", "%27");
}

function renderNotifLinkButton(n = {}) {
  const url = String(n.linkUrl || "").trim();
  if (!url) return "";

  const href = safeHref(url);
  if (!href) return "";

  const label = String(n.linkLabel || "Ouvrir").trim() || "Ouvrir";
  const isPremium = String(n.type || "") === "workshop_promo";
  const cls = isPremium ? "btn-helloasso-premium" : "btn-helloasso";

  const icon = `
    <svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 3h7v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M21 3l-9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M10 5H6a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;

  return `
    <div style="margin-top:10px;">
      <a href="${href}" target="_blank" rel="noreferrer"
         class="${cls}" style="text-decoration:none">
        ${icon}
        ${escapeHTML(label)}
      </a>
    </div>
  `;
}

async function markRead(notifId) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await updateDoc(doc(db, "notifications", uid, "items", notifId), { read: true });
}

async function deleteNotif(notifId) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await deleteDoc(doc(db, "notifications", uid, "items", notifId));
}

// =========================
// LOAD NOTIFS
// =========================
async function loadNotifs() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  root.innerHTML = `<section class="card"><p>Chargement…</p></section>`;

  const qy = query(
    collection(db, "notifications", uid, "items"),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  const snap = await getDocs(qy);

  // ✅ Auto-mark read
  const unreadDocs = snap.docs.filter(d => d.data()?.read === false);
  await Promise.all(unreadDocs.map(d => markRead(d.id)));

  if (snap.empty) {
    root.innerHTML = `<section class="card"><p>Aucune notification.</p></section>`;
    return;
  }

  root.innerHTML = "";

  const admin = isAdminUser(auth.currentUser);

  snap.forEach((d) => {
    const n = d.data() || {};
    const card = document.createElement("section");
    card.className = "card";
    card.style.opacity = n.read ? "0.7" : "1";
    card.style.position = "relative";
    card.style.cursor = "pointer";

    // ✅ supprimer seulement newsletters + seulement admin
    const canDeleteNewsletter = admin && (n.type === "newsletter");

    card.innerHTML = `
  ${n.logoUrl ? `
    <div style="margin-top:10px;display:flex;align-items:center;gap:10px;">
      <img src="${n.logoUrl}" alt="logo"
        style="width:28px;height:28px;border-radius:8px;object-fit:cover">
      <span style="font-size:12px;color:var(--muted);font-weight:800">Ti’Doc</span>
    </div>
  ` : ""}

  ${canDeleteNewsletter ? `
    <button
      type="button"
      data-del="${d.id}"
      class="link"
      style="position:absolute;top:12px;right:12px;font-size:13px;"
    >
      Supprimer
    </button>
  ` : ""}

  <div>
    <strong>${escapeHTML(n.title || "Notification")}</strong>

    ${n.text ? `<div style="margin-top:4px">${escapeHTML(n.text)}</div>` : ""}

    <!-- ✅ BLOC CODE PROMO -->
    ${(n.type === "workshop_promo" && n.promoCode) ? `
      <div style="
        margin-top:12px;
        padding:12px;
        border-radius:14px;
        background:rgba(23,140,168,.08);
        border:1px solid rgba(23,140,168,.18);
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        font-weight:950;
      ">
        <span>Code promo :</span>
        <span style="
          font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size:15px;
          letter-spacing:1px;
        ">
          ${escapeHTML(n.promoCode)}
        </span>
        <button type="button"
          data-copy="${d.id}"
          class="btn-outline"
          style="height:34px;border-radius:10px;font-weight:900;">
          Copier
        </button>
      </div>
    ` : ""}

    ${n.imageUrl ? `<img src="${n.imageUrl}" style="margin-top:10px;width:100%;border-radius:12px">` : ""}

    ${renderNotifLinkButton(n)}
  </div>
`;

    // clic supprimer (ne doit pas markRead)
    const delBtn = card.querySelector(`[data-del="${d.id}"]`);
    delBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!confirm("Supprimer cette newsletter ?")) return;

      try {
        await deleteNotif(d.id);
        card.remove();
      } catch (err) {
        alert("Impossible de supprimer (permissions).");
        console.log(err);
      }
    });

    // bouton copier code promo
const copyBtn = card.querySelector(`[data-copy="${d.id}"]`);
copyBtn?.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();

  try {
    await navigator.clipboard.writeText(String(n.promoCode || ""));
    copyBtn.textContent = "✅ Copié";
    setTimeout(() => copyBtn.textContent = "Copier", 1000);
  } catch {
    alert("Copie impossible. Copie manuellement le code.");
  }
});

    // clic carte = markRead
    card.addEventListener("click", async () => {
      try { await markRead(d.id); } catch {}
    });

    root.appendChild(card);
  });
}

// =========================
// NEWSLETTER MODAL (ADMIN)
// =========================
function openNewsletterModal() {
  // ✅ Sécurité : si jamais le bouton apparaît par bug côté UI
  if (!isAdminUser(auth.currentUser)) {
    alert("Accès refusé.");
    return;
  }

  let imageUrl = "";
  let logoUrl = "";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  overlay.innerHTML = `
    <section class="card modal-card">
      <div class="modal-head">
        <div>
          <h2 style="margin:0;color:var(--tidoc)">Nouvelle newsletter</h2>
          <div style="font-size:13px;color:var(--muted);margin-top:4px">
            Envoi en notification à tous les utilisateurs
          </div>
        </div>
        <button class="btn-outline" type="button" id="nlClose">Fermer</button>
      </div>

      <div class="modal-body">

        <div class="modal-field">
          <label>Titre</label>
          <input id="nlTitle" placeholder="Ex : Nouveautés Ti’Doc" />
        </div>

        <div class="modal-field">
          <label>Texte</label>
          <textarea id="nlText" rows="5" placeholder="Écris ton message..." ></textarea>
        </div>

        <div class="modal-grid">
          <div class="modal-field">
            <label>Texte du bouton (optionnel)</label>
            <input id="nlLinkLabel" placeholder="Ex : Voir le lien" />
          </div>

          <div class="modal-field">
            <label>Lien du bouton (optionnel)</label>
            <input id="nlLinkUrl" placeholder="https://..." />
          </div>
        </div>

        <div class="modal-actions" style="justify-content:flex-start;">
          <button class="btn-outline" type="button" id="pickImage">Choisir image</button>
          <button class="btn-outline" type="button" id="pickLogo">Choisir logo</button>
          <div id="nlPicked" style="font-size:13px;color:var(--muted)"></div>

          <input id="nlPickImageFile" type="file" accept="image/*" style="display:none" />
          <input id="nlPickLogoFile"  type="file" accept="image/*" style="display:none" />
        </div>

        <div class="preview-card">
          <div class="preview-toprow">
            <img id="prevLogo" class="preview-logo" style="display:none" alt="logo">
            <div style="flex:1">
              <p id="prevTitle" class="preview-title">Aperçu du titre…</p>
              <p id="prevText" class="preview-text">Aperçu du texte…</p>
            </div>
          </div>
          <img id="prevImg" class="preview-media" style="display:none" alt="image">
          <div style="margin-top:10px;display:flex;justify-content:flex-start;">
            <a id="prevBtn" class="btn-primary" target="_blank" style="display:none;text-decoration:none;"></a>
          </div>
        </div>

        <div class="modal-actions">
          <div id="nlMsg" style="margin-right:auto;font-size:13px;color:var(--muted)"></div>
          <button class="btn-primary" type="button" id="nlSend">Envoyer à tout le monde</button>
        </div>

      </div>
    </section>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector("#nlClose").onclick = close;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const titleEl = overlay.querySelector("#nlTitle");
  const textEl  = overlay.querySelector("#nlText");
  const labEl   = overlay.querySelector("#nlLinkLabel");
  const urlEl   = overlay.querySelector("#nlLinkUrl");

  const prevTitle = overlay.querySelector("#prevTitle");
  const prevText  = overlay.querySelector("#prevText");
  const prevImg   = overlay.querySelector("#prevImg");
  const prevLogo  = overlay.querySelector("#prevLogo");
  const prevBtn   = overlay.querySelector("#prevBtn");
  const picked    = overlay.querySelector("#nlPicked");

  const btnPickImage = overlay.querySelector("#pickImage");
  const btnPickLogo  = overlay.querySelector("#pickLogo");

  function refreshPreview() {
    const t = titleEl.value.trim();
    const x = textEl.value.trim();
    const bl = labEl.value.trim();
    const bu = urlEl.value.trim();

    prevTitle.textContent = t || "Aperçu du titre…";
    prevText.textContent  = x || "Aperçu du texte…";

    if (logoUrl) {
      prevLogo.src = logoUrl;
      prevLogo.style.display = "";
    } else {
      prevLogo.style.display = "none";
    }

    if (imageUrl) {
      prevImg.src = imageUrl;
      prevImg.style.display = "";
    } else {
      prevImg.style.display = "none";
    }

    if (bl && bu) {
      prevBtn.textContent = bl;
      prevBtn.href = bu;
      prevBtn.style.display = "inline-block";
    } else {
      prevBtn.style.display = "none";
    }

    const bits = [];
    if (imageUrl) bits.push("Image ✅");
    if (logoUrl) bits.push("Logo ✅");
    picked.textContent = bits.length ? bits.join(" • ") : "";
  }

  titleEl.addEventListener("input", refreshPreview);
  textEl.addEventListener("input", refreshPreview);
  labEl.addEventListener("input", refreshPreview);
  urlEl.addEventListener("input", refreshPreview);

  const imgInput  = overlay.querySelector("#nlPickImageFile");
  const logoInput = overlay.querySelector("#nlPickLogoFile");

  btnPickImage.onclick = () => imgInput.click();
  btnPickLogo.onclick  = () => logoInput.click();

  // ✅ IMAGE upload (il manquait dans ton code)
  imgInput.addEventListener("change", async () => {
    const file = imgInput.files?.[0];
    if (!file) return;

    try {
      picked.textContent = "Upload image…";
      btnPickImage.disabled = true;
      btnPickLogo.disabled = true;

      const up = await uploadToCloudinary(file, "tidoc/newsletter/image");
      imageUrl = up.secureUrl;
      refreshPreview();
    } catch (e) {
      alert(e?.message || e);
    } finally {
      btnPickImage.disabled = false;
      btnPickLogo.disabled = false;
      imgInput.value = "";
    }
  });

  // ✅ LOGO upload (doublon supprimé : il n’y a PLUS qu’un seul listener)
  logoInput.addEventListener("change", async () => {
    const file = logoInput.files?.[0];
    if (!file) return;

    try {
      picked.textContent = "Upload logo…";
      btnPickImage.disabled = true;
      btnPickLogo.disabled = true;

      const up = await uploadToCloudinary(file, "tidoc/newsletter/logo");
      logoUrl = up.secureUrl;
      refreshPreview();
    } catch (e) {
      alert(e?.message || e);
    } finally {
      btnPickImage.disabled = false;
      btnPickLogo.disabled = false;
      logoInput.value = "";
    }
  });

  overlay.querySelector("#nlSend").onclick = async () => {
    const nlMsg = overlay.querySelector("#nlMsg");

    const title = titleEl.value.trim();
    const text = textEl.value.trim();
    const linkLabel = labEl.value.trim();
    const linkUrl = urlEl.value.trim();

    if (!title || !text) { nlMsg.textContent = "❌ Titre + texte requis."; return; }
    if ((linkLabel && !linkUrl) || (!linkLabel && linkUrl)) {
      nlMsg.textContent = "❌ Bouton: il faut texte + lien.";
      return;
    }

    try {
      nlMsg.textContent = "Envoi…";
      await broadcastNewsletterToAll({
        title, text, linkLabel, linkUrl, imageUrl, logoUrl
      });
      nlMsg.textContent = "✅ Envoyé !";
      setTimeout(close, 500);
    } catch (e) {
      console.log(e);
      nlMsg.textContent = "Erreur: " + (e?.message || e);
    }
  };

  refreshPreview();
}

// =========================
// BROADCAST (ADMIN)
// =========================
async function broadcastNewsletterToAll(payload) {
  // Rules: notifications create = admin only
  if (!isAdminUser(auth.currentUser)) {
    throw new Error("Accès refusé (admin).");
  }

  const usersSnap = await getDocs(collection(db, "users"));

  const fromUid = auth.currentUser.uid;
  const fromEmail = auth.currentUser.email;

  const jobs = [];

  usersSnap.forEach(uDoc => {
    const toUid = uDoc.id;

    jobs.push(
      addDoc(
        collection(db, "notifications", toUid, "items"),
        {
          toUid,
          fromUid,
          fromEmail,
          type: "newsletter",
          title: payload.title,
          text: payload.text,
          linkLabel: payload.linkLabel || "",
          linkUrl: payload.linkUrl || "",
          imageUrl: payload.imageUrl || "",
          logoUrl: payload.logoUrl || "",
          read: false,
          createdAt: serverTimestamp()
        }
      )
    );
  });

  await Promise.all(jobs);
}

// =========================
// BOOT
// =========================
onAuthStateChanged(auth, (u) => {
  if (!u) return;

  loadNotifs();

  const admin = isAdminUser(u);

  if (adminTools) adminTools.style.display = admin ? "" : "none";

  // ✅ bouton newsletter visible uniquement admin
  if (btnAddNewsletter) {
    btnAddNewsletter.style.display = admin ? "" : "none";
    if (admin) btnAddNewsletter.onclick = openNewsletterModal;
  }
});
