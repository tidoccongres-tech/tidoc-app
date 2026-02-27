import { auth, db, requireAuthOrRedirect, isAdminUser } from "./auth.js";
import {
  collection,
  query,
  orderBy,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ===== Cloudinary (partners uploads)
const CLOUD_NAME = "dctwkkvn1";
const UPLOAD_PRESET = "tidoc_galerie";

async function uploadToCloudinary(file, folder = "tidoc/partners") {
  if (!file) throw new Error("Aucun fichier.");
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", UPLOAD_PRESET);
  fd.append("folder", folder);

  const res = await fetch(url, { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok || !data?.secure_url) {
    console.log("Cloudinary upload error:", data);
    throw new Error(data?.error?.message || "Upload Cloudinary impossible.");
  }
  return data.secure_url;
}

requireAuthOrRedirect("./login.html");

const grid = document.getElementById("partnersGrid");
const empty = document.getElementById("partnersEmpty");
const btnAdd = document.getElementById("btnAddPartner");
const kpis = document.getElementById("partnersKpis");
const kpiCount = document.getElementById("kpiCount");

function escapeHTML(s=""){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function safeHref(u=""){
  let url = String(u||"").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  if (!/^https?:\/\//i.test(url)) return "";
  return url.replaceAll('"', "%22").replaceAll("'", "%27");
}

function skeleton(){
  if (!grid) return;
  grid.innerHTML = "";
  for (let i=0; i<6; i++){
    const el = document.createElement("div");
    el.className = "partner-skel";
    el.innerHTML = `<div class="skel-block"></div><div class="skel-foot"></div>`;
    grid.appendChild(el);
  }
}

function trashSvg(){
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM6 9h2v9H6V9Z"></path>
    </svg>
  `;
}

async function loadPartners(){
  if (!grid) return;
  skeleton();

  const qy = query(collection(db, "partners"), orderBy("createdAt", "desc"));
  const snap = await getDocs(qy);

  grid.innerHTML = "";

  if (snap.empty){
    empty.style.display = "";
    if (kpis) kpis.style.display = "none";
    return;
  }

  empty.style.display = "none";
  if (kpis) kpis.style.display = "";
  if (kpiCount) kpiCount.textContent = String(snap.size);

  const admin = isAdminUser(auth.currentUser);

  snap.forEach(d => {
    const p = d.data() || {};
    const name = String(p.name || "Partenaire").trim();
    const logoUrl = String(p.logoUrl || "");
    const linkUrl = safeHref(p.linkUrl || "");

    const card = document.createElement("article");
    card.className = "partner-card";

    card.innerHTML = `
      ${admin ? `
        <button class="partner-del" type="button" data-del="${d.id}" aria-label="Supprimer">
          ${trashSvg()}
        </button>
      ` : ""}

      <div class="partner-media">
        ${logoUrl ? `<img src="${logoUrl}" alt="${escapeHTML(name)}">` : `<div style="font-weight:900;color:var(--muted)">Logo</div>`}
      </div>

      <div class="partner-foot">
        <div class="partner-name">${escapeHTML(name)}</div>
        ${linkUrl ? `<a class="partner-link" href="${linkUrl}" target="_blank" rel="noreferrer">Voir</a>` : `<span class="partner-link" style="opacity:.55">—</span>`}
      </div>
    `;

    // delete admin
    const del = card.querySelector(`[data-del="${d.id}"]`);
    del?.addEventListener("click", async (e)=>{
      e.preventDefault();
      e.stopPropagation();
      if (!confirm("Supprimer ce partenaire ?")) return;
      try{
        await deleteDoc(doc(db, "partners", d.id));
        card.remove();
      }catch(err){
        console.log(err);
        alert("Suppression impossible (permissions).");
      }
    });

    // click => open link if exists
    if (linkUrl){
      card.style.cursor = "pointer";
      card.addEventListener("click", ()=>{
        window.open(linkUrl, "_blank", "noreferrer");
      });
    }

    grid.appendChild(card);
  });
}

function openAddModal(){
  if (!isAdminUser(auth.currentUser)){
    alert("Accès refusé.");
    return;
  }

  let logoUrl = "";

  const overlay = document.createElement("div");
  overlay.className = "partners-modal-overlay";

  overlay.innerHTML = `
    <section class="partners-modal">
      <div class="partners-modal-head">
        <div>
          <h2 class="partners-modal-title">Ajouter un partenaire</h2>
          <p class="partners-modal-sub">Logo + nom + lien (optionnel)</p>
        </div>
        <button class="btn-outline" type="button" id="pClose">Fermer</button>
      </div>

      <div class="partners-form">
        <div class="field">
          <span>Nom</span>
          <input id="pName" placeholder="Ex : HelloAsso" />
        </div>

        <div class="field">
          <span>Lien (optionnel)</span>
          <input id="pLink" placeholder="https://..." />
        </div>

        <div class="field">
          <span>Logo</span>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
            <button class="btn-outline" type="button" id="pPick">Choisir une image</button>
            <div class="partners-msg" id="pPicked" style="color:var(--muted)">Aucun fichier</div>
            <input id="pFile" type="file" accept="image/*" style="display:none" />
          </div>
        </div>

        <div class="card" style="border-radius:18px;background:rgba(255,255,255,.72)">
          <div style="font-weight:950;color:#0f4f60;margin-bottom:8px;">Aperçu</div>
          <div class="partner-media" style="border-radius:18px;">
            <img id="pPrev" style="display:none;max-height:120px;object-fit:contain" alt="preview">
            <div id="pPrevTxt" style="font-weight:900;color:var(--muted)">Logo</div>
          </div>
        </div>

        <div class="partners-actions">
          <div class="partners-msg" id="pMsg" style="margin-right:auto;"></div>
          <button class="btn-primary" type="button" id="pSave">Enregistrer</button>
        </div>
      </div>
    </section>
  `;

  document.body.appendChild(overlay);

  const close = ()=> overlay.remove();
  overlay.querySelector("#pClose").onclick = close;
  overlay.addEventListener("click", (e)=>{ if (e.target === overlay) close(); });

  const nameEl = overlay.querySelector("#pName");
  const linkEl = overlay.querySelector("#pLink");
  const fileEl = overlay.querySelector("#pFile");
  const btnPick = overlay.querySelector("#pPick");
  const picked = overlay.querySelector("#pPicked");
  const prev = overlay.querySelector("#pPrev");
  const prevTxt = overlay.querySelector("#pPrevTxt");
  const msg = overlay.querySelector("#pMsg");
  const btnSave = overlay.querySelector("#pSave");

  btnPick.onclick = ()=> fileEl.click();

  fileEl.addEventListener("change", async ()=>{
    const file = fileEl.files?.[0];
    if (!file) return;

    try{
      picked.textContent = "Upload…";
      btnPick.disabled = true;
      btnSave.disabled = true;

      const url = await uploadToCloudinary(file, "tidoc/partners");
      logoUrl = url;

      prev.src = logoUrl;
      prev.style.display = "";
      prevTxt.style.display = "none";
      picked.textContent = "Logo ✅";
    }catch(e){
      alert(e?.message || e);
      picked.textContent = "Erreur upload";
    }finally{
      btnPick.disabled = false;
      btnSave.disabled = false;
      fileEl.value = "";
    }
  });

  btnSave.onclick = async ()=>{
    const name = nameEl.value.trim();
    const linkUrl = linkEl.value.trim();

    if (!name){ msg.textContent = "❌ Nom requis."; return; }
    if (!logoUrl){ msg.textContent = "❌ Logo requis."; return; }

    // lien: soit vide, soit validable
    if (linkUrl && !safeHref(linkUrl)){
      msg.textContent = "❌ Lien invalide.";
      return;
    }

    try{
      msg.textContent = "Enregistrement…";
      btnSave.disabled = true;

      await addDoc(collection(db, "partners"), {
        name,
        linkUrl: linkUrl || "",
        logoUrl,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser.uid
      });

      msg.textContent = "✅ Ajouté !";
      setTimeout(close, 350);
      setTimeout(loadPartners, 450);
    }catch(err){
      console.log(err);
      msg.textContent = "Erreur: " + (err?.message || err);
      btnSave.disabled = false;
    }
  };
}

onAuthStateChanged(auth, (user)=>{
  if (!user) return;

  const admin = isAdminUser(user);
  if (btnAdd){
    btnAdd.style.display = admin ? "" : "none";
    if (admin) btnAdd.onclick = openAddModal;
  }

  loadPartners();
});
