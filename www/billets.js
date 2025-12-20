// billets.js (MODULE) — Upload PDF/Photo → Scan QR → OCR (Nom/Pack/N°) → Lock QR → Save userTickets → Display
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

function normalizeSpaces(s="") {
  return String(s).replace(/\s+/g, " ").trim();
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

    const maxW = 1600; // perf iPad
    const scale = Math.min(1, maxW / img.width);
    canvas.width = Math.floor(img.width * scale);
    canvas.height = Math.floor(img.height * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- PDF (pdf.js) ----------
async function renderPdfPageToCanvas(pdf, pageNumber, scale = 1.7) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function loadPdf(file) {
  if (!window.pdfjsLib) throw new Error("PDF.js non chargé.");
  const buf = await file.arrayBuffer();
  try {
    return await window.pdfjsLib.getDocument({ data: buf }).promise;
  } catch {
    return await window.pdfjsLib.getDocument({ data: buf, disableWorker: true }).promise;
  }
}

// ---------- OCR (Tesseract) ----------
async function ocrCanvas(canvas) {
  if (!window.Tesseract) throw new Error("Tesseract.js non chargé.");
  const { data } = await window.Tesseract.recognize(canvas, "fra", { logger: () => {} });
  return data?.text || "";
}

function parseFromOcr(ocrTextRaw = "") {
  const raw = String(ocrTextRaw || "");
  const text = normalizeSpaces(raw);

  // Pack: "Pack Essentiel"
  let packKey = "";
  const mp = text.match(/pack\s*(essentiel|standard|premium)/i);
  if (mp) {
    const v = mp[1].toLowerCase();
    if (v.startsWith("ess")) packKey = "essentiel";
    else if (v.startsWith("sta")) packKey = "standard";
    else if (v.startsWith("pre")) packKey = "premium";
  }

  // N° billet: "N° de billet : 163160874"
  let ticketNumber = "";
  const mn = text.match(/n[°o]\s*de\s*billet\s*[:\-]?\s*([0-9]{5,})/i);
  if (mn) ticketNumber = mn[1];

  // Nom: souvent la ligne AVANT "Pack ..."
  // Exemple: "Aurore bouquet Pack Essentiel"
  let holderName = "";
  if (mp) {
    const idx = text.toLowerCase().indexOf(mp[0].toLowerCase());
    if (idx > 2) {
      const before = normalizeSpaces(text.slice(0, idx));
      const parts = before.split(" ");
      // on récupère les 2-4 derniers mots avant "Pack" (nom prénom)
      const cand = parts.slice(-4).join(" ").trim();
      if (cand && !cand.toLowerCase().includes("ti'doc") && !cand.toLowerCase().includes("helloasso")) {
        holderName = cand;
      }
    }
  }

  return { packKey, ticketNumber, holderName, ocrText: raw };
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
    packKey,                       // ✅ obligatoire (anti-triche côté UI)
    holderName: holderName || "",
    ticketNumber: ticketNumber || "",
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, "userTickets", u.uid), payload, { merge: true });
}

// ---------- Render ----------
function renderResult({ qrText, packKey, holderName, ticketNumber } = {}) {
  const pack = packKey ? PACKS[packKey] : null;

  const packLabel = pack ? pack.label : "—";
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
        <div><b>N° de billet :</b> ${escapeHTML(ticketNumber || "—")}</div>
        <div style="margin-top:8px;"><b>Pack :</b> ${escapeHTML(packLabel)}</div>
        <div><b>Conférences :</b> ${escapeHTML(String(conf))}</div>
        <div><b>Workshops :</b> ${escapeHTML(String(ws))}</div>
      </div>
    </div>
  `;

  const qrHost = boxEl.querySelector("#qrRender");
  if (qrHost && window.QRCode && qrText) {
    qrHost.innerHTML = "";
    new window.QRCode(qrHost, { text: qrText, width: 220, height: 220 });
  } else if (qrHost) {
    qrHost.innerHTML = `<div style="opacity:.7;font-size:12px;text-align:center;padding:20px;">
      QRCodeJS non chargé (ajoute qrcodejs).
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
    let canvasForOcr = null;

    if (type.includes("pdf")) {
      const pdf = await loadPdf(file);
      // page 1 suffit sur HelloAsso
      const canvas = await renderPdfPageToCanvas(pdf, 1, 1.7);
      qrText = scanCanvasForQR(canvas);
      canvasForOcr = canvas;

    } else if (type.startsWith("image/")) {
      const canvas = await loadImageToCanvas(file);
      qrText = scanCanvasForQR(canvas);
      canvasForOcr = canvas;

    } else {
      throw new Error("Format non supporté. Choisis un PDF ou une photo.");
    }

    if (!qrText) throw new Error("QR introuvable. Zoome sur le QR / photo plus nette.");

    // lock QR
    setStatus("⏳ Vérification du billet…");
    await claimQrOrThrow(qrText);

    // OCR
    setStatus("⏳ Lecture des infos (nom, pack, n°)…");
    const ocrText = await ocrCanvas(canvasForOcr);
    const { packKey, holderName, ticketNumber } = parseFromOcr(ocrText);

    // ✅ pack obligatoire => pas de confirmation => pas de triche “simple”
    if (!packKey) {
      throw new Error("Pack illisible. Essaie le PDF (pas une capture floue) ou zoom sur la zone 'Pack'.");
    }

    await saveTicketToFirestore({ qrText, packKey, holderName, ticketNumber });

    setStatus(`✅ Billet enregistré (${PACKS[packKey].label})`);
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
