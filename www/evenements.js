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
  runTransaction, serverTimestamp, query, orderBy, Timestamp, limit,
  setDoc, where
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

// ✅ petit indicateur debug (ne remplace pas le body)
if (eventsList) {
  eventsList.innerHTML = `<section class="card"><p>🟡 evenements.js chargé…</p></section>`;
}

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
      ...PACKS_FALLBACK,
      ...(Object.keys(normalized).length ? normalized : {}),
    };

    // labels figés (sécurité)
    PACKS.premium.label   = PACKS_FALLBACK.premium.label;
    PACKS.standard.label  = PACKS_FALLBACK.standard.label;
    PACKS.essentiel.label = PACKS_FALLBACK.essentiel.label;
    PACKS.workshop.label  = PACKS_FALLBACK.workshop.label;
    PACKS.staff.label     = "Pack staffeurs";

  } catch (e){
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
function isAdmin(){
  if (window.TIDOC_AUTH?.isAdmin) return true;
  const email = (auth.currentUser?.email || "").toLowerCase();
  return email === ADMIN_EMAIL.toLowerCase();
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
  ["eventDate","eventStart","eventEnd","eventTitle","eventPlace","eventDesc","eventCapacity","eventCapacityStaff","eventType"]
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

// workshopKey normalisation
function normalizeKey(v = "") {
  return String(v || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._ -]/g, "")
    .replace(/\s+/g, " ")
    .replaceAll(" ", "-");
}

function isWorkshopEvent(evType=""){
  return String(evType).toLowerCase().includes("workshop");
}

function getEventWorkshopKey(e){
  const explicit = String(e.workshopKey || "").trim();
  return explicit ? explicit : normalizeKey(String(e.title || ""));
}

async function updateWorkshopMeta(eventId, { helloAssoUrl, workshopKey } = {}){
  if (!isAdmin()) return alert("Réservé à l’admin Ti’Doc.");

  const evRef = doc(db, "events", eventId);

  const payload = {};
  if (typeof helloAssoUrl === "string") payload.helloAssoUrl = helloAssoUrl.trim();
  if (typeof workshopKey === "string") payload.workshopKey = workshopKey.trim();

  if ("helloAssoUrl" in payload && payload.helloAssoUrl && !/^https?:\/\//i.test(payload.helloAssoUrl)){
    alert("Le lien HelloAsso doit commencer par http(s)://");
    return;
  }
  if ("workshopKey" in payload){
    payload.workshopKey = normalizeKey(payload.workshopKey);
  }

  try{
    await setDoc(evRef, { ...payload, updatedAt: serverTimestamp() }, { merge:true });
  } catch(e){
    console.log("updateWorkshopMeta error:", e);
    alert("Impossible de modifier (rules ?).");
  }
}

// =====================
// RIGHTS / TICKET
// =====================
async function getMyRights(){
  const uid = auth.currentUser?.uid;
  if (!uid) return { ok:false, reason:"nologin" };

  const tSnap = await getDoc(doc(db, "userTickets", uid));
  if (!tSnap.exists()) return { ok:false, reason:"noticket" };

  const packKeyRaw = String(tSnap.data()?.packKey || "").toLowerCase();
  const packKey = packKeyRaw.includes("staff") ? "staff" : packKeyRaw;

  const pack = PACKS[packKey];
  if (!pack) return { ok:false, reason:"badpack" };

  const uSnap = await getDoc(doc(db, "userUsage", uid));
  const usage = uSnap.exists() ? (uSnap.data() || {}) : {};

  const confUsed = Number(usage.conferenceUsed || 0);
  const wsUsed   = Number(usage.workshopUsed || 0);
  const otherUsed = Number(usage.otherUsed || 0);

  // ✅ IMPORTANT: otherAllowed exist (sinon crash sur events type "Autre")
  const otherAllowed = 9999;

  return {
    ok:true,
    packKey,
    isStaff: packKey === "staff",

    confUsed,
    wsUsed,
    otherUsed,

    wsAllowed: Number(pack.workshopDiscountPacks ?? 0),
    confAllowed: Number(pack.conferencesAllowed ?? 0),
    otherAllowed,

    wsLeft: Math.max(0, Number(pack.workshopDiscountPacks ?? 0) - wsUsed),
    confLeft: Math.max(0, Number(pack.conferencesAllowed ?? 0) - confUsed),
    otherLeft: Math.max(0, otherAllowed - otherUsed),
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

// =====================
// WORKSHOP ACCESS (tickets)
// =====================
async function loadMyWorkshopKeys(){
  const uid = auth.currentUser?.uid;
  if (!uid) return new Set();

  const keys = new Set();
  try{
    const qy = query(collection(db, "userWorkshopTickets"), where("uid", "==", uid), limit(500));
    const snap = await getDocs(qy);
    snap.forEach((d)=>{
      const data = d.data() || {};
      const wk = String(data.workshopKey || "");
      const title = String(data.workshopTitle || "");
      if (wk) keys.add(wk);
      else if (title) keys.add(normalizeKey(title));
    });
  } catch(e){
    console.log("loadMyWorkshopKeys error:", e);
  }
  return keys;
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
    const title = document.getElementById("eventTitle")?.value?.trim() || "";
    const place = document.getElementById("eventPlace")?.value?.trim() || "";
    const type  = document.getElementById("eventType")?.value || "Autre";
    const desc  = document.getElementById("eventDesc")?.value?.trim() || "";

    const capacity      = Number(document.getElementById("eventCapacity")?.value || 0);
    const capacityStaff = Number(document.getElementById("eventCapacityStaff")?.value || 0);

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

    const base = {
      title, desc, place, type,
      startAt, endAt,

      capacity: Math.max(0, capacity),
      capacityStaff: Math.max(0, capacityStaff),

      bookedCount: 0,
      bookedStaffCount: 0,

      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.uid || "",
    };

    if (isWorkshopEvent(type)){
      base.workshopKey = normalizeKey(title);
    }

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
  const regsSnap = await getDocs(collection(db, "events", eventId, "registrations"));
  await Promise.all(regsSnap.docs.map(d => deleteDoc(d.ref)));
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

// =====================
// REGISTRATION (JOIN / LEAVE) — Conf/Autre uniquement
// =====================
function eventTypeKey(evType=""){
  const t = String(evType).toLowerCase();
  if (t.includes("workshop")) return "ws";
  if (t.includes("conf")) return "conf";
  return "other";
}

async function registerToEvent(eventId){
  const uid = auth.currentUser?.uid;
  if (!uid) { location.href="./login.html"; return; }

  // block workshops in-app
  const evSnapPeek = await getDoc(doc(db, "events", eventId));
  if (evSnapPeek.exists()){
    const evPeek = evSnapPeek.data() || {};
    if (isWorkshopEvent(evPeek.type)){
      alert("Les workshops se font uniquement via HelloAsso 🙂");
      return;
    }
  }

  const rights = await requireTicketOrRedirect();
  if (!rights) return;

  const evRef    = doc(db, "events", eventId);
  const regRef   = doc(db, "events", eventId, "registrations", uid);
  const usageRef = doc(db, "userUsage", uid);

  await runTransaction(db, async (tx)=>{
    const evSnap = await tx.get(evRef);
    if (!evSnap.exists()) throw new Error("Évènement introuvable.");

    const ev = evSnap.data() || {};
    if (isWorkshopEvent(ev.type)) throw new Error("Les workshops se font uniquement via HelloAsso.");

    const capPublic  = Number(ev.capacity || 0);
    const capStaff   = Number(ev.capacityStaff || 0);
    const bookedPub  = Number(ev.bookedCount || 0);
    const bookedStf  = Number(ev.bookedStaffCount || 0);

    const regSnap = await tx.get(regRef);
    if (regSnap.exists()) throw new Error("Tu es déjà inscrit(e).");

    if (rights.isStaff){
      if (capStaff > 0 && bookedStf >= capStaff) throw new Error("Plus de places STAFF disponibles.");
    } else {
      if (capPublic > 0 && bookedPub >= capPublic) throw new Error("Plus de places disponibles.");
    }

    const typeKey = eventTypeKey(ev.type);

    const uSnap = await tx.get(usageRef);
    const usage = uSnap.exists() ? (uSnap.data() || {}) : {};
    const wsUsed    = Number(usage.workshopUsed || 0);
    const confUsed  = Number(usage.conferenceUsed || 0);
    const otherUsed = Number(usage.otherUsed || 0);

    if (typeKey === "conf"){
      if (confUsed >= rights.confAllowed) throw new Error("Tu n’as plus de conférence disponible.");
      tx.set(usageRef, { conferenceUsed: confUsed + 1 }, { merge:true });
    } else {
      // other
      if (otherUsed >= rights.otherAllowed) throw new Error("Tu n’as plus de quota “Autre” disponible.");
      tx.set(usageRef, { otherUsed: otherUsed + 1 }, { merge:true });
    }

    tx.set(regRef, {
      uid,
      isStaff: !!rights.isStaff,
      createdAt: serverTimestamp()
    });

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

  // block workshops in-app
  const evSnapPeek = await getDoc(doc(db, "events", eventId));
  if (evSnapPeek.exists()){
    const evPeek = evSnapPeek.data() || {};
    if (isWorkshopEvent(evPeek.type)){
      alert("Les workshops se gèrent sur HelloAsso 🙂");
      return;
    }
  }

  const evRef    = doc(db, "events", eventId);
  const regRef   = doc(db, "events", eventId, "registrations", uid);
  const usageRef = doc(db, "userUsage", uid);

  await runTransaction(db, async (tx)=>{
    const evSnap = await tx.get(evRef);
    if (!evSnap.exists()) throw new Error("Évènement introuvable.");

    const ev = evSnap.data() || {};
    if (isWorkshopEvent(ev.type)) throw new Error("Les workshops se gèrent sur HelloAsso.");

    const regSnap = await tx.get(regRef);
    if (!regSnap.exists()) throw new Error("Tu n’es pas inscrit(e).");

    const reg = regSnap.data() || {};
    const wasStaff = !!reg.isStaff;

    const bookedPub  = Number(ev.bookedCount || 0);
    const bookedStf  = Number(ev.bookedStaffCount || 0);

    const typeKey = eventTypeKey(ev.type);

    const uSnap = await tx.get(usageRef);
    const usage = uSnap.exists() ? (uSnap.data() || {}) : {};
    const confUsed  = Number(usage.conferenceUsed || 0);
    const otherUsed = Number(usage.otherUsed || 0);

    if (typeKey === "conf"){
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

    copyBtn?.addEventListener("click", async ()=>{
      try{
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "✅ Copié";
        setTimeout(()=>{ copyBtn.textContent = "Copier la liste"; }, 1200);
      } catch(_){
        alert("Copie impossible sur cet appareil. Sélectionne le texte et copie manuellement.");
      }
    }, { once:true });

    reloadBtn?.addEventListener("click", ()=> loadParticipants(eventId), { once:true });

  } catch (e){
    console.log("loadParticipants error:", e);
    if (listEl) listEl.textContent = "❌ " + String(e?.message || e);
  }
}

// =====================
// PROMO GLOBAL (ADMIN) — UI + NOTIFS
// (tu as déjà la logique, ici on garde le rendu top-zone)
// =====================
async function sendNotif(toUid, payload){
  await addDoc(collection(db, "notifications", toUid, "items"), {
    toUid,
    fromUid: auth.currentUser?.uid || "",
    fromEmail: auth.currentUser?.email || "",
    read: false,
    createdAt: serverTimestamp(),
    ...payload
  });
}

async function assignPromoCodeToUserIfNeeded(uid, tier){
  tier = String(tier || "").toLowerCase();
  if (!["premium","standard","essentiel"].includes(tier)) return "";

  const userRef  = doc(db, "userTickets", uid);
  const poolsRef = doc(db, "config", "promoPools");

  const res = await runTransaction(db, async (tx) => {
    // ✅ TOUS les READS d'abord (peu importe les branches)
    const userSnap  = await tx.get(userRef);
    if (!userSnap.exists()) return { code:"" };

    const userData = userSnap.data() || {};
    const existing = String(userData.promoCode || "").trim();
    if (existing) return { code: existing, already:true };

    const qrHash = String(userData.qrHash || "").trim();
    if (!qrHash) return { code:"" };

    const claimRef  = doc(db, "promoClaims", qrHash);
    const claimSnap = await tx.get(claimRef);

    const poolsSnap = await tx.get(poolsRef); // ✅ read aussi ici, même si claim existe

    // --- Si claim existe déjà, on écrit userTickets (après tous les reads) ---
    if (claimSnap.exists()){
      const claim = claimSnap.data() || {};
      const code = String(claim.code || "").trim();
      const claimTier = String(claim.tier || tier).toLowerCase();

      if (code){
        tx.set(userRef, {
          promoCode: code,
          promoTier: claimTier,
          promoAssignedAt: claim.assignedAt || serverTimestamp(),
        }, { merge:true });
      }
      return { code };
    }

    // --- Sinon: on consomme dans le pool ---
    const poolsData = poolsSnap.exists() ? (poolsSnap.data() || {}) : {};
    const list = Array.isArray(poolsData[tier])
      ? poolsData[tier].map(x=>String(x||"").trim()).filter(Boolean)
      : [];

    if (!list.length) return { code:"" };

    const code = list[0];
    const rest = list.slice(1);

    // ✅ READ promoCodes avant tout WRITE (et seulement maintenant qu'on connaît le code)
    const codeId  = String(code).toLowerCase();
    const codeRef = doc(db, "promoCodes", codeId);
    const codeSnap = await tx.get(codeRef);

    // ✅ WRITES (après tous les reads)
    tx.set(poolsRef, { [tier]: rest, updatedAt: serverTimestamp() }, { merge:true });

    tx.set(userRef, {
      promoCode: code,
      promoTier: tier,
      promoAssignedAt: serverTimestamp(),
    }, { merge:true });

    tx.set(claimRef, { qrHash, tier, code, assignedTo: uid, assignedAt: serverTimestamp() });

    if (!codeSnap.exists()){
      tx.set(codeRef, {
        code, tier, assignedTo: uid,
        assignedAt: serverTimestamp(),
        copiedAt: null,
        redeemedAt: null
      }, { merge:false });
    }

    return { code };
  });

  return String(res?.code || "").trim();
}

    // consommer dans pool
   const poolsSnap = await tx.get(poolsRef);
const poolsData = poolsSnap.exists() ? (poolsSnap.data() || {}) : {};
const list = Array.isArray(poolsData[tier])
  ? poolsData[tier].map(x=>String(x||"").trim()).filter(Boolean)
  : [];

if (!list.length) return { code:"" };

const code = list[0];
const rest = list.slice(1);

// ✅ READ AVANT WRITE (promoCodes)
const codeId  = String(code).toLowerCase();
const codeRef = doc(db, "promoCodes", codeId);
const codeSnap = await tx.get(codeRef); // ✅ déplacé ici

// ✅ WRITES (après tous les reads)
tx.set(poolsRef, { [tier]: rest, updatedAt: serverTimestamp() }, { merge:true });

tx.set(userRef, {
  promoCode: code,
  promoTier: tier,
  promoAssignedAt: serverTimestamp(),
  promoSentAt: serverTimestamp(),
}, { merge:true });

tx.set(claimRef, { qrHash, tier, code, assignedTo: uid, assignedAt: serverTimestamp() });

if (!codeSnap.exists()){
  tx.set(codeRef, {
    code, tier, assignedTo: uid,
    assignedAt: serverTimestamp(),
    copiedAt: null,
    redeemedAt: null
  }, { merge:false });
}

return { code };
  });

  return String(res?.code || "").trim();
}

async function broadcastPromoToTier(tier, helloAssoUrl){
  if (!isAdmin()) throw new Error("Réservé à l’admin Ti’Doc.");
  tier = String(tier || "").toLowerCase();
  if (!["premium","standard","essentiel"].includes(tier)) throw new Error("Tier invalide.");

  const usersSnap = await getDocs(collection(db, "userTickets"));
  const recipients = [];
  usersSnap.forEach(d => {
    const data = d.data() || {};
    const pk = String(data.packKey || "").toLowerCase();
    if (pk === tier) {
      recipients.push({ uid: d.id, promoCode: String(data.promoCode || "").trim() });
    }
  });

  if (!recipients.length) return 0;

  const title = `🎟️ Code promo workshops — ${tier.toUpperCase()}`;

  for (const u of recipients){
    if (!u.promoCode){
      u.promoCode = await assignPromoCodeToUserIfNeeded(u.uid, tier);
    }
  }

  await Promise.all(recipients.map(u => {
    const code = String(u.promoCode || "").trim();
    const text = code ? `Ton code promo personnel est : ${code}` : `Codes promo temporairement indisponibles. Contacte l’admin.`;

    return sendNotif(u.uid, {
      type: "workshop_promo",
      title,
      text,
      promoCode: code,
      linkLabel: "Ouvrir HelloAsso",
      linkUrl: String(helloAssoUrl || "").trim()
    });
  }));

  return recipients.length;
}

function renderPromoBroadcastCard(){
  const wrap = document.createElement("section");
  wrap.className = "event-card";
  wrap.style.border = "2px dashed rgba(23,140,168,.35)";
  wrap.style.padding = "14px";
  wrap.style.marginBottom = "14px";
  wrap.style.background = "rgba(23,140,168,.04)";

  wrap.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px;">
      <div style="font-weight:950; color:#0e5f71; font-size:16px;">🎟️ Envoi codes promo (workshops)</div>

      <label style="display:flex; flex-direction:column; gap:6px;">
        <span style="font-weight:900;">Lien HelloAsso (global)</span>
        <input id="promoGlobalHelloAsso" type="text" placeholder="https://..."
          style="padding:10px 12px; border-radius:12px; border:1px solid rgba(0,0,0,.15);">
      </label>

      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn-premium btn-premium-outline" type="button" data-send-tier="premium">Envoyer → Premium</button>
        <button class="btn-premium btn-premium-outline" type="button" data-send-tier="standard">Envoyer → Standard</button>
        <button class="btn-premium btn-premium-outline" type="button" data-send-tier="essentiel">Envoyer → Essentiel</button>
      </div>

      <div id="promoBroadcastMsg" style="font-size:12px; font-weight:900; color:rgba(15,35,42,.65);"></div>
    </div>
  `;

  const input = wrap.querySelector("#promoGlobalHelloAsso");
  const msg   = wrap.querySelector("#promoBroadcastMsg");

  wrap.querySelectorAll("button[data-send-tier]").forEach(btn => {
    btn.addEventListener("click", async ()=>{
      const tier  = String(btn.getAttribute("data-send-tier") || "").toLowerCase();
      const hello = String(input?.value || "").trim();

      if (!/^https?:\/\//i.test(hello)) {
        alert("Mets un lien HelloAsso valide (http(s)://...)");
        return;
      }

      try{
        btn.disabled = true;
        if (msg) msg.textContent = "⏳ Envoi…";
        const n = await broadcastPromoToTier(tier, hello);
        if (msg) msg.textContent = `✅ Envoyé à ${n} utilisateur(s) (${tier}).`;
      } catch(e){
        console.log("broadcastPromoToTier error:", e);
        if (msg) msg.textContent = "❌ " + (e?.message || String(e));
        alert("❌ " + (e?.message || String(e)));
      } finally {
        btn.disabled = false;
      }
    });
  });

  return wrap;
}

// =====================
// RENDER EVENT CARD
// =====================
function renderEventCard(eventId, e = {}, { myWorkshopKeys = new Set(), regMap = {} } = {}){
  const start = e.startAt?.toDate ? e.startAt.toDate() : null;
  const end   = e.endAt?.toDate ? e.endAt.toDate() : null;

  const { day, month } = start ? formatDayMonth(start) : { day:"—", month:"—" };
  const timeStr = start ? formatTime(start) : "";
  const endStr  = end ? formatTime(end) : "";

  const title = String(e.title || "Évènement");
  const place = String(e.place || "");
  const type  = String(e.type || "Autre");
  const desc  = String(e.desc || "");

  const isWs = isWorkshopEvent(type);
  const wkKey = isWs ? getEventWorkshopKey(e) : "";
  const hasWsTicket = isWs && myWorkshopKeys.has(wkKey);

  const isReg = !!regMap[eventId];
  const admin = isAdmin();

  const capPub  = Number(e.capacity || 0);
  const capStf  = Number(e.capacityStaff || 0);
  const bookedP = Number(e.bookedCount || 0);
  const bookedS = Number(e.bookedStaffCount || 0);

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

      <div class="event-meta">
        ${timeStr ? `🕒 ${escapeHTML(timeStr)}${endStr ? "–" + escapeHTML(endStr) : ""}` : ""}
        ${place ? ` • 📍 <a href="${mapsUrl(place)}" target="_blank" rel="noopener">${escapeHTML(place)}</a>` : ""}
        ${type ? ` • 🏷️ ${escapeHTML(type)}` : ""}
      </div>

      ${desc ? `<div class="event-desc">${escapeHTML(desc)}</div>` : ""}

      <div class="event-meta" style="margin-top:10px;">
        ${capPub ? `Public: ${Math.max(0, capPub - bookedP)}/${capPub}` : `Public: ∞`}
        ${capStf ? ` • Staff: ${Math.max(0, capStf - bookedS)}/${capStf}` : ``}
        ${isWs ? ` • WorkshopKey: ${escapeHTML(wkKey || "—")}` : ``}
        ${hasWsTicket ? ` • ✅ INSCRIT (billet détecté)` : ``}
      </div>
    </div>
  `;

  const actions = sec.querySelector("[data-actions]");

  // ADMIN buttons
  if (admin){
    const btnList = document.createElement("button");
    btnList.className = "pill-btn";
    btnList.type = "button";
    btnList.textContent = "Liste participants";
    btnList.addEventListener("click", () => loadParticipants(eventId));

    const btnDel = document.createElement("button");
    btnDel.className = "icon-danger";
    btnDel.type = "button";
    btnDel.innerHTML = TRASH_SVG;
    btnDel.title = "Supprimer";
    btnDel.addEventListener("click", () => deleteEvent(eventId));

    actions?.appendChild(btnList);
    actions?.appendChild(btnDel);

  }

  // USER button
  const uid = auth.currentUser?.uid;

  if (isWs){
    const hello = String(e.helloAssoUrl || "").trim();

    const a = document.createElement("a");
    a.className = "btn-premium btn-premium-primary";
    a.href = hello || "#";
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = hasWsTicket ? "✅ INSCRIT" : "Ouvrir HelloAsso";

    if (!hello){
      a.className = "btn-premium btn-premium-outline";
      a.textContent = admin ? "⚠️ Ajouter HelloAsso" : "Workshop";
      a.addEventListener("click", (ev)=>ev.preventDefault());
    }

    actions?.appendChild(a);

  } else {
    const btn = document.createElement("button");
    btn.className = isReg ? "btn-premium btn-premium-outline" : "btn-premium btn-premium-primary";
    btn.type = "button";
    btn.textContent = isReg ? "Se désinscrire" : "S’inscrire";

    btn.addEventListener("click", async ()=>{
      try{
        if (!uid){ location.href="./login.html"; return; }
        btn.disabled = true;
        if (isReg) await unregisterFromEvent(eventId);
        else await registerToEvent(eventId);
        await loadEvents();
      } catch(err){
        alert(err?.message || String(err));
      } finally {
        btn.disabled = false;
      }
    });

    actions?.appendChild(btn);
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

    const myWorkshopKeys = await loadMyWorkshopKeys();

    const uid = auth.currentUser?.uid || "";
    const docs = snap.docs.map(d => ({ id: d.id, data: d.data() || {} }));

    // Map inscription (conf/autre)
    const regMap = {};
    if (uid){
      await Promise.all(docs.map(async (row)=>{
        const e = row.data || {};
        if (isWorkshopEvent(e.type)) return;
        try{
          const r = await getDoc(doc(db, "events", row.id, "registrations", uid));
          if (r.exists()) regMap[row.id] = true;
        } catch {}
      }));
    }

    // tri priorité
    const scored = docs.map(row => {
      const e = row.data || {};
      const isWs = isWorkshopEvent(e.type);
      const wkKey = isWs ? getEventWorkshopKey(e) : "";
      const hasWsTicket = isWs && myWorkshopKeys.has(wkKey);
      const isReg = !!regMap[row.id];

      let score = 0;
      if (hasWsTicket) score += 200;
      if (isReg) score += 150;

      return { ...row, score };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const da = a.data?.startAt?.toMillis ? a.data.startAt.toMillis() : 0;
      const dbb = b.data?.startAt?.toMillis ? b.data.startAt.toMillis() : 0;
      return da - dbb;
    });

    // rendu
    eventsList.innerHTML = "";

    // bloc admin promo en haut (si présent dans HTML)
    const promoZone = document.getElementById("promoTopZone");
    if (promoZone){
      promoZone.innerHTML = "";
      if (isAdmin()){
        promoZone.appendChild(renderPromoBroadcastCard());
      }
    }

    scored.forEach((row)=>{
      const card = renderEventCard(row.id, row.data, { myWorkshopKeys, regMap });
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
      await loadPackConfig();
      await loadEvents();
      showMsg("🟢 OK");
    } catch(e){
      console.log("boot error:", e);
      if (eventsList) eventsList.innerHTML = `<section class="card"><p>❌ Boot: ${escapeHTML(e?.message || String(e))}</p></section>`;
    }
  });
});
