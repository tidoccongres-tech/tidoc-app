// billets.js (MODULE) — PDF: texte via PDF.js / Image: OCR crop zone droite

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const app  = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// ---------- MAIN IMPORT HANDLER ----------
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

      // 1) QR
      qrText = scanCanvasForQR(canvas);

      // 2) OCR top-right (pack/nom/num)
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

    if (!qrText) {
      throw new Error("QR Code non détecté sur le billet.");
    }

    // 🔐 anti-double billet
    await claimQrOrThrow(qrText);

    // 💾 sauvegarde Firestore
    await saveTicketToFirestore({ qrText, packKey, holderName, ticketNumber });

    // 🎨 affichage immédiat
    renderResult({ qrText, packKey, holderName, ticketNumber });

    setStatus("✅ Billet importé avec succès");
  } catch (e) {
    console.log("handleFile import error:", e);
    setStatus("❌ " + (e?.message || String(e)));
  }
}

// UI
const uploadBtn = document.getElementById("uploadTicketBtn");
const deleteBtn = document.getElementById("deleteTicketBtn");
const fileInput = document.getElementById("ticketFileInput");
const statusEl  = document.getElementById("ticketStatus");
const boxEl     = document.getElementById("ticketBox");

// Packs (quotas)
const PACKS_FALLBACK = {
  essentiel: { label: "Essentiel", workshopsAllowed: 1, conferencesAllowed: 2, otherAllowed: 0 },
  standard:  { label: "Standard",  workshopsAllowed: 2, conferencesAllowed: 4, otherAllowed: 0 },
  premium:   { label: "Premium",   workshopsAllowed: 3, conferencesAllowed: 7, otherAllowed: 0 },
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

function setStatus(t = "") { if (statusEl) statusEl.textContent = t; }
function escapeHTML(s = "") {
  return String(s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

// ---------- QR scan (jsQR) ----------
function scanCanvasForQR(canvas) {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(img.data, img.width, img.height);
    return code?.data || "";
  } catch { return ""; }
}

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

  // on renvoie quand même le pdf pour lire le texte
  return { pdf, qrText: "" };
}

// ---------- PDF TEXT extraction (fiable pour Nom/Pack/N° billet) ----------
async function extractMetaFromPdfText(pdf) {
  const page = await pdf.getPage(1);
  const tc = await page.getTextContent();
  const text = (tc.items || []).map(it => (it.str || "").trim()).filter(Boolean).join("\n");
  return parseMetaFromText(text);
}

// ---------- OCR crop (image) pour Nom/Pack/N° billet ----------
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

// ---------- Parsing commun (PDF texte / OCR texte) ----------
function parseMetaFromText(raw = "") {
  const lines = String(raw).split(/\r?\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const full = lines.join(" ");

  // pack
  let packKey = "";
  const mp = full.match(/pack\s*(essentiel|standard|premium)/i);
  if (mp) {
    const v = mp[1].toLowerCase();
    if (v.startsWith("ess")) packKey = "essentiel";
    else if (v.startsWith("sta")) packKey = "standard";
    else if (v.startsWith("pre")) packKey = "premium";
  }

  // ticket number
  let ticketNumber = "";
  const mn = full.match(/n[°o]\s*de\s*billet\s*[:\-]?\s*([0-9]{5,})/i);
  if (mn) ticketNumber = mn[1];

  // holder name = ligne au-dessus de "Pack ..."
  let holderName = "";
  const idxPack = lines.findIndex(l => /pack\s*(essentiel|standard|premium)/i.test(l));
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
    const mSame = lines[idxPack].match(/^(.*?)\s+pack\s*(essentiel|standard|premium)/i);
    if (mSame) holderName = mSame[1].trim();
  }

  return { holderName, packKey, ticketNumber, rawText: raw };
}

// ---------- SHA256 / Lock QR ----------
async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function claimQrOrThrow(qrText) {
  const u = auth.currentUser;
  if (!u) throw new Error("Connexion requise.");

  const qrHash = await sha256Hex(qrText);
  const claimRef = doc(db, "qrClaims", qrHash);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(claimRef);

    if (!snap.exists()) {
      tx.set(claimRef, {
        uid: u.uid,
        email: (u.email || "").toLowerCase(),
        createdAt: serverTimestamp()
      });
      return;
    }

    const existing = snap.data() || {};
    if (existing.uid && existing.uid !== u.uid) {
      throw new Error("Ce billet est déjà lié à un autre compte (QR déjà utilisé).");
    }
  });

  return qrHash;
}

// ---------- Save ----------
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

// ✅ DELETE ticket + unclaim QR
async function deleteMyTicketAndUnclaim() {
  const u = auth.currentUser;
  if (!u) { setStatus("🔒 Connecte-toi."); return; }

  const ok = confirm(
  "Supprimer ce billet ?\n\n" +
  "• Le billet sera retiré de ton compte\n" +
  "• Tu pourras l’importer à nouveau plus tard\n" +
  "• Cela n’annule PAS ton achat HelloAsso\n\n" +
  "Confirmer la suppression ?"
  );
  if (!ok) return;

  setStatus("⏳ Suppression…");

  const ticketRef = doc(db, "userTickets", u.uid);

  try {
    const snap = await getDoc(ticketRef);
    const t = snap.exists() ? (snap.data() || {}) : {};
    const qrHash = t.qrHash || "";

    // supprime billet
    await deleteDoc(ticketRef);

    // supprime claim si c’est le même uid
    if (qrHash) {
      const claimRef = doc(db, "qrClaims", qrHash);
      await runTransaction(db, async (tx) => {
        const cs = await tx.get(claimRef);
        if (!cs.exists()) return;
        const c = cs.data() || {};
        if (c.uid === u.uid) tx.delete(claimRef);
      });
    }

    boxEl.textContent = "Aucun billet importé pour l’instant.";
    setStatus("✅ Billet supprimé");
  } catch (e) {
    console.log("delete ticket error:", e);
    setStatus("❌ " + (e?.message || String(e)));
  }
}

// ---------- Render ----------
function renderResult({ qrText, packKey, holderName, ticketNumber } = {}) {
  const pack = packKey ? PACKS[packKey] : null;
  const packLabel = pack ? pack.label : "Non détecté";
  const conf = pack ? pack.conferencesAllowed : "—";
  const ws   = pack ? pack.workshopsAllowed : "—";
  const other = pack ? pack.otherAllowed : "—";

  boxEl.innerHTML = `
  <div style="position:relative; display:flex; flex-direction:column; gap:12px;">

    <!-- ✅ poubelle (au lieu de "Supprimer") -->
    <button
      class="delete-btn"
      id="deleteTicketInlineBtn"
      type="button"
      aria-label="Supprimer le billet"
      title="Supprimer"
      style="position:absolute; top:0; right:0;"
   >
      ${TRASH_TIDOC_SVG}
   </button>

    <div style="font-weight:900; color:var(--tidoc); font-size:15px; margin-bottom:8px;">
      ✅ Billet importé
    </div>

    <!-- ✅ QR premium -->
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
      <div><b>Workshops :</b> ${ws}</div>
      <div><b>Autre :</b> ${other}</div>
    </div>
  </div>
  `;

  boxEl.querySelector("#deleteTicketInlineBtn")
    ?.addEventListener("click", deleteMyTicketAndUnclaim);

  // QR code (qrcodejs)
  const host = boxEl.querySelector("#qrRender");
  if (host && window.QRCode && qrText) {
    host.innerHTML = "";
    new window.QRCode(host, { text: qrText, width: 220, height: 220 });
  } else if (host) {
    host.innerHTML = `<div style="opacity:.7;font-size:12px;text-align:center;padding:18px;">
      (Ajoute qrcodejs pour afficher le QR ici)
    </div>`;
  }
}
async function loadSavedTicket() {
  const u = auth.currentUser;
  if (!u) {
    setStatus("Connecte-toi pour afficher ton billet.");
    boxEl.textContent = "Aucun billet importé pour l’instant.";
    return;
  }

  const snap = await getDoc(doc(db, "userTickets", u.uid));
  if (!snap.exists()) {
    setStatus("");
    boxEl.textContent = "Aucun billet importé pour l’instant.";
    return;
  }

  const t = snap.data() || {};
  setStatus("✅ Billet chargé");
  renderResult({
    qrText: t.qrText || "",
    packKey: t.packKey || "",
    holderName: t.holderName || "",
    ticketNumber: t.ticketNumber || ""
  });
}

// UI
uploadBtn?.addEventListener("click", () => fileInput?.click());
fileInput?.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  await handleFile(file);
  fileInput.value = "";
});
deleteBtn?.addEventListener("click", deleteMyTicketAndUnclaim);

onAuthStateChanged(auth, async () => {
  await loadPackConfig();   // ✅ charge quotas depuis Firestore (sinon fallback)
  await loadSavedTicket();
});
