// evenements.js (MODULE) — ✅ clean + ajouts inclus (bouton admin "Liste participants")
// - Packs dynamiques (config/packs)
// - Quotas affichés
// - ✅ Admin: bouton "Participants" sur chaque event (+ modal simple)
// - ✅ Admin: suppression event
// - ✅ User: inscription/désinscription transaction + update bookedCount
// - ✅ FIX: addDoc manquait dans tes imports
// - ✅ FIX: showForm(true/false) gère bien le display/hidden

import * as AuthMod from "./auth.js";
import {
  collection, addDoc, getDocs, getDoc, doc, deleteDoc,
  runTransaction, serverTimestamp, query, orderBy, Timestamp, limit,
  setDoc,writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const auth = AuthMod.auth;
const db   = AuthMod.db;

const ADMIN_EMAIL = "tidoc.congres@gmail.com";

/* =========================
   PACKS (quotas) + STAFF
   ========================= */
const PACKS_FALLBACK = {
  essentiel: { label:"Essentiel", workshopsAllowed: 1, conferencesAllowed: 2, otherAllowed: 0 },
  standard:  { label:"Standard",  workshopsAllowed: 2, conferencesAllowed: 4, otherAllowed: 0 },
  premium:   { label:"Premium",   workshopsAllowed: 3, conferencesAllowed: 7, otherAllowed: 0 },

  // ✅ Pack staffeurs (quota workshops configurable, conférences quasi illimitées)
  staff:     { label:"Pack staffeurs", workshopsAllowed: 3, conferencesAllowed: 999, otherAllowed: 0 },

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

    // ✅ force au minimum les clés attendues
    PACKS = {
      ...PACKS_FALLBACK,
      ...(Object.keys(normalized).length ? normalized : {}),
    };

    // ✅ label figé
    PACKS.staff.label = "Pack staffeurs";
  } catch (e){
    console.log("loadPackConfig error:", e);
    PACKS = { ...PACKS_FALLBACK };
  }
}

/* =========================
   ICONS
   ========================= */
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
  eventForm.hidden = !show;
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

  const packKeyRaw = String(tSnap.data()?.packKey || "").toLowerCase();

  // ✅ accepte "staffeurs" ou "staff" (au cas où)
  const packKey = packKeyRaw.includes("staff") ? "staff" : packKeyRaw;

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
    isStaff: packKey === "staff",

    wsUsed, confUsed, otherUsed,
    wsAllowed: pack.workshopsAllowed,
    confAllowed: pack.conferencesAllowed,
    otherAllowed: pack.otherAllowed,

    wsLeft: Math.max(0, pack.workshopsAllowed - wsUsed),
    confLeft: Math.max(0, pack.conferencesAllowed - confUsed),
    otherLeft: Math.max(0, pack.otherAllowed - otherUsed),
  };
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

    const capacity      = Number(document.getElementById("eventCapacity")?.value || 0);        // public
    const capacityStaff = Number(document.getElementById("eventCapacityStaff")?.value || 0);  // ✅ staff

    if (capacity < 0 || capacityStaff < 0) { showMsg("Les places doivent être >= 0."); return; }
    if ((capacity + capacityStaff) < 1) { showMsg("Ajoute au moins 1 place (public + staff)."); return; }
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

      // ✅ capacités séparées
      capacity: Math.max(0, capacity),
      capacityStaff: Math.max(0, capacityStaff),

      bookedCount: 0,
      bookedStaffCount: 0,

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

async function deleteEventAndCleanup(eventId){
  // 1) supprimer toutes les inscriptions
  const regsSnap = await getDocs(collection(db, "events", eventId, "registrations"));
  await Promise.all(regsSnap.docs.map(d => deleteDoc(d.ref)));

  // 2) supprimer l’event
  await deleteDoc(doc(db, "events", eventId));
}

async function deleteEvent(eventId){
  if (!isAdmin()) return;
  if (!confirm("Supprimer cet évènement ? Cela désinscrira tous les participants.")) return;

  try{
    await deleteEventAndCleanup(eventId);
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

    const capPublic  = Number(ev.capacity || 0);
    const capStaff   = Number(ev.capacityStaff || 0);
    const bookedPub  = Number(ev.bookedCount || 0);
    const bookedStf  = Number(ev.bookedStaffCount || 0);

    const regSnap = await tx.get(regRef);
    if (regSnap.exists()) throw new Error("Tu es déjà inscrit(e).");

    // ✅ place selon staff/public
    if (rights.isStaff){
      if (capStaff > 0 && bookedStf >= capStaff) throw new Error("Plus de places STAFF disponibles.");
    } else {
      if (capPublic > 0 && bookedPub >= capPublic) throw new Error("Plus de places disponibles.");
    }

    const typeKey = eventTypeKey(ev.type);

    // ✅ quotas (staff inclus si tu veux limiter workshops)
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
    } else {
      if (otherUsed >= rights.otherAllowed) throw new Error("Tu n’as plus de quota “Autre” disponible.");
      tx.set(usageRef, { otherUsed: otherUsed + 1 }, { merge:true });
    }

    // ✅ registration
    tx.set(regRef, {
      uid,
      isStaff: !!rights.isStaff,
      createdAt: serverTimestamp()
    });

    // ✅ incrément bon compteur
    if (rights.isStaff){
      tx.update(evRef, { bookedStaffCount: bookedStf + 1 });
    } else {
      tx.update(evRef, { bookedCount: bookedPub + 1 });
    }
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

    const reg = regSnap.data() || {};
    const wasStaff = !!reg.isStaff;

    const ev = evSnap.data() || {};
    const bookedPub  = Number(ev.bookedCount || 0);
    const bookedStf  = Number(ev.bookedStaffCount || 0);

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

    if (wasStaff){
      tx.update(evRef, { bookedStaffCount: Math.max(0, bookedStf - 1) });
    } else {
      tx.update(evRef, { bookedCount: Math.max(0, bookedPub - 1) });
    }
  });
}

/* =========================
   ADMIN: LISTE PARTICIPANTS
   ========================= */
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

  // récup event pour titre/type
  let ev = null;
  try{
    const evSnap = await getDoc(doc(db, "events", eventId));
    ev = evSnap.exists() ? (evSnap.data() || {}) : null;
  } catch(_) {}

  // récup registrations
  try{
    const regsQ = query(collection(db, "events", eventId, "registrations"), orderBy("createdAt","asc"), limit(5000));
    const regsSnap = await getDocs(regsQ);

    const uids = regsSnap.docs.map(d => d.id); // docId = uid

    // fetch users docs (simple, en série pour rester safe)
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

    // copy
    copyBtn?.addEventListener("click", async ()=>{
      try{
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "✅ Copié";
        setTimeout(()=>{ copyBtn.textContent = "Copier la liste"; }, 1200);
      } catch(e){
        alert("Copie impossible sur cet appareil. Sélectionne le texte et copie manuellement.");
      }
    }, { once:true });

    reloadBtn?.addEventListener("click", ()=> loadParticipants(eventId), { once:true });

  } catch (e){
    console.log("loadParticipants error:", e);
    if (listEl) listEl.textContent = "❌ " + String(e?.message || e);
  }
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

  const capPub   = Number(e.capacity || 0);
const capStaff = Number(e.capacityStaff || 0);
const bookedPub= Number(e.bookedCount || 0);
const bookedStf= Number(e.bookedStaffCount || 0);

const leftPub   = capPub > 0 ? Math.max(0, capPub - bookedPub) : null;
const leftStaff = capStaff > 0 ? Math.max(0, capStaff - bookedStf) : null;
  const canDelete = isAdmin();

  const card = document.createElement("section");
  card.className = "event-card";

  card.innerHTML = `
    <div class="event-date">
      <span class="day">${day}</span>
      <span class="month">${month}</span>
    </div>

    <div class="event-content">
      <div class="event-head" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <h3 style="margin:0;">${escapeHTML(e.title || "")}</h3>

        ${
  canDelete ? `
    <div class="event-actions">
      <button class="btn-premium btn-premium-outline" type="button" data-part="${id}">
        Liste participants
      </button>
      <button class="icon-danger" type="button" data-del="${id}" aria-label="Supprimer">
        ${TRASH_SVG}
      </button>
    </div>
  ` : ""
}
      </div>

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
  !canDelete ? `
    <div class="event-actions">
      <button class="btn-premium btn-premium-primary" type="button" data-toggle="${id}">
        …
      </button>
      <span class="event-status" data-status="${id}"></span>
    </div>

    <div class="event-rights" data-rights="${id}"></div>
  ` : ""
}
    </div>
  `;

  // admin binds
  if (canDelete){
    card.querySelector(`[data-del="${id}"]`)?.addEventListener("click", ()=> deleteEvent(id));
    card.querySelector(`[data-part="${id}"]`)?.addEventListener("click", ()=> loadParticipants(id));
    return card;
  }

  // user binds
  (async ()=>{
    const uid = auth.currentUser?.uid;

    const btn     = card.querySelector(`[data-toggle="${id}"]`);
    const status  = card.querySelector(`[data-status="${id}"]`);
    const rightsEl= card.querySelector(`[data-rights="${id}"]`);
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
          `Autre : ${r.otherUsed}/${r.otherAllowed} (reste ${r.otherLeft})`;
      }
    }

    const isIn = await userIsRegistered(id, uid);
    btn.textContent = isIn ? "Se désinscrire" : "S’inscrire";
    if (status) status.textContent = isIn ? "✅ Inscrit(e)" : "";

    btn.addEventListener("click", async ()=>{
      try{
        if (btn.disabled) return;
        btn.disabled = true;

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
        btn.disabled = false;
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

  // debug (optionnel)
  window.addEventListener("error", (e) => {
    const box = document.getElementById("eventsList");
    if (box) box.innerHTML = `<section class="card"><p>❌ JS error: ${String(e.message)}</p></section>`;
  });
  window.addEventListener("unhandledrejection", (e) => {
    const box = document.getElementById("eventsList");
    if (box) box.innerHTML = `<section class="card"><p>❌ Promise error: ${String(e.reason?.message || e.reason)}</p></section>`;
  });

  onAuthStateChanged(auth, async () => {
    applyAdminUI();
    await loadPackConfig();
    await loadEvents();
  });

  // fallback
  loadEvents();
});
