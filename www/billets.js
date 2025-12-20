// billets.js — PDF + Photo → Scan QR → Affiche pack + quotas
// Requiert : pdfjsLib (PDF.js legacy) + jsQR

const uploadBtn = document.getElementById("uploadTicketBtn");
const fileInput = document.getElementById("ticketFileInput");
const statusEl  = document.getElementById("ticketStatus");
const boxEl     = document.getElementById("ticketBox");

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

function detectPackFromText(qrText = "") {
  const t = (qrText || "").toLowerCase();
  if (t.includes("essentiel")) return "essentiel";
  if (t.includes("standard"))  return "standard";
  if (t.includes("premium"))   return "premium";
  return "";
}

function renderResult({ qrText, packKey } = {}) {
  const pack = packKey ? PACKS[packKey] : null;

  const qrSafe = escapeHTML(qrText || "");
  const packLabel = pack ? pack.label : "Non détecté";

  const conf = pack ? pack.conferencesAllowed : "—";
  const ws   = pack ? pack.workshopsAllowed : "—";

  if (!boxEl) return;

  boxEl.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px;">
      <div style="font-weight:900; color:var(--tidoc); font-size:15px;">
        ✅ Billet importé
      </div>

      <div style="border:1px solid var(--line); border-radius:14px; padding:12px;">
        <div style="font-weight:900; margin-bottom:6px;">QR détecté</div>
        <div style="font-size:12px; opacity:.75; overflow-wrap:anywhere;">
          ${qrSafe ? qrSafe : "—"}
        </div>
      </div>

      <div style="border:1px solid var(--line); border-radius:14px; padding:12px;">
        <div><b>Pack :</b> ${escapeHTML(packLabel)}</div>
        <div><b>Conférences :</b> ${escapeHTML(String(conf))}</div>
        <div><b>Workshops :</b> ${escapeHTML(String(ws))}</div>
      </div>

      ${!pack ? `
        <div style="border:1px dashed rgba(0,0,0,.18); border-radius:14px; padding:12px;">
          <div style="font-weight:900; margin-bottom:8px;">Pack non détecté</div>
          <div style="font-size:13px; opacity:.8; margin-bottom:10px;">
            Le QR HelloAsso ne contient pas toujours le nom du pack.
            Choisis ton pack pour afficher les quotas :
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-outline" type="button" data-pack="essentiel">Essentiel</button>
            <button class="btn-outline" type="button" data-pack="standard">Standard</button>
            <button class="btn-outline" type="button" data-pack="premium">Premium</button>
          </div>
        </div>
      ` : ``}
    </div>
  `;

  // pack manuel
  boxEl.querySelectorAll("[data-pack]").forEach((b) => {
    b.addEventListener("click", () => {
      const key = b.getAttribute("data-pack");
      renderResult({ qrText, packKey: key });
      setStatus(`✅ Pack sélectionné : ${PACKS[key].label}`);
    });
  });
}

// ---------- QR scan ----------
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

async function loadImageToCanvas(fileOrBlob, maxW = 1400) {
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
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const scale = Math.min(1, maxW / img.width);
    canvas.width = Math.floor(img.width * scale);
    canvas.height = Math.floor(img.height * scale);

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- PDF ----------
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

async function scanPdfForQR(file) {
  if (!window.pdfjsLib) throw new Error("PDF.js non chargé (pdfjsLib absent).");
  if (!window.jsQR) throw new Error("Scanner QR non chargé (jsQR absent).");

  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

  const pagesToTry = Math.min(2, pdf.numPages);

  for (let i = 1; i <= pagesToTry; i++) {
    // normal
    let canvas = await renderPdfPageToCanvas(pdf, i, 1.8);
    let qr = scanCanvasForQR(canvas);
    if (qr) return qr;

    // zoom fort
    canvas = await renderPdfPageToCanvas(pdf, i, 2.4);
    qr = scanCanvasForQR(canvas);
    if (qr) return qr;
  }

  return "";
}

// ---------- iPad file type detection ----------
function isProbablyPdf(file) {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();

  if (type.includes("pdf")) return true;

  // iOS renvoie parfois application/octet-stream
  if (type.includes("octet-stream") && name.endsWith(".pdf")) return true;

  // si pas de type mais extension .pdf
  if (!type && name.endsWith(".pdf")) return true;

  return false;
}

function isProbablyImage(file) {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) return true;

  const name = (file.name || "").toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".heic"].some(ext => name.endsWith(ext));
}

// ---------- Main ----------
async function handleFile(file) {
  if (!file) return;

  if (!window.jsQR) {
    setStatus("❌ Scanner QR non chargé (jsQR).");
    return;
  }

  setStatus("⏳ Analyse du billet…");
  if (boxEl) boxEl.textContent = "Analyse en cours…";

  try {
    let qrText = "";

    if (isProbablyPdf(file)) {
      if (!window.pdfjsLib) {
        throw new Error("PDF.js non chargé. Vérifie billets.html (scripts PDF.js legacy).");
      }
      qrText = await scanPdfForQR(file);

    } else if (isProbablyImage(file)) {
      const canvas = await loadImageToCanvas(file, 1600);
      qrText = scanCanvasForQR(canvas);

      // fallback sans réduction
      if (!qrText) {
        const canvas2 = await loadImageToCanvas(file, 99999);
        qrText = scanCanvasForQR(canvas2);
      }

    } else {
      setStatus("❌ Format non supporté. Choisis un PDF ou une photo.");
      if (boxEl) boxEl.textContent = "Format non supporté.";
      return;
    }

    if (!qrText) {
      setStatus("❌ QR introuvable. Essaie une photo plus nette / zoomée sur le QR.");
      if (boxEl) boxEl.textContent = "QR introuvable.";
      return;
    }

    const packKey = detectPackFromText(qrText);
    setStatus(packKey ? `✅ QR détecté + Pack : ${PACKS[packKey].label}` : "✅ QR détecté (pack à confirmer)");
    renderResult({ qrText, packKey });

  } catch (e) {
    console.log("ticket read error:", e);
    setStatus("❌ Erreur dans la lecture du billet : " + (e?.message || e));
    if (boxEl) boxEl.textContent = "Erreur lecture billet.";
  }
}

// UI events
uploadBtn?.addEventListener("click", () => fileInput?.click());

fileInput?.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  await handleFile(file);
  fileInput.value = ""; // reset pour ré-uploader le même fichier
});

// init
setStatus("");
