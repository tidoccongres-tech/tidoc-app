// notifications.js (MODULE)
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
const adminTools = document.getElementById("adminTools");
const btnAddNewsletter = document.getElementById("btnAddNewsletter");

// =========================
// Helpers
// =========================
function escapeHTML(s=""){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

async function markRead(notifId){
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await updateDoc(doc(db, "notifications", uid, "items", notifId), { read: true });
}

async function deleteNotif(notifId){
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await deleteDoc(doc(db, "notifications", uid, "items", notifId));
}

// =========================
// LOAD NOTIFS
// =========================
async function loadNotifs(){
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  root.innerHTML = `<section class="card"><p>Chargement…</p></section>`;

  const qy = query(
    collection(db, "notifications", uid, "items"),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  const snap = await getDocs(qy);

  // ✅ Auto-mark read (quand on ouvre la page, tout devient lu)
  const unreadDocs = snap.docs.filter(d => (d.data()?.read === false));
  await Promise.all(unreadDocs.map(d => markRead(d.id)));
  
  if (snap.empty){
    root.innerHTML = `<section class="card"><p>Aucune notification.</p></section>`;
    return;
  }

  root.innerHTML = "";

  const admin = isAdminUser(auth.currentUser);

  snap.forEach((d)=>{
    const n = d.data() || {};
    const card = document.createElement("section");
    card.className = "card";
    card.style.opacity = n.read ? "0.7" : "1";
    card.style.position = "relative";
    card.style.cursor = "pointer";

    // ✅ supprimer seulement les newsletters et seulement admin
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
        ${n.imageUrl ? `<img src="${n.imageUrl}" style="margin-top:10px;width:100%;border-radius:12px">` : ""}
        ${(n.linkUrl && n.linkLabel) ? `
          <a href="${n.linkUrl}" target="_blank" class="btn-primary"
             style="margin-top:10px;display:inline-block;text-decoration:none">
            ${escapeHTML(n.linkLabel)}
          </a>` : ""}
      </div>
    `;

    // clic supprimer (ne doit pas marquer lu)
    const delBtn = card.querySelector(`[data-del="${d.id}"]`);
    delBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!confirm("Supprimer cette newsletter ?")) return;

      try {
        await deleteNotif(d.id);
        card.remove(); // UI instant
      } catch (err) {
        alert("Impossible de supprimer (permissions).");
        console.log(err);
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
// GALERIE PICKER
// =========================

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.45)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "10000";

  overlay.innerHTML = `
    <div class="card" style="width:min(520px,95vw);max-height:80vh;overflow:auto;">
      <h3>Choisir une image</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
        ${snap.docs.map(d=>{
          const img = d.data();
          return `
            <img src="${img.url}"
              data-url="${img.url}"
              style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;cursor:pointer">
          `;
        }).join("")}
      </div>
    </div>
  `;

  overlay.onclick = (e)=>{
    const url = e.target?.dataset?.url;
    if (url){
      onPick(url);
      overlay.remove();
    }
    if (e.target === overlay) overlay.remove();
  };

  document.body.appendChild(overlay);
}

// =========================
// NEWSLETTER MODAL
// =========================
function openNewsletterModal(){
  let imageUrl = "";
  let logoUrl = "";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  overlay.innerHTML = `
    <section class="card modal-card">
      <div class="modal-head">
        <div>
          <h2 style="margin:0;color:var(--tidoc)">Nouvelle newsletter</h2>
          <div style="font-size:13px;color:var(--muted);margin-top:4px">Envoi en notification à tous les utilisateurs</div>
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
            <input id="nlLinkLabel" placeholder="Ex : Shop now" />
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
  overlay.addEventListener("click", (e)=>{ if (e.target === overlay) close(); });

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

  function refreshPreview(){
    const t = titleEl.value.trim();
    const x = textEl.value.trim();
    const bl = labEl.value.trim();
    const bu = urlEl.value.trim();

    prevTitle.textContent = t || "Aperçu du titre…";
    prevText.textContent  = x || "Aperçu du texte…";

    if (logoUrl){
      prevLogo.src = logoUrl;
      prevLogo.style.display = "";
    } else {
      prevLogo.style.display = "none";
    }

    if (imageUrl){
      prevImg.src = imageUrl;
      prevImg.style.display = "";
    } else {
      prevImg.style.display = "none";
    }

    if (bl && bu){
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

  const imgInput = overlay.querySelector("#nlPickImageFile");
const logoInput = overlay.querySelector("#nlPickLogoFile");

overlay.querySelector("#pickImage").onclick = () => imgInput.click();
overlay.querySelector("#pickLogo").onclick = () => logoInput.click();

imgInput.addEventListener("change", async () => {
  const file = imgInput.files?.[0];
  if (!file) return;

  try {
    picked.textContent = "Upload image…";
    const up = await uploadToCloudinary(file, "tidoc/newsletter/image");
    imageUrl = up.secureUrl;
    refreshPreview();
  } catch (e) {
    alert(e?.message || e);
  } finally {
    imgInput.value = ""; // permet de re-sélectionner la même photo
  }
});

logoInput.addEventListener("change", async () => {
  const file = logoInput.files?.[0];
  if (!file) return;

  try {
    picked.textContent = "Upload logo…";
    const up = await uploadToCloudinary(file, "tidoc/newsletter/logo");
    logoUrl = up.secureUrl;
    refreshPreview();
  } catch (e) {
    alert(e?.message || e);
  } finally {
    logoInput.value = "";
  }
});

  overlay.querySelector("#nlSend").onclick = async () => {
    const nlMsg = overlay.querySelector("#nlMsg");

    const title = titleEl.value.trim();
    const text = textEl.value.trim();
    const linkLabel = labEl.value.trim();
    const linkUrl = urlEl.value.trim();

    if (!title || !text){ nlMsg.textContent = "❌ Titre + texte requis."; return; }
    if ((linkLabel && !linkUrl) || (!linkLabel && linkUrl)){
      nlMsg.textContent = "❌ Bouton: il faut texte + lien.";
      return;
    }

    try{
      nlMsg.textContent = "Envoi…";
      await broadcastNewsletter({ title, text, linkLabel, linkUrl, imageUrl, logoUrl });
      nlMsg.textContent = "✅ Envoyé !";
      setTimeout(close, 500);
    }catch(e){
      console.log(e);
      nlMsg.textContent = "Erreur: " + (e?.message || e);
    }
  };

  refreshPreview();
}

// =========================
// BROADCAST
// =========================
async function broadcastNewsletter(payload){
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
onAuthStateChanged(auth, (u)=>{
  if (!u) return;

  loadNotifs();

  const admin = isAdminUser(u);

  // (optionnel) si tu gardes adminTools dans le HTML
  if (adminTools) adminTools.style.display = admin ? "" : "none";

  // ✅ bouton newsletter visible uniquement admin
  if (btnAddNewsletter) {
    btnAddNewsletter.style.display = admin ? "" : "none";
    if (admin) btnAddNewsletter.onclick = openNewsletterModal;
  }
});
