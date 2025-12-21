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
// Load notifs
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
    card.style.cursor = "pointer";
    card.style.opacity = n.read ? "0.7" : "1";
    card.style.marginBottom = "10px";

    const hasBtn = n.linkUrl && n.linkLabel;
    const hasImg = n.imageUrl;
    const hasLogo = n.logoUrl;

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
        <div style="flex:1">
          <div style="font-weight:900;display:flex;gap:8px;align-items:center;">
            ${hasLogo ? `<img src="${escapeHTML(n.logoUrl)}" style="width:22px;height:22px;border-radius:6px;object-fit:cover;">` : ""}
            <span>${escapeHTML(n.title || n.text || "Notification")}</span>
          </div>

          ${n.text && n.title ? `<div style="opacity:.85;font-size:13px;margin-top:4px;">${escapeHTML(n.text)}</div>` : ""}
          <div style="opacity:.6;font-size:12px;margin-top:4px;">${escapeHTML(n.type || "")}</div>

          ${hasImg ? `<img src="${escapeHTML(n.imageUrl)}" style="margin-top:10px;width:100%;border-radius:12px;max-height:220px;object-fit:cover;">` : ""}

          ${hasBtn ? `
            <div style="margin-top:10px;">
              <a href="${escapeHTML(n.linkUrl)}" target="_blank" class="btn-primary" style="display:inline-block;text-decoration:none;">
                ${escapeHTML(n.linkLabel)}
              </a>
            </div>
          ` : ""}
        </div>

        ${n.read ? "" : `<span style="font-size:12px;background:#178CA8;color:#fff;padding:4px 8px;border-radius:999px;">Nouveau</span>`}
      </div>
    `;

    card.addEventListener("click", async ()=>{
      try{ await markRead(d.id); }catch(_){}
      if (n.postId){
        window.location.href = `./blog.html?postId=${encodeURIComponent(n.postId)}`;
      }
    });

    root.appendChild(card);
  });
}

// =========================
// Admin newsletter modal
// =========================
function openNewsletterModal(){
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.45)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "9999";
  overlay.style.padding = "16px";

  overlay.innerHTML = `
    <div class="card" style="width:min(520px,94vw);max-height:90vh;overflow:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <h2 style="margin:0;color:var(--tidoc)">Nouvelle newsletter</h2>
        <button class="btn-outline" type="button" id="nlClose">Fermer</button>
      </div>

      <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px;">
        <input id="nlTitle" placeholder="Titre (ex : Nouveautés Ti’Doc)" />
        <textarea id="nlText" rows="5" placeholder="Texte..."
          style="padding:12px;border:1px solid #ddd;border-radius:12px;font-size:15px"></textarea>

        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <input id="nlLinkLabel" placeholder="Texte bouton (ex : Shop now)" style="flex:1;min-width:180px" />
          <input id="nlLinkUrl" placeholder="Lien (https://...)" style="flex:2;min-width:220px" />
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <input id="nlImageUrl" placeholder="URL image (optionnel)" style="flex:1;min-width:220px" />
          <input id="nlLogoUrl" placeholder="URL logo (optionnel)" style="flex:1;min-width:220px" />
        </div>

        <button class="btn-primary" type="button" id="nlSend">Envoyer à tout le monde</button>
        <div class="small" id="nlMsg" style="margin-top:6px;"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector("#nlClose").onclick = close;
  overlay.addEventListener("click", (e)=>{ if (e.target === overlay) close(); });

  overlay.querySelector("#nlSend").onclick = async () => {
    const nlMsg = overlay.querySelector("#nlMsg");
    const title = overlay.querySelector("#nlTitle").value.trim();
    const text = overlay.querySelector("#nlText").value.trim();
    const linkLabel = overlay.querySelector("#nlLinkLabel").value.trim();
    const linkUrl = overlay.querySelector("#nlLinkUrl").value.trim();
    const imageUrl = overlay.querySelector("#nlImageUrl").value.trim();
    const logoUrl = overlay.querySelector("#nlLogoUrl").value.trim();

    if (!title || !text) { nlMsg.textContent = "❌ Titre + texte requis."; return; }
    if ((linkLabel && !linkUrl) || (!linkLabel && linkUrl)) {
      nlMsg.textContent = "❌ Si tu mets un bouton, il faut texte + lien.";
      return;
    }

    try{
      nlMsg.textContent = "Envoi…";
      await broadcastNewsletter({ title, text, linkLabel, linkUrl, imageUrl, logoUrl });
      nlMsg.textContent = "✅ Envoyé !";
      setTimeout(close, 600);
    }catch(e){
      console.log(e);
      nlMsg.textContent = "Erreur: " + (e?.message || e);
    }
  };
}

async function broadcastNewsletter(payload){
  const usersSnap = await getDocs(collection(db, "users"));

  const fromUid = auth.currentUser?.uid || "";
  const fromEmail = auth.currentUser?.email || "";

  const promises = [];
  usersSnap.forEach((uDoc)=>{
    const toUid = uDoc.id;
    promises.push(
      addDoc(collection(db, "notifications", toUid, "items"), {
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
        createdAt: serverTimestamp(),
      })
    );
  });

  await Promise.all(promises);
}

// =========================
// Boot
// =========================
onAuthStateChanged(auth, (u)=>{
  if (!u) return;

  loadNotifs();

  const admin = isAdminUser(u);
  if (adminTools) adminTools.style.display = admin ? "" : "none";

  if (admin && btnAddNewsletter) {
    btnAddNewsletter.onclick = openNewsletterModal;
  }
});
