// notifications.js (MODULE)
import { auth, db, requireAuthOrRedirect } from "./auth.js";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

requireAuthOrRedirect("./login.html");

const root = document.getElementById("notifRoot");

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

async function loadNotifs(){
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  root.innerHTML = `<section class="card"><p>Chargement…</p></section>`;

  const qy = query(
    collection(db, "notifications", uid, "items"),
    orderBy("createdAt", "desc"),
    limit(30)
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

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
        <div>
          <div style="font-weight:800;">${escapeHTML(n.text || "Notification")}</div>
          <div style="opacity:.7;font-size:13px;">${escapeHTML(n.type || "")}</div>
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

onAuthStateChanged(auth, (u)=>{ if (u) loadNotifs(); });
