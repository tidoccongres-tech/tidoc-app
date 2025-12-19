// billets.js (MODULE) — robuste + debug Netlify Function
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

// 🔗 lien HelloAsso (page billetterie)
const HELLOASSO_PUBLIC_URL =
  "https://www.helloasso.com/associations/ti-doc/evenements/ti-doc-2026";

if (openHelloAssoBtn) {
  openHelloAssoBtn.href = HELLOASSO_PUBLIC_URL;
  openHelloAssoBtn.target = "_blank";
  openHelloAssoBtn.rel = "noopener noreferrer";
}

// --- helpers UI
function requireLogin(actionText = "faire cette action") {
  if (!auth.currentUser) {
    alert(
      "Connexion requise 🔒\n\n" +
      `Pour ${actionText}, connecte-toi d'abord.`
    );
    return false;
  }
  return true;
}

function show(msg) {
  if (ticketStatus) ticketStatus.textContent = msg || "";
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
      <div><b>Conférences :</b> ${Number(t.conferencesAllowed ?? 0)}</div>
      <div><b>Workshops :</b> ${Number(t.workshopsAllowed ?? 0)}</div>
      ${t.helloassoOrderId ? `<div style="opacity:.7; font-size:12px;">Commande: ${t.helloassoOrderId}</div>` : ""}
      ${t.helloassoPayerEmail ? `<div style="opacity:.7; font-size:12px;">Email: ${t.helloassoPayerEmail}</div>` : ""}
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

  try {
    const ref = doc(db, "userTickets", u.uid);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      const t = snap.data();
      show(`✅ Pack détecté : ${t.ticketType || "?"}`);
      renderTicketBox(t);
    } else {
      show("Aucun billet détecté pour l’instant.");
      renderTicketBox(null);
    }
  } catch (e) {
    console.log("loadExistingTicket error:", e);
    show("❌ Erreur Firestore (voir console).");
    renderTicketBox(null);
  }
}

// --- fetch robuste : essaye plusieurs endpoints + gère HTML/JSON
async function postJsonWithFallback(urls, bodyObj) {
  let lastError = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
      });

      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const raw = await res.text().catch(() => "");

      if (!res.ok) {
        lastError = {
          url,
          status: res.status,
          text: raw.slice(0, 300),
          contentType
        };
        continue;
      }

      // si JSON → parse
      if (contentType.includes("application/json")) {
        const data = JSON.parse(raw || "{}");
        return { ok: true, url, data };
      }

      // sinon on tente quand même un parse JSON
      try {
        const data = JSON.parse(raw);
        return { ok: true, url, data };
      } catch {
        lastError = {
          url,
          status: res.status,
          text: "Réponse non JSON (ex: HTML): " + raw.slice(0, 300),
          contentType
        };
        continue;
      }

    } catch (e) {
      lastError = {
        url,
        status: "NETWORK",
        text: String(e?.message || e),
        contentType: ""
      };
    }
  }

  return { ok: false, error: lastError };
}

async function syncTicket() {
  if (!requireLogin("récupérer ton billet")) return;

  const u = auth.currentUser;

  if (syncTicketBtn) syncTicketBtn.disabled = true;
  show("⏳ Vérification de ton billet…");

  try {
    // ✅ Routes à tester :
    // 1) Netlify functions direct
    // 2) /api/... seulement si tu as mis la redirection dans netlify.toml
    const endpoints = [
      "/.netlify/functions/helloasso-ticket",
      "/api/helloasso-ticket"
    ];

    const { ok, data, url, error } = await postJsonWithFallback(endpoints, {
      email: (u.email || "").toLowerCase(),
      uid: u.uid
    });

    if (!ok) {
      console.log("helloasso-ticket error:", error);
      show(
        `❌ Impossible de récupérer le billet.\n` +
        `(${error?.status || "?"}) sur ${error?.url || "?"}\n` +
        `${(error?.text || "").slice(0, 180)}`
      );
      renderTicketBox(null);
      return;
    }

    console.log("helloasso-ticket OK from:", url, data);

    if (!data?.ticketType) {
      show("❌ Aucun billet trouvé pour cet email sur HelloAsso.");
      renderTicketBox(null);
      return;
    }

    const payload = {
      ticketType: data.ticketType || "",
      workshopsAllowed: Number(data.workshopsAllowed ?? 0),
      conferencesAllowed: Number(data.conferencesAllowed ?? 0),
      helloassoOrderId: data.helloassoOrderId || "",
      helloassoPayerEmail: (data.email || u.email || "").toLowerCase(),
      updatedAt: Date.now()
    };

    await setDoc(doc(db, "userTickets", u.uid), payload, { merge: true });

    show(`✅ Pack détecté : ${payload.ticketType}`);
    renderTicketBox(payload);

  } catch (e) {
    console.log("syncTicket error:", e);
    show("❌ Erreur réseau/JS (voir console).");
  } finally {
    if (syncTicketBtn) syncTicketBtn.disabled = false;
  }
}

syncTicketBtn?.addEventListener("click", syncTicket);

// ✅ écoute auth
onAuthStateChanged(auth, () => {
  loadExistingTicket();
});
