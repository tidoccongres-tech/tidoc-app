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
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.45)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "9999";

  overlay.innerHTML = `
    <div class="card" style="width:min(520px,94vw)">
      <h2>Nouvelle newsletter</h2>

      <input id="nlTitle" placeholder="Titre" />
      <textarea id="nlText" rows="4" placeholder="Texte"></textarea>

      <input id="nlLinkLabel" placeholder="Texte bouton (optionnel)" />
      <input id="nlLinkUrl" placeholder="Lien bouton (optionnel)" />

      <button class="btn-outline" id="pickImage">Choisir image</button>
      <button class="btn-outline" id="pickLogo">Choisir logo</button>

      <button class="btn-primary" id="sendNl">Envoyer</button>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector("#pickImage").onclick = () =>
    openGalleryPicker(url => imageUrl = url);

  overlay.querySelector("#pickLogo").onclick = () =>
    openGalleryPicker(url => logoUrl = url);

  overlay.querySelector("#sendNl").onclick = async () => {
    const title = overlay.querySelector("#nlTitle").value.trim();
    const text = overlay.querySelector("#nlText").value.trim();
    const linkLabel = overlay.querySelector("#nlLinkLabel").value.trim();
    const linkUrl = overlay.querySelector("#nlLinkUrl").value.trim();

    if (!title || !text) return alert("Titre + texte requis");

    await broadcastNewsletter({
      title, text, linkLabel, linkUrl, imageUrl, logoUrl
    });

    overlay.remove();
  };
}

// =========================
// BROADCAST
// =========================
async function broadcastNewsletter(payload){
  const users = await getDocs(collection(db, "users"));
  const fromUid = auth.currentUser.uid;
  const fromEmail = auth.currentUser.email;

  const jobs = [];
  users.forEach(u=>{
    jobs.push(
      addDoc(collection(db, "notifications", u.id, "items"), {
        ...payload,
        fromUid,
        fromEmail,
        type: "newsletter",
        read: false,
        createdAt: serverTimestamp()
      })
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
