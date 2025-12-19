// evenements.js (MODULE) — clean & fiable (admin via auth.js)
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ✅ IMPORTANT : on utilise auth.js pour admin + profil
import { isAdminUser, ensureUserDoc } from "./auth.js";

// ✅ init
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ===== DOM
const openEventForm = document.getElementById("openEventForm");
const eventForm = document.getElementById("eventForm");
const cancelEvent = document.getElementById("cancelEvent");
const publishEvent = document.getElementById("publishEvent");
const eventsList = document.getElementById("eventsList");
const eventMsg = document.getElementById("eventMsg");

// ===== helpers
let IS_ADMIN = false;
function isAdmin() {
  return IS_ADMIN;
}

function showMsg(t = "") {
  if (eventMsg) eventMsg.textContent = t;
}

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
  eventForm.style.display = show ? "" : "none";
}

function clearForm() {
  const ids = ["eventDate", "eventStart", "eventEnd", "eventTitle", "eventPlace", "eventDesc"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  showMsg("");
}

// ===== CRUD
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

    if (!d || !title) {
      showMsg("Il faut au minimum une date + un titre.");
      return;
    }

    // startAt
    const startHHMM = start || "00:00";
    const [sh, sm] = startHHMM.split(":").map(Number);
    const startDate = new Date(d + "T00:00:00");
    startDate.setHours(sh, sm, 0, 0);
    const startAt = Timestamp.fromDate(startDate);

    // endAt (optionnel)
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
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || "",
      createdByEmail: (auth.currentUser?.email || "").toLowerCase(),
    });

    clearForm();
    showForm(false);
    await loadEvents();
  } catch (e) {
    console.log("PUBLISH EVENT ERROR:", e);
    alert("Impossible de publier l’évènement. (Rules Firestore ?)");
  }
}

async function deleteEvent(eventId) {
  if (!isAdmin()) return;
  if (!confirm("Supprimer cet évènement ?")) return;

  try {
    await deleteDoc(doc(db, "events", eventId));
    await loadEvents();
  } catch (e) {
    console.log("DELETE EVENT ERROR:", e);
    alert("Suppression impossible (rules ?).");
  }
}

// ===== render
function renderEventCard(id, e) {
  const startAtDate = e.startAt?.toDate ? e.startAt.toDate() : null;
  if (!startAtDate) return null;

  const { day, month } = formatDayMonth(startAtDate);
  const timeTxt = formatTime(startAtDate);
  const endTxt = e.endAt?.toDate ? formatTime(e.endAt.toDate()) : "";

  const canDelete = isAdmin();
  const place = (e.place || "").trim();

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
        ${
          canDelete
            ? `<button class="delete-btn" type="button" title="Supprimer" data-del="${id}">🗑️</button>`
            : ``
        }
      </div>

      ${e.desc ? `<p class="event-desc">${escapeHTML(e.desc)}</p>` : ""}

      <div class="event-meta">
        <span>🕒 ${timeTxt}${endTxt ? " – " + endTxt : ""}</span>
        ${e.type ? `<span>• ${escapeHTML(e.type)}</span>` : ""}
        ${
          place
            ? `<span>• 📍 <a class="event-place" target="_blank" rel="noreferrer" href="${mapsUrl(place)}">${escapeHTML(place)}</a></span>`
            : ""
        }
      </div>

      <div class="event-select" style="margin-top:10px">
        <button class="btn-outline event-add" type="button" data-add="${id}">
          Ajouter à mon billet
        </button>
      </div>
    </div>
  `;

  // delete (admin)
  if (canDelete) {
    card.querySelector(`[data-del="${id}"]`)?.addEventListener("click", () => deleteEvent(id));
  }

  // placeholder add ticket
  card.querySelector(`[data-add="${id}"]`)?.addEventListener("click", () => {
    alert("On le branche à Billets après 🙂");
  });

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

// ===== boot
document.addEventListener("DOMContentLoaded", () => {
  openEventForm?.addEventListener("click", () => {
    if (!isAdmin()) {
      alert("Réservé à l’admin Ti’Doc.");
      return;
    }
    showForm(true);
    document.getElementById("eventDate")?.focus();
  });

  cancelEvent?.addEventListener("click", () => {
    clearForm();
    showForm(false);
  });

  publishEvent?.addEventListener("click", createEvent);

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      // ✅ s’assure que /users/<uid> existe (displayName etc)
      await ensureUserDoc(user);
      IS_ADMIN = isAdminUser(user);
    } else {
      IS_ADMIN = false;
    }

    if (openEventForm) openEventForm.style.display = IS_ADMIN ? "" : "none";
    if (!IS_ADMIN) showForm(false);

    loadEvents();
  });

  loadEvents();
});
