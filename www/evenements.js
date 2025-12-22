// evenements.js (MODULE)
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  deleteDoc,
  runTransaction,
  serverTimestamp,
  query,
  orderBy,
  Timestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ✅ init
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const PACKS = {
  essentiel: { workshopsAllowed: 1, conferencesAllowed: 2 },
  standard:  { workshopsAllowed: 2, conferencesAllowed: 4 },
  premium:   { workshopsAllowed: 3, conferencesAllowed: 7 },
};

// DOM
const openEventForm = document.getElementById("openEventForm");
const eventForm = document.getElementById("eventForm");
const cancelEvent = document.getElementById("cancelEvent");
const publishEvent = document.getElementById("publishEvent");
const eventsList = document.getElementById("eventsList");
const eventMsg = document.getElementById("eventMsg");

// helpers
function isAdmin() { return !!window.TIDOC_AUTH?.isAdmin; }
function showMsg(t = "") { if (eventMsg) eventMsg.textContent = t; }

function escapeHTML(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mapsUrl(address) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
}

function formatDayMonth(dateObj) {
  const day = dateObj.getDate();
  const month = dateObj.toLocaleDateString("fr-FR", { month: "short" }).toUpperCase();
  return { day, month };
}

function formatTime(dateObj) {
  return dateObj.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function showForm(show) {
  if (!eventForm) return;
  eventForm.hidden = false;
  eventForm.style.display = show ? "" : "none";
}

function clearForm() {
  ["eventDate", "eventStart", "eventEnd", "eventTitle", "eventPlace", "eventDesc", "eventCapacity"]
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
  showMsg("");
}

function applyAdminUI() {
  const admin = isAdmin();
  if (openEventForm) openEventForm.style.display = admin ? "flex" : "none";
  if (!admin) showForm(false);
}

// ===== Rights / Ticket =====
async function getMyRights(){
  const uid = auth.currentUser?.uid;
  if (!uid) return { ok:false, reason:"nologin" };

  const tSnap = await getDoc(doc(db, "userTickets", uid));
  if (!tSnap.exists()) return { ok:false, reason:"noticket" };

  const packKey = (tSnap.data()?.packKey || "").toLowerCase();
  const pack = PACKS[packKey];
  if (!pack) return { ok:false, reason:"badpack" };

  const uSnap = await getDoc(doc(db, "userUsage", uid));
  const usage = uSnap.exists() ? (uSnap.data() || {}) : {};
  const wsUsed = Number(usage.workshopUsed || 0);
  const confUsed = Number(usage.conferenceUsed || 0);

  return {
    ok:true,
    packKey,
    wsLeft: Math.max(0, pack.workshopsAllowed - wsUsed),
    confLeft: Math.max(0, pack.conferencesAllowed - confUsed),
  };
}

// ===== CRUD events =====
async function createEvent() {
  if (!isAdmin()) {
    alert("Réservé à l’admin Ti’Doc.");
    return;
  }

  try {
    const d = document.getElementById("eventDate")?.value || "";
    const start = document.getElementById("eventStart")?.value || "";
    const end = document.getElementById("eventEnd")?.value || "";
    const title = document.getElementById("eventTitle")?.value?.trim() || "";
    const place = document.getElementById("eventPlace")?.value?.trim() || "";
    const type = document.getElementById("eventType")?.value || "Autre";
    const desc = document.getElementById("eventDesc")?.value?.trim() || "";

    const capacity = Number(document.getElementById("eventCapacity")?.value || 0);
    if (capacity < 1) { showMsg("Ajoute un nombre de places (>=1)."); return; }

    if (!d || !title) { showMsg("Il faut au minimum une date + un titre."); return; }

    const startHHMM = start || "00:00";
    const [sh, sm] = startHHMM.split(":").map(Number);
    const startDate = new Date(d + "T00:00:00");
    startDate.setHours(sh, sm, 0, 0);
    const startAt = Timestamp.fromDate(startDate);

    let endAt = null;
    if (end) {
      const [eh, em] = end.split(":").map(Number);
      const endDate = new Date(d + "T00:00:00");
      endDate.setHours(eh, em, 0, 0);
      endAt = Timestamp.fromDate(endDate);
    }

    await addDoc(collection(db, "events"), {
      title,
      desc,
      place,
      type,
      startAt,
      endAt,
      capacity,
      bookedCount: 0,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || "",
    });

    clearForm();
    showForm(false);
    await loadEvents();
  } catch (e) {
    console.log("createEvent error:", e);
    alert("Impossible de publier l’évènement (Rules Firestore ?)");
  }
}

async function deleteEvent(eventId) {
  if (!isAdmin()) return;
  if (!confirm("Supprimer cet évènement ?")) return;

  try {
    await deleteDoc(doc(db, "events", eventId));
    await loadEvents();
  } catch (e) {
    console.log("deleteEvent error:", e);
    alert("Suppression impossible (rules ?).");
  }
}

// ===== Registration =====
async function registerToEvent(eventId){
  const uid = auth.currentUser?.uid;
  if (!uid) { location.href="./login.html"; return; }

  const rights = await getMyRights();
  if (!rights.ok){
    if (rights.reason === "noticket" || rights.reason === "badpack") {
      alert("Tu dois importer ton billet pour t’inscrire.");
      location.href = "./billets.html";
      return;
    }
    alert("Connexion requise.");
    return;
  }

  const evRef = doc(db, "events", eventId);
  const regRef = doc(db, "events", eventId, "registrations", uid);
  const usageRef = doc(db, "userUsage", uid);

  await runTransaction(db, async (tx) => {
    const evSnap = await tx.get(evRef);
    if (!evSnap.exists()) throw new Error("Évènement introuvable.");

    const ev = evSnap.data() || {};
    const cap = Number(ev.capacity || 0);
    const booked = Number(ev.bookedCount || 0);

    const regSnap = await tx.get(regRef);
    if (regSnap.exists()) throw new Error("Tu es déjà inscrit(e).");

    if (cap > 0 && booked >= cap) throw new Error("Plus de places disponibles.");

    const type = (ev.type || "").toLowerCase();

    const uSnap = await tx.get(usageRef);
    const usage = uSnap.exists() ? (uSnap.data() || {}) : {};
    const wsUsed = Number(usage.workshopUsed || 0);
    const confUsed = Number(usage.conferenceUsed || 0);

    const wsAllowed = PACKS[rights.packKey].workshopsAllowed;
    const confAllowed = PACKS[rights.packKey].conferencesAllowed;

    if (type.includes("workshop")) {
      if (wsUsed >= wsAllowed) throw new Error("Tu n’as plus de workshop disponible.");
      tx.set(usageRef, { workshopUsed: wsUsed + 1 }, { merge:true });
    } else if (type.includes("conf")) {
      if (confUsed >= confAllowed) throw new Error("Tu n’as plus de conférence disponible.");
      tx.set(usageRef, { conferenceUsed: confUsed + 1 }, { merge:true });
    } else {
      throw new Error("Type d’évènement non éligible à l’inscription.");
    }

    tx.set(regRef, { uid, createdAt: serverTimestamp() });
    tx.set(evRef, { bookedCount: booked + 1 }, { merge:true });
  });
}

// ===== Render =====
function renderEventCard(id, e) {
  const startAtDate = e.startAt?.toDate ? e.startAt.toDate() : null;
  if (!startAtDate) return null;

  const { day, month } = formatDayMonth(startAtDate);
  const timeTxt = formatTime(startAtDate);
  const endTxt = e.endAt?.toDate ? formatTime(e.endAt.toDate()) : "";
  const place = (e.place || "").trim();
  const canDelete = isAdmin();

  const cap = Number(e.capacity || 0);
  const booked = Number(e.bookedCount || 0);
  const left = cap > 0 ? Math.max(0, cap - booked) : null;

  const card = document.createElement("section");
  card.className = "event-card";

  card.innerHTML = `
    <div class="event-date">
      <span class="day">${day}</span>
      <span class="month">${month}</span>
    </div>

    <div class="event-content">
      <div class="event-head">
        <h3>${escapeHTML(e.title || "")}</h3>
        ${canDelete ? `<button class="delete-btn" type="button" data-del="${id}">🗑️</button>` : ""}
      </div>

      ${e.desc ? `<p class="event-desc">${escapeHTML(e.desc)}</p>` : ""}

      <div class="event-meta">
        <span>🕒 ${timeTxt}${endTxt ? " – " + endTxt : ""}</span>
        ${cap ? `<span>• 👥 ${left} / ${cap} places restantes</span>` : ""}
        ${e.type ? `<span>• ${escapeHTML(e.type)}</span>` : ""}
        ${
          place
            ? `<span>• 📍 <a class="event-place" target="_blank" rel="noreferrer" href="${mapsUrl(place)}">${escapeHTML(place)}</a></span>`
            : ""
        }
      </div>

      ${!canDelete ? `
        <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <button class="btn-primary event-add" type="button" data-join="${id}">
            S’inscrire
          </button>
          <span data-rights="${id}" style="font-size:12px;color:var(--muted);font-weight:700;"></span>
        </div>
      ` : ""}
    </div>
  `;

  if (canDelete) {
    card.querySelector(`[data-del="${id}"]`)?.addEventListener("click", () => deleteEvent(id));
  }

  card.querySelector(`[data-join="${id}"]`)?.addEventListener("click", async () => {
    try{
      await registerToEvent(id);
      alert("✅ Inscription validée !");
      await loadEvents();
    }catch(err){
      alert("❌ " + (err?.message || String(err)));
    }
  });

  // affiche les quotas restants
  (async ()=>{
    const el = card.querySelector(`[data-rights="${id}"]`);
    if (!el) return;
    if (!auth.currentUser) { el.textContent = "Connecte-toi pour t’inscrire."; return; }

    const r = await getMyRights();
    if (!r.ok){ el.textContent = "Billet requis (importe-le)."; return; }
    el.textContent = `Workshops restants : ${r.wsLeft} • Conférences restantes : ${r.confLeft}`;
  })();

  return card;
}

async function loadEvents() {
  if (!eventsList) return;

  eventsList.innerHTML = `<section class="card"><p>Chargement…</p></section>`;

  const qy = query(collection(db, "events"), orderBy("startAt", "asc"));
  const snap = await getDocs(qy);

  eventsList.innerHTML = "";

  if (snap.empty) {
    eventsList.innerHTML = `<section class="card"><p>Aucun évènement pour l’instant.</p></section>`;
    return;
  }

  snap.forEach((d) => {
    const card = renderEventCard(d.id, d.data());
    if (card) eventsList.appendChild(card);
  });
}

// boot
document.addEventListener("DOMContentLoaded", () => {
  applyAdminUI();
  window.addEventListener("tidoc:auth", applyAdminUI);

  openEventForm?.addEventListener("click", () => {
    if (!isAdmin()) return alert("Réservé à l’admin Ti’Doc.");
    showForm(true);
    document.getElementById("eventDate")?.focus();
  });

  cancelEvent?.addEventListener("click", () => {
    clearForm();
    showForm(false);
  });

  publishEvent?.addEventListener("click", createEvent);

  onAuthStateChanged(auth, () => {
    applyAdminUI();
    loadEvents();
  });

  loadEvents();
});
