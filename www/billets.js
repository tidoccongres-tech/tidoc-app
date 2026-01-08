// billets.js (MODULE)

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, runTransaction, serverTimestamp,
  collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const app  = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// =====================
// UI
// =====================
const uploadBtn = document.getElementById("uploadTicketBtn");
const deleteBtn = document.getElementById("deleteTicketBtn");
const fileInput = document.getElementById("ticketFileInput");
const statusEl  = document.getElementById("ticketStatus");
const boxEl     = document.getElementById("ticketBox");

function setStatus(t = "") { if (statusEl) statusEl.textContent = t; }
function escapeHTML(s = "") {
  return String(s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

// =====================
// OFFICIAL TICKET INDEX (GitHub raw JSON)
// =====================
const OFFICIAL_TICKETS_URL = "https://raw.githubusercontent.com/<USER>/<REPO>/main/tickets_officiels.json";
// ↑ tu remplaces avec ton raw github

let OFFICIAL_CACHE = null;

async function fetchOfficialTicketsIndex() {
  // cache mémoire
  if (OFFICIAL_CACHE) return OFFICIAL_CACHE;

  // cache localStorage (optionnel)
  try {
    const cached = JSON.parse(localStorage.getItem("tidoc_official_index") || "null");
    if (cached && cached.data && cached.ts && (Date.now() - cached.ts) < 5 * 60 * 1000) {
      OFFICIAL_CACHE = cached.data;
      return OFFICIAL_CACHE;
    }
  } catch(_) {}

  const res = await fetch(OFFICIAL_TICKETS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Impossible de vérifier le billet (index officiel indisponible).");

  const data = await res.json();
  OFFICIAL_CACHE = data;

  try {
    localStorage.setItem("tidoc_official_index", JSON.stringify({ ts: Date.now(), data }));
  } catch(_) {}

  return OFFICIAL_CACHE;
}

async function verifyPackWithQrOrThrow(qrText, detectedPackKey) {
  const qrHash = await sha256Hex(qrText);
  const index = await fetchOfficialTicketsIndex();

  const officialPack = (index && index[qrHash]) ? String(index[qrHash]).toLowerCase() : "";

  if (!officialPack) {
    throw new Error("Billet non reconnu (QR absent de la liste officielle).");
  }

  // si l’OCR n’a rien trouvé, on peut “remplir” avec l’officiel
  if (!detectedPackKey) return { qrHash, officialPack, finalPackKey: officialPack };

  const det = String(detectedPackKey).toLowerCase();

  if (det !== officialPack) {
    throw new Error(`Billet refusé : pack incohérent (détecté: ${det} / officiel: ${officialPack}).`);
  }

  return { qrHash, officialPack, finalPackKey: det };
}

// =====================
// PACKS (quotas) — 4 packs fixes
// =====================
// NB: quotas = ce que TU veux afficher/contrôler dans l’app (modifiable par admin)
const PACKS_FALLBACK = {
  premium:  { label: "Premium",  conferencesAllowed: 999, workshopDiscountPacks: 3, otherAllowed: 0 },
  standard: { label: "Standard", conferencesAllowed: 7,   workshopDiscountPacks: 2, otherAllowed: 0 },
  essentiel:{ label: "Essentiel",conferencesAllowed: 2,   workshopDiscountPacks: 1, otherAllowed: 0 },
  workshop: { label: "Workshop", conferencesAllowed: 0,   workshopDiscountPacks: 0, otherAllowed: 0 },
};
let PACKS = { ...PACKS_FALLBACK };

function normalizePackConfig(obj){
  const src = obj && typeof obj === "object" ? obj : {};
  const out = {};
  for (const k of Object.keys(src)){
    const v = src[k] || {};
    out[String(k).toLowerCase()] = {
      // label volontairement ignoré si on veut le figer (on garde quand même la propriété)
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

    // ✅ on force les 4 packs (labels figés sur fallback)
    PACKS = {
      premium:  { ...PACKS_FALLBACK.premium,  ...(normalized.premium  || {}) },
      standard: { ...PACKS_FALLBACK.standard, ...(normalized.standard || {}) },
      essentiel:{ ...PACKS_FALLBACK.essentiel,...(normalized.essentiel|| {}) },
      workshop: { ...PACKS_FALLBACK.workshop, ...(normalized.workshop || {}) },
    };

    // ✅ labels figés (si tu veux VRAIMENT empêcher toute modif)
    PACKS.premium.label   = PACKS_FALLBACK.premium.label;
    PACKS.standard.label  = PACKS_FALLBACK.standard.label;
    PACKS.essentiel.label = PACKS_FALLBACK.essentiel.label;
    PACKS.workshop.label  = PACKS_FALLBACK.workshop.label;

  } catch (e){
    console.log("loadPackConfig error:", e);
    PACKS = { ...PACKS_FALLBACK };
  }
}

// =====================
// PROMO CODES — pools séparés (premium/standard/essentiel)
// Firestore: config/promoPools
// {
//   premium:  ["CODE1", "CODE2", ...],
//   standard: ["CODEA", ...],
//   essentiel:["CODEX", ...],
//   updatedAt: ...
// }
// =====================
let PROMO_POOLS = { premium: [], standard: [], essentiel: [] };

function normalizeCodes(list){
  const arr = Array.isArray(list) ? list : [];
  const cleaned = arr
    .map(x => String(x || "").trim())
    .filter(Boolean);
  // dédoublonnage (case-insensitive)
  const seen = new Set();
  const out = [];
  for (const c of cleaned){
    const k = c.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

async function loadPromoPools(){
  try{
    const snap = await getDoc(doc(db, "config", "promoPools"));
    if (!snap.exists()){
      PROMO_POOLS = { premium: [], standard: [], essentiel: [] };
      return;
    }
    const d = snap.data() || {};
    PROMO_POOLS = {
      premium: normalizeCodes(d.premium),
      standard: normalizeCodes(d.standard),
      essentiel: normalizeCodes(d.essentiel),
    };
  } catch(e){
    console.log("loadPromoPools error:", e);
    PROMO_POOLS = { premium: [], standard: [], essentiel: [] };
  }
}

// Attribuer 1 code selon le pack (premium/standard/essentiel), et le retirer du pool
async function assignPromoCodeIfNeeded(packKey){
  const u = auth.currentUser;
  if (!u) return { code: "" };

  const tier = String(packKey || "").toLowerCase();
  if (!["premium","standard","essentiel"].includes(tier)) return { code: "" };

  const userRef = doc(db, "userTickets", u.uid);
  const poolsRef = doc(db, "config", "promoPools");

  const res = await runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    const userData = userSnap.exists() ? (userSnap.data() || {}) : {};
    const existing = userData?.promoCode || "";

    // ✅ déjà attribué → on ne re-pioche pas
    if (existing && String(existing).trim()) {
      return { code: String(existing).trim(), already: true };
    }

    const poolsSnap = await tx.get(poolsRef);
    const poolsData = poolsSnap.exists() ? (poolsSnap.data() || {}) : {};
    const list = normalizeCodes(poolsData[tier]);

    if (!list.length) {
      return { code: "", empty: true };
    }

    const code = list[0];
    const rest = list.slice(1);

    tx.set(poolsRef, {
      ...poolsData,
      [tier]: rest,
      updatedAt: serverTimestamp()
    }, { merge: true });

    tx.set(userRef, {
      promoCode: code,
      promoTier: tier,
      promoAssignedAt: serverTimestamp()
    }, { merge: true });

    return { code, already: false };
  });

  return res || { code: "" };
}

// =====================
// ICON (trash) — inchangé
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
// MAIN IMPORT HANDLER
// =====================
async function handleFile(file) {
  if (!file) return;

  try {
    setStatus("⏳ Analyse du billet…");

    let qrText = "";
    let packKey = "";
    let holderName = "";
    let ticketNumber = "";

    // ===== PDF =====
    if (file.type === "application/pdf") {
      const { pdf, qrText: qrFromPdf } = await scanPdfForQR(file);
      qrText = qrFromPdf || "";

      const meta = await extractMetaFromPdfText(pdf);
      packKey = meta.packKey || "";
      holderName = meta.holderName || "";
      ticketNumber = meta.ticketNumber || "";
    }

    // ===== IMAGE =====
    else if (file.type.startsWith("image/")) {
      const canvas = await loadImageToCanvas(file);

      qrText = scanCanvasForQR(canvas);

      const crop = cropTopRight(canvas);
      const text = await ocrCanvas(crop);
      const meta = parseMetaFromText(text);

      packKey = meta.packKey || "";
      holderName = meta.holderName || "";
      ticketNumber = meta.ticketNumber || "";
    }
    else {
      throw new Error("Format non supporté (PDF ou image uniquement).");
    }

    if (!qrText) throw new Error("QR Code non détecté sur le billet.");

   // ✅ Vérif “texte/emojis” VS “officiel (QR -> GitHub)”
   const v = await verifyPackWithQrOrThrow(qrText, packKey);
   packKey = v.finalPackKey; // garde celui détecté (ou rempli par l’officiel si vide)
    
    // 🔐 anti-double billet (global)
    await claimQrOrThrow(qrText);

    // ✅ Si pack workshop → on le sauvegarde à part (sans écraser billet principal)
    const p = String(packKey || "").toLowerCase();
    if (p === "workshop") {
      await saveWorkshopTicket({ qrText, packKey, holderName, ticketNumber });
      await syncNameFromTicket(holderName);

      await loadSavedTicket(); // recharge billet principal + liste workshops
      setStatus("✅ Billet workshop importé");
      return;
    }

    // Sinon billet principal
    await saveTicketToFirestore({ qrText, packKey, holderName, ticketNumber });
    await syncNameFromTicket(holderName);

    // 🎟️ Attribution auto code promo si pack premium/standard/essentiel
    const promo = await assignPromoCodeIfNeeded(packKey);

    // 🎨 affichage immédiat (avec code si dispo)
    renderResult({
  qrText: t.qrText || "",
  packKey: t.packKey || "",
  holderName: t.holderName || "",
  ticketNumber: t.ticketNumber || "",
  promoCode: t.promoCode || "",
  workshopsImportedCount: workshops.length
});

renderWorkshopsList(workshops);
    
    setStatus("✅ Billet importé avec succès");
  } catch (e) {
    console.log("handleFile import error:", e);
    setStatus("❌ " + (e?.message || String(e)));
  }
}

// =====================
// Parsing (PDF texte / OCR texte)
// =====================
function parseMetaFromText(raw = "") {
  const lines = String(raw)
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const full = lines.join(" ");

  // ✅ 1) Pack via emojis (prioritaire)
  const EMOJI_PACK = [
    { emoji: "⭐️", key: "premium" },
    { emoji: "📘", key: "standard" },
    { emoji: "🍻", key: "essentiel" },
    { emoji: "🧑‍⚕️", key: "workshop" },
  ];

  let packKey = "";
  for (const e of EMOJI_PACK) {
    if (full.includes(e.emoji)) { packKey = e.key; break; }
  }

  // ✅ 2) Pack via texte ("Pack premium/standard/essentiel/workshop")
  if (!packKey) {
    const mp = full.match(/pack\s*(essentiel|standard|premium|workshop|atelier)/i);
    if (mp) {
      const v = mp[1].toLowerCase();
      if (v.startsWith("ess")) packKey = "essentiel";
      else if (v.startsWith("sta")) packKey = "standard";
      else if (v.startsWith("pre")) packKey = "premium";
      else if (v.startsWith("wor") || v.startsWith("ate")) packKey = "workshop";
    }
  }

  // ticket number
  let ticketNumber = "";
  const mn = full.match(/n[°o]\s*de\s*billet\s*[:\-]?\s*([0-9]{5,})/i);
  if (mn) ticketNumber = mn[1];

  // holder name = ligne au-dessus de "Pack ..."
  let holderName = "";
  const idxPack = lines.findIndex(l => /pack\s*(essentiel|standard|premium|workshop|atelier)/i.test(l) || /⭐️|📘|🍻|🧑‍⚕️/.test(l));
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
    const mSame = lines[idxPack].match(/^(.*?)\s+pack\s*(essentiel|standard|premium|workshop|atelier)/i);
    if (mSame) holderName = mSame[1].trim();
  }

  return { holderName, packKey, ticketNumber, rawText: raw };
}

// =====================
// Save Ticket principal
// =====================
async function saveTicketToFirestore({ qrText, packKey, holderName, ticketNumber }) {
  const u = auth.currentUser;
  if (!u) throw new Error("Connexion requise.");
  const qrHash = await sha256Hex(qrText);

  await setDoc(doc(db, "userTickets", u.uid), {
    qrText,
    qrHash,
    packKey: packKey || "",
    holderName: holderName || "",
    ticketNumber: ticketNumber || "",
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// =====================
// Save Workshop Ticket (multi)
// Collection: userWorkshopTickets (docs = uid_qrHash)
// =====================
async function saveWorkshopTicket({ qrText, packKey, holderName, ticketNumber }){
  const u = auth.currentUser;
  if (!u) throw new Error("Connexion requise.");
  const qrHash = await sha256Hex(qrText);

  const id = `${u.uid}_${qrHash}`;
  await setDoc(doc(db, "userWorkshopTickets", id), {
    uid: u.uid,
    qrText,
    qrHash,
    packKey: packKey || "workshop",
    holderName: holderName || "",
    ticketNumber: ticketNumber || "",
    createdAt: serverTimestamp()
  }, { merge: true });
}

// =====================
// DELETE billet principal + unclaim QR (inchangé) — MAIS ne touche pas workshops
// =====================
async function deleteMyTicketAndUnclaim() {
  ...
}

// (tes fonctions sha256Hex, claimQrOrThrow, syncNameFromTicket, scanPdfForQR, OCR etc restent identiques)

// =====================
// Render (ajoute promoCode + liste workshops)
// =====================
function renderResult({ qrText, packKey, holderName, ticketNumber, promoCode, workshopsImportedCount } = {}) {  const key = String(packKey || "").toLowerCase();
  const pack = PACKS[key] || null;
  const packLabel = pack ? pack.label : (key ? key : "Non détecté");

  const discount = pack ? Number(pack.workshopDiscountPacks ?? 0) : 0;
  const imported = Number(workshopsImportedCount ?? 0);                                                                                                           
                                                                                                              
  const conf = pack ? (pack.conferencesAllowed === 999 ? "Toutes" : pack.conferencesAllowed) : "—";
  const ws   = pack ? pack.workshopsAllowed : "—";
  const other = pack ? pack.otherAllowed : "—";

  const promo = String(promoCode || "").trim();
  const showPromo = promo && ["premium","standard","essentiel"].includes(key);

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

      <div class="qr-premium">
        <div class="qr-title">QR Code</div>
        <div class="qr-box">
          <div id="qrRender" style="width:220px;height:220px;"></div>
        </div>
      </div>

      <div style="border:1px solid var(--line); border-radius:14px; padding:12px;">
        <div><b>Nom :</b> ${escapeHTML(holderName || "—")}</div>
        <div><b>N° billet :</b> ${escapeHTML(ticketNumber || "—")}</div>
        <div style="margin-top:8px;"><b>Pack :</b> ${escapeHTML(packLabel)}</div>
        <div><b>Conférences :</b> ${conf}</div>
        <div><b>Workshops (quota app) :</b> ${ws}</div>
        <div><b>Autre :</b> ${other}</div>
      </div>

      ${showPromo ? `
        <div style="border:1px solid rgba(23,140,168,.22); border-radius:14px; padding:12px; background:rgba(23,140,168,.06);">
          <div style="font-weight:900; color:#0f4f60;">🎟️ Code promo workshops</div>
          <div style="margin-top:6px; font-size:13px; font-weight:800; color:rgba(15,35,42,.85);">
            Utilise ce code sur HelloAsso pour acheter ton <b>Pack Workshop</b> avec la réduction.
          </div>
          <div style="margin-top:10px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <div style="font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-weight:900; font-size:14px;
                        padding:10px 12px; border-radius:12px; background:#fff; border:1px solid rgba(0,0,0,.08);">
              ${escapeHTML(promo)}
            </div>
            <button id="copyPromoBtn" class="btn-outline" type="button" style="height:40px;">
              Copier
            </button>
          </div>
          <div id="copyPromoMsg" style="margin-top:8px; font-size:12px; font-weight:800; color:rgba(31,75,86,.75);"></div>
        </div>
      ` : ""}

      <div id="workshopsListBox"></div>
    </div>
  `;

  boxEl.querySelector("#deleteTicketInlineBtn")
    ?.addEventListener("click", deleteMyTicketAndUnclaim);

  const host = boxEl.querySelector("#qrRender");
  if (host && window.QRCode && qrText) {
    host.innerHTML = "";
    new window.QRCode(host, { text: qrText, width: 220, height: 220 });
  } else if (host) {
    host.innerHTML = `<div style="opacity:.7;font-size:12px;text-align:center;padding:18px;">
      (Ajoute qrcodejs pour afficher le QR ici)
    </div>`;
  }

  // copy promo
  const copyBtn = boxEl.querySelector("#copyPromoBtn");
  if (copyBtn && promo) {
    copyBtn.addEventListener("click", async () => {
      try{
        await navigator.clipboard.writeText(promo);
        const msg = boxEl.querySelector("#copyPromoMsg");
        if (msg) msg.textContent = "✅ Copié";
      }catch{
        const msg = boxEl.querySelector("#copyPromoMsg");
        if (msg) msg.textContent = "❌ Impossible de copier (copie manuelle).";
      }
    });
  }
}

// =====================
// Load saved ticket + load workshops list
// =====================
async function loadSavedTicket() {
  const u = auth.currentUser;
  if (!u) {
    setStatus("Connecte-toi pour afficher ton billet.");
    boxEl.textContent = "Aucun billet importé pour l’instant.";
    return;
  }

  const snap = await getDoc(doc(db, "userTickets", u.uid));

  // Toujours charger la liste workshop (même si pas de billet principal)
  const wsQ = query(collection(db, "userWorkshopTickets"), where("uid", "==", u.uid));
  const wsSnap = await getDocs(wsQ);
  const workshops = wsSnap.docs.map(d => d.data() || {}).filter(Boolean);

  if (!snap.exists()) {
    setStatus(workshops.length ? "✅ Billets workshop chargés" : "");
    boxEl.textContent = "Aucun billet importé pour l’instant.";
    // petit rendu workshops si existants
    if (workshops.length) {
      boxEl.innerHTML = `<div style="font-weight:900; color:var(--tidoc); margin-bottom:10px;">🎫 Tes billets workshop</div>
        <div id="workshopsListBox"></div>`;
      renderWorkshopsList(workshops);
    }
    return;
  }

  const t = snap.data() || {};
  setStatus("✅ Billet chargé");

  renderResult({
    qrText: t.qrText || "",
    packKey: t.packKey || "",
    holderName: t.holderName || "",
    ticketNumber: t.ticketNumber || "",
    promoCode: t.promoCode || ""
  });

  renderWorkshopsList(workshops);
}

function renderWorkshopsList(workshops = []){
  const listBox = document.getElementById("workshopsListBox");
  if (!listBox) return;

  if (!workshops.length) {
    listBox.innerHTML = `
      <div style="opacity:.8; font-weight:800; color:rgba(31,75,86,.75);">
        Aucun billet workshop importé pour l’instant.
      </div>
    `;
    return;
  }

  const items = workshops.map(w => `
    <div style="border:1px solid var(--line); border-radius:14px; padding:12px; background:#fff;">
      <div style="font-weight:900; color:#0f4f60;">🧪 Pack Workshop</div>
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
}

// =====================
// ADMIN UI (packs editor) — quotas only
// =====================
const ADMIN_EMAIL = "tidoc.congres@gmail.com";

function isAdmin(){
  if (window.TIDOC_AUTH?.isAdmin) return true;
  const email = (auth.currentUser?.email || "").toLowerCase();
  return email === ADMIN_EMAIL.toLowerCase();
}

const adminBtn   = document.getElementById("adminEditPacksBtn");
const adminModal = document.getElementById("adminPacksModal");
const adminForm  = document.getElementById("adminPacksForm");
const adminMsg   = document.getElementById("adminPacksMsg");
const adminClose = document.getElementById("adminPacksCloseBtn");
const adminCancel= document.getElementById("adminPacksCancelBtn");
const adminSave  = document.getElementById("adminPacksSaveBtn");

function setAdminMsg(t=""){ if (adminMsg) adminMsg.textContent = t; }

function ensureDefaultPacks(packs){
  // ✅ force 4 packs
  const base = { ...PACKS_FALLBACK, ...(packs || {}) };
  return {
    premium:  { ...PACKS_FALLBACK.premium,  ...(base.premium  || {}) },
    standard: { ...PACKS_FALLBACK.standard, ...(base.standard || {}) },
    essentiel:{ ...PACKS_FALLBACK.essentiel,...(base.essentiel|| {}) },
    workshop: { ...PACKS_FALLBACK.workshop, ...(base.workshop || {}) },
  };
}

function renderAdminPacksEditor(){
  if (!adminForm) return;

  const packs = ensureDefaultPacks(PACKS);
  adminForm.innerHTML = "";

  Object.keys(packs).forEach((key)=>{
    const p = packs[key] || {};
    const row = document.createElement("div");
    row.style.cssText = "border:1px solid #eee; border-radius:14px; padding:12px;";

    // ✅ label figé (pas d’input)
    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
        <div style="font-weight:950;">Pack : ${escapeHTML(PACKS_FALLBACK[key]?.label || key)}</div>
      </div>

      <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
        <label style="display:flex; gap:8px; align-items:center;">
          <span style="width:110px; font-weight:800;">Conférences</span>
          <input data-pack-conf="${escapeHTML(key)}" type="number" min="0" value="${Number(p.conferencesAllowed ?? 0)}"
                 style="width:110px; padding:8px 10px; border:1px solid #ddd; border-radius:10px;">
        </label>

        <label style="display:flex; gap:8px; align-items:center;">
          <span style="width:110px; font-weight:800;">Workshops</span>
          <input data-pack-ws="${escapeHTML(key)}" type="number" min="0" value="${Number(p.workshopsAllowed ?? 0)}"
                 style="width:110px; padding:8px 10px; border:1px solid #ddd; border-radius:10px;">
        </label>

        <label style="display:flex; gap:8px; align-items:center;">
          <span style="width:110px; font-weight:800;">Autre</span>
          <input data-pack-other="${escapeHTML(key)}" type="number" min="0" value="${Number(p.otherAllowed ?? 0)}"
                 style="width:110px; padding:8px 10px; border:1px solid #ddd; border-radius:10px;">
        </label>
      </div>
    `;
    adminForm.appendChild(row);
  });
}

function openAdminModal(){
  if (!isAdmin()) return alert("Réservé à l’admin Ti’Doc.");
  setAdminMsg("");
  renderAdminPacksEditor();
  if (adminModal) adminModal.style.display = "block";
}
function closeAdminModal(){ if (adminModal) adminModal.style.display = "none"; }

async function saveAdminPacks(){
  if (!isAdmin()) return;
  try{
    setAdminMsg("⏳ Enregistrement…");

    const packs = ensureDefaultPacks(PACKS);
    const out = {};

    for (const key of Object.keys(packs)){
      const confEl  = document.querySelector(`[data-pack-conf="${CSS.escape(key)}"]`);
      const wsEl    = document.querySelector(`[data-pack-ws="${CSS.escape(key)}"]`);
      const othEl   = document.querySelector(`[data-pack-other="${CSS.escape(key)}"]`);

      out[key] = {
        // ✅ label figé
        label: PACKS_FALLBACK[key]?.label || key,
        conferencesAllowed: Math.max(0, Number(confEl?.value || 0)),
        workshopsAllowed: Math.max(0, Number(wsEl?.value || 0)),
        otherAllowed: Math.max(0, Number(othEl?.value || 0)),
      };
    }

    await setDoc(doc(db, "config", "packs"), out, { merge:true });

    await loadPackConfig();
    await loadSavedTicket();

    setAdminMsg("✅ Quotas mis à jour !");
    closeAdminModal();
  } catch(e){
    console.log("saveAdminPacks error:", e);
    setAdminMsg("❌ " + (e?.message || String(e)));
  }
}

adminBtn?.addEventListener("click", openAdminModal);
adminClose?.addEventListener("click", closeAdminModal);
adminCancel?.addEventListener("click", closeAdminModal);
adminModal?.addEventListener("click", (e)=>{ if (e.target === adminModal) closeAdminModal(); });
adminSave?.addEventListener("click", saveAdminPacks);

// ======================
// ADMIN UI — PROMO CODES MODAL
// ======================
const promoBtn   = document.getElementById("adminEditPromoBtn");
const promoModal = document.getElementById("adminPromoModal");
const promoClose = document.getElementById("adminPromoCloseBtn");
const promoCancel= document.getElementById("adminPromoCancelBtn");
const promoSave  = document.getElementById("adminPromoSaveBtn");
const promoMsg   = document.getElementById("adminPromoMsg");

const promoPremiumEl  = document.getElementById("promoPremiumInput");
const promoStandardEl = document.getElementById("promoStandardInput");
const promoEssentielEl= document.getElementById("promoEssentielInput");

function setPromoMsg(t=""){ if (promoMsg) promoMsg.textContent = t; }

function openPromoModal(){
  if (!isAdmin()) return alert("Réservé à l’admin Ti’Doc.");
  setPromoMsg("");
  // pré-remplissage (optionnel)
  promoPremiumEl.value  = (PROMO_POOLS.premium || []).join("\n");
  promoStandardEl.value = (PROMO_POOLS.standard || []).join("\n");
  promoEssentielEl.value= (PROMO_POOLS.essentiel || []).join("\n");
  promoModal.style.display = "block";
}
function closePromoModal(){ if (promoModal) promoModal.style.display = "none"; }

async function savePromoPools(){
  if (!isAdmin()) return;
  try{
    setPromoMsg("⏳ Enregistrement…");

    const premium  = normalizeCodes(String(promoPremiumEl.value || "").split(/\r?\n/));
    const standard = normalizeCodes(String(promoStandardEl.value || "").split(/\r?\n/));
    const essentiel= normalizeCodes(String(promoEssentielEl.value || "").split(/\r?\n/));

    await setDoc(doc(db, "config", "promoPools"), {
      premium, standard, essentiel,
      updatedAt: serverTimestamp()
    }, { merge:true });

    await loadPromoPools();
    setPromoMsg(`✅ Pools mis à jour — Premium: ${PROMO_POOLS.premium.length}, Standard: ${PROMO_POOLS.standard.length}, Essentiel: ${PROMO_POOLS.essentiel.length}`);
    closePromoModal();
  }catch(e){
    console.log("savePromoPools error:", e);
    setPromoMsg("❌ " + (e?.message || String(e)));
  }
}

promoBtn?.addEventListener("click", openPromoModal);
promoClose?.addEventListener("click", closePromoModal);
promoCancel?.addEventListener("click", closePromoModal);
promoModal?.addEventListener("click", (e)=>{ if (e.target === promoModal) closePromoModal(); });
promoSave?.addEventListener("click", savePromoPools);

// =====================
// INIT
// =====================
onAuthStateChanged(auth, async () => {
  await loadPackConfig();
  await loadPromoPools();
  await loadSavedTicket();
  if (adminBtn) adminBtn.style.display = isAdmin() ? "inline-flex" : "none";
  if (promoBtn) promoBtn.style.display = isAdmin() ? "inline-flex" : "none";
});
