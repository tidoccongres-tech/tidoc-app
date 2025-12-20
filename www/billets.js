// billets.js — PDF + Photo → Scan QR → Lit pack (PDF texte ou OCR image) → Affiche QR en image + quotas
// Requiert dans billets.html :
// - pdf.js (window.pdfjsLib)
// - jsQR (window.jsQR)
// - tesseract.js (window.Tesseract)

const uploadBtn = document.getElementById("uploadTicketBtn");
const fileInput = document.getElementById("ticketFileInput");
const statusEl  = document.getElementById("ticketStatus");
const boxEl     = document.getElementById("ticketBox");

const openHelloAssoBtn = document.getElementById("openHelloAssoBtn");
const HELLOASSO_URL = "https://www.helloasso.com/associations/ti-doc/evenements/ti-doc-2026";
if (openHelloAssoBtn) openHelloAssoBtn.href = HELLOASSO_URL;

// Quotas (modifiable plus tard)
const PACKS = {
  essentiel: { label: "Essentiel", workshopsAllowed: 1, conferencesAllowed: 2 },
  standard:  { label: "Standard",  workshopsAllowed: 2, conferencesAllowed: 4 },
  premium:   { label: "Premium",   workshopsAllowed: 3, conferencesAllowed: 7 },
};

function setStatus(t = "") {
  if (statusEl) statusEl.textContent = t;
}

function escapeHTML(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(s = "") {
  return String(s).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function detectPackFromAnyText(txt = "") {
  const t = normalize(txt);
  // supporte “Pack Essentiel”, “pack: standard”, etc.
  if (t.includes("essentiel")) return "essentiel";
  if (t.includes("standard"))  return "standard";
  if (t.includes("premium"))   return "premium";
  return "";
}

function renderResult({ qrText, packKey, qrDataUrl } = {}) {
  const pack = packKey ? PACKS[packKey] : null;

  const packLabel = pack ? pack.label : "Non détecté";
  const conf = pack ? pack.conferencesAllowed : "—";
  const ws   = pack ? pack.workshopsAllowed : "—";

  boxEl.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div style="font-weight:900; color:var(--tidoc); font-size:15px;">
        ✅ Billet importé
      </div>

      <div style="border:1px solid var(--line); border-radius:14px; padding:12px;">
        <div style="font-weight:900; margin-bottom:10px;">QR code</div>
        ${
          qrDataUrl
            ? `<div style="display:flex; justify-content:center;">
                 <img src="${qrDataUrl}" alt="QR code" style="width:180px; height:180px; object-fit:contain; border-radius:12px; border:1px solid var(--line); background:#fff;">
               </div>`
            : `<div style="opacity:.7; font-size:13px;">(aperçu QR non disponible)</div>`
        }
        <div style="margin-top:10px; font-size:12px; opacity:.7; overflow-wrap:anywhere;">
          ${escapeHTML(qrText || "")}
        </div>
      </div>

      <div style="border:1px solid var(--line); border-radius:14px; padding:12px;">
        <div><b>Pack :</b> ${escapeHTML(packLabel)}</div>
        <div><b>Conférences :</b> ${escapeHTML(String(conf))}</div>
        <div><b>Workshops :</b> ${escapeHTML(String(ws))}</div>
      </div>

      ${
        !pack
          ? `<div style="border:1px dashed rgba(0,0,0,.18); border-radius:14px; padding:12px;">
               <div style="font-weight:900; margin-bottom:8px;">Pack non détecté automatiquement</div>
               <div style="font-size:13px; opacity:.85;">
                 Astuce : importe idéalement le <b>PDF HelloAsso</b> (plus fiable qu’une capture).
               </div>
             </div>`
          : ``
      }
    </div>
  `;
}

// ---------- QR scan helpers (jsQR) ----------
function qrBoundingBox(loc) {
  if (!loc) return null;
  const xs = [loc.topLeftCorner.x, loc.topRightCorner.x, loc.bottomRightCorner.x, loc.bottomLeftCorner.x];
  const ys = [loc.topLeftCorner.y, loc.topRightCorner.y, loc.bottomRightCorner.y, loc.bottomLeftCorner.y];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x:minX, y:minY, w:(maxX-minX), h:(maxY-minY) };
}

function cropCanvasToDataUrl(canvas, rect, pad = 18) {
  if (!rect) return "";
  const x = Math.max(0, Math.floor(rect.x - pad));
  const y = Math.max(0, Math.floor(rect.y - pad));
  const w = Math.min(canvas.width - x, Math.floor(rect.w + pad*2));
  const h = Math.min(canvas.height - y, Math.floor(rect.h + pad*2));
  if (w <= 0 || h <= 0) return "";

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d").drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out.toDataURL("image/png");
}

function scanCanvasForQR(canvas) {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(img.data, img.width, img.height);
    if (!code?.data) return { qrText:"", qrDataUrl:"", location:null };

    const rect = qrBoundingBox(code.location);
    const qrDataUrl = cropCanvasToDataUrl(canvas, rect, 14);

    return { qrText: code.data, qrDataUrl, location: code.location };
  } catch {
    return { qrText:"", qrDataUrl:"", location:null };
  }
}

async function loadImageToCanvas(fileOrBlob, { maxW = 1600 } = {}) {
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // scale raisonnable (perf iPad)
    const scale = Math.min(1, maxW / img.width);
    canvas.width = Math.floor(img.width * scale);
    canvas.height = Math.floor(img.height * scale);

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- PDF helpers ----------
async function renderPdfPageToCanvas(pdf, pageNumber, scale = 1.8) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function extractPdfText(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const tc = await page.getTextContent();
  const parts = (tc.items || []).map(it => it.str).filter(Boolean);
  return parts.join(" ");
}

async function scanPdf(file) {
  if (!window.pdfjsLib) throw new Error("PDF.js non chargé.");
  const buf = await file.arrayBuffer();
  let pdf;
try {
  pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
} catch (e) {
  // ✅ fallback iOS/Safari si le worker CDN est bloqué
  pdf = await window.pdfjsLib.getDocument({ data: buf, disableWorker: true }).promise;
}

  // on tente 1-2 pages
  const pagesToTry = Math.min(2, pdf.numPages);

  let best = { qrText:"", qrDataUrl:"", packKey:"" };

  for (let i = 1; i <= pagesToTry; i++) {
    // 1) texte → pack
    const txt = await extractPdfText(pdf, i);
    const packKeyFromText = detectPackFromAnyText(txt);

    // 2) rendu → QR
    let canvas = await renderPdfPageToCanvas(pdf, i, 1.8);
    let qrRes = scanCanvasForQR(canvas);

    if (!qrRes.qrText) {
      canvas = await renderPdfPageToCanvas(pdf, i, 2.4);
      qrRes = scanCanvasForQR(canvas);
    }

    if (qrRes.qrText) {
      best = {
        qrText: qrRes.qrText,
        qrDataUrl: qrRes.qrDataUrl,
        packKey: packKeyFromText || detectPackFromAnyText(qrRes.qrText),
      };
      return best; // PDF : si QR trouvé, on sort
    }

    // si pas de QR sur cette page, on garde au moins le pack si trouvé
    if (packKeyFromText && !best.packKey) best.packKey = packKeyFromText;
  }

  return best;
}

// ---------- OCR image (pour lire “Pack Essentiel” sur une capture) ----------
async function ocrPackFromImageCanvas(canvas) {
  if (!window.Tesseract) return "";

  // On crop la zone “haut-droite sous le nom” (comme ton billet)
  // Ajustable si besoin : ici ~40% à droite, et ~35% en haut
  const w = canvas.width, h = canvas.height;
  const cropX = Math.floor(w * 0.50);
  const cropY = Math.floor(h * 0.12);
  const cropW = Math.floor(w * 0.40);
  const cropH = Math.floor(h * 0.26);

  const roi = document.createElement("canvas");
  roi.width = cropW;
  roi.height = cropH;
  roi.getContext("2d").drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  // OCR (fr+eng, mais on garde simple)
  const { data } = await window.Tesseract.recognize(roi, "fra+eng", {
    logger: () => {} // silence
  });

  return data?.text || "";
}

// ---------- Main flow ----------
async function handleFile(file) {
  if (!file) return;

  if (!window.jsQR) {
    setStatus("❌ Scanner QR non chargé (jsQR).");
    return;
  }

  setStatus("⏳ Analyse du billet…");
  boxEl.textContent = "Analyse en cours…";

  const type = (file.type || "").toLowerCase();

  try {
    let qrText = "";
    let qrDataUrl = "";
    let packKey = "";

    if (type.includes("pdf")) {
      // PDF → QR + pack via texte PDF
      const res = await scanPdf(file);
      qrText = res.qrText || "";
      qrDataUrl = res.qrDataUrl || "";
      packKey = res.packKey || "";

      if (!qrText) {
        setStatus("❌ QR introuvable dans le PDF. Essaie une capture zoomée du QR.");
        boxEl.textContent = "QR introuvable.";
        return;
      }

    } else if (type.startsWith("image/")) {
      // Image → QR via jsQR, pack via OCR
      const canvas = await loadImageToCanvas(file, { maxW: 1800 });
      const qrRes = scanCanvasForQR(canvas);

      qrText = qrRes.qrText || "";
      qrDataUrl = qrRes.qrDataUrl || "";

      if (!qrText) {
        setStatus("❌ QR introuvable. Essaie une photo plus nette / zoomée sur le QR.");
        boxEl.textContent = "QR introuvable.";
        return;
      }

      // 1) pack depuis QR (rare)
      packKey = detectPackFromAnyText(qrText);

      // 2) pack via OCR zone du pack (ton cas)
      if (!packKey) {
        setStatus("⏳ QR OK. Lecture du pack…");
        const ocrText = await ocrPackFromImageCanvas(canvas);
        packKey = detectPackFromAnyText(ocrText);
      }

    } else {
      setStatus("❌ Format non supporté. Choisis un PDF ou une photo.");
      boxEl.textContent = "Format non supporté.";
      return;
    }

    setStatus(packKey ? `✅ QR + Pack : ${PACKS[packKey].label}` : "✅ QR détecté (pack non trouvé automatiquement)");
    renderResult({ qrText, packKey, qrDataUrl });

  } catch (e) {
    console.log("ticket read error:", e);
    setStatus("❌ Erreur : " + (e?.message || e));
    boxEl.textContent = "Erreur lecture billet.";
  }
}

// UI events
uploadBtn?.addEventListener("click", () => fileInput?.click());

fileInput?.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  await handleFile(file);
  fileInput.value = ""; // re-uploader le même fichier possible
});

// état initial
setStatus("");
if (boxEl) boxEl.textContent = "Aucun billet importé pour l’instant.";
