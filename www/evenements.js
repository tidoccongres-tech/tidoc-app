// evenements.js (MODULE)

import { firebaseConfig } from "./firebase-config.js";
import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

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
  getDoc,      // ✅ ajoute
  setDoc,      // ✅ ajoute
  updateDoc    // ✅ ajoute
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
async function getUserTicketTypeId() {

  const uid = auth.currentUser?.uid;
  if (!uid) return null;

  const snap = await getDoc(doc(db, "userTickets", uid));
  if (!snap.exists()) return null;

  return snap.data().ticketTypeId || null;
}

async function getTicketLimits(ticketTypeId) {
  if (!ticketTypeId) return null;

  const snap = await getDoc(doc(db, "ticketTypes", ticketTypeId));
  if (!snap.exists()) return null;

  const d = snap.data();
  return {
    workshopsAllowed: Number(d.workshopsAllowed ?? 0),
    conferencesAllowed: Number(d.conferencesAllowed ?? 0),
  };
}

async function getUserSelections() {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;

  const ref = doc(db, "userSelections", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // doc auto créé vide
    await setDoc(ref, { selectedWorkshops: [], selectedConferences: [] }, { merge: true });
    return { selectedWorkshops: [], selectedConferences: [] };
  }
  const d = snap.data();
  return {
    selectedWorkshops: Array.isArray(d.selectedWorkshops) ? d.selectedWorkshops : [],
    selectedConferences: Array.isArray(d.selectedConferences) ? d.selectedConferences : [],
  };
}

// ✅ évite double init
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Elements
const openEventForm = document.getElementById("openEventForm");
const eventForm = document.getElementById("eventForm");
const cancelEvent = document.getElementById("cancelEvent");
const publishEvent = document.getElementById("publishEvent");
const eventsList = document.getElementById("eventsList");
const notifBtn = document.getElementById("notifBtn");

function isAdmin() {
  return !!window.TIDOC_AUTH?.isAdmin;
}

function escapeHTML(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function requireLogin(actionText = "faire cette action") {
  if (auth.currentUser) return true;

async function getUserQuota(uid){
  // userTickets/<uid>
  const utSnap = await getDoc(doc(db, "userTickets", uid));
  if (!utSnap.exists()) return null;

  const { ticketTypeId } = utSnap.data();
  if (!ticketTypeId) return null;

  // ticketTypes/<typeId>
  const ttSnap = await getDoc(doc(db, "ticketTypes", ticketTypeId));
  if (!ttSnap.exists()) return null;

  const tt = ttSnap.data();
  return {
    ticketTypeId,
    workshopsAllowed: Number(tt.workshopsAllowed ?? 0),
    conferencesAllowed: Number(tt.conferencesAllowed ?? 0),
  };
}

async function getUserSelection(uid){
  const selRef = doc(db, "userSelections", uid);
  const selSnap = await getDoc(selRef);
  if (!selSnap.exists()) return { selectedEventIds: [] };
  return selSnap.data();
}

async function saveUserSelection(uid, selectedEventIds){
  const selRef = doc(db, "userSelections", uid);
  // setDoc merge pour créer si absent
  await setDoc(selRef, { selectedEventIds, updatedAt: serverTimestamp() }, { merge:true });
}

async function countSelectedByType(selectedIds){
  // On doit connaître le type des events sélectionnés
  // -> on recharge les docs events correspondants
  let workshops = 0;
  let conferences = 0;

  for (const eventId of selectedIds){
    const evSnap = await getDoc(doc(db, "events", eventId));
    if (!evSnap.exists()) continue;
    const ev = evSnap.data();
    if (ev.type === "Workshop") workshops++;
    else if (ev.type === "Conférence") conferences++;
  }
  return { workshops, conferences };
}

  alert(
    "Connexion requise 🔒\n\n" +
      `Pour ${actionText}, connecte-toi avec Google via l’icône Profil en haut à gauche.`
  );
  return false;
}

function mapsUrl(address) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
}

// icône SVG (même style que cloche)
const TRASH_SVG =
  '<svg viewBox="0 0 24 24" class="icon" aria-hidden="true">' +
  '<path d="M6 7h12M9 7V5h6v2m-7 3v8m4-8v8m4-8v8M5 7l1 14h12l1-14" />' +
  "</svg>";

function formatDayMonth(dateObj) {
  const day = dateObj.getDate();
  const month = dateObj.toLocaleDateString("fr-FR", { month: "short" }).toUpperCase();
  return { day, month };
}

function formatTime(dateObj) {
  return dateObj.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// --- UI form ---
openEventForm?.addEventListener("click", () => {
  if (!isAdmin()) {
    alert("Réservé à l’admin Ti’Doc.");
    return;
  }
  if (!requireLogin("créer un évènement")) return;
  if (eventForm) eventForm.hidden = false;
});

cancelEvent?.addEventListener("click", () => {
  if (eventForm) eventForm.hidden = true;
});

publishEvent?.addEventListener("click", async () => {
  if (!isAdmin()) {
    alert("Réservé à l’admin Ti’Doc.");
    return;
  }
  if (!requireLogin("publier un évènement")) return;

  try {
    const d = document.getElementById("eventDate")?.value || "";        // "2026-03-27"
    const start = document.getElementById("eventStart")?.value || "";  // "09:00"
    const end = document.getElementById("eventEnd")?.value || "";      // "10:30"
    const title = document.getElementById("eventTitle")?.value?.trim() || "";
    const place = document.getElementById("eventPlace")?.value?.trim() || "";
    const type = document.getElementById("eventType")?.value || "Autre";
    const desc = document.getElementById("eventDesc")?.value?.trim() || "";

    if (!d || !title) {
      alert("Il faut au minimum une date + un titre.");
      return;
    }

    // ✅ startAt (date événement)
    const startHHMM = start || "00:00";
    const [sh, sm] = startHHMM.split(":").map(Number);
    const startDate = new Date(d + "T00:00:00");
    startDate.setHours(sh, sm, 0, 0);
    const startAt = Timestamp.fromDate(startDate);

    // ✅ endAt optionnel
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
      startAt,               // ✅ tri fiable
      endAt,                 // ✅ optionnel
      createdAt: serverTimestamp()
    });

    // reset
    document.getElementById("eventDate").value = "";
    document.getElementById("eventStart").value = "";
    document.getElementById("eventEnd").value = "";
    document.getElementById("eventTitle").value = "";
    document.getElementById("eventPlace").value = "";
    document.getElementById("eventDesc").value = "";
    if (eventForm) eventForm.hidden = true;

    await loadEvents();
  } catch (e) {
    console.log("PUBLISH EVENT ERROR:", e);
    alert(
      "Impossible de publier l’évènement.\n\n" +
        "Cause la plus fréquente : Rules Firestore (permission denied).\n" +
        "Va dans Firestore → Rules et vérifie que /events est autorisé pour l’admin."
    );
  }
});

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

// ===== Billets / Sélections =====
async function getMyTicket() {
  const u = auth.currentUser;
  if (!u) return null;

  const snap = await getDoc(doc(db, "userTickets", u.uid));
  return snap.exists() ? snap.data() : null;
}

async function getMySelection() {
  const u = auth.currentUser;
  if (!u) return { selectedEventIds: [] };

  const ref = doc(db, "userSelections", u.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { selectedEventIds: [] };
  return snap.data();
}

function isWorkshop(type = "") {
  const t = String(type).toLowerCase();
  return t.includes("workshop") || t.includes("ws");
}
function isConference(type = "") {
  const t = String(type).toLowerCase();
  return t.includes("conf") || t.includes("conférence") || t.includes("conference");
}

async function addToMyTicket(eventId, eventType) {
  if (!requireLogin("ajouter un évènement à ton billet")) return;

  // 1) billet
  const ticket = await getMyTicket();
  if (!ticket?.ticketType) {
    alert("Tu n’as pas de billet détecté.\nVa dans Billets → Récupérer mon billet.");
    return;
  }

  // 2) sélection actuelle
  const u = auth.currentUser;
  const selRef = doc(db, "userSelections", u.uid);
  const sel = await getMySelection();
  const selectedIds = Array.isArray(sel.selectedEventIds) ? sel.selectedEventIds : [];

  // déjà ajouté ?
  if (selectedIds.includes(eventId)) {
    alert("Déjà ajouté ✅");
    return;
  }

  // 3) compter WS/conf déjà choisis
  // On relit les events sélectionnés pour compter correctement (simple et sûr)
  let wsCount = 0;
  let confCount = 0;

  for (const id of selectedIds) {
    const eSnap = await getDoc(doc(db, "events", id));
    if (!eSnap.exists()) continue;
    const e = eSnap.data();
    if (isWorkshop(e.type)) wsCount++;
    else if (isConference(e.type)) confCount++;
  }

  // 4) vérifier quota selon type de l’évènement qu’on ajoute
  const wsMax = Number(ticket.workshopsAllowed || 0);
  const confMax = Number(ticket.conferencesAllowed || 0);

  if (isWorkshop(eventType) && wsCount >= wsMax) {
    alert(`Quota workshop atteint (${wsMax}).`);
    return;
  }
  if (isConference(eventType) && confCount >= confMax) {
    alert(`Quota conférences atteint (${confMax}).`);
    return;
  }

  // 5) écrire la sélection
  const next = [...selectedIds, eventId];
  await setDoc(selRef, { selectedEventIds: next, updatedAt: serverTimestamp() }, { merge: true });

  alert("Ajouté à ton billet ✅");
  await loadEvents(); // refresh UI
}

// --- load (tri par date de l’évènement ✅) ---
async function loadEvents() {
  if (!eventsList) return;
  eventsList.innerHTML = "";

  // ✅ TRI par startAt (date de l'événement)
  const qy = query(collection(db, "events"), orderBy("startAt", "asc"));
  const snap = await getDocs(qy);

  if (snap.empty) {
    eventsList.innerHTML = `<div class="card"><p>Aucun évènement pour l’instant.</p></div>`;
    return;
  }

  for (const d of snap.docs) {
    const id = d.id;
    const e = d.data();

    const startAtDate = e.startAt?.toDate ? e.startAt.toDate() : null;
    if (!startAtDate) continue;

    const { day, month } = formatDayMonth(startAtDate);
    const timeTxt = formatTime(startAtDate);
    const endTxt = e.endAt?.toDate ? formatTime(e.endAt.toDate()) : "";

    const delBtn = isAdmin()
      ? `<button class="delete-btn" type="button" title="Supprimer" data-del="${id}">${TRASH_SVG}</button>`
      : "";

    const placeHtml = e.place
      ? `<a href="${mapsUrl(e.place)}" target="_blank" rel="noreferrer" class="event-place">• 📍 ${escapeHTML(e.place)}</a>`
      : "";

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
      ${delBtn}
    </div>

    <p class="event-desc">${escapeHTML(e.desc || "")}</p>

    <div class="event-meta">
      <span>🕒 ${timeTxt}${endTxt ? " – " + endTxt : ""}</span>
      ${e.type ? `<span>• ${escapeHTML(e.type)}</span>` : ""}
      ${e.place ? `<span>• 📍 <a class="event-place" target="_blank" href="${mapsUrl(e.place)}">${escapeHTML(e.place)}</a></span>` : ""}
    </div>

    <div class="event-select" style="margin-top:10px">
      <button class="btn-outline event-add" type="button" data-add="${id}">
        Ajouter à mon billet
      </button>
    </div>
  </div>
`;

    <div class="event-select">
      <button
        class="btn-outline event-add"
        type="button"
        data-add="${id}">
        Ajouter à mon billet
      </button>
    </div>
  </div>
`;
    `;

    eventsList.appendChild(card);
    card.querySelector(`[data-del="${id}"]`)?.addEventListener("click", () => deleteEvent(id));
  }
}

card.querySelector(`[data-add="${id}"]`)?.addEventListener("click", async () => {
  if (!requireLogin("ajouter un évènement à ton billet")) return;

  const uid = auth.currentUser.uid;

  // 1) quota pack
  const quota = await getUserQuota(uid);
  if (!quota) {
    alert("Aucun billet trouvé pour ton compte (pas encore connecté à HelloAsso).");
    return;
  }

  // 2) sélection actuelle
  const sel = await getUserSelection(uid);
  const selected = Array.isArray(sel.selectedEventIds) ? sel.selectedEventIds : [];

  // déjà sélectionné -> toggle (on enlève)
  if (selected.includes(id)) {
    const next = selected.filter(x => x !== id);
    await saveUserSelection(uid, next);
    alert("Retiré de ton billet ✅");
    return;
  }

  // 3) compter par type
  const counts = await countSelectedByType(selected);

  // 4) vérifier quota selon type de l’event cliqué
  const clickedType = e.type;

  if (clickedType === "Workshop" && counts.workshops >= quota.workshopsAllowed) {
    alert(`Quota atteint : ${quota.workshopsAllowed} workshop(s) max pour ton billet.`);
    return;
  }
  if (clickedType === "Conférence" && counts.conferences >= quota.conferencesAllowed) {
    alert(`Quota atteint : ${quota.conferencesAllowed} conférence(s) max pour ton billet.`);
    return;
  }

  // 5) ok -> on ajoute
  const next = [...selected, id];
  await saveUserSelection(uid, next);
  alert("Ajouté à ton billet ✅");
});

notifBtn?.addEventListener("click", () => {
  alert("Notifications : on pourra les activer plus tard avec la version PWA 🙂");
});

async function toggleSelection(eventId, eventType) {
  if (!requireLogin("ajouter à ton billet")) return;

  const uid = auth.currentUser.uid;

  // 1) pack utilisateur
  const ticketTypeId = await getUserTicketTypeId();
  if (!ticketTypeId) {
    alert("Aucun billet détecté pour ton compte. (userTickets manquant)");
    return;
  }

  // 2) limites du pack
  const limits = await getTicketLimits(ticketTypeId);
  if (!limits) {
    alert("TicketType introuvable dans Firestore (ticketTypes).");
    return;
  }

  // 3) sélections actuelles
  const sel = await getUserSelections();
  const ref = doc(db, "userSelections", uid);

  const isWorkshop = /workshop/i.test(eventType || "");
  const key = isWorkshop ? "selectedWorkshops" : "selectedConferences";
  const allowed = isWorkshop ? limits.workshopsAllowed : limits.conferencesAllowed;

  const already = sel[key].includes(eventId);

  // Si déjà sélectionné → on retire
  if (already) {
    await updateDoc(ref, { [key]: arrayRemove(eventId) });
    return { added: false, used: sel[key].length - 1, allowed };
  }

  // Sinon → vérifier quota
  if (sel[key].length >= allowed) {
    alert(`Quota atteint 😅\nTu as droit à ${allowed} ${isWorkshop ? "workshop(s)" : "conférence(s)"} avec ton pack.`);
    return null;
  }

  await updateDoc(ref, { [key]: arrayUnion(eventId) });
  return { added: true, used: sel[key].length + 1, allowed };
}

document.addEventListener("DOMContentLoaded", () => {
  loadEvents();

card.querySelector(`[data-add="${id}"]`)?.addEventListener("click", async () => {
  // ⚠️ e.type doit être bien rempli ("Workshop" vs "Conférence")
  const res = await toggleSelection(id, e.type);

  if (!res) return;

  const btn = card.querySelector(`[data-add="${id}"]`);
  if (!btn) return;

  if (res.added) {
    btn.textContent = "Ajouté ✓";
    btn.classList.remove("btn-outline");
    btn.classList.add("btn-primary");
  } else {
    btn.textContent = "Ajouter à mon billet";
    btn.classList.remove("btn-primary");
    btn.classList.add("btn-outline");
  }
});

  const timer = setInterval(() => {
    if (window.TIDOC_AUTH) {
      if (openEventForm) openEventForm.style.display = isAdmin() ? "" : "none";
      if (!isAdmin() && eventForm) eventForm.hidden = true;
      clearInterval(timer);
    }
  }, 100);
});

