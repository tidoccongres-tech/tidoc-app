// billets.js (MODULE) — Upload PDF/Image -> decode QR + extract pack -> display
import { requireAuthOrRedirect } from "./auth.js";
requireAuthOrRedirect("./login.html");

// ====== CDN libs (ESM) ======
// QR decoder (image/canvas)
import { BrowserQRCodeReader } from "https://esm.run/@zxing/browser@0.1.5";

// PDF reader (text + render to canvas)
import * as pdfjsLib from "https://esm.run/pdfjs-dist@4.4.168";
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js";

// ===== UI =====
const uploadBtn = document.getElementById("uploadTicketBtn");
const fileInput = document.getElementById("ticketFileInput");
const ticketStatus = document.getElementById("ticketStatus");
const ticketBox = document.getElementById("ticketBox");

// ===== LocalStorage =====
const LS_KEY = "tidoc_ticket_v1";

// ===== Pack rules (à ajuster à TES packs réels) =====
// Si tu connais exactement les quotas par pack : mets-les ici.
const PACKS = [
  { name: "Essentiel", conferencesAllowed: 0, workshopsAllowed: 0 },
  { name: "Standard",  conferencesAllowed: 999, workshopsAllowed: 1 },
  { name: "Premium",   conferencesAllowed: 999, workshopsAllowed: 999 },
];

// Helpers
function show(msg = "") {
  if (ticketStatus) ticketStatus.textContent = msg;
}

function findPackInText(text) {
  const t = (text || "").toLowerCase();

  // cherche les mots des packs
  for (const p of PACKS) {
    if (t.includes(p.name.toLowerCase())) return p.name;
  }

  // fallback heuristique (si HelloAsso écrit autrement)
  if (t.includes("premium")) return "Premium";
  if (t.includes("standard")) return "Standard";
  if (t.includes("essentiel") || t.includes("essentielle")) return "Essentiel";

  return "";
}

function packInfo(packName) {
  const p = PACKS.find(x => x.name.toLowerCase() === (packName || "").toLowerCase());
  if (!p) return { conferencesAllowed: 0, workshopsAllowed: 0 };
  return {
    conferencesAllowed: p.conferencesAllowed,
    workshopsAllowed: p.workshopsAllowed
  };
}

function renderTicket(data) {
  if (!ticketBox) return;

  if (!data) {
    ticketBox.textContent = "Aucun billet pour l’instant.";
    return;
  }

  const packName = data.packName || "Inconnu";
  const { conferencesAllowed, workshopsAllowed } = packInfo(packName);

  ticketBox.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px;">
      <div style="display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap;">
        <div style="border:1px solid rgba(0,0,0,.08); border-radius:12px; padding:10px; background:#fff;">
          <div style="font-weight:900; color:var(--tidoc); margin-bottom:8px;">QR Code</div>
          <img src="${data.qrDataUrl || ""}" alt="QR" style="width:160px; height:160px; object-fit:contain; display:block;">
        </div>

        <div style="flex:1; min-width:180px;">
          <div style="font-weight:900; color:var(--tidoc); font-size:16px; margin-bottom:6px;">
            Pack : ${escapeHtml(packName)}
          </div>

          <div style="font-size:13px; color:var(--muted); font-weight:800;">
            Conférences autorisées : ${Number(conferencesAllowed)}
          </div>
          <div style="font-size:13px; color:var(--muted); font-weight:800; margin-top:4px;">
            Workshops autorisés : ${Number(workshopsAllowed)}
          </div>

          <div style="margin-top:10px; font-size:12px; opacity:.7; word-break:break-word;">
            <b>QR contenu :</b> ${escapeHtml(data.qrText || "")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ====== QR decode from Image ======
async function decodeQrFromImageFile(file) {
  const reader = new BrowserQRCodeReader();
  const imgUrl = URL.createObjectURL(file);

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = imgUrl;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  // canvas
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  // QR
  const result = await reader.decodeFromCanvas(canvas);
  URL.revokeObjectURL(imgUrl);

  // dataURL pour affichage
  const qrDataUrl = canvasToQrPreview(canvas);

  return { qrText: result?.getText?.() || "", qrDataUrl };
}

// petit helper : on ne veut pas afficher l’image entière, juste un carré lisible
function canvasToQrPreview(canvas) {
  try {
    // On exporte l’image entière : souvent ok car billet capture contient QR bien visible.
    // Si tu veux, on pourra recadrer plus tard.
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

// ====== PDF: extract text + render pages to canvas to find QR ======
async function pdfToText(pdf) {
  let full = "";
  const maxPages = Math.min(pdf.numPages, 2); // souvent le billet est page 1
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(it => it.str).filter(Boolean);
    full += "\n" + strings.join(" ");
  }
  return full;
}

async function renderPdfPageToCanvas(pdf, pageNumber, scale = 2) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function decodeQrFromPdfFile(file) {
  const reader = new BrowserQRCodeReader();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  // 1) texte -> pack
  const text = await pdfToText(pdf);
  const packName = findPackInText(text);

  // 2) QR -> on rend les 2 premières pages et on tente un decode
  let qrText = "";
  let qrDataUrl = "";

  const pagesToTry = Math.min(pdf.numPages, 2);

  for (let p = 1; p <= pagesToTry; p++) {
    const canvas = await renderPdfPageToCanvas(pdf, p, 2);
    try {
      const res = await reader.decodeFromCanvas(canvas);
      qrText = res?.getText?.() || "";
      qrDataUrl = canvas.toDataURL("image/png");
      break;
    } catch {
      // pas de QR détecté sur cette page -> continue
    }
  }

  return { qrText, qrDataUrl, packName };
}

// ====== Main handler ======
async function handleFile(file) {
  if (!file) return;

  show("Analyse du billet…");

  const type = (file.type || "").toLowerCase();

  // IMAGE
  if (type.startsWith("image/")) {
    try {
      const { qrText, qrDataUrl } = await decodeQrFromImageFile(file);

      // pack inconnu sur image (sans OCR), on laisse vide
      const data = { qrText, qrDataUrl, packName: "" };

      localStorage.setItem(LS_KEY, JSON.stringify(data));
      renderTicket(data);

      show(qrText ? "✅ Billet analysé." : "⚠️ QR non détecté (essaie une capture plus nette).");
      return;
    } catch (e) {
      console.log(e);
      show("❌ Impossible de lire le QR sur l’image. Essaie une capture plus nette.");
      return;
    }
  }

  // PDF
  if (type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    try {
      const { qrText, qrDataUrl, packName } = await decodeQrFromPdfFile(file);

      const data = { qrText, qrDataUrl, packName };

      localStorage.setItem(LS_KEY, JSON.stringify(data));
      renderTicket(data);

      if (!qrText) show("⚠️ PDF lu mais QR non détecté. Essaie une capture image du QR.");
      else if (!packName) show("✅ QR détecté. ⚠️ Pack non trouvé dans le PDF (on peut améliorer la détection).");
      else show("✅ Billet analysé (QR + pack).");
      return;
    } catch (e) {
      console.log(e);
      show("❌ Impossible de lire le PDF. Essaie une capture d’écran (image) du billet.");
      return;
    }
  }

  show("❌ Format non supporté. Choisis un PDF ou une image.");
}

// ====== Boot ======
function loadSaved() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return renderTicket(null);
    const data = JSON.parse(raw);
    renderTicket(data);
  } catch {
    renderTicket(null);
  }
}

uploadBtn?.addEventListener("click", () => fileInput?.click());

fileInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  // reset pour pouvoir re-uploader le même fichier
  e.target.value = "";
  await handleFile(file);
});

loadSaved();
