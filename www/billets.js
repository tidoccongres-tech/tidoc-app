// billets.js (MODULE)
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ✅ évite double init
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// UI
const openHelloAssoBtn = document.getElementById("openHelloAssoBtn");
const syncTicketBtn = document.getElementById("syncTicketBtn");
const ticketStatus = document.getElementById("ticketStatus");
const ticketBox = document.getElementById("ticketBox");

// 🔗 mets ici ton lien HelloAsso (page billetterie)
const HELLOASSO_PUBLIC_URL = "https://www.helloasso.com/associations/ti-doc/evenements/ti-doc-2026";

// ✅ assure que le bouton ouvre toujours quelque chose
if (openHelloAssoBtn) openHelloAssoBtn.href = HELLOASSO_PUBLIC_URL;

function requireLogin(actionText = "faire cette action") {
  if (!auth.currentUser) {
    alert(
      "Connexion requise 🔒\n\n" +
      `Pour ${actionText}, connecte-toi avec Google via l’icône Profil (en haut à gauche).`
    );
    return false;
  }
  return true;
}

function show(msg) {
  if (ticketStatus) ticketStatus.textContent = msg;
}

function renderTicketBox(t) {
  if (!ticketBox) return;

  if (!t) {
    ticketBox.textContent = "Aucun billet pour l’instant.";
    return;
  }

  ticketBox.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <div><b>Pack :</b> ${t.ticketType || "?"}</div>
      <div><b>Conférences :</b> ${t.conferencesAllowed ?? 0}</div>
      <div><b>Workshops :</b> ${t.workshopsAllowed ?? 0}</div>
      ${t.helloassoOrderId ? `<div style="opacity:.7; font-size:12px;">Commande: ${t.helloassoOrderId}</div>` : ""}
    </div>
  `;
}

async function loadExistingTicket() {
  const u = auth.currentUser;
  if (!u) {
    show("Connecte-toi pour afficher ton billet.");
    renderTicketBox(null);
    return;
  }

  const ref = doc(db, "userTickets", u.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const t = snap.data();
    show(`✅ Pack détecté : ${t.ticketType} — Conf: ${t.conferencesAllowed} — WS: ${t.workshopsAllowed}`);
    renderTicketBox(t);
  } else {
    show("Aucun billet détecté pour l’instant.");
    renderTicketBox(null);
  }
}

async function syncTicket() {
  if (!requireLogin("récupérer ton billet")) return;

  const u = auth.currentUser;
  show("⏳ Vérification de ton billet…");

  try {
    const res = await fetch("/.netlify/functions/helloasso-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: u.email || "",
        uid: u.uid
      })
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.log("helloasso-ticket error:", txt);
      show("❌ Impossible de récupérer le billet (Netlify Function / API).");
      return;
    }

    const data = await res.json();

    if (!data?.ticketType) {
      show("❌ Aucun billet trouvé pour cet email sur HelloAsso.");
      return;
    }

    // Stocke dans Firestore : userTickets/{uid}
    const payload = {
      ticketType: data.ticketType,                 // "essentiel" | "standard" | "premium"
      workshopsAllowed: data.workshopsAllowed ?? 0,
      conferencesAllowed: data.conferencesAllowed ?? 0,
      helloassoOrderId: data.helloassoOrderId || "",
      helloassoPayerEmail: data.email || u.email || "",
      updatedAt: Date.now()
    };

    await setDoc(doc(db, "userTickets", u.uid), payload, { merge: true });

    show(`✅ Pack détecté : ${payload.ticketType} — Conf: ${payload.conferencesAllowed} — WS: ${payload.workshopsAllowed}`);
    renderTicketBox(payload);

  } catch (e) {
    console.log("syncTicket error:", e);
    show("❌ Erreur réseau (voir console).");
  }
}

syncTicketBtn?.addEventListener("click", syncTicket);

// ✅ écoute auth propre (Firebase v10)
onAuthStateChanged(auth, () => {
  loadExistingTicket();
});
