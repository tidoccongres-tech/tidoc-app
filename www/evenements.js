// evenements.js (MODULE) — ✅ ton fichier + modifications workshops HelloAsso + priorité affichage + admin Premium/Autre notifs
// - Packs dynamiques (config/packs)
// - Quotas affichés
// - ✅ Admin: bouton "Liste participants" sur chaque event (+ modal simple)
// - ✅ Admin: suppression event
// - ✅ User: inscription/désinscription transaction + update bookedCount
// - ✅ Workshops: plus d’inscription app, seulement HelloAsso + “INSCRIT” si billet workshop détecté
// - ✅ Tri: inscrits/éligibles en haut + titre plus visible

import * as AuthMod from "./auth.js";
import {
  collection, addDoc, getDocs, getDoc, doc, deleteDoc,
  runTransaction, serverTimestamp, query, orderBy, Timestamp, limit,
  setDoc, writeBatch, where
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const auth = AuthMod.auth;
const db   = AuthMod.db;

const ADMIN_EMAIL = "tidoc.congres@gmail.com";

/* =========================
   PACKS (quotas) + STAFF
   ========================= */
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
    const data = snap.data() || {};
    const normalized = normalizePackConfig(data);

    PACKS = {
      ...PACKS_FALLBACK,
      ...(Object.keys(normalized).length ? normalized : {}),
    };

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

// Normalisation workshopKey
function normalizeKey(v = "") {
  return v
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._ -]/g, "")
    .replace(/\s+/g, " ")
    .replaceAll(" ", "-");
}

function isWorkshopEvent(evType=""){
  const t = String(evType).toLowerCase();
  return t.includes("workshop");
}

function getEventWorkshopKey(e){
  const explicit = String(e.workshopKey || "").trim();
  if (explicit) return explicit;
  return normalizeKey(String(e.title || ""));
}

async function updateWorkshopMeta(eventId, { helloAssoUrl, workshopKey } = {}){
  if (!isAdmin()) return alert("Réservé à l’admin Ti’Doc.");

  const evRef = doc(db, "events", eventId);

  const payload = {};
  if (typeof helloAssoUrl === "string") payload.helloAssoUrl = helloAssoUrl.trim();
  if (typeof workshopKey === "string") payload.workshopKey = workshopKey.trim();

  // mini garde-fous
  if ("helloAssoUrl" in payload && payload.helloAssoUrl && !/^https?:\/\//i.test(payload.helloAssoUrl)){
    alert("Le lien HelloAsso doit commencer par http(s)://");
    return;
  }
  if ("workshopKey" in payload){
    // on normalise une clé “propre”
    payload.workshopKey = normalizeKey(payload.workshopKey);
  }

  try{
    await setDoc(evRef, { ...payload, updatedAt: serverTimestamp() }, { merge:true });
  } catch(e){
    console.log("updateWorkshopMeta error:", e);
    alert("Impossible de modifier (rules ?).");
  }
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
  const packKey = packKeyRaw.includes("staff") ? "staff" : packKeyRaw;

  const pack = PACKS[packKey];
  if (!pack) return { ok:false, reason:"badpack" };

  const uSnap = await getDoc(doc(db, "userUsage", uid));
  const usage = uSnap.exists() ? (uSnap.data() || {}) : {};

  const confUsed = Number(usage.conferenceUsed || 0);

// ici "wsUsed" = nb de packs workshop remisés déjà consommés via l’app (si tu veux garder ce compteur)
const wsUsed = Number(usage.workshopUsed || 0);

return {
  ok:true,
  packKey,
  isStaff: packKey === "staff",
  wsUsed,
  confUsed,
  wsAllowed: Number(pack.workshopDiscountPacks ?? 0),
  confAllowed: Number(pack.conferencesAllowed ?? 0),
  wsLeft: Math.max(0, Number(pack.workshopDiscountPacks ?? 0) - wsUsed),
  confLeft: Math.max(0, Number(pack.conferencesAllowed ?? 0) - confUsed),
};
} // ✅ <-- ICI : fin de getMyRights()

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
   WORKSHOP ACCESS (tickets)
   ========================= */
async function loadMyWorkshopKeys(){
  const uid = auth.currentUser?.uid;
  if (!uid) return new Set();

  // On query uniquement les tickets de l’utilisateur
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

    // Bonus: si c’est un workshop, on prépare workshopKey automatiquement
    if (isWorkshopEvent(type)){
      base.workshopKey = normalizeKey(title);
      // helloAssoUrl sera rempli plus tard via édition (ou tu l’ajoutes dans le form ensuite)
      // base.helloAssoUrl = ""
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

/* =========================
   REGISTRATION (JOIN / LEAVE) — CONFÉRENCES uniquement (workshops: HelloAsso)
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

  // On empêche l’inscription app sur workshops
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

    // Double sécurité
    if (isWorkshopEvent(ev.type)){
      throw new Error("Les workshops se font uniquement via HelloAsso.");
    }

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

  // Workshops: pas de désinscription app
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
    if (isWorkshopEvent(ev.type)){
      throw new Error("Les workshops se gèrent sur HelloAsso.");
    }

    const regSnap = await tx.get(regRef);
    if (!regSnap.exists()) throw new Error("Tu n’es pas inscrit(e).");

    const reg = regSnap.data() || {};
    const wasStaff = !!reg.isStaff;

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
   ADMIN: NOTIFS (Premium / Autre) pour workshops
   ========================= */
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

async function broadcastWorkshopPromo(audience, eventId){
  // audience: "premium" | "other"
  if (!isAdmin()) return alert("Réservé à l’admin Ti’Doc.");

  const evSnap = await getDoc(doc(db, "events", eventId));
  if (!evSnap.exists()) return alert("Évènement introuvable.");

  const ev = evSnap.data() || {};
  if (!isWorkshopEvent(ev.type)) return alert("Ce bouton est uniquement pour les workshops.");

  const hello = String(ev.helloAssoUrl || "").trim();
  if (!hello) return alert("Ajoute d’abord helloAssoUrl sur ce workshop.");

  // Liste utilisateurs (userTickets) => packKey
  const usersSnap = await getDocs(collection(db, "userTickets"));
  const users = [];
  usersSnap.forEach(d => users.push({ uid: d.id, ...(d.data() || {}) }));

  const recipients = users.filter(u => {
    const pk = String(u.packKey || "").toLowerCase();
    if (!pk) return false;
    const isPrem = pk === "premium";
    return audience === "premium" ? isPrem : !isPrem;
  });

  if (!recipients.length) return alert("Aucun destinataire.");

  // Notification : on met lien + (si dispo) code promo stocké sur userTicket
  const title =
    audience === "premium"
      ? `🎟️ Premium — ${String(ev.title || "Workshop")}`
      : `🎟️ Workshops — ${String(ev.title || "Workshop")}`;

  await Promise.all(recipients.map(u => {
    const code = String(u.promoCode || "").trim();
    const promoLine = code ? `Code promo : ${code}` : `Code promo : (à renseigner)`;
    return sendNotif(u.uid, {
      type: "workshop_promo",
      title,
      text: `Inscription sur HelloAsso. ${promoLine}`,
      linkLabel: "Ouvrir HelloAsso",
      linkUrl: hello
    });
  }));

  alert(`✅ Envoyé à ${recipients.length} utilisateur(s).`);
}

/* =========================
   RENDER
   ========================= */
async function userIsRegistered(eventId, uid){
  if (!uid) return false;
  const snap = await getDoc(doc(db, "events", eventId, "registrations", uid));
  return snap.exists();
}

function renderEventCard(id, e, opts){
  const { myWorkshopKeys, regMap } = opts || {};
  const startAtDate = e.startAt?.toDate ? e.startAt.toDate() : null;
  if (!startAtDate) return null;

  const { day, month } = formatDayMonth(startAtDate);
  const timeTxt = formatTime(startAtDate);
  const endTxt  = e.endAt?.toDate ? formatTime(e.endAt.toDate()) : "";
  const place   = (e.place || "").trim();

  const capPub    = Number(e.capacity || 0);
  const capStaff  = Number(e.capacityStaff || 0);
  const bookedPub = Number(e.bookedCount || 0);
  const bookedStf = Number(e.bookedStaffCount || 0);

  const leftPub   = capPub > 0 ? Math.max(0, capPub - bookedPub) : null;
  const leftStaff = capStaff > 0 ? Math.max(0, capStaff - bookedStf) : null;

  const capPubTxt   = capPub > 0 ? String(capPub) : "∞";
  const capStaffTxt = capStaff > 0 ? String(capStaff) : "∞";

  const canDelete = isAdmin();

  // ✅ nouveau : statut “inscrit/éligible”
  const uid = auth.currentUser?.uid;
  const isWorkshop = isWorkshopEvent(e.type);
  const isConf = isConferenceEvent(e.type);

  const workshopKey = isWorkshop ? getEventWorkshopKey(e) : "";
  const hasWorkshopTicket = !!(isWorkshop && myWorkshopKeys && myWorkshopKeys.has(workshopKey));

  const isIn = !!(uid && regMap && regMap[id]); // uniquement conf/autre (pas workshops)

  const isEmph = hasWorkshopTicket || isIn;

  const hello = String(e.helloAssoUrl || "").trim();

  const card = document.createElement("section");
  card.className = "event-card";

  // ✅ rendu plus visible si inscrit
  if (isEmph){
    card.style.border = "2px solid rgba(23,140,168,.35)";
    card.style.boxShadow = "0 22px 46px rgba(23,140,168,.16)";
    card.style.background = "linear-gradient(135deg, rgba(23,140,168,.12), rgba(255,255,255,.86))";
  }

  card.innerHTML = `
    <div class="event-date">
      <span class="day">${day}</span>
      <span class="month">${month}</span>
    </div>

    <div class="event-content">
      <div class="event-head" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <h3 style="margin:0;font-weight:${isEmph ? "950" : "900"};color:${isEmph ? "#0e5f71" : "#0e5f71"};">
          ${escapeHTML(e.title || "")}
        </h3>

        ${canDelete ? `
  <div class="event-actions" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">

    <button class="btn-premium btn-premium-outline" type="button" data-part="${id}">
      Liste participants
    </button>

    ${isWorkshop ? `
      <button class="btn-premium btn-premium-outline" type="button" data-edit-ha="${id}">HelloAsso</button>
      <button class="btn-premium btn-premium-outline" type="button" data-edit-wk="${id}">Key</button>
      <button class="btn-premium btn-premium-outline" type="button" data-prem="${id}">Premium</button>
      <button class="btn-premium btn-premium-outline" type="button" data-other="${id}">Autre</button>
    ` : ""}

    <button class="icon-danger" type="button" data-del="${id}" aria-label="Supprimer">
      ${TRASH_SVG}
    </button>

  </div>
` : ""}

      ${e.desc ? `<p class="event-desc">${escapeHTML(e.desc)}</p>` : ""}

      <div class="event-meta">
        <span>🕒 ${timeTxt}${endTxt ? " – " + endTxt : ""}</span>

        ${
          (capPub > 0 || capStaff > 0)
            ? `<span>• 👥 Public: ${bookedPub}/${capPubTxt}${leftPub !== null ? ` (${leftPub} restantes)` : ""} • Staff: ${bookedStf}/${capStaffTxt}${leftStaff !== null ? ` (${leftStaff} restantes)` : ""}</span>`
            : `<span>• 👥 Public: ${bookedPub}/${capPubTxt} • Staff: ${bookedStf}/${capStaffTxt}</span>`
        }

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
            <button class="btn-premium ${isWorkshop ? "btn-premium-primary" : "btn-premium-primary"}" type="button" data-toggle="${id}">
              …
            </button>
            <span class="event-status" data-status="${id}"></span>
          </div>

          <div class="event-rights" data-rights="${id}"></div>
        ` : (isEmph ? `
          <div class="event-rights" style="margin-top:10px;font-weight:950;color:#0e5f71;">
            ${hasWorkshopTicket ? "✅ INSCRIT (billet workshop détecté)" : (isIn ? "✅ INSCRIT" : "")}
          </div>
        ` : "")
      }
    ${canDelete && isWorkshop ? `
  <div style="margin-top:8px; font-size:12px; font-weight:850; color:rgba(15,35,42,.7);">
    HelloAsso: ${e.helloAssoUrl ? "✅" : "❌"} • Key: <span style="font-family:ui-monospace;">${escapeHTML(getEventWorkshopKey(e))}</span>
  </div>
` : ""}
    </div>
  `;

  // admin binds
  if (canDelete){
    card.querySelector(`[data-del="${id}"]`)?.addEventListener("click", ()=> deleteEvent(id));
    card.querySelector(`[data-part="${id}"]`)?.addEventListener("click", ()=> loadParticipants(id));

    // ✅ admin promo buttons workshops
    card.querySelector(`[data-prem="${id}"]`)?.addEventListener("click", ()=> broadcastWorkshopPromo("premium", id));
    card.querySelector(`[data-other="${id}"]`)?.addEventListener("click", ()=> broadcastWorkshopPromo("other", id));

// ✅ admin edit HelloAsso URL
card.querySelector(`[data-edit-ha="${id}"]`)?.addEventListener("click", async ()=>{
  const current = String(e.helloAssoUrl || "").trim();
  const next = prompt("Lien HelloAsso pour ce workshop :", current);
  if (next === null) return; // cancel
  await updateWorkshopMeta(id, { helloAssoUrl: next });
  await loadEvents();
});

// ✅ admin edit Workshop Key (sert à matcher les billets workshop)
card.querySelector(`[data-edit-wk="${id}"]`)?.addEventListener("click", async ()=>{
  const current = String(e.workshopKey || getEventWorkshopKey(e) || "").trim();
  const next = prompt("Workshop Key (sert à matcher les billets) :", current);
  if (next === null) return;
  await updateWorkshopMeta(id, { workshopKey: next });
  await loadEvents();
});

    return card;
  }

  // user binds
  (async ()=>{
    const uid = auth.currentUser?.uid;

    const btn      = card.querySelector(`[data-toggle="${id}"]`);
    const status   = card.querySelector(`[data-status="${id}"]`);
    const rightsEl = card.querySelector(`[data-rights="${id}"]`);
    if (!btn) return;

    if (!uid){
      btn.textContent = "Se connecter";
      btn.addEventListener("click", ()=> location.href="./login.html");
      if (rightsEl) rightsEl.textContent = "Connecte-toi pour voir tes accès.";
      return;
    }

    // quotas (toujours affichés)
    if (rightsEl){
      const r = await getMyRights();
      if (!r.ok) rightsEl.textContent = "Billet requis (importe-le).";
      else {
       rightsEl.textContent =
         `Packs Workshop remisés : ${r.wsUsed}/${r.wsAllowed} (reste ${r.wsLeft}) • ` +
         `Conférences : ${r.confUsed}/${r.confAllowed} (reste ${r.confLeft})`;
      }
    }

    // ✅ workshops => pas d’inscription app
    if (isWorkshop){
      if (hasWorkshopTicket){
        if (status) status.textContent = "✅ Inscrit(e)";
        btn.textContent = hello ? "Ouvrir HelloAsso" : "HelloAsso à venir";
        btn.disabled = !hello;
        btn.addEventListener("click", ()=>{
          if (!hello) return;
          window.open(hello, "_blank", "noopener,noreferrer");
        });
      } else {
        if (status) status.textContent = "🔒 Pas le bon billet";
        btn.textContent = "Réservé";
        btn.disabled = true;
      }
      return;
    }

    // ✅ conférences/autre => inscription app (inchangé)
    const isAlready = isIn;

    btn.textContent = isAlready ? "Se désinscrire" : "S’inscrire";
    if (status) status.textContent = isAlready ? "✅ Inscrit(e)" : "";

    btn.addEventListener("click", async ()=>{
      try{
        if (btn.disabled) return;
        btn.disabled = true;

        if (isAlready){
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
   LOAD EVENTS + TRI
   ========================= */
async function loadEvents(){
  if (!eventsList) return;

  try {
    eventsList.innerHTML = `<section class="card"><p>Chargement…</p></section>`;

    const qy = query(collection(db, "events"), orderBy("startAt", "asc"));
    const snap = await getDocs(qy);

    if (snap.empty){
      eventsList.innerHTML = `<section class="card"><p>Aucun évènement pour l’instant.</p></section>`;
      return;
    }

    // charge les clés workshop user + inscriptions conf
    const myWorkshopKeys = await loadMyWorkshopKeys();

    const uid = auth.currentUser?.uid || "";
    const docs = snap.docs.map(d => ({ id: d.id, data: d.data() || {} }));

    // Map inscription (pour conférences/autre)
    const regMap = {};
    if (uid){
      await Promise.all(docs.map(async (row)=>{
        const e = row.data || {};
        if (isWorkshopEvent(e.type)) return; // pas de reg app workshop
        try{
          const r = await getDoc(doc(db, "events", row.id, "registrations", uid));
          if (r.exists()) regMap[row.id] = true;
        } catch {}
      }));
    }

    // ✅ tri priorité
    // score élevé si:
    // - workshop avec ticket
    // - conf/autre inscrit
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
      // sinon: date asc (déjà tri initial, mais on garde)
      const da = a.data?.startAt?.toMillis ? a.data.startAt.toMillis() : 0;
      const dbb = b.data?.startAt?.toMillis ? b.data.startAt.toMillis() : 0;
      return da - dbb;
    });

    eventsList.innerHTML = "";
    scored.forEach((row)=>{
      const card = renderEventCard(row.id, row.data, { myWorkshopKeys, regMap });
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
