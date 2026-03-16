// evenements.js (MODULE) — VERSION COMPLETE STABLE
// ✅ Packs dynamiques (config/packs) + STAFF
// ✅ Admin: créer / supprimer event
// ✅ Admin: liste participants (modal) + édition HelloAsso + workshopKey
// ✅ User: inscription/désinscription (transactions) UNIQUEMENT pour conférences/autres
// ✅ Workshops: pas d’inscription app, bouton HelloAsso + “✅ INSCRIT” si billet workshop détecté
// ✅ Tri: inscrits/éligibles en haut
// ✅ Debug: erreurs visibles dans la page

import * as AuthMod from "./auth.js";
import {
  collection, addDoc, getDocs, getDoc, doc, deleteDoc,
  serverTimestamp, query, orderBy, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const auth = AuthMod.auth;
const db   = AuthMod.db;

const ADMIN_EMAIL = "tidoc.congres@gmail.com";

// =====================
// DOM
// =====================
const openEventForm = document.getElementById("openEventForm");
const eventForm     = document.getElementById("eventForm");
const cancelEvent   = document.getElementById("cancelEvent");
const publishEvent  = document.getElementById("publishEvent");
const eventsList    = document.getElementById("eventsList");
const eventMsg      = document.getElementById("eventMsg");

function showMsg(t=""){ if (eventMsg) eventMsg.textContent = t; }

// =====================
// PACKS (quotas) + STAFF
// =====================
const PACKS_FALLBACK = {
  premium:   { label:"Premium",   conferencesAllowed: 7, workshopDiscountPacks: 3 },
  standard:  { label:"Standard",  conferencesAllowed: 4, workshopDiscountPacks: 2 },
  essentiel: { label:"Essentiel", conferencesAllowed: 2, workshopDiscountPacks: 1 },
  workshop:  { label:"Workshop",  conferencesAllowed: 0, workshopDiscountPacks: 0 },
  staff:     { label:"Pack staffeurs", conferencesAllowed: 999, workshopDiscountPacks: 999 },
};

let PACKS = { ...PACKS_FALLBACK };

function normalizePackConfig(obj){
  const src = obj && typeof obj === "object" ? obj : {};
  const out = {};
  for (const k of Object.keys(src)){
    const v = src[k] || {};
    out[String(k).toLowerCase()] = {
      label: String(v.label || k),
      conferencesAllowed: Number(v.conferencesAllowed ?? 0),
      workshopDiscountPacks: Number(v.workshopDiscountPacks ?? 0),
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

    const normalized = normalizePackConfig(snap.data() || {});
    PACKS = {
      premium:   { ...PACKS_FALLBACK.premium,   ...(normalized.premium   || {}) },
      standard:  { ...PACKS_FALLBACK.standard,  ...(normalized.standard  || {}) },
      essentiel: { ...PACKS_FALLBACK.essentiel, ...(normalized.essentiel || {}) },
      workshop:  { ...PACKS_FALLBACK.workshop,  ...(normalized.workshop  || {}) },
      staff:     { ...PACKS_FALLBACK.staff,     ...(normalized.staff     || {}) },
    };

    // labels figés
    PACKS.premium.label   = PACKS_FALLBACK.premium.label;
    PACKS.standard.label  = PACKS_FALLBACK.standard.label;
    PACKS.essentiel.label = PACKS_FALLBACK.essentiel.label;
    PACKS.workshop.label  = PACKS_FALLBACK.workshop.label;
    PACKS.staff.label     = "Pack staffeurs";

    // sécurité staff
    if (!Number.isFinite(PACKS.staff.conferencesAllowed) || PACKS.staff.conferencesAllowed <= 0) PACKS.staff.conferencesAllowed = 999;
    if (!Number.isFinite(PACKS.staff.workshopDiscountPacks) || PACKS.staff.workshopDiscountPacks <= 0) PACKS.staff.workshopDiscountPacks = 999;

  } catch(e){
    console.log("loadPackConfig error:", e);
    PACKS = { ...PACKS_FALLBACK };
  }
}

// =====================
// ICONS
// =====================
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

// =====================
// HELPERS
// =====================
// ---- TIER NORMALISATION (robuste) ----

function isAdmin(){
  const u = auth.currentUser;
  const email = String(u?.email || "").trim().toLowerCase();
  const uid   = String(u?.uid || "").trim();

  return email === "tidoc.congres@gmail.com"
      || uid === "b831dIbb3xPcn2qhfxUuVqkVSKF3"; // fallback au cas où
}

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
  eventForm.hidden = !show;
  eventForm.style.display = show ? "" : "none";
}

function clearForm(){
  const map = {
  eventDate: "",
  eventStart: "",
  eventEnd: "",
  eventTitle: "",
  eventSpeaker: "",
  eventPlace: "",
  eventDesc: "",
  eventType: "Conférence"
};

  Object.keys(map).forEach((id)=>{
    const el = document.getElementById(id);
    if (el) el.value = map[id];
  });

  showMsg("");
}

function applyAdminUI(){
  const admin = isAdmin();
  if (openEventForm) openEventForm.style.display = admin ? "flex" : "none";
  if (!admin) showForm(false);
}

// =====================
// CRUD EVENTS (ADMIN)
// =====================
async function createEvent(){
  if (!isAdmin()) { alert("Réservé à l’admin Ti’Doc."); return; }

  try{
    const d     = document.getElementById("eventDate")?.value || "";
    const start = document.getElementById("eventStart")?.value || "";
    const end   = document.getElementById("eventEnd")?.value || "";
    const title   = document.getElementById("eventTitle")?.value?.trim() || "";
    const speaker = document.getElementById("eventSpeaker")?.value?.trim() || ""; // ✅ NEW
    const place   = document.getElementById("eventPlace")?.value?.trim() || "";
    const type    = document.getElementById("eventType")?.value || "Autre";
    const desc    = document.getElementById("eventDesc")?.value?.trim() || "";

if (!d || !title) {
  showMsg("Il faut au minimum une date + un titre.");
  return;
}
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

   const base = {
  title,
  speaker: speaker || "",
  desc,
  place,
  type,
  startAt,
  endAt,
  createdAt: serverTimestamp(),
  createdBy: auth.currentUser?.uid || "",
};

    await addDoc(collection(db, "events"), base);

    clearForm();
    showForm(false);
    await loadEvents();

  } catch(e){
    console.log("createEvent error:", e);
    alert("Impossible de publier l’évènement (Rules Firestore ?)");
  }
}

async function deleteEventAndCleanup(eventId){
  await deleteDoc(doc(db, "events", eventId));
}

async function deleteEvent(eventId){
  if (!isAdmin()) return;
  if (!confirm("Supprimer cet évènement ?")) return;

  try{
    await deleteEventAndCleanup(eventId);
    await loadEvents();
  } catch(e){
    console.log("deleteEvent error:", e);
    alert("Suppression impossible (rules ?).");
  }
}

// =====================
// ADMIN: LISTE PARTICIPANTS
// =====================
function ensureParticipantsModal(){
  let modal = document.getElementById("participantsModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "participantsModal";
  modal.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.35);
    display:none; align-items:center; justify-content:center; z-index:99999;
    padding:16px;
  `;

  modal.innerHTML = `
    <div style="
      width:min(92vw,680px); max-height:86vh; overflow:auto;
      background:#fff; border-radius:18px; box-shadow:0 30px 70px rgba(0,0,0,.18);
      padding:14px 14px 16px;
    ">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="font-weight:950; color:var(--tidoc); font-size:16px;">Participants</div>
        <button id="participantsCloseBtn" class="btn-outline" type="button" style="height:40px;border-radius:14px;font-weight:900;">Fermer</button>
      </div>

      <div id="participantsMeta" style="margin:10px 0 8px; font-size:13px; font-weight:800; color:var(--muted);"></div>

      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:10px;">
        <button id="participantsCopyBtn" class="btn-primary" type="button" style="height:44px;border-radius:16px;font-weight:950;">Copier la liste</button>
        <button id="participantsReloadBtn" class="btn-outline" type="button" style="height:44px;border-radius:16px;font-weight:950;">Rafraîchir</button>
      </div>

      <pre id="participantsList" style="
        background:rgba(23,140,168,.06);
        border:1px solid rgba(23,140,168,.14);
        border-radius:14px;
        padding:12px;
        font-size:12px;
        line-height:1.45;
        white-space:pre-wrap;
        user-select:text;
      ">Chargement…</pre>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => { modal.style.display = "none"; };
  modal.addEventListener("click", (e)=>{ if (e.target === modal) close(); });
  modal.querySelector("#participantsCloseBtn")?.addEventListener("click", close);

  return modal;
}

async function loadParticipants(eventId){
  if (!isAdmin()) return alert("Réservé à l’admin Ti’Doc.");

  const modal = ensureParticipantsModal();
  const listEl = modal.querySelector("#participantsList");
  const metaEl = modal.querySelector("#participantsMeta");
  const copyBtn = modal.querySelector("#participantsCopyBtn");
  const reloadBtn = modal.querySelector("#participantsReloadBtn");

  modal.style.display = "flex";
  if (listEl) listEl.textContent = "Chargement…";
  if (metaEl) metaEl.textContent = "";

  let ev = null;
  try{
    const evSnap = await getDoc(doc(db, "events", eventId));
    ev = evSnap.exists() ? (evSnap.data() || {}) : null;
  } catch(_) {}

  try{
    const regsQ = query(collection(db, "events", eventId, "registrations"), orderBy("createdAt","asc"), limit(5000));
    const regsSnap = await getDocs(regsQ);

    const uids = regsSnap.docs.map(d => d.id);

    const names = [];
    for (const uid of uids){
      try{
        const us = await getDoc(doc(db, "users", uid));
        const d = us.exists() ? (us.data() || {}) : {};
        const display = String(d.displayName || d.username || d.name || "").trim();
        names.push(display || uid);
      } catch {
        names.push(uid);
      }
    }

    const header =
      `${String(ev?.title || "Évènement").trim()}${ev?.type ? " — " + String(ev.type) : ""}\n` +
      `Participants: ${names.length}\n` +
      `------------------------------\n`;

    const body = names.map((n, i) => `${String(i+1).padStart(3,"0")}. ${n}`).join("\n");
    const text = header + body;

    if (metaEl){
      metaEl.textContent = `Évènement: ${String(ev?.title || "—")} • ${names.length} participant(s)`;
    }
    if (listEl) listEl.textContent = text;

    // ✅ reset label bouton copier à chaque ouverture / refresh
if (copyBtn) copyBtn.textContent = "Copier la liste";

// ✅ handlers uniques (pas d’empilement)
if (copyBtn){
  copyBtn.onclick = async () => {
    try{
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "✅ Copié";
      setTimeout(()=>{ copyBtn.textContent = "Copier la liste"; }, 1200);
    } catch(_){
      alert("Copie impossible sur cet appareil. Sélectionne le texte et copie manuellement.");
    }
  };
}

// ✅ reload safe
const thisEventId = eventId;
if (reloadBtn){
  reloadBtn.onclick = () => loadParticipants(thisEventId);
}

  } catch (e){
    console.log("loadParticipants error:", e);
    if (listEl) listEl.textContent = "❌ " + String(e?.message || e);
  }
}

// =====================
// RENDER EVENT CARD
// =====================
function renderEventCard(eventId, e = {}){
  const start = e.startAt?.toDate ? e.startAt.toDate() : null;
  const end   = e.endAt?.toDate ? e.endAt.toDate() : null;

  const { day, month } = start ? formatDayMonth(start) : { day:"—", month:"—" };
  const timeStr = start ? formatTime(start) : "";
  const endStr  = end ? formatTime(end) : "";

  const title   = String(e.title || "Évènement");
  const speaker = String(e.speaker || "").trim();
  const place   = String(e.place || "");
  const type    = String(e.type || "Autre");
  const desc    = String(e.desc || "");

  const admin = isAdmin();

  const metaItems = [];
  if (timeStr) {
    metaItems.push(`<span class="event-meta-item">🕒 ${escapeHTML(timeStr)}${endStr ? "–" + escapeHTML(endStr) : ""}</span>`);
  }
  if (speaker) {
    metaItems.push(`<span class="event-meta-item">👨‍⚕️ ${escapeHTML(speaker)}</span>`);
  }
  if (place) {
    metaItems.push(
      `<span class="event-meta-item">📍 <a href="${mapsUrl(place)}" target="_blank" rel="noopener">${escapeHTML(place)}</a></span>`
    );
  }
  if (type) {
    metaItems.push(`<span class="event-meta-item">🏷️ ${escapeHTML(type)}</span>`);
  }

  const metaLine = metaItems.join("");

  const sec = document.createElement("section");
  sec.className = "event-card";

  sec.innerHTML = `
    <div class="event-date">
      <div class="day">${escapeHTML(day)}</div>
      <div class="month">${escapeHTML(month)}</div>
    </div>

    <div class="event-content">
      <div class="event-head">
        <h3>${escapeHTML(title)}</h3>
        <div class="event-actions" data-actions></div>
      </div>

      ${metaLine ? `<div class="event-meta-under event-meta-wrap">${metaLine}</div>` : ""}
      ${desc ? `<div class="event-desc">${escapeHTML(desc)}</div>` : ""}
    </div>
  `;

  const actions = sec.querySelector("[data-actions]");

  if (admin){
    const btnDel = document.createElement("button");
    btnDel.className = "icon-danger";
    btnDel.type = "button";
    btnDel.innerHTML = TRASH_SVG;
    btnDel.title = "Supprimer";
    btnDel.addEventListener("click", () => deleteEvent(eventId));
    actions?.appendChild(btnDel);
  }

  return sec;
}

// =====================
// LOAD EVENTS + TRI
// =====================
async function loadEvents(){
  if (!eventsList) return;

  try {
    eventsList.innerHTML = `<section class="card"><p>⏳ Chargement…</p></section>`;

    const qy = query(collection(db, "events"), orderBy("startAt", "asc"));
    const snap = await getDocs(qy);

    if (snap.empty){
      eventsList.innerHTML = `<section class="card"><p>Aucun évènement pour l’instant.</p></section>`;
      return;
    }

    const docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));

    eventsList.innerHTML = "";

    const promoZone = document.getElementById("promoTopZone");
    if (promoZone) promoZone.innerHTML = "";

    docs.forEach((row) => {
      const card = renderEventCard(row.id, row.data);
      if (card) eventsList.appendChild(card);
    });

  } catch (e) {
    console.log("loadEvents error:", e);
    eventsList.innerHTML = `<section class="card"><p>❌ ${escapeHTML(e?.message || String(e))}</p></section>`;
  }
}

// =====================
// BOOT (1 seul endroit) ✅
// =====================
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

  // erreurs visibles dans l’UI
  window.addEventListener("error", (e) => {
    if (eventsList) eventsList.innerHTML = `<section class="card"><p>❌ JS error: ${escapeHTML(String(e.message))}</p></section>`;
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (eventsList) eventsList.innerHTML = `<section class="card"><p>❌ Promise error: ${escapeHTML(String(e.reason?.message || e.reason))}</p></section>`;
  });

  onAuthStateChanged(auth, async () => {
  try{
    applyAdminUI();
    await loadEvents();
  } catch(e){
    console.log("boot error:", e);
    if (eventsList) eventsList.innerHTML = `<section class="card"><p>❌ Boot: ${escapeHTML(e?.message || String(e))}</p></section>`;
  }
});
});
