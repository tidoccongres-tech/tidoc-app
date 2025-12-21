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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

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

  if (snap.empty){
    root.innerHTML = `<section class="card"><p>Aucune notification.</p></section>`;
    return;
  }

  root.innerHTML = "";

  snap.forEach((d)=>{
    const n = d.data() || {};
    const card = document.createElement("section");
    card.className = "card";
    card.style.opacity = n.read ? "0.7" : "1";

    card.innerHTML = `
      <div>
        <strong>${escapeHTML(n.title || "Notification")}</strong>
        ${n.text ? `<div style="margin-top:4px">${escapeHTML(n.text)}</div>` : ""}
        ${n.imageUrl ? `<img src="${n.imageUrl}" style="margin-top:10px;width:100%;border-radius:12px">` : ""}
        ${n.linkUrl ? `
          <a href="${n.linkUrl}" target="_blank" class="btn-primary" style="margin-top:10px;display:inline-block">
            ${escapeHTML(n.linkLabel)}
          </a>` : ""}
      </div>
    `;

    card.onclick = async () => {
      try { await markRead(d.id); } catch {}
    };

    root.appendChild(card);
  });
}

// =========================
// GALERIE PICKER
// =========================
async function openGalleryPicker(onPick){
  const snap = await getDocs(collection(db, "gallery"));

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

  overlay.querySelector("#pickImage").onclick = () =>
    openGalleryPicker((url) => { imageUrl = url; refreshPreview(); });

  overlay.querySelector("#pickLogo").onclick = () =>
    openGalleryPicker((url) => { logoUrl = url; refreshPreview(); });

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
    const toUid = uDoc.id; // ✅ DESTINATAIRE OBLIGATOIRE

    jobs.push(
      addDoc(
        collection(db, "notifications", toUid, "items"),
        {
          toUid,               // ✅ requis par les rules
          fromUid,             // ✅ requis par les rules
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
  adminTools.style.display = admin ? "" : "none";
  if (admin) btnAddNewsletter.onclick = openNewsletterModal;
});
