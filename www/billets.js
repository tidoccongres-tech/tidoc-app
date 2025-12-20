// billets.js (MODULE) — Upload PDF/Photo → Scan QR → Lock QR → Save userTickets → Display
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// Firebase init
const app  = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// UI
const uploadBtn = document.getElementById("uploadTicketBtn");
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
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Pack détecté uniquement si le QR le contient vraiment
function detectPackFromText(qrText = "") {
  const t = (qrText || "").toLowerCase();
  if (t.includes("essentiel")) return "essentiel";
  if (t.includes("standard"))  return "standard";
  if (t.includes("premium"))   return "premium";
  return "";
}

// Meta (nom / numéro) : pas dispo sans OCR / API → on laisse vide pour l’instant
function extractTicketMeta(qrText = "") {
  return { holderName: "", ticketNumber: "" };
}

// ---------- QR scan (jsQR) ----------
function scanCanvasForQR(canvas) {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(img.data, img.width, img.height);
    return code?.data || "";
  } catch {
    return "";
  }
}

async function loadImageToCanvas(fileOrBlob) {
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const maxW = 1400; // perf iPad
    const scale = Math.min(1, maxW / img.width);
    canvas.width = Math.floor(img.width * scale);
    canvas.height = Math.floor(img.height * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- PDF scan (pdf.js) ----------
async function renderPdfPageToCanvas(pdf, pageNumber, scale = 1.6) {
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
    let canvas = await renderPdfPageToCanvas(pdf, i, 1.6);
    let qr = scanCanvasForQR(canvas);
    if (qr) return qr;

    canvas = await renderPdfPageToCanvas(pdf, i, 2.2);
    qr = scanCanvasForQR(canvas);
    if (qr) return qr;
  }
  return "";
}

// ---------- SHA256 ----------
async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------- Lock QR (qrClaims) ----------
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

// ---------- Save user ticket ----------
async function saveTicketToFirestore({ qrText, packKey, holderName, ticketNumber }) {
  const u = auth.currentUser;
  if (!u) throw new Error("Connexion requise.");

  const qrHash = await sha256Hex(qrText);

  const payload = {
    qrText,
    qrHash,
    // packKey: uniquement si détecté dans le QR (sinon "")
    packKey: packKey || "",
    holderName: holderName || "",
    ticketNumber: ticketNumber || "",
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, "userTickets", u.uid), payload, { merge: true });
}

// ---------- Render ----------
function renderResult({ qrText, packKey, holderName, ticketNumber } = {}) {
  const pack = packKey ? PACKS[packKey] : null;

  const packLabel = pack ? pack.label : "Non vérifié";
  const conf = pack ? pack.conferencesAllowed : "—";
  const ws   = pack ? pack.workshopsAllowed : "—";

  boxEl.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div style="font-weight:900; color:var(--tidoc); font-size:15px;">✅ Billet importé</div>

      <div style="border:1px solid var(--line); border-radius:14px; padding:12px;">
        <div style="font-weight:900; margin-bottom:8px;">QR Code</div>
        <div style="display:flex; justify-content:center; padding:8px 0;">
          <div id="qrRender" style="width:220px;height:220px;"></div>
        </div>
        <div style="font-size:12px; opacity:.65; overflow-wrap:anywhere;">${escapeHTML(qrText || "—")}</div>
      </div>

      <div style="border:1px solid var(--line); border-radius:14px; padding:12px;">
        <div><b>Nom :</b> ${escapeHTML(holderName || "—")}</div>
        <div><b>N° billet :</b> ${escapeHTML(ticketNumber || "—")}</div>
        <div style="margin-top:8px;"><b>Pack :</b> ${escapeHTML(packLabel)}</div>
        <div><b>Conférences :</b> ${escapeHTML(String(conf))}</div>
        <div><b>Workshops :</b> ${escapeHTML(String(ws))}</div>
      </div>
    </div>
  `;

  // ✅ Génère un vrai QR (qrcodejs)
  const qrHost = boxEl.querySelector("#qrRender");
  if (qrHost && window.QRCode && qrText) {
    qrHost.innerHTML = "";
    new window.QRCode(qrHost, { text: qrText, width: 220, height: 220 });
  } else if (qrHost) {
    qrHost.innerHTML = `<div style="opacity:.7;font-size:12px;text-align:center;padding:20px;">
      QRCodeJS non chargé (ajoute la lib qrcodejs).
    </div>`;
  }
}

// ---------- Main flow ----------
async function handleFile(file) {
  if (!file) return;

  if (!auth.currentUser) {
    setStatus("🔒 Connecte-toi d’abord.");
    return;
  }

  if (!window.jsQR) {
    setStatus("❌ Scanner QR non chargé (jsQR).");
    return;
  }

  setStatus("⏳ Analyse du billet…");
  boxEl.textContent = "Analyse en cours…";

  const type = (file.type || "").toLowerCase();

  try {
    let qrText = "";

    if (type.includes("pdf")) {
      qrText = await scanPdfForQR(file);
    } else if (type.startsWith("image/")) {
      const canvas = await loadImageToCanvas(file);
      qrText = scanCanvasForQR(canvas);
    } else {
      throw new Error("Format non supporté. Choisis un PDF ou une photo.");
    }

    if (!qrText) {
      throw new Error("QR introuvable. Essaie une photo plus nette / zoomée sur le QR.");
    }

    // lock QR
    setStatus("⏳ Vérification du billet…");
    await claimQrOrThrow(qrText);

    // pack seulement si inclus dans le QR
    const packKey = detectPackFromText(qrText);

    // meta placeholders (future OCR possible)
    const { holderName, ticketNumber } = extractTicketMeta(qrText);

    // save
    await saveTicketToFirestore({ qrText, packKey, holderName, ticketNumber });

    setStatus(packKey ? `✅ Billet enregistré (Pack: ${PACKS[packKey].label})` : "✅ Billet enregistré (Pack non vérifié)");
    renderResult({ qrText, packKey, holderName, ticketNumber });

  } catch (e) {
    console.log("ticket read error:", e);
    setStatus("❌ " + (e?.message || String(e)));
    boxEl.textContent = "Erreur lecture billet.";
  }
}

// ---------- Load existing ticket ----------
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

// UI events
uploadBtn?.addEventListener("click", () => fileInput?.click());

fileInput?.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  await handleFile(file);
  fileInput.value = "";
});

// boot
onAuthStateChanged(auth, () => loadSavedTicket());
