// evenements.js (MODULE)
import * as AuthMod from "./auth.js";
import {
  collection, addDoc, getDocs, getDoc, doc, deleteDoc,
  runTransaction, serverTimestamp, query, orderBy, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const auth = AuthMod.auth;
const db   = AuthMod.db;

const ADMIN_EMAIL = "tidoc.congres@gmail.com";

const PACKS_FALLBACK = {
  essentiel: { label:"Essentiel", workshopsAllowed: 1, conferencesAllowed: 2, otherAllowed: 0 },
  standard:  { label:"Standard",  workshopsAllowed: 2, conferencesAllowed: 4, otherAllowed: 0 },
  premium:   { label:"Premium",   workshopsAllowed: 3, conferencesAllowed: 7, otherAllowed: 0 },
  autre:     { label:"Autre",     workshopsAllowed: 0, conferencesAllowed: 0, otherAllowed: 0 },
};

let PACKS = { ...PACKS_FALLBACK };

function normalizePackConfig(obj){
  const src = obj && typeof obj === "object" ? obj : {};
  const out = {};
  for (const k of Object.keys(src)){
    const v = src[k] || {};
    out[String(k).toLowerCase()] = {
      label: String(v.label || k),
      workshopsAllowed: Number(v.workshopsAllowed ?? 0),
      conferencesAllowed: Number(v.conferencesAllowed ?? 0),
      otherAllowed: Number(v.otherAllowed ?? 0),
    };
  }
  return out;
}

async function loadPackConfig(){
  try{
    const snap = await getDoc(doc(db, "config", "packs"));
    if (!snap.exists()){
      PACKS = { ...PACKS_FALLBACK };
      return;
    }
    const data = snap.data() || {};
    const normalized = normalizePackConfig(data);
    PACKS = Object.keys(normalized).length ? normalized : { ...PACKS_FALLBACK };
  } catch (e){
    console.log("loadPackConfig error:", e);
    PACKS = { ...PACKS_FALLBACK };
  }
}
const TRASH_SVG = `
<svg class="trash-ico" viewBox="0 0 408.483 408.483" aria-hidden="true" focusable="false">
  <path d="M87.748,388.784c0.461,11.01,9.521,19.699,20.539,19.699h191.911c11.018,0,20.078-8.689,20.539-19.699l13.705-289.316
    H74.043L87.748,388.784z M247.655,171.329c0-4.61,3.738-8.349,8.35-8.349h13.355c4.609,0,8.35,3.738,8.35,8.349v165.293
    c0,4.611-3.738,8.349-8.35,8.349h-13.355c-4.61,0-8.35-3.736-8.35-8.349V171.329z M189.216,171.329
    c0-4.61,3.738-8.349,8.349-8.349h13.355c4.609,0,8.349,3.738,8.349,8.349v165.293c0,4.611-3.737,8.349-8.349,8.349h-13.355
    c-4.61,0-8.349-3.736-8.349-8.349V171.329L189.216,171.329z M130.775,171.329c0-4.61,3.738-8.349,8.349-8.349h13.356
    c4.61,0,8.349,3.738,8.349,8.349v165.293c0,4.611-3.738,8.349-8.349,8.349h-13.356c-4.61,0-8.349-3.736-8.349-8.349V171.329z"/>
  <path d="M343.567,21.043h-88.535V4.305c0-2.377-1.927-4.305-4.305-4.305h-92.971c-2.377,0-4.304,1.928-4.304,4.305v16.737H64.916
    c-7.125,0-12.9,5.776-12.9,12.901V74.47h304.451V33.944C356.467,26.819,350.692,21.043,343.567,21.043z"/>
</svg>`;

/* =========================
   DOM
   ========================= */
const openEventForm = document.getElementById("openEventForm");
const eventForm     = document.getElementById("eventForm");
const cancelEvent   = document.getElementById("cancelEvent");
const publishEvent  = document.getElementById("publishEvent");
const eventsList    = document.getElementById("eventsList");
const eventMsg      = document.getElementById("eventMsg");

/* =========================
   HELPERS
   ========================= */
function isAdmin(){
  if (window.TIDOC_AUTH?.isAdmin) return true;
  const email = (auth.currentUser?.email || "").toLowerCase();
  return email === ADMIN_EMAIL.toLowerCase();
}

function showMsg(t=""){ if (eventMsg) eventMsg.textContent = t; }

function escapeHTML(s=""){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function mapsUrl(address){
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
}

function formatDayMonth(dateObj){
  const day = dateObj.getDate();
  const month = dateObj.toLocaleDateString("fr-FR", { month:"short" }).toUpperCase();
  return { day, month };
}

function formatTime(dateObj){
  return dateObj.toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" });
}

function showForm(show){
  if (!eventForm) return;
  eventForm.hidden = false;
  eventForm.style.display = show ? "" : "none";
}

function clearForm(){
  ["eventDate","eventStart","eventEnd","eventTitle","eventPlace","eventDesc","eventCapacity"]
    .forEach((id)=>{
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
  showMsg("");
}

function applyAdminUI(){
  const admin = isAdmin();
  if (openEventForm) openEventForm.style.display = admin ? "flex" : "none";
  if (!admin) showForm(false);
}

/* =========================
   RIGHTS / TICKET
   ========================= */
async function getMyRights(){
  const uid = auth.currentUser?.uid;
  if (!uid) return { ok:false, reason:"nologin" };

  const tSnap = await getDoc(doc(db, "userTickets", uid));
  if (!tSnap.exists()) return { ok:false, reason:"noticket" };

  const packKey = String(tSnap.data()?.packKey || "").toLowerCase();
  const pack = PACKS[packKey];
  if (!pack) return { ok:false, reason:"badpack" };

  const uSnap = await getDoc(doc(db, "userUsage", uid));
  const usage = uSnap.exists() ? (uSnap.data() || {}) : {};

  const wsUsed    = Number(usage.workshopUsed || 0);
  const confUsed  = Number(usage.conferenceUsed || 0);
  const otherUsed = Number(usage.otherUsed || 0);

  return {
    ok:true,
    packKey,

    wsUsed,
    confUsed,
    otherUsed,

    wsAllowed: pack.workshopsAllowed,
    confAllowed: pack.conferencesAllowed,
    otherAllowed: pack.otherAllowed,

    wsLeft: Math.max(0, pack.workshopsAllowed - wsUsed),
    confLeft: Math.max(0, pack.conferencesAllowed - confUsed),
    otherLeft: Math.max(0, pack.otherAllowed - otherUsed),
  };
}

/* =========================
   CRUD EVENTS (ADMIN)
   ========================= */
async function createEvent(){
  if (!isAdmin()) { alert("Réservé à l’admin Ti’Doc."); return; }

  try{
    const d     = document.getElementById("eventDate")?.value || "";
    const start = document.getElementById("eventStart")?.value || "";
    const end   = document.getElementById("eventEnd")?.value || "";
    const title = document.getElementById("eventTitle")?.value?.trim() || "";
    const place = document.getElementById("eventPlace")?.value?.trim() || "";
    const type  = document.getElementById("eventType")?.value || "Autre";
    const desc  = document.getElementById("eventDesc")?.value?.trim() || "";
    const capacity = Number(document.getElementById("eventCapacity")?.value || 0);

    if (capacity < 1) { showMsg("Ajoute un nombre de places (>=1)."); return; }
    if (!d || !title) { showMsg("Il faut au minimum une date + un titre."); return; }

    const startHHMM = start || "00:00";
    const [sh, sm] = startHHMM.split(":").map(Number);
    const startDate = new Date(d + "T00:00:00");
    startDate.setHours(sh, sm, 0, 0);
    const startAt = Timestamp.fromDate(startDate);

    let endAt = null;
    if (end){
      const [eh, em] = end.split(":").map(Number);
      const endDate = new Date(d + "T00:00:00");
      endDate.setHours(eh, em, 0, 0);
      endAt = Timestamp.fromDate(endDate);
    }

    await addDoc(collection(db, "events"), {
      title, desc, place, type,
      startAt, endAt,
      capacity,
      bookedCount: 0,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || "",
    });

    clearForm();
    showForm(false);
    await loadEvents();
  } catch(e){
    console.log("createEvent error:", e);
    alert("Impossible de publier l’évènement (Rules Firestore ?)");
  }
}

async function deleteEvent(eventId){
  if (!isAdmin()) return;
  if (!confirm("Supprimer cet évènement ?")) return;

  try{
    await deleteDoc(doc(db, "events", eventId));
    await loadEvents();
  } catch(e){
    console.log("deleteEvent error:", e);
    alert("Suppression impossible (rules ?).");
  }
}

/* =========================
   REGISTRATION (JOIN / LEAVE)
   ========================= */
function eventTypeKey(evType=""){
  const t = String(evType).toLowerCase();
  if (t.includes("workshop")) return "ws";
  if (t.includes("conf")) return "conf";
  return "other";
}

async function requireTicketOrRedirect(){
  const r = await getMyRights();
  if (r.ok) return r;

  if (r.reason === "noticket" || r.reason === "badpack") {
    alert("Tu dois importer ton billet pour t’inscrire.");
    location.href = "./billets.html";
    return null;
  }
  alert("Connexion requise.");
  return null;
}

async function registerToEvent(eventId){
  const uid = auth.currentUser?.uid;
  if (!uid) { location.href="./login.html"; return; }

  const rights = await requireTicketOrRedirect();
  if (!rights) return;

  const evRef    = doc(db, "events", eventId);
  const regRef   = doc(db, "events", eventId, "registrations", uid);
  const usageRef = doc(db, "userUsage", uid);

  await runTransaction(db, async (tx)=>{
    const evSnap = await tx.get(evRef);
    if (!evSnap.exists()) throw new Error("Évènement introuvable.");

    const ev = evSnap.data() || {};
    const cap    = Number(ev.capacity || 0);
    const booked = Number(ev.bookedCount || 0);

    const regSnap = await tx.get(regRef);
    if (regSnap.exists()) throw new Error("Tu es déjà inscrit(e).");

    if (cap > 0 && booked >= cap) throw new Error("Plus de places disponibles.");

    const typeKey = eventTypeKey(ev.type);

    const uSnap = await tx.get(usageRef);
    const usage = uSnap.exists() ? (uSnap.data() || {}) : {};
    const wsUsed    = Number(usage.workshopUsed || 0);
    const confUsed  = Number(usage.conferenceUsed || 0);
    const otherUsed = Number(usage.otherUsed || 0);

    if (typeKey === "ws"){
      if (wsUsed >= rights.wsAllowed) throw new Error("Tu n’as plus de workshop disponible.");
      tx.set(usageRef, { workshopUsed: wsUsed + 1 }, { merge:true });

    } else if (typeKey === "conf"){
      if (confUsed >= rights.confAllowed) throw new Error("Tu n’as plus de conférence disponible.");
      tx.set(usageRef, { conferenceUsed: confUsed + 1 }, { merge:true });

    } else { // other
      if (otherUsed >= rights.otherAllowed) throw new Error("Tu n’as plus de quota “Autre” disponible.");
      tx.set(usageRef, { otherUsed: otherUsed + 1 }, { merge:true });
    }

    tx.set(regRef, { uid, createdAt: serverTimestamp() });
    tx.update(evRef, { bookedCount: booked + 1 }); // ✅ rules OK (+1)
  });
}

async function unregisterFromEvent(eventId){
  const uid = auth.currentUser?.uid;
  if (!uid) { location.href="./login.html"; return; }

  const evRef    = doc(db, "events", eventId);
  const regRef   = doc(db, "events", eventId, "registrations", uid);
  const usageRef = doc(db, "userUsage", uid);

  await runTransaction(db, async (tx)=>{
    const evSnap = await tx.get(evRef);
    if (!evSnap.exists()) throw new Error("Évènement introuvable.");

    const regSnap = await tx.get(regRef);
    if (!regSnap.exists()) throw new Error("Tu n’es pas inscrit(e).");

    const ev = evSnap.data() || {};
    const booked  = Number(ev.bookedCount || 0);
    const typeKey = eventTypeKey(ev.type);

    const uSnap = await tx.get(usageRef);
    const usage = uSnap.exists() ? (uSnap.data() || {}) : {};
    const wsUsed    = Number(usage.workshopUsed || 0);
    const confUsed  = Number(usage.conferenceUsed || 0);
    const otherUsed = Number(usage.otherUsed || 0);

    if (typeKey === "ws"){
      tx.set(usageRef, { workshopUsed: Math.max(0, wsUsed - 1) }, { merge:true });
    } else if (typeKey === "conf"){
      tx.set(usageRef, { conferenceUsed: Math.max(0, confUsed - 1) }, { merge:true });
    } else {
      tx.set(usageRef, { otherUsed: Math.max(0, otherUsed - 1) }, { merge:true });
    }

    tx.delete(regRef);
    tx.update(evRef, { bookedCount: Math.max(0, booked - 1) }); // ✅ rules OK (-1)
  });
}
    
/* =========================
   RENDER
   ========================= */
async function userIsRegistered(eventId, uid){
  if (!uid) return false;
  const snap = await getDoc(doc(db, "events", eventId, "registrations", uid));
  return snap.exists();
}

function renderEventCard(id, e){
  const startAtDate = e.startAt?.toDate ? e.startAt.toDate() : null;
  if (!startAtDate) return null;

  const { day, month } = formatDayMonth(startAtDate);
  const timeTxt = formatTime(startAtDate);
  const endTxt  = e.endAt?.toDate ? formatTime(e.endAt.toDate()) : "";
  const place   = (e.place || "").trim();

  const cap    = Number(e.capacity || 0);
  const booked = Number(e.bookedCount || 0);
  const left   = cap > 0 ? Math.max(0, cap - booked) : null;

  const canDelete = isAdmin();

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
        ${canDelete ? `<button class="delete-btn" type="button" data-del="${id}" aria-label="Supprimer">${TRASH_SVG}</button>` : ""}      </div>

      ${e.desc ? `<p class="event-desc">${escapeHTML(e.desc)}</p>` : ""}

      <div class="event-meta">
        <span>🕒 ${timeTxt}${endTxt ? " – " + endTxt : ""}</span>
        ${cap ? `<span>• 👥 ${booked}/${cap} inscrits • ${left} places restantes</span>` : ""}
        ${e.type ? `<span>• ${escapeHTML(e.type)}</span>` : ""}
        ${
          place
            ? `<span>• 📍 <a class="event-place" target="_blank" rel="noreferrer" href="${mapsUrl(place)}">${escapeHTML(place)}</a></span>`
            : ""
        }
      </div>

      ${
        !canDelete
          ? `
        <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <button class="btn-primary event-add" type="button" data-toggle="${id}">…</button>
          <span data-status="${id}" style="font-size:12px;color:var(--muted);font-weight:800;"></span>
        </div>
        <div style="margin-top:8px;">
          <span data-rights="${id}" style="font-size:12px;color:var(--muted);font-weight:700;"></span>
        </div>
          `
          : ""
      }
    </div>
  `;

  // delete admin
  if (canDelete){
    card.querySelector(`[data-del="${id}"]`)?.addEventListener("click", ()=> deleteEvent(id));
    return card;
  }

  // bind quotas + button state
  (async ()=>{
    const uid = auth.currentUser?.uid;

    const btn    = card.querySelector(`[data-toggle="${id}"]`);
    const status = card.querySelector(`[data-status="${id}"]`);
    const rightsEl = card.querySelector(`[data-rights="${id}"]`);

    if (!btn) return;

    if (!uid){
      btn.textContent = "Se connecter";
      btn.addEventListener("click", ()=> location.href="./login.html");
      if (rightsEl) rightsEl.textContent = "Connecte-toi pour t’inscrire.";
      return;
    }

    // quotas
    if (rightsEl){
      const r = await getMyRights();
      if (!r.ok) rightsEl.textContent = "Billet requis (importe-le).";
      else {
        rightsEl.textContent =
          `Workshops : ${r.wsUsed}/${r.wsAllowed} (reste ${r.wsLeft}) • ` +
          `Conférences : ${r.confUsed}/${r.confAllowed} (reste ${r.confLeft}) • ` +
          `Autre : ${r.otherUsed}/${r.otherAllowed} (reste ${r.otherLeft})`;      }
    }

    // registration state
    const isIn = await userIsRegistered(id, uid);
    btn.textContent = isIn ? "Se désinscrire" : "S’inscrire";
    if (status) status.textContent = isIn ? "✅ Inscrit(e)" : "";

    btn.addEventListener("click", async ()=>{
      try{
        if (isIn){
          await unregisterFromEvent(id);
          alert("✅ Désinscription validée !");
        } else {
          await registerToEvent(id);
          alert("✅ Inscription validée !");
        }
        await loadEvents();
      } catch(err){
        alert("❌ " + (err?.message || String(err)));
      }
    });
  })();

  return card;
}

/* =========================
   LOAD EVENTS
   ========================= */
async function loadEvents(){
  if (!eventsList) return;

  try {
    eventsList.innerHTML = `<section class="card"><p>Chargement…</p></section>`;

    const qy = query(collection(db, "events"), orderBy("startAt", "asc"));
    const snap = await getDocs(qy);

    eventsList.innerHTML = "";

    if (snap.empty){
      eventsList.innerHTML = `<section class="card"><p>Aucun évènement pour l’instant.</p></section>`;
      return;
    }

    snap.forEach((d)=>{
      const card = renderEventCard(d.id, d.data());
      if (card) eventsList.appendChild(card);
    });
  } catch (e) {
    console.log("loadEvents error:", e);
    eventsList.innerHTML = `<section class="card"><p>❌ ${escapeHTML(e?.message || String(e))}</p></section>`;
  }
}

/* =========================
   BOOT
========================= */
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

  onAuthStateChanged(auth, async () => {
    applyAdminUI();
    await loadPackConfig();   // ✅ packs dynamiques
    await loadEvents();       // ✅ charge la liste
  });

  // ✅ optionnel : si jamais l'user menu tarde, on affiche quand même un "Chargement…"
  loadEvents();
});
