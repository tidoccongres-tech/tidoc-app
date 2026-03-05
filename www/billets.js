// billets.js (MODULE) — VERSION COMPLETE
// ✅ Import PDF/Image réparé (PDF.js + jsQR + OCR)
// ✅ Quotas packs: Premium/Standard/Essentiel => Conférences + Packs workshop remisés
// ✅ Pack Workshop => "Workshops" (par défaut 1, modifiable)
// ✅ Promo codes: pools (premium/standard/essentiel) + UI lisible (liste + ajouter + supprimer)
// ✅ Vérif officielle OPTIONNELLE (ne casse plus l’import si URL non configurée)

import { auth, db } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, runTransaction,
  serverTimestamp, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

async function hasRegistration(eventId) {
  const u = auth.currentUser;
  if (!u) return false;
  const regRef = doc(db, "events", eventId, "registrations", u.uid);
  const snap = await getDoc(regRef);
  return snap.exists();
}

async function hasWorkshopTicketForEvent({ eventTitle, eventKey }) {
  const u = auth.currentUser;
  if (!u) return false;

  // on check dans userWorkshopTickets
  // (adaptable: workshopKey ou workshopTitle)
  const key = String(eventKey || "").trim();
  const title = String(eventTitle || "").trim();

  // 1) match par workshopKey
  if (key) {
    const q1 = query(
      collection(db, "userWorkshopTickets"),
      where("uid", "==", u.uid),
      where("workshopKey", "==", key)
    );
    const s1 = await getDocs(q1);
    if (!s1.empty) return true;
  }

  // 2) match par workshopTitle
  if (title) {
    const q2 = query(
      collection(db, "userWorkshopTickets"),
      where("uid", "==", u.uid),
      where("workshopTitle", "==", title)
    );
    const s2 = await getDocs(q2);
    if (!s2.empty) return true;
  }

  return false;
}

// =====================
// UI
// =====================
const statusEl  = document.getElementById("ticketStatus");
const boxEl     = document.getElementById("ticketBox");

let LAST_MAIN_TICKET = null;     // { qrText, packKey, holderName, ticketNumber }
let LAST_WORKSHOPS = [];         // array of workshop docs
let LAST_PARTIES = []; // billets Ti’Masqué (array)

function setStatus(t = "") { if (statusEl) statusEl.textContent = t; }
function escapeHTML(s = "") {
  return String(s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function normalizeKey(v = "") {
  return String(v || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._ -]/g, "")
    .replace(/\s+/g, " ")
    .replaceAll(" ", "-");
}

// =====================
// OFFICIAL TICKET INDEX (OPTIONNEL)
// Si tu ne veux pas de vérif, laisse OFFICIAL_TICKETS_URL = "" (import OK).
// Format attendu : { "<qrHash>": "premium"|"standard"|"essentiel"|"workshop", ... }
// =====================
const OFFICIAL_TICKETS_URL = ""; // <-- mets ton RAW github ici si tu veux activer la vérif

let OFFICIAL_CACHE = null;

function officialUrlLooksConfigured(){
  const u = String(OFFICIAL_TICKETS_URL || "").trim();
  if (!u) return false;
  if (u.includes("<USER>") || u.includes("<REPO>")) return false;
  return true;
}

async function fetchOfficialTicketsIndex() {
  if (!officialUrlLooksConfigured()) return null;
  if (OFFICIAL_CACHE) return OFFICIAL_CACHE;

  try {
    const cached = JSON.parse(localStorage.getItem("tidoc_official_index") || "null");
    if (cached?.data && cached?.ts && (Date.now() - cached.ts) < 5 * 60 * 1000) {
      OFFICIAL_CACHE = cached.data;
      return OFFICIAL_CACHE;
    }
  } catch (_) {}

  const res = await fetch(OFFICIAL_TICKETS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Index officiel indisponible.");

  const data = await res.json();
if (!data || typeof data !== "object") throw new Error("Index officiel invalide.");
OFFICIAL_CACHE = data;

try {
  localStorage.setItem("tidoc_official_index", JSON.stringify({ ts: Date.now(), data }));
} catch (_) {}

return OFFICIAL_CACHE;

}

async function verifyPackWithQrOrThrow(qrText, detectedPackKey) {
  // si pas configuré => on ne bloque pas l’import
  if (!officialUrlLooksConfigured()) {
    return { qrHash: await sha256Hex(qrText), officialPack: "", finalPackKey: detectedPackKey || "" };
  }

  const qrHash = await sha256Hex(qrText);
const index = await fetchOfficialTicketsIndex();

if (!index || typeof index !== "object") {
  throw new Error("Index officiel invalide.");
}

const officialPack = index[qrHash] ? String(index[qrHash]).toLowerCase() : "";
if (!officialPack) throw new Error("Billet non reconnu (QR absent de la liste officielle).");

if (!detectedPackKey) return { qrHash, officialPack, finalPackKey: officialPack };

const det = String(detectedPackKey).toLowerCase();
if (det && det !== officialPack) {
  throw new Error(`Billet refusé : pack incohérent (détecté: ${det} / officiel: ${officialPack}).`);
}

  return { qrHash, officialPack, finalPackKey: officialPack };
}

// =====================
// PACKS (quotas) — 4 packs fixes
// Premium/Standard/Essentiel: conferencesAllowed + workshopDiscountPacks
// Workshop: conferencesAllowed = nb de WORKSHOPS (défaut 1)
// =====================
const PACKS_FALLBACK = {
  premium:   { label: "Premium",   conferencesAllowed: 7, workshopDiscountPacks: 3 },
  standard:  { label: "Standard",  conferencesAllowed: 4, workshopDiscountPacks: 2 },
  essentiel: { label: "Essentiel", conferencesAllowed: 2, workshopDiscountPacks: 1 },
  workshop:  { label: "Workshop",  conferencesAllowed: 1, workshopDiscountPacks: 0 },

  staff:     { label: "Pack Staffeurs", conferencesAllowed: 999, workshopDiscountPacks: 999 },
};

let PACKS = { ...PACKS_FALLBACK };

function normalizePackConfig(obj) {
  const src = obj && typeof obj === "object" ? obj : {};
  const out = {};
  for (const k of Object.keys(src)) {
    const v = src[k] || {};
    out[String(k).toLowerCase()] = {
      label: String(v.label || k),
      conferencesAllowed: Number(v.conferencesAllowed ?? 0),
      workshopDiscountPacks: Number(v.workshopDiscountPacks ?? 0),
    };
  }
  return out;
}

async function loadPackConfig() {
  try {
    const snap = await getDoc(doc(db, "config", "packs"));
    if (!snap.exists()) {
      PACKS = { ...PACKS_FALLBACK };
      return;
    }

    const normalized = normalizePackConfig(snap.data() || {});
    PACKS = {
  premium:   { ...PACKS_FALLBACK.premium,   ...(normalized.premium   || {}) },
  standard:  { ...PACKS_FALLBACK.standard,  ...(normalized.standard  || {}) },
  essentiel: { ...PACKS_FALLBACK.essentiel, ...(normalized.essentiel || {}) },
  workshop:  { ...PACKS_FALLBACK.workshop,  ...(normalized.workshop  || {}) },
  staff:     { ...PACKS_FALLBACK.staff,     ...(normalized.staff     || {}) }, // ✅
};

// labels figés
PACKS.premium.label   = PACKS_FALLBACK.premium.label;
PACKS.standard.label  = PACKS_FALLBACK.standard.label;
PACKS.essentiel.label = PACKS_FALLBACK.essentiel.label;
PACKS.workshop.label  = PACKS_FALLBACK.workshop.label;
PACKS.staff.label     = PACKS_FALLBACK.staff.label; // ✅

// défaut workshop=1
if (!Number.isFinite(PACKS.workshop.conferencesAllowed) || PACKS.workshop.conferencesAllowed <= 0) {
  PACKS.workshop.conferencesAllowed = 1;
}

// staff: valeur safe (si jamais)
if (!Number.isFinite(PACKS.staff.conferencesAllowed) || PACKS.staff.conferencesAllowed < 0) {
  PACKS.staff.conferencesAllowed = 999;
}
if (!Number.isFinite(PACKS.staff.workshopDiscountPacks) || PACKS.staff.workshopDiscountPacks < 0) {
  PACKS.staff.workshopDiscountPacks = 999;
}
  } catch (e) {
    console.log("loadPackConfig error:", e);
    PACKS = { ...PACKS_FALLBACK };
  }
}

const ENABLE_TICKET_PREVIEW = false; // ⛔️ tu veux pas d’aperçu

const previewEl = document.getElementById("ticketPreview");
let LAST_PREVIEW_URL = null;

function showTicketPreview(file) {
  if (!previewEl || !file) return;

  // nettoie l’ancien blob url
  if (LAST_PREVIEW_URL) {
    try { URL.revokeObjectURL(LAST_PREVIEW_URL); } catch (_) {}
    LAST_PREVIEW_URL = null;
  }

  const url = URL.createObjectURL(file);
  LAST_PREVIEW_URL = url;

  if (file.type === "application/pdf") {
    previewEl.innerHTML = `
      <div style="font-weight:900; color:var(--tidoc); margin-bottom:8px;">Aperçu du billet</div>
      <embed src="${url}#view=FitH" type="application/pdf"
             style="width:100%; height:520px; border:1px solid var(--line); border-radius:14px; background:#fff;" />
    `;
  } else if (file.type.startsWith("image/")) {
    previewEl.innerHTML = `
      <div style="font-weight:900; color:var(--tidoc); margin-bottom:8px;">Aperçu du billet</div>
      <img src="${url}" alt="Billet importé"
           style="width:100%; max-height:520px; object-fit:contain; border:1px solid var(--line); border-radius:14px; background:#fff;" />
    `;
  } else {
    previewEl.innerHTML = "";
  }
}

function clearTicketPreview() {
  if (!previewEl) return;
  previewEl.innerHTML = "";
  if (LAST_PREVIEW_URL) {
    try { URL.revokeObjectURL(LAST_PREVIEW_URL); } catch (_) {}
    LAST_PREVIEW_URL = null;
  }
}

// =====================
// PROMO CODES — pools séparés
// Firestore: config/promoPools
// { premium:[...], standard:[...], essentiel:[...], updatedAt: ... }
// =====================
let PROMO_POOLS = { premium: [], standard: [], essentiel: [] };

function splitCodes(input = "") {
  return String(input)
    .replace(/\r/g, "\n")
    .split(/[\n\s,;]+/g)
    .map(x => String(x || "").trim())
    .filter(Boolean);
}

function normalizeCodes(list) {
  const arr = Array.isArray(list) ? list : [];
  const cleaned = arr.map(x => String(x || "").trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const c of cleaned) {
    const k = c.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

async function loadPromoPools() {
  try {
    const snap = await getDoc(doc(db, "config", "promoPools"));
    if (!snap.exists()) {
      PROMO_POOLS = { premium: [], standard: [], essentiel: [] };
      return;
    }
    const d = snap.data() || {};
    PROMO_POOLS = {
      premium: normalizeCodes(d.premium),
      standard: normalizeCodes(d.standard),
      essentiel: normalizeCodes(d.essentiel),
    };
  } catch (e) {
    console.log("loadPromoPools error:", e);
    PROMO_POOLS = { premium: [], standard: [], essentiel: [] };
  }
}

// =====================
// PROMO STATE (admin active par tier)
// Firestore: config/promoState
// { premium:true/false, standard:true/false, essentiel:true/false, updatedAt: ... }
// =====================
let PROMO_STATE = { premium: false, standard: false, essentiel: false };

async function loadPromoState() {
  try {
    const snap = await getDoc(doc(db, "config", "promoState"));
    const d = snap.exists() ? (snap.data() || {}) : {};
    PROMO_STATE = {
      premium: !!d.premium,
      standard: !!d.standard,
      essentiel: !!d.essentiel
    };
  } catch (e) {
    console.log("loadPromoState error:", e);
    PROMO_STATE = { premium: false, standard: false, essentiel: false };
  }
}

// Attribuer 1 code selon le pack (premium/standard/essentiel), et le retirer du pool
// + écrire un registre promoCodes/{codeLower} pour l’admin
async function assignPromoCodeIfNeeded(packKey) {
  const u = auth.currentUser;
  if (!u) return { code: "" };

  const tier = String(packKey || "").toLowerCase();
  if (!["premium", "standard", "essentiel"].includes(tier)) return { code: "" };

  const userRef   = doc(db, "userTickets", u.uid);
  const poolsRef  = doc(db, "config", "promoPools");

  const res = await runTransaction(db, async (tx) => {
    // ✅ 1) lire userTickets
    const userSnap = await tx.get(userRef);
    const userData = userSnap.exists() ? (userSnap.data() || {}) : {};

    const existing = String(userData?.promoCode || "").trim();
    if (existing) return { code: existing, already: true };

    const qrHash = String(userData?.qrHash || "").trim();
    if (!qrHash) return { code: "", error: "missing_qrHash" };

    // ✅ 2) vérifier si ce billet a déjà reçu un code (verrou)
    const claimRef = doc(db, "promoClaims", qrHash);
    const claimSnap = await tx.get(claimRef);

    if (claimSnap.exists()) {
      const claim = claimSnap.data() || {};
      const code = String(claim.code || "").trim();

      // On remet le même code sur le compte (si jamais)
      if (code) {
        tx.set(userRef, {
          promoCode: code,
          promoTier: String(claim.tier || tier),
          promoAssignedAt: claim.assignedAt || serverTimestamp()
        }, { merge: true });

        return { code, reused: true };
      }
      return { code: "", reused: true };
    }

    // ✅ 3) sinon: consommer 1 code du pool
    const poolsSnap = await tx.get(poolsRef);
    const poolsData = poolsSnap.exists() ? (poolsSnap.data() || {}) : {};

    const list = normalizeCodes(poolsData[tier]);
    if (!list.length) return { code: "", empty: true };

    const code = list[0];
    const rest = list.slice(1);

    // ✅ IMPORTANT: write uniquement tier + updatedAt (comme tes rules)
    tx.set(poolsRef, { [tier]: rest, updatedAt: serverTimestamp() }, { merge: true });

    // ✅ 4) écrire le code sur userTickets
    tx.set(userRef, {
      promoCode: code,
      promoTier: tier,
      promoAssignedAt: serverTimestamp()
    }, { merge: true });

// ✅ 5) créer le verrou promoClaims/{qrHash} (pas de 2e read)
tx.set(claimRef, {
  qrHash,
  tier,
  code,
  assignedTo: u.uid,
  assignedEmail: String(u.email || "").toLowerCase(),
  holderName: String(userData?.holderName || "").trim(),
  ticketNumber: String(userData?.ticketNumber || "").trim(),
  assignedAt: serverTimestamp()
});
        
    // ⚠️ IMPORTANT: pas de READ ici (sinon permission-denied car read admin-only)
    const codeId = String(code).toLowerCase();
    const codeRef = doc(db, "promoCodes", codeId);

    tx.set(codeRef, {
      code,
      tier,
      assignedTo: u.uid,
      assignedEmail: String(u.email || "").toLowerCase(),
      assignedAt: serverTimestamp(),
      copiedAt: null,
      redeemedAt: null
    }, { merge: true });

    return { code, already: false };
  });

  return res || { code: "" };
}

// =====================
// ICONS
// =====================
const TRASH_TIDOC_SVG = `
<svg class="trash-ico" viewBox="0 0 408.483 408.483" aria-hidden="true">
  <g><g>
    <path d="M87.748,388.784c0.461,11.01,9.521,19.699,20.539,19.699h191.911c11.018,0,20.078-8.689,20.539-19.699l13.705-289.316
      H74.043L87.748,388.784z M247.655,171.329c0-4.61,3.738-8.349,8.35-8.349h13.355c4.609,0,8.35,3.738,8.35,8.349v165.293
      c0,4.611-3.738,8.349-8.35,8.349h-13.355c-4.61,0-8.35-3.736-8.35-8.349V171.329z M189.216,171.329
      c0-4.61,3.738-8.349,8.349-8.349h13.355c4.609,0,8.349,3.738,8.349,8.349v165.293c0,4.611-3.737,8.349-8.349,8.349h-13.355
      c-4.61,0-8.349-3.736-8.349-8.349V171.329L189.216,171.329z M130.775,171.329c0-4.61,3.738-8.349,8.349-8.349h13.356
      c4.61,0,8.349,3.738,8.349,8.349v165.293c0,4.611-3.738,8.349-8.349,8.349h-13.356c-4.61,0-8.349-3.736-8.349-8.349V171.329z"/>
    <path d="M343.567,21.043h-88.535V4.305c0-2.377-1.927-4.305-4.305-4.305h-92.971c-2.377,0-4.304,1.928-4.304,4.305v16.737H64.916
      c-7.125,0-12.9,5.776-12.9,12.901V74.47h304.451V33.944C356.467,26.819,350.692,21.043,343.567,21.043z"/>
  </g></g>
</svg>
`;

// =====================
// SHA256
// =====================
async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// =====================
// OPTION METIER
// - true  => les billets workshop réservent aussi le QR dans qrClaims (comportement actuel)
// - false => qrClaims réservé au billet principal uniquement
// =====================
const CLAIM_WORKSHOP_QR = true;

// Option : est-ce qu’on claim le QR aussi pour les billets soirée ?
const CLAIM_PARTY_QR = true;

// =====================
// Lock QR (anti-double billet)
// =====================
async function claimQrOrThrow(qrText) {
  const u = auth.currentUser;
  if (!u) throw new Error("Connexion requise.");

  const qrHash = await sha256Hex(qrText);
  const claimRef = doc(db, "qrClaims", qrHash);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(claimRef);

    // Pas encore claim -> on claim
    if (!snap.exists()) {
      tx.set(claimRef, {
        uid: u.uid,
        email: String(u.email || "").toLowerCase(),
        createdAt: serverTimestamp()
      });
      return;
    }

    const existing = snap.data() || {};
    const existingUid = String(existing.uid || "");

    // Doc présent mais corrompu (pas de uid) -> on sécurise en le réécrivant
    if (!existingUid) {
      tx.set(claimRef, {
        uid: u.uid,
        email: String(u.email || "").toLowerCase(),
        createdAt: existing.createdAt || serverTimestamp()
      }, { merge: true });
      return;
    }

    // 🟢 Même utilisateur -> OK
    if (existingUid === u.uid) return;

    // 🔴 Autre utilisateur -> bloqué
    throw new Error("Ce billet est déjà lié à un autre compte (QR déjà utilisé).");
  });

  return qrHash;
}

// =====================
// Sync Nom billet -> Firestore (NE TOUCHE PAS le pseudo affiché)
// =====================
async function syncNameFromTicket(holderName) {
  const u = auth.currentUser;
  const ticketHolderName = String(holderName || "").trim();
  if (!u || !ticketHolderName) return;

  // ✅ champ dédié
  try {
    await setDoc(doc(db, "users", u.uid), {
      ticketHolderName,
      ticketUpdatedAt: serverTimestamp()
    }, { merge: true });
  } catch (_) {}

  // optionnel: affichage local
  try {
    localStorage.setItem("tidoc_ticket_holder_name", ticketHolderName);
    window.dispatchEvent(new CustomEvent("tidoc:ticket", { detail: { ticketHolderName } }));
  } catch (_) {}
}

// =====================
// Save main ticket
// =====================
async function saveTicketToFirestore({ qrText, packKey, holderName, ticketNumber }) {
  const u = auth.currentUser;
  if (!u) throw new Error("Connexion requise.");

  const qrHash = await sha256Hex(qrText);

  await setDoc(doc(db, "userTickets", u.uid), {
    qrText, qrHash,
    packKey: packKey || "",
    holderName: holderName || "",
    ticketNumber: ticketNumber || "",
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// =====================
// Save workshop ticket (multi)
// =====================
async function saveWorkshopTicket({ qrText, packKey, holderName, ticketNumber, workshopTitle }) {
  const u = auth.currentUser;
  if (!u) throw new Error("Connexion requise.");

  const qrHash = await sha256Hex(qrText);

  // ✅ Check "already imported" via query (autorisé par rules)
  const q = query(
    collection(db, "userWorkshopTickets"),
    where("uid", "==", u.uid),
    where("qrHash", "==", qrHash)
  );
  const snap = await getDocs(q);
  if (!snap.empty) return { already: true };

  // ✅ Crée ensuite un doc stable (uid + hash) => pas de doublon
  const id = `${u.uid}_${qrHash}`;
  const ref = doc(db, "userWorkshopTickets", id);

  const title = String(workshopTitle || "").trim();
  const key = title ? normalizeKey(title) : "";

  await setDoc(ref, {
    uid: u.uid,
    qrText, qrHash,
    packKey: packKey || "workshop",
    holderName: holderName || "",
    ticketNumber: ticketNumber || "",
    workshopTitle: title || "",
    workshopKey: key || "",
    createdAt: serverTimestamp()
  }); // ✅ create uniquement (si existe déjà => update => interdit, mais on l'a évité)

  return { already: false };
}

// =====================
// Save party ticket (Ti’Masqué) (multi)
// =====================
async function savePartyTicket({ qrText, holderName, ticketNumber, partyTitle }) {
  const u = auth.currentUser;
  if (!u) throw new Error("Connexion requise.");

  const qrHash = await sha256Hex(qrText);

  // ✅ anti-doublon (autorisé par rules)
  const q = query(
    collection(db, "userPartyTickets"),
    where("uid", "==", u.uid),
    where("qrHash", "==", qrHash)
  );
  const snap = await getDocs(q);
  if (!snap.empty) return { already: true };

  // ✅ id stable = uid_hash
  const id = `${u.uid}_${qrHash}`;
  const ref = doc(db, "userPartyTickets", id);

  const title = String(partyTitle || "The Ti'Rendez-vous").trim();
  const partyKey = normalizeKey(title) || "ti-rendez-vous";

  await setDoc(ref, {
    uid: u.uid,
    qrText, qrHash,
    holderName: holderName || "",
    ticketNumber: ticketNumber || "",
    partyTitle: title,
    partyKey,
    createdAt: serverTimestamp()
  }); // create only (si déjà => évité via query)

  return { already: false };
}

async function deletePartyTicketByHash(qrHash) {
  const u = auth.currentUser;
  if (!u) { setStatus("🔒 Connecte-toi."); return; }

  const ok = confirm("Supprimer ce billet The Ti'Rendez-vous ?");
  if (!ok) return;

  setStatus("⏳ Suppression du billet The Ti'Rendez-vous…");

  try {
    const id = `${u.uid}_${qrHash}`;
    await deleteDoc(doc(db, "userPartyTickets", id)).catch(() => {});

    // libérer le QR si tu claim aussi les billets soirée
    if (typeof CLAIM_PARTY_QR === "undefined" ? true : CLAIM_PARTY_QR) {
      const claimRef = doc(db, "qrClaims", qrHash);
      await runTransaction(db, async (tx) => {
        const cs = await tx.get(claimRef);
        if (!cs.exists()) return;
        const uidInClaim = String(cs.data()?.uid || "");
        if (uidInClaim === u.uid) tx.delete(claimRef);
      }).catch(() => {});
    }

    await loadSavedTicket();
    setStatus("✅ Billet The Ti'Rendez-vous supprimé");
  } catch (e) {
    console.error("deletePartyTicketByHash error:", e);
    setStatus("❌ " + (e?.message || "Erreur suppression billet The Ti'Rendez-vous"));
  }
}

// =====================
// DELETE ticket + unclaim QR (main)
// =====================
async function deleteMyTicketAndUnclaim() {
  const u = auth.currentUser;
  if (!u) { setStatus("🔒 Connecte-toi."); return; }

  const ok = confirm(
    "Supprimer complètement ton billet ?\n\n" +
    "• Billet principal supprimé\n" +
    "• Tous les billets workshop supprimés\n" +
    "• Toutes tes inscriptions aux événements supprimées\n" +
    "• Quotas réinitialisés\n" +
    "• QR Code libéré\n\n" +
    "Continuer ?"
  );
  if (!ok) return;

  setStatus("⏳ Suppression complète…");

  const userId = u.uid;

  try {
    // 1️⃣ Lire le billet principal pour récupérer le qrHash
    const ticketRef = doc(db, "userTickets", userId);
    const snap = await getDoc(ticketRef);
    const data = snap.exists() ? snap.data() : {};
    const qrHash = data.qrHash || null;

    // 2️⃣ Supprimer billet principal
    await deleteDoc(ticketRef).catch(() => {});

    // 3️⃣ Supprimer billets workshop
    const wsQ = query(collection(db, "userWorkshopTickets"), where("uid", "==", userId));
    const wsSnap = await getDocs(wsQ);
    const wsDeletes = wsSnap.docs.map(d => deleteDoc(d.ref));
    await Promise.allSettled(wsDeletes);

    // 4️⃣ Supprimer toutes les inscriptions événements
    const eventsSnap = await getDocs(collection(db, "events"));
    const deleteRegs = [];
    eventsSnap.forEach(ev => {
      const regRef = doc(db, "events", ev.id, "registrations", userId);
      deleteRegs.push(deleteDoc(regRef));
    });
    await Promise.allSettled(deleteRegs);

    // 5️⃣ Supprimer document usage (quotas)
    await deleteDoc(doc(db, "userUsage", userId)).catch(() => {});

    // 6️⃣ Libérer QR claim (si existait)
    if (qrHash) {
      const claimRef = doc(db, "qrClaims", qrHash);
      await runTransaction(db, async (tx) => {
        const cs = await tx.get(claimRef);
        if (!cs.exists()) return;
        const uid = String(cs.data()?.uid || "");
        if (uid === userId) tx.delete(claimRef);
      }).catch(() => {});
    }

    // 7️⃣ Effacer le nom associé au billet
    await setDoc(doc(db, "users", userId), {
      ticketHolderName: "",
      ticketUpdatedAt: serverTimestamp()
    }, { merge: true }).catch(() => {});

    // 8️⃣ Nettoyage interface
    if (boxEl) boxEl.textContent = "Aucun billet importé pour l’instant.";
    clearTicketPreview();
    await loadSavedTicket().catch(() => {});
    setStatus("✅ Billet totalement supprimé !");
  } catch (e) {
    console.error("deleteMyTicketAndUnclaim error:", e);
    setStatus("❌ " + (e?.message || "Erreur inconnue"));
    try { await loadSavedTicket(); } catch {}
  }
}

async function deleteWorkshopTicketByHash(qrHash) {
  const u = auth.currentUser;
  if (!u) { setStatus("🔒 Connecte-toi."); return; }

  const ok = confirm("Supprimer ce billet workshop ?");
  if (!ok) return;

  setStatus("⏳ Suppression du workshop…");

  try {
    const id = `${u.uid}_${qrHash}`;
    await deleteDoc(doc(db, "userWorkshopTickets", id)).catch(() => {});

    // Optionnel : libérer le QR si tu as choisi de claim aussi les workshops
    if (typeof CLAIM_WORKSHOP_QR === "undefined" ? true : CLAIM_WORKSHOP_QR) {
      const claimRef = doc(db, "qrClaims", qrHash);
      await runTransaction(db, async (tx) => {
        const cs = await tx.get(claimRef);
        if (!cs.exists()) return;
        const uidInClaim = String(cs.data()?.uid || "");
        if (uidInClaim === u.uid) tx.delete(claimRef);
      }).catch(() => {});
    }

    await loadSavedTicket();
    setStatus("✅ Workshop supprimé");
  } catch (e) {
    console.error("deleteWorkshopTicketByHash error:", e);
    setStatus("❌ " + (e?.message || "Erreur suppression workshop"));
  }
}

// =====================
// QR scan (jsQR)
// =====================
function scanCanvasForQR(canvas) {
  try {
    if (!window.jsQR) throw new Error("jsQR non chargé.");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(img.data, img.width, img.height);
    return code?.data || "";
  } catch { return ""; }
}

// =====================
// PDF QR scan (PDF.js legacy global: pdfjsLib)
// =====================
async function renderPdfPageToCanvas(pdf, pageNumber, scale = 2.0) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function scanPdfForQR(file) {
  if (!window.pdfjsLib) throw new Error("PDF.js non chargé.");
  if (!window.jsQR) throw new Error("jsQR non chargé.");

  const buf = await file.arrayBuffer();
  let pdf;
  try {
    pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  } catch {
    pdf = await window.pdfjsLib.getDocument({ data: buf, disableWorker: true }).promise;
  }

  const pagesToTry = Math.min(2, pdf.numPages);
  for (let i = 1; i <= pagesToTry; i++) {
    const c1 = await renderPdfPageToCanvas(pdf, i, 1.8);
    const qr1 = scanCanvasForQR(c1);
    if (qr1) return { pdf, qrText: qr1 };

    const c2 = await renderPdfPageToCanvas(pdf, i, 2.4);
    const qr2 = scanCanvasForQR(c2);
    if (qr2) return { pdf, qrText: qr2 };
  }

  return { pdf, qrText: "" };
}

// =====================
// PDF TEXT extraction
// =====================
async function extractMetaFromPdfText(pdf) {
  const page = await pdf.getPage(1);
  const tc = await page.getTextContent();
  const text = (tc.items || []).map(it => (it.str || "").trim()).filter(Boolean).join("\n");
  return parseMetaFromText(text);
}

// =====================
// OCR crop (image)
// =====================
async function loadImageToCanvas(fileOrBlob) {
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const maxW = 1600;
    const scale = Math.min(1, maxW / img.width);
    canvas.width = Math.floor(img.width * scale);
    canvas.height = Math.floor(img.height * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cropTopRight(canvas) {
  const w = canvas.width;
  const h = canvas.height;

  const crop = document.createElement("canvas");
  const ctx = crop.getContext("2d");

  const x = Math.floor(w * 0.52);
  const y = Math.floor(h * 0.06);
  const cw = Math.floor(w * 0.46);
  const ch = Math.floor(h * 0.32);

  crop.width = cw;
  crop.height = ch;
  ctx.drawImage(canvas, x, y, cw, ch, 0, 0, cw, ch);

  return crop;
}

async function ocrCanvas(canvas) {
  if (!window.Tesseract) throw new Error("Tesseract non chargé.");
  const { data } = await window.Tesseract.recognize(canvas, "fra+eng");
  return data?.text || "";
}

// =====================
// Parsing (PDF texte / OCR texte)
// =====================
// à mettre UNE FOIS en haut du fichier (hors fonction)
const PARTY_DEFAULT_TITLE = "The Ti'Rendez-vous";
const PARTY_KEYWORDS = [
  "ti-rendez-vous",
  "ti rendez-vous",
  "tirendezvous",
  "ti'rendez-vous",
  "ti’rendez-vous",
  "the ti'rendez-vous",
  "the ti’rendez-vous",
  "the ti rendez-vous",
  "rendez-vous",
  "rendez vous",
];

function parseMetaFromText(raw = "") {
  const lines = String(raw).split(/\r?\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const full = lines.join(" ");

  // pack (inclut workshop/atelier + staffeurs)
  let packKey = "";
  const mp = full.match(/pack\s*(essentiel|standard|premium|workshop|atelier|staffeurs?|staff)/i);

  if (mp && mp[1]) {
    const v = mp[1].toLowerCase();
    // ordre IMPORTANT : staff AVANT standard
    if (v.startsWith("staff")) packKey = "staff";
    else if (v.startsWith("ess")) packKey = "essentiel";
    else if (v.startsWith("pre")) packKey = "premium";
    else if (v.startsWith("stand")) packKey = "standard";
    else if (v.startsWith("wor") || v.startsWith("ate")) packKey = "workshop";
  }

  // ticket number
  let ticketNumber = "";
  const mn = full.match(/n[°o]\s*de\s*billet\s*[:\-]?\s*([0-9]{5,})/i);
  if (mn) ticketNumber = mn[1];

  // holder name = ligne au-dessus de "Pack ..."
  let holderName = "";
  const idxPack = lines.findIndex(l => /pack\s*(essentiel|standard|premium|workshop|atelier|staffeurs?|staff)/i.test(l));
  if (idxPack > 0) {
    for (let j = idxPack - 1; j >= 0; j--) {
      const c = lines[j];
      const bad =
        /helloasso/i.test(c) ||
        /ti'?doc/i.test(c) ||
        /contact/i.test(c) ||
        /achete/i.test(c) ||
        /acheteur/i.test(c) ||
        /n[°o]\s*de\s*billet/i.test(c) ||
        /pack\s*/i.test(c) ||
        c.length < 3;
      if (!bad) { holderName = c; break; }
    }
  }

  // fallback (si OCR colle tout)
  if (!holderName && idxPack >= 0) {
    const mSame = lines[idxPack].match(/^(.*?)\s+pack\s*(essentiel|standard|premium|workshop|atelier|staffeurs?|staff)/i);
    if (mSame) holderName = mSame[1].trim();
  }

  // Workshop title
  let workshopTitle = "";

  for (const l of lines) {
    const m1 = l.match(/\b(workshop|atelier)\b\s*[:\-–—]?\s*(.+)$/i);
    if (m1 && m1[2]) {
      const tail = String(m1[2]).trim();
      if (tail && !/^pack\b/i.test(tail)) {
        workshopTitle = `${m1[1][0].toUpperCase()}${m1[1].slice(1).toLowerCase()} ${tail}`.trim();
        break;
      }
    }

    const m2 = l.match(/\bpack\s*(workshop|atelier)\b\s*[:\-–—]?\s*(.+)$/i);
    if (m2 && m2[2]) {
      const tail = String(m2[2]).trim();
      if (tail) {
        workshopTitle = `${m2[1][0].toUpperCase()}${m2[1].slice(1).toLowerCase()} ${tail}`.trim();
        break;
      }
    }
  }

  if (!workshopTitle) {
    const m = full.match(/\b(workshop|atelier)\b\s*[:\-–—]?\s*([A-Za-zÀ-ÖØ-öø-ÿ0-9'’"()\/+ .]{3,})/i);
    if (m && m[2]) {
      const tail = String(m[2]).trim();
      if (tail) workshopTitle = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${tail}`.trim();
    }
  }

  // =====================
  // Party title (Ti-Masqué)
  // =====================
  let partyTitle = "";

  const fullNorm = full
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[–—]/g, "-");

  const looksTiMasque = PARTY_KEYWORDS.some(k => {
    const kn = String(k)
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, "'")
      .replace(/[–—]/g, "-");
    return fullNorm.includes(kn);
  });

  if (looksTiMasque) {
    // Si une ligne du type "Ti-Masqué : NOM", on récupère NOM
    for (const l of lines) {
      const m = l.match(/(?:the\s*)?ti\s*[-’']?\s*(?:masqu[eé]|rendez[- ]?vous)\s*[:\-–—]?\s*(.+)$/i);
      if (m && m[1]) {
        const tail = String(m[1]).trim();
        if (tail && tail.length >= 2) { partyTitle = tail; break; }
      }
    }
    if (!partyTitle) partyTitle = PARTY_DEFAULT_TITLE;
  }

  // ✅ IMPORTANT : on retourne aussi partyTitle
  return { holderName, packKey, ticketNumber, workshopTitle, partyTitle, rawText: raw };
}

// =====================
// Render main ticket + promo + workshops list
// =====================
function renderResult({ qrText, packKey, holderName, ticketNumber, promoCode, workshopsImportedCount } = {}) {
  if (!boxEl) return;

  const key = String(packKey || "").toLowerCase();
  const pack = PACKS[key] || null;
  const packLabel = pack ? pack.label : (key ? key : "Non détecté");

  const conf = pack ? pack.conferencesAllowed : "—";
  const discount = pack ? Number(pack.workshopDiscountPacks ?? 0) : 0;
  const imported = Number(workshopsImportedCount ?? 0);

  const promo = String(promoCode || "").trim();

  const tier = key;
  const canHavePromo = ["premium", "standard", "essentiel"].includes(tier);
  const promoEnabled = !!PROMO_STATE?.[tier];
  const showGetPromoBtn = canHavePromo && !promo && promoEnabled;

  const wsLine =
    key === "workshop"
      ? `${conf}`
      : (discount > 0 ? `${imported} / ${discount}` : `${imported}`);

  boxEl.innerHTML = `
    <div style="position:relative; display:flex; flex-direction:column; gap:12px;">

      <button class="delete-btn" id="deleteTicketInlineBtn" type="button"
        aria-label="Supprimer le billet" title="Supprimer"
        style="position:absolute; top:0; right:0;">
        ${TRASH_TIDOC_SVG}
      </button>

      <div style="font-weight:900; color:var(--tidoc); font-size:15px; margin-bottom:8px;">
        ✅ Billet importé
      </div>

      <div style="border:1px solid var(--line); border-radius:14px; padding:12px;">
        <div><b>Nom :</b> ${escapeHTML(holderName || "—")}</div>
        <div><b>N° billet :</b> ${escapeHTML(ticketNumber || "—")}</div>

        <div style="margin-top:8px;"><b>Pack :</b> ${escapeHTML(packLabel)}</div>
        <div><b>${key === "workshop" ? "Workshops" : "Conférences"} :</b> ${escapeHTML(String(conf))}</div>

        ${
          key !== "workshop" && key !== "staff"
            ? `<div><b>Workshops (importés / remisés) :</b> ${escapeHTML(String(wsLine))}</div>`
            : (key === "staff" ? `<div><b>Workshops :</b> Illimités</div>` : "")
        }

        ${
          promo
            ? `<div style="margin-top:10px;"><b>Code promo :</b> <span style="font-weight:950;">${escapeHTML(promo)}</span></div>`
            : ""
        }

        ${
          showGetPromoBtn
            ? `
              <div style="margin-top:12px;">
                <button id="btnGetPromo" class="btn-premium btn-premium-primary" type="button">
                  🎟️ Obtenir mon code promo
                </button>
                <div id="promoHint" style="margin-top:8px;font-size:12px;font-weight:800;color:rgba(15,35,42,.65);"></div>
              </div>
            `
            : ""
        }
      </div>

      <div id="workshopsListBox"></div>
    </div>
  `;

  boxEl.querySelector("#deleteTicketInlineBtn")
    ?.addEventListener("click", deleteMyTicketAndUnclaim);

  boxEl.querySelector("#btnGetPromo")?.addEventListener("click", async () => {
    const hint = boxEl.querySelector("#promoHint");
    try {
      if (hint) hint.textContent = "⏳ Attribution du code…";

      const r = await assignPromoCodeIfNeeded(tier);

      if (!r?.code) {
        if (hint) hint.textContent = "❌ Pool vide ou code indisponible.";
        return;
      }

      if (hint) hint.textContent = "✅ Code attribué !";
      await loadSavedTicket();
    } catch (e) {
      console.log("btnGetPromo error:", e);
      if (hint) hint.textContent = "❌ " + (e?.message || String(e));
    }
  });
}

function renderWorkshopsList(workshops = []) {
  const listBox = boxEl?.querySelector("#workshopsListBox") || document.getElementById("workshopsListBox");
  if (!listBox) return;

  if (!workshops.length) {
    listBox.innerHTML = `
      <div style="opacity:.8; font-weight:800; color:rgba(31,75,86,.75);">
        Aucun billet workshop importé pour l’instant.
      </div>
    `;
    return;
  }

  const items = workshops.map((w) => `
    <div style="position:relative; border:1px solid var(--line); border-radius:14px; padding:12px; background:#fff;">
      <button class="delete-btn ws-del-btn"
              type="button"
              data-ws-hash="${escapeHTML(w.qrHash || "")}"
              aria-label="Supprimer le workshop"
              title="Supprimer"
              style="position:absolute; top:10px; right:10px;">
        ${TRASH_TIDOC_SVG}
      </button>

      <div style="font-weight:900; color:#0f4f60;">🧪 ${escapeHTML(w.workshopTitle || "Pack Workshop")}</div>
      <div style="margin-top:6px;"><b>Nom :</b> ${escapeHTML(w.holderName || "—")}</div>
      <div><b>N° billet :</b> ${escapeHTML(w.ticketNumber || "—")}</div>
    </div>
  `).join("");

  listBox.innerHTML = `
    <div style="margin-top:6px; font-weight:900; color:var(--tidoc);">🎫 Billets workshop importés</div>
    <div style="margin-top:10px; display:flex; flex-direction:column; gap:10px;">
      ${items}
    </div>
  `;

  // ✅ bind des poubelles ICI (dans le scope)
  listBox.querySelectorAll(".ws-del-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const h = btn.getAttribute("data-ws-hash") || "";
      if (!h) return;
      await deleteWorkshopTicketByHash(h);
    });
  });
}

function renderPartyTicketsList(parties = []) {
  const listBox =
    boxEl?.querySelector("#partyTicketsListBox") ||
    document.getElementById("partyTicketsListBox");

  if (!listBox) return;

  if (!parties.length) {
    listBox.innerHTML = `
      <div style="opacity:.8; font-weight:800; color:rgba(31,75,86,.75);">
        Aucun billet The Ti’Rendez-vous importé pour l’instant.
      </div>
    `;
    return;
  }

  const items = parties.map((p) => `
    <div style="position:relative; border:1px solid var(--line); border-radius:14px; padding:12px; background:#fff;">
      <button class="delete-btn party-del-btn"
              type="button"
              data-party-hash="${escapeHTML(p.qrHash || "")}"
              aria-label="Supprimer le billet The Ti'Rendez-vous"
              title="Supprimer"
              style="position:absolute; top:10px; right:10px;">
        ${TRASH_TIDOC_SVG}
      </button>

      <div style="font-weight:900; color:#0f4f60;">🎭 ${escapeHTML(p.partyTitle || "The Ti'Rendez-vous")}</div>
      <div style="margin-top:6px;"><b>Nom :</b> ${escapeHTML(p.holderName || "—")}</div>
      <div><b>N° billet :</b> ${escapeHTML(p.ticketNumber || "—")}</div>
      <div style="margin-top:6px;"><b>Type :</b> The Ti'Rendez-vous</div>
    </div>
  `).join("");

  listBox.innerHTML = `
    <div style="margin-top:6px; font-weight:900; color:var(--tidoc);">🎭 Billets The Ti’Rendez-vous importés</div>
    <div style="margin-top:10px; display:flex; flex-direction:column; gap:10px;">
      ${items}
    </div>
  `;

  listBox.querySelectorAll(".party-del-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const h = btn.getAttribute("data-party-hash") || "";
      if (!h) return;
      await deletePartyTicketByHash(h);
    });
  });
}

function ensureScanOverlay() {
  let ov = document.getElementById("scanOverlay");
  if (ov) return ov;

  ov = document.createElement("div");
  ov.id = "scanOverlay";
  ov.style.cssText = `
    position:fixed; inset:0; z-index:99999;
    background:rgba(0,0,0,.72);
    display:none;
    padding:14px;
  `;

  ov.innerHTML = `
    <div style="
      width:min(980px, 100%);
      height:100%;
      margin:0 auto;
      background:#fff;
      border-radius:18px;
      overflow:hidden;
      display:flex;
      flex-direction:column;
      box-shadow:0 20px 70px rgba(0,0,0,.35);
    ">
      <div style="
        display:flex; align-items:center; justify-content:space-between;
        padding:12px 14px; border-bottom:1px solid rgba(0,0,0,.08);
        background:linear-gradient(180deg, rgba(15,79,96,.08), rgba(0,0,0,0));
      ">
        <div style="font-weight:950; color:var(--tidoc);">Qr codes</div>
        <button id="scanCloseBtn" class="delete-btn" type="button" aria-label="Fermer">✕</button>
      </div>

      <div id="scanBody" style="padding:14px; overflow:auto;"></div>
    </div>
  `;

  document.body.appendChild(ov);

  ov.querySelector("#scanCloseBtn")?.addEventListener("click", () => {
    ov.style.display = "none";
    document.body.style.overflow = "";
  });

  // clic sur fond = close
  ov.addEventListener("click", (e) => {
    if (e.target === ov) {
      ov.style.display = "none";
      document.body.style.overflow = "";
    }
  });

  return ov;
}

function openScanMode({ mainTicket = null, workshops = [], parties = [] } = {}) {
  const ov = ensureScanOverlay();
  const body = ov.querySelector("#scanBody");
  if (!body) return;

  const ws = Array.isArray(workshops) ? workshops : [];
  const hasMain = !!(mainTicket && mainTicket.qrText);
  const mainPackKey = String(mainTicket?.packKey || "").toLowerCase();
  const pack = PACKS[mainPackKey] || null;
  const packLabel = pack ? pack.label : (mainPackKey ? mainPackKey : "—");

  // reset
  body.innerHTML = "";

  // wrapper
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex; flex-direction:column; gap:14px;";

  // ====== TOP: MAIN QR ======
  if (hasMain) {
    const top = document.createElement("div");
    top.style.cssText = `
      border:1px solid var(--line);
      border-radius:16px;
      padding:14px;
      display:flex;
      gap:14px;
      align-items:center;
      flex-wrap:wrap;
    `;

    top.innerHTML = `
      <div style="min-width:220px; flex:0 0 auto;">
        <div style="font-weight:950; color:var(--tidoc); margin-bottom:8px;">
          🎫 Pass principal — ${escapeHTML(packLabel)}
        </div>
        <div id="scanMainQR" style="width:260px;height:260px;"></div>
      </div>

      <div style="min-width:220px; flex:1 1 240px;">
        <div style="font-weight:900; margin-bottom:6px;">${escapeHTML(mainTicket?.holderName || "—")}</div>
        <div style="opacity:.85; font-weight:800;">N° billet : ${escapeHTML(mainTicket?.ticketNumber || "—")}</div>
        <div style="margin-top:10px; font-size:12px; font-weight:800; opacity:.75;">
          Montre ce QR à la cérémonie d'ouverture.
        </div>
      </div>
    `;

    wrap.appendChild(top);

    const host = top.querySelector("#scanMainQR");
    if (host && window.QRCode) {
      host.innerHTML = "";
      new window.QRCode(host, { text: mainTicket.qrText, width: 260, height: 260 });
    }
  }

  // ====== BOTTOM: WORKSHOP CAROUSEL ======
  if (ws.length) {
    const section = document.createElement("div");
    section.style.cssText = `
      border:1px solid var(--line);
      border-radius:16px;
      padding:14px;
      background:#fff;
    `;

    const dotsId = "scanDots";
    section.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div style="font-weight:950; color:var(--tidoc);">🧪 Workshops — QR à scanner</div>
        <div id="${dotsId}" style="display:flex; gap:6px; align-items:center;"></div>
      </div>

      <div id="scanCarousel" style="
        margin-top:12px;
        display:flex;
        overflow-x:auto;
        scroll-snap-type:x mandatory;
        gap:12px;
        -webkit-overflow-scrolling:touch;
        padding-bottom:8px;
      "></div>

      <div style="margin-top:6px; font-size:12px; font-weight:800; opacity:.7;">
        Swipe → pour passer au workshop suivant
      </div>
    `;

    const carousel = section.querySelector("#scanCarousel");
    const dotsEl = section.querySelector(`#${dotsId}`);

    // dots
    if (dotsEl) {
      dotsEl.innerHTML = ws.map((_, i) => `
        <span data-dot="${i}" style="
          width:8px;height:8px;border-radius:99px;
          background:rgba(15,79,96,.22);
          display:inline-block;
        "></span>
      `).join("");
    }

    // slides
    ws.forEach((w, i) => {
      const slide = document.createElement("div");
      slide.style.cssText = `
        flex:0 0 100%;
        scroll-snap-align:start;
        border:1px solid rgba(0,0,0,.08);
        border-radius:14px;
        padding:12px;
        background:rgba(15,79,96,.03);
      `;

      const title = w.workshopTitle || "Pack Workshop";
      const qr = String(w.qrText || "").trim();
      const qrid = `scanWsQR_${i}`;

      slide.innerHTML = `
        <div style="font-weight:950; color:#0f4f60; margin-bottom:10px;">
          ${escapeHTML(title)}
        </div>
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
          <div id="${qrid}" style="width:220px;height:220px; background:#fff; border-radius:12px; padding:8px;"></div>
          <div style="min-width:200px; flex:1 1 220px;">
            <div style="font-weight:900;">${escapeHTML(w.holderName || "—")}</div>
            <div style="opacity:.85; font-weight:800;">N° billet : ${escapeHTML(w.ticketNumber || "—")}</div>
            <div style="margin-top:10px; font-size:12px; font-weight:800; opacity:.75;">
              Montre ce QR au moment de ton workshop.
            </div>
          </div>
        </div>
      `;

      carousel?.appendChild(slide);

      // render QR
      const host = slide.querySelector(`#${qrid}`);
      if (host && window.QRCode && qr) {
        host.innerHTML = "";
        new window.QRCode(host, { text: qr, width: 220, height: 220 });
      }
    });

    // update dots on scroll
    if (carousel && dotsEl) {
      const setDot = (idx) => {
        dotsEl.querySelectorAll("[data-dot]").forEach((d, j) => {
          d.style.background = (j === idx) ? "rgba(15,79,96,.85)" : "rgba(15,79,96,.22)";
        });
      };
      setDot(0);

      carousel.addEventListener("scroll", () => {
        const w = carousel.clientWidth || 1;
        const idx = Math.round(carousel.scrollLeft / w);
        setDot(Math.max(0, Math.min(ws.length - 1, idx)));
      }, { passive: true });
    }

    wrap.appendChild(section);
  }

  // ====== PARTY: Ti’Masqué ======
  const ps = Array.isArray(parties) ? parties : [];
  if (ps.length) {
    const section = document.createElement("div");
    section.style.cssText = `
      border:1px solid var(--line);
      border-radius:16px;
      padding:14px;
      background:#fff;
    `;

    section.innerHTML = `
      <div style="font-weight:950; color:var(--tidoc);">🎭 The Ti'Rendez-vous — QR à scanner</div>
      <div id="scanPartyWrap" style="margin-top:12px; display:flex; flex-direction:column; gap:12px;"></div>
    `;

    const wrapParty = section.querySelector("#scanPartyWrap");

    ps.forEach((p, i) => {
      const card = document.createElement("div");
      card.style.cssText = `
        border:1px solid rgba(0,0,0,.08);
        border-radius:14px;
        padding:12px;
        background:rgba(15,79,96,.03);
        display:flex;
        gap:12px;
        align-items:center;
        flex-wrap:wrap;
      `;

      const qrid = `scanPartyQR_${i}`;
      const qr = String(p.qrText || "").trim();

      card.innerHTML = `
        <div style="min-width:220px;">
          <div style="font-weight:950; color:#0f4f60; margin-bottom:8px;">
            🎭 ${escapeHTML(p.partyTitle || "The Ti'Rendez-vous")}
          </div>
          <div id="${qrid}" style="width:220px;height:220px; background:#fff; border-radius:12px; padding:8px;"></div>
        </div>

        <div style="min-width:200px; flex:1 1 220px;">
  <div style="font-weight:900;">${escapeHTML(p.holderName || "—")}</div>
  <div style="opacity:.85; font-weight:800;">N° billet : ${escapeHTML(p.ticketNumber || "—")}</div>
  <div style="margin-top:6px; font-size:12px; font-weight:800; opacity:.7;">
    Montre ce QR à l’entrée de la soirée The Ti'Rendez-vous.
  </div>
</div>
      `;

      wrapParty?.appendChild(card);

      const host = card.querySelector(`#${qrid}`);
      if (host && window.QRCode && qr) {
        host.innerHTML = "";
        new window.QRCode(host, { text: qr, width: 220, height: 220 });
      }
    });

    wrap.appendChild(section);
  }
  
  // fallback (aucun QR)
  if (!hasMain && !ws.length) {
    wrap.innerHTML = `<div style="font-weight:900; opacity:.8;">Aucun billet à afficher.</div>`;
  }

  body.appendChild(wrap);

  ov.style.display = "block";
  document.body.style.overflow = "hidden";
}

// =====================
// Load saved ticket + workshops
// =====================
async function loadSavedTicket() {
  const u = auth.currentUser;
  const scanBtn = document.getElementById("scanModeIconBtn");

  if (!u) {
    setStatus("Connecte-toi pour afficher ton billet.");
    if (boxEl) boxEl.textContent = "Aucun billet importé pour l’instant.";
    LAST_MAIN_TICKET = null;
    LAST_WORKSHOPS = [];
    LAST_PARTIES = [];
    if (scanBtn) scanBtn.style.display = "none";
    return;
  }

  const snap = await getDoc(doc(db, "userTickets", u.uid));

  // ---- workshops ----
  let workshops = [];
  try {
    const wsQ = query(collection(db, "userWorkshopTickets"), where("uid", "==", u.uid));
    const wsSnap = await getDocs(wsQ);
    workshops = wsSnap.docs.map(d => d.data() || {}).filter(Boolean);
  } catch (e) {
    console.warn("workshops load error:", e);
    workshops = [];
  }
  LAST_WORKSHOPS = workshops;

  // ---- parties (Ti’Masqué) ----
  let parties = [];
  try {
    const pQ = query(collection(db, "userPartyTickets"), where("uid", "==", u.uid));
    const pSnap = await getDocs(pQ);
    parties = pSnap.docs.map(d => d.data() || {}).filter(Boolean);
  } catch (e) {
    console.warn("party tickets load error:", e);
    parties = [];
  }
  LAST_PARTIES = parties;

  // scan icon: on l’affiche si main OU workshops OU parties
  const hasAnyQR = !!(snap.exists() && (snap.data()?.qrText)) || workshops.length || parties.length;
  if (scanBtn) scanBtn.style.display = hasAnyQR ? "" : "none";

  // --- CAS: pas de billet principal ---
  if (!snap.exists()) {
    LAST_MAIN_TICKET = null;

    setStatus((workshops.length || parties.length) ? "✅ Billets chargés" : "");
    if (!boxEl) return;

    if (!workshops.length && !parties.length) {
      boxEl.textContent = "Aucun billet importé pour l’instant.";
      return;
    }

    boxEl.innerHTML = `
      <div style="font-weight:900; color:var(--tidoc); margin-bottom:10px;">🎫 Tes billets</div>
      <div id="workshopsListBox"></div>
      <div id="partyTicketsListBox" style="margin-top:12px;"></div>
    `;

    renderWorkshopsList(workshops);
    renderPartyTicketsList(parties);
    return;
  }

  // --- CAS: billet principal ---
  const ticket = snap.data() || {};

  LAST_MAIN_TICKET = {
    qrText: ticket.qrText || "",
    packKey: ticket.packKey || "",
    holderName: ticket.holderName || "",
    ticketNumber: ticket.ticketNumber || ""
  };

  setStatus("✅ Billet chargé");

  renderResult({
    qrText: ticket.qrText || "",
    packKey: ticket.packKey || "",
    holderName: ticket.holderName || "",
    ticketNumber: ticket.ticketNumber || "",
    promoCode: ticket.promoCode || "",
    workshopsImportedCount: workshops.length
  });

  // on ajoute la box Ti’Masqué sous la box workshops
  if (boxEl && !boxEl.querySelector("#partyTicketsListBox")) {
    boxEl.insertAdjacentHTML("beforeend", `<div id="partyTicketsListBox" style="margin-top:12px;"></div>`);
  }

  renderWorkshopsList(workshops);
  renderPartyTicketsList(parties);
}

// =====================
// AUTO-REGISTER WORKSHOP (quand billet workshop importé)
// =====================
async function findWorkshopEventIdByKeyOrTitle({ workshopKey, workshopTitle }) {
  const key = String(workshopKey || "").trim();
  const title = String(workshopTitle || "").trim();

  // 1) try match by workshopKey
  if (key) {
    try {
      const q1 = query(
        collection(db, "events"),
        where("type", "==", "workshop"),
        where("key", "==", key)
      );
      const s1 = await getDocs(q1);
      if (!s1.empty) return s1.docs[0].id;
    } catch (_) {}
  }

  // 2) fallback match by title
  if (title) {
    try {
      const q2 = query(
        collection(db, "events"),
        where("type", "==", "workshop"),
        where("title", "==", title)
      );
      const s2 = await getDocs(q2);
      if (!s2.empty) return s2.docs[0].id;
    } catch (_) {}
  }

  return null;
}

async function autoRegisterWorkshopFromTicket({ workshopKey, workshopTitle }) {
  const u = auth.currentUser;
  if (!u) return { ok: false, reason: "no-auth" };

  const eventId = await findWorkshopEventIdByKeyOrTitle({ workshopKey, workshopTitle });
  if (!eventId) return { ok: false, reason: "no-matching-event" };

  const regRef = doc(db, "events", eventId, "registrations", u.uid);
  const regSnap = await getDoc(regRef);

  // déjà inscrit => rien à faire
  if (regSnap.exists()) return { ok: true, already: true, eventId };

  // create registration (rules OK si { uid: u.uid })
  await setDoc(regRef, {
    uid: u.uid,
    createdAt: serverTimestamp(),
    via: "ticket_workshop"
  });

  return { ok: true, created: true, eventId };
}

// =====================
// MAIN IMPORT HANDLER
// =====================
async function handleFile(file) {
  if (!file) return;

if (ENABLE_TICKET_PREVIEW) showTicketPreview(file);
else clearTicketPreview();

  setStatus("");
  if (statusEl) statusEl.style.color = "";

  try {
    setStatus("⏳ Analyse du billet…");

    let qrText = "";
    let packKey = "";
    let holderName = "";
    let ticketNumber = "";
    let workshopTitle = "";
    let partyTitle = "";
    let rawText = "";

    // =====================
    // 1) EXTRACTION (PDF / IMAGE)
    // =====================
    if (file.type === "application/pdf") {
      const out = await scanPdfForQR(file);
      qrText = out?.qrText || "";
      const pdf = out?.pdf;

      const meta = await extractMetaFromPdfText(pdf);
      packKey = meta?.packKey || "";
      holderName = meta?.holderName || "";
      ticketNumber = meta?.ticketNumber || "";
      workshopTitle = meta?.workshopTitle || "";
      partyTitle = meta?.partyTitle || "";
      rawText = meta?.rawText || "";
    }
    else if (file.type.startsWith("image/")) {
      const canvas = await loadImageToCanvas(file);

      qrText = scanCanvasForQR(canvas) || "";

      const crop = cropTopRight(canvas);
      const text = await ocrCanvas(crop);
      const meta = parseMetaFromText(text);

      packKey = meta?.packKey || "";
      holderName = meta?.holderName || "";
      ticketNumber = meta?.ticketNumber || "";
      workshopTitle = meta?.workshopTitle || "";
      partyTitle = meta?.partyTitle || "";
      rawText = meta?.rawText || text || "";
    }
    else {
      throw new Error("Format non supporté (PDF ou image uniquement).");
    }

    if (!qrText) throw new Error("QR Code non détecté sur le billet.");

    // =====================
    // 2) HEURISTIQUES INTELLIGENTES
    // =====================

    const p0 = String(packKey || "").toLowerCase();
    const isKnownMain = ["premium", "standard", "essentiel", "staff"].includes(p0);

    const looksWorkshop =
      /workshop|atelier/i.test(String(workshopTitle || "")) ||
      /workshop|atelier/i.test(String(rawText || ""));

    const looksParty =
      !!String(partyTitle || "").trim(); // si parseMeta a détecté Ti-Masqué

    // 🔹 Si pas pack principal détecté mais workshop trouvé
    if (!isKnownMain && looksWorkshop) {
      packKey = "workshop";
    }

    // 🔹 Si pas pack principal détecté mais Ti-Masqué trouvé
    if (!isKnownMain && looksParty) {
      packKey = "party";
    }

    // =====================
// 3) VERIFICATION OFFICIELLE (si activée)
// =====================
// ✅ pas de vérif officielle sur Ti’Masqué (sauf si tu ajoutes "party" dans l’index)
if (String(packKey).toLowerCase() !== "party") {
  const v = await verifyPackWithQrOrThrow(qrText, packKey);
  if (v?.finalPackKey) packKey = v.finalPackKey;
}

const p = String(packKey || "").toLowerCase();

    // =====================
    // 4) LOCK QR (anti double import)
    // =====================

    if (p !== "workshop" && p !== "party") {
      await claimQrOrThrow(qrText);
    } else {
      if (
        (p === "workshop" && (typeof CLAIM_WORKSHOP_QR === "undefined" ? true : CLAIM_WORKSHOP_QR)) ||
        (p === "party" && (typeof CLAIM_PARTY_QR === "undefined" ? true : CLAIM_PARTY_QR))
      ) {
        await claimQrOrThrow(qrText);
      }
    }

    // =====================
    // 5) SAVE
    // =====================

    // 🎉 Billet Soirée (Ti’Masqué)
    if (p === "party") {
      const r = await savePartyTicket({
        qrText,
        holderName,
        ticketNumber,
        partyTitle
      });

      await syncNameFromTicket(holderName);
      await loadSavedTicket();

      setStatus(r?.already
        ? "ℹ️ Billet The Ti'Rendez-vous déjà importé"
        : "✅ Billet The Ti'Rendez-vous importé");

      return;
    }

    // 🧪 Workshop
    if (p === "workshop") {
  const r = await saveWorkshopTicket({
    qrText,
    packKey,
    holderName,
    ticketNumber,
    workshopTitle
  });

  // ✅ auto-inscription au workshop correspondant
  try {
    const workshopKey = normalizeKey(workshopTitle || "");
    const reg = await autoRegisterWorkshopFromTicket({
      workshopKey,
      workshopTitle
    });

    // optionnel : feedback
    if (reg?.ok && reg?.created) {
      console.log("✅ Auto-registered workshop:", reg.eventId);
    } else if (reg?.reason === "no-matching-event") {
      console.log("ℹ️ Aucun event workshop ne matche ce billet (title/key).");
    }
  } catch (e) {
    console.warn("autoRegisterWorkshopFromTicket error:", e);
  }

  await syncNameFromTicket(holderName);
  await loadSavedTicket();

  setStatus(r?.already
    ? "ℹ️ Billet workshop déjà importé"
    : "✅ Billet workshop importé (inscription auto si event trouvé)");

  return;
}

    // 🎫 Billet principal
    await saveTicketToFirestore({
      qrText,
      packKey,
      holderName,
      ticketNumber
    });

    await syncNameFromTicket(holderName);
    await loadSavedTicket();

    setStatus("✅ Billet importé avec succès");
  }
  catch (e) {
    console.log("handleFile import error:", e);
    setStatus("❌ " + (e?.message || String(e)));
  }
}

// =====================
// ADMIN (aligné rules)
// =====================
const ADMIN_EMAIL = "tidoc.congres@gmail.com";
const ADMIN_UID   = "b831dIbb3xPcn2qhfxUuVqkVSKF3";
let AUTH_USER = null;

function normEmail(e="") {
  return String(e || "").trim().toLowerCase();
}

function isAdmin() {
  const u = AUTH_USER || auth.currentUser;
  const email = normEmail(u?.email);
  const uid = String(u?.uid || "");
  return (uid === ADMIN_UID) || (email === normEmail(ADMIN_EMAIL));
}

onAuthStateChanged(auth, async (user) => {
  AUTH_USER = user;
  updateAdminButtonsVisibility();

  try {
    await loadPackConfig();
    await loadPromoPools();
    await loadPromoState();     // ✅ AJOUT
    await loadSavedTicket();
  } finally {
    updateAdminButtonsVisibility();
  }
});

// =====================
// ADMIN UI — PACKS (quotas) (SANS "Autre")
// =====================
const adminBtn    = document.getElementById("adminEditPacksBtn");
const adminModal  = document.getElementById("adminPacksModal");
const adminForm   = document.getElementById("adminPacksForm");
const adminMsg    = document.getElementById("adminPacksMsg");
const adminClose  = document.getElementById("adminPacksCloseBtn");
const adminCancel = document.getElementById("adminPacksCancelBtn");
const adminSave   = document.getElementById("adminPacksSaveBtn");

// ======================
// ADMIN UI — PROMO CODES (LISTE + AJOUT + SUPPRESSION)
// ======================
const promoBtn    = document.getElementById("adminEditPromoBtn");
const promoModal  = document.getElementById("adminPromoModal");
const promoClose  = document.getElementById("adminPromoCloseBtn");
const promoCancel = document.getElementById("adminPromoCancelBtn");
const promoSave   = document.getElementById("adminPromoSaveBtn");
const promoMsg    = document.getElementById("adminPromoMsg");

const promoPremiumEl   = document.getElementById("promoPremiumInput");
const promoStandardEl  = document.getElementById("promoStandardInput");
const promoEssentielEl = document.getElementById("promoEssentielInput");

function setAdminMsg(t = "") { if (adminMsg) adminMsg.textContent = t; }
function setPromoMsg(t = "") { if (promoMsg) promoMsg.textContent = t; }

// =====================
// Modals hard close (bfcache safe)
// =====================
function hardCloseModals() {
  const pm = document.getElementById("adminPromoModal");
  const am = document.getElementById("adminPacksModal");

  if (pm) {
    pm.style.display = "none";
    pm.style.pointerEvents = "none";
    pm.style.visibility = "hidden";
    pm.setAttribute("aria-hidden", "true");
  }

  if (am) {
    am.style.display = "none";
    am.style.pointerEvents = "none";
    am.style.visibility = "hidden";
    am.setAttribute("aria-hidden", "true");
  }

  document.body.classList.remove("modal-open");
}

function lockBodyScroll() {
  document.body.classList.add("modal-open");
}

function unlockBodyScroll() {
  document.body.classList.remove("modal-open");
}

// =====================
// Ticket UI binds
// =====================
function bindUI() {
  const uploadBtn = document.getElementById("uploadTicketBtn");
  const fileInput = document.getElementById("ticketFileInput");

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener("click", () => {
      fileInput.value = "";
      fileInput.click();
    });

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (file) await handleFile(file);
      fileInput.value = "";
    });

    console.log("✅ Import bind OK");
  } else {
    console.warn("❌ uploadBtn/fileInput introuvables", { uploadBtn, fileInput });
  }
 }

// =====================
// PACKS editor helpers
// =====================
function ensureDefaultPacks(packs) {
  const base = { ...PACKS_FALLBACK, ...(packs || {}) };
  return {
    premium:   { ...PACKS_FALLBACK.premium,   ...(base.premium   || {}) },
    standard:  { ...PACKS_FALLBACK.standard,  ...(base.standard  || {}) },
    essentiel: { ...PACKS_FALLBACK.essentiel, ...(base.essentiel || {}) },
    workshop:  { ...PACKS_FALLBACK.workshop,  ...(base.workshop  || {}) },
    staff:     { ...PACKS_FALLBACK.staff,     ...(base.staff     || {}) },
  };
}

function renderAdminPacksEditor() {
  if (!adminForm) return;

  const packs = ensureDefaultPacks(PACKS);
  adminForm.innerHTML = "";

  Object.keys(packs).forEach((key) => {
    const p = packs[key] || {};
    const row = document.createElement("div");
    row.style.cssText = "border:1px solid #eee; border-radius:14px; padding:12px;";

    const isWs = key === "workshop";
    const labelPack = escapeHTML(PACKS_FALLBACK[key]?.label || key);

    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
        <div style="font-weight:950;">Pack : ${labelPack}</div>
      </div>

      <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">

        <label style="display:flex; gap:8px; align-items:center;">
          <span style="width:170px; font-weight:800;">${isWs ? "Workshops" : "Conférences"}</span>
          <input data-pack-main="${escapeHTML(key)}"
                 type="number" min="0"
                 value="${Number(p.conferencesAllowed ?? 0)}"
                 style="width:110px; padding:8px 10px; border:1px solid #ddd; border-radius:10px;">
        </label>

        ${
          isWs
            ? ""
            : `
              <label style="display:flex; gap:8px; align-items:center;">
                <span style="width:170px; font-weight:800;">Workshops</span>
                <input data-pack-wsd="${escapeHTML(key)}"
                       type="number" min="0"
                       value="${Number(p.workshopDiscountPacks ?? 0)}"
                       style="width:110px; padding:8px 10px; border:1px solid #ddd; border-radius:10px;">
              </label>
            `
        }

      </div>
    `;

    adminForm.appendChild(row);
  });
}

function openAdminModal() {
  if (!isAdmin()) return alert("Réservé à l’admin Ti’Doc.");
  setAdminMsg("");
  renderAdminPacksEditor();

  if (adminModal) {
    adminModal.style.display = "block";
    adminModal.style.pointerEvents = "auto";
    adminModal.style.visibility = "visible";
    adminModal.setAttribute("aria-hidden", "false");
    adminModal.scrollTop = 0;
  }
  lockBodyScroll();
}

function closeAdminModal() {
  if (adminModal) {
    adminModal.style.display = "none";
    adminModal.style.pointerEvents = "none";
    adminModal.style.visibility = "hidden";
    adminModal.setAttribute("aria-hidden", "true");
  }
  unlockBodyScroll();
}

async function saveAdminPacks() {
  if (!isAdmin()) return;

  try {
    setAdminMsg("⏳ Enregistrement…");

    const packs = ensureDefaultPacks(PACKS);
    const out = {};

    for (const key of Object.keys(packs)) {
      const mainEl = document.querySelector(`[data-pack-main="${CSS.escape(key)}"]`);
      if (!mainEl) continue;

      // workshop: main = nb workshops
      if (key === "workshop") {
        out[key] = {
          label: PACKS_FALLBACK[key]?.label || key,
          conferencesAllowed: Math.max(0, Number(mainEl.value || 0)),
          workshopDiscountPacks: 0,
        };
        if (out[key].conferencesAllowed <= 0) out[key].conferencesAllowed = 1;
        continue;
      }

      const wsdEl = document.querySelector(`[data-pack-wsd="${CSS.escape(key)}"]`);

      // staff: valeurs safe
      if (key === "staff") {
        out[key] = {
          label: PACKS_FALLBACK[key]?.label || key,
          conferencesAllowed: Math.max(0, Number(mainEl.value || 0)),
          workshopDiscountPacks: Math.max(0, Number(wsdEl?.value || 0)),
        };
        if (out[key].conferencesAllowed <= 0) out[key].conferencesAllowed = 999;
        if (out[key].workshopDiscountPacks <= 0) out[key].workshopDiscountPacks = 999;
        continue;
      }

      // autres packs: conf + packs remisés
      out[key] = {
        label: PACKS_FALLBACK[key]?.label || key,
        conferencesAllowed: Math.max(0, Number(mainEl.value || 0)),
        workshopDiscountPacks: Math.max(0, Number(wsdEl?.value || 0)),
      };
    }

    await setDoc(doc(db, "config", "packs"), out, { merge: true });

    await loadPackConfig();
    await loadSavedTicket();

    setAdminMsg("✅ Quotas mis à jour !");
    closeAdminModal();
  } catch (e) {
    console.log("saveAdminPacks error:", e);
    setAdminMsg("❌ " + (e?.message || String(e)));
  }
}

// =====================
// PROMO UI helpers
// =====================
function ensurePromoUI(tier, textareaEl) {
  if (!promoModal || !textareaEl) return;

  const wrapId = `promo_ui_${tier}`;
  if (document.getElementById(wrapId)) return;

  const wrap = document.createElement("div");
  wrap.id = wrapId;
  wrap.style.cssText = "margin-top:10px; padding:10px; border:1px dashed rgba(0,0,0,.12); border-radius:12px; background:rgba(0,0,0,.02);";

  wrap.innerHTML = `
    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
      <input id="promoAdd_${tier}" type="text" placeholder="Ajouter des codes (espaces/virgules/retours ligne)"
             style="flex:1; min-width:240px; padding:10px 12px; border-radius:12px; border:1px solid rgba(0,0,0,.15);">
      <button id="promoAddBtn_${tier}" type="button" class="btn-outline" style="height:40px;">Ajouter</button>
      <div id="promoCount_${tier}" style="font-weight:900; color:rgba(15,35,42,.75);"></div>
    </div>
    <div id="promoList_${tier}" style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;"></div>
    <div style="margin-top:8px; font-size:12px; font-weight:800; color:rgba(15,35,42,.55);">
      Astuce : clique sur un code pour le supprimer.
    </div>
  `;

  textareaEl.parentElement?.appendChild(wrap);

  const addInput = document.getElementById(`promoAdd_${tier}`);
  const addBtn   = document.getElementById(`promoAddBtn_${tier}`);

  addBtn?.addEventListener("click", () => {
    const toAdd = splitCodes(addInput?.value || "");
    if (!toAdd.length) return;

    const current = splitCodes(textareaEl.value || "");
    const merged = normalizeCodes([...current, ...toAdd]);

    textareaEl.value = merged.join("\n");
    if (addInput) addInput.value = "";
    renderPromoListForTier(tier, textareaEl);
    schedulePromoAutosave();
  });

  textareaEl.addEventListener("input", () => {
    renderPromoListForTier(tier, textareaEl);
    schedulePromoAutosave();
  });
}

function renderPromoListForTier(tier, textareaEl) {
  const listEl  = document.getElementById(`promoList_${tier}`);
  const countEl = document.getElementById(`promoCount_${tier}`);
  if (!listEl || !countEl || !textareaEl) return;

  const codes = normalizeCodes(splitCodes(textareaEl.value || ""));
  countEl.textContent = `${codes.length} code(s)`;

  if (!codes.length) {
    listEl.innerHTML = `<div style="opacity:.7; font-weight:800;">(aucun code)</div>`;
    return;
  }

  listEl.innerHTML = codes.map((c) => `
    <button type="button" data-code="${escapeHTML(c)}"
      style="border:1px solid rgba(0,0,0,.12); background:#fff; border-radius:999px;
             padding:8px 10px; font-weight:900; font-size:12px; cursor:pointer;">
      ${escapeHTML(c)}
    </button>
  `).join("");

  listEl.querySelectorAll("button[data-code]").forEach(btn => {
    btn.addEventListener("click", () => {
      const code = btn.getAttribute("data-code") || "";
      const filtered = codes.filter(x => x.toLowerCase() !== code.toLowerCase());
      textareaEl.value = filtered.join("\n");
      renderPromoListForTier(tier, textareaEl);
      schedulePromoAutosave();
    });
  });
}

function openPromoModal() {
  if (!isAdmin()) return alert("Réservé à l’admin Ti’Doc.");

  // si le HTML n’a pas les inputs promo → on ne casse pas le reste
  if (!promoModal || !promoPremiumEl || !promoStandardEl || !promoEssentielEl) {
    return alert("UI promo absente sur cette page (inputs manquants).");
  }

  setPromoMsg("");

  promoPremiumEl.value   = (PROMO_POOLS.premium || []).join("\n");
  promoStandardEl.value  = (PROMO_POOLS.standard || []).join("\n");
  promoEssentielEl.value = (PROMO_POOLS.essentiel || []).join("\n");

  ensurePromoUI("premium", promoPremiumEl);
  ensurePromoUI("standard", promoStandardEl);
  ensurePromoUI("essentiel", promoEssentielEl);

  renderPromoListForTier("premium", promoPremiumEl);
  renderPromoListForTier("standard", promoStandardEl);
  renderPromoListForTier("essentiel", promoEssentielEl);

  promoModal.style.display = "block";
  promoModal.style.pointerEvents = "auto";
  promoModal.style.visibility = "visible";
  promoModal.setAttribute("aria-hidden", "false");
  promoModal.scrollTop = 0;

  lockBodyScroll();
}

function closePromoModal() {
  if (promoModal) {
    promoModal.style.display = "none";
    promoModal.style.pointerEvents = "none";
    promoModal.style.visibility = "hidden";
    promoModal.setAttribute("aria-hidden", "true");
  }
  unlockBodyScroll();
}

async function savePromoPools() {
  if (!isAdmin()) return;
  if (!promoPremiumEl || !promoStandardEl || !promoEssentielEl) return;

  try {
    setPromoMsg("⏳ Enregistrement…");

    const premium   = normalizeCodes(splitCodes(promoPremiumEl.value || ""));
    const standard  = normalizeCodes(splitCodes(promoStandardEl.value || ""));
    const essentiel = normalizeCodes(splitCodes(promoEssentielEl.value || ""));

    await setDoc(doc(db, "config", "promoPools"), {
      premium, standard, essentiel,
      updatedAt: serverTimestamp()
    }, { merge: true });

    await loadPromoPools();

    setPromoMsg(`✅ Pools mis à jour — Premium: ${PROMO_POOLS.premium.length}, Standard: ${PROMO_POOLS.standard.length}, Essentiel: ${PROMO_POOLS.essentiel.length}`);
    closePromoModal();
  } catch (e) {
    console.log("savePromoPools error:", e);
    setPromoMsg("❌ " + (e?.message || String(e)));
  }
}

// ======================
// ✅ AUTO-SAVE PROMO POOLS (admin)
// ======================
let promoAutosaveTimer = null;

async function autosavePromoPoolsIfAdmin() {
  if (!isAdmin()) return;
  if (!promoPremiumEl || !promoStandardEl || !promoEssentielEl) return;

  try {
    const premium   = normalizeCodes(splitCodes(promoPremiumEl.value || ""));
    const standard  = normalizeCodes(splitCodes(promoStandardEl.value || ""));
    const essentiel = normalizeCodes(splitCodes(promoEssentielEl.value || ""));

    await setDoc(doc(db, "config", "promoPools"), {
      premium, standard, essentiel,
      updatedAt: serverTimestamp()
    }, { merge: true });

    PROMO_POOLS = { premium, standard, essentiel };
    setPromoMsg("✅ Sauvegarde auto");
  } catch (e) {
    console.log("autosave promoPools error:", e);
    setPromoMsg("❌ Auto-save impossible (rules ?) " + (e?.message || String(e)));
  }
}

function schedulePromoAutosave() {
  if (!isAdmin()) return;
  if (promoAutosaveTimer) clearTimeout(promoAutosaveTimer);
  promoAutosaveTimer = setTimeout(() => {
    autosavePromoPoolsIfAdmin();
  }, 600);
}

// =====================
// Bind admin UI (packs + promo)
// =====================
function bindAdminUI() {
  // Packs
  adminBtn?.addEventListener("click", openAdminModal);
  adminClose?.addEventListener("click", closeAdminModal);
  adminCancel?.addEventListener("click", closeAdminModal);
  adminModal?.addEventListener("click", (e) => { if (e.target === adminModal) closeAdminModal(); });
  adminSave?.addEventListener("click", saveAdminPacks);

  // Promo
  promoBtn?.addEventListener("click", openPromoModal);
  promoClose?.addEventListener("click", closePromoModal);
  promoCancel?.addEventListener("click", closePromoModal);
  promoModal?.addEventListener("click", (e) => { if (e.target === promoModal) closePromoModal(); });
  promoSave?.addEventListener("click", savePromoPools);
}

// =====================
// Init page (safe timing)
// =====================
function initBilletsPage() {
  hardCloseModals();
  bindUI();
  bindAdminUI();

  document.getElementById("scanModeIconBtn")?.addEventListener("click", () => {
  openScanMode({ mainTicket: LAST_MAIN_TICKET, workshops: LAST_WORKSHOPS, parties: LAST_PARTIES });
});
}

window.addEventListener("DOMContentLoaded", initBilletsPage);
window.addEventListener("pageshow", hardCloseModals);
window.addEventListener("focus", hardCloseModals);


// =====================
// Admin buttons visibility (tu l’as déjà ailleurs)
// =====================
function updateAdminButtonsVisibility() {
  const ok = isAdmin();
  document.body.classList.toggle("is-admin", ok);

  const packsBtn = document.getElementById("adminEditPacksBtn");
  const promoBtn = document.getElementById("adminEditPromoBtn");

  if (packsBtn) packsBtn.style.display = ok ? "" : "none";
  if (promoBtn) promoBtn.style.display = ok ? "" : "none";

  console.log("ADMIN CHECK:", {
    ok,
    uid: (AUTH_USER || auth.currentUser)?.uid || null,
    email: (AUTH_USER || auth.currentUser)?.email || null
  });
}
