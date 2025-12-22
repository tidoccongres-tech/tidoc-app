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

// UI
const uploadBtn = document.getElementById("uploadTicketBtn");
const deleteBtn = document.getElementById("deleteTicketBtn");
const fileInput = document.getElementById("ticketFileInput");
const statusEl  = document.getElementById("ticketStatus");
const boxEl     = document.getElementById("ticketBox");

// Packs (quotas)
const PACKS = {
  essentiel: { label: "Essentiel", workshopsAllowed: 1, conferencesAllowed: 2 },
  standard:  { label: "Standard",  workshopsAllowed: 2, conferencesAllowed: 4 },
  premium:   { label: "Premium",   workshopsAllowed: 3, conferencesAllowed: 7 },
};

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
      <svg class="trash-ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v9h-2v-9Zm4 0h2v9h-2v-9ZM7 10h2v9H7v-9ZM6 7h12l-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7Z"/>
      </svg>
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

onAuthStateChanged(auth, () => loadSavedTicket());
