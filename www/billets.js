// billets.js — Upload PDF/Photo → Scan QR → extrait infos →
// 1) persiste dans Firestore (reste après reload)
// 2) verrouille le QR sur 1 seul compte (nominatif)

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
import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// Firebase init
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// UI
const uploadBtn = document.getElementById("uploadTicketBtn");
const fileInput = document.getElementById("ticketFileInput");
const statusEl  = document.getElementById("ticketStatus");
const boxEl     = document.getElementById("ticketBox");

// Quotas (modifiable)
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

// ---- Extraction “visuelle” depuis la capture (pas OCR) :
// Ici on ne lit pas le texte du PDF, on lit le contenu du QR.
// MAIS tu peux quand même extraire "Pack Essentiel/Standard/Premium"
// si HelloAsso l'inclut dans le QR (souvent non).
function detectPackFromText(qrText = "") {
  const t = (qrText || "").toLowerCase();
  if (t.includes("essentiel")) return "essentiel";
  if (t.includes("standard"))  return "standard";
  if (t.includes("premium"))   return "premium";
  return "";
}

// ---- Extraction depuis le visuel du billet (dans TON exemple, le pack est écrit)
// Sans OCR, on ne peut pas “lire” le texte imprimé.
// Donc on sécurise autrement : pack obligatoire = sélection, OU tu ajoutes OCR plus tard.
// (Mais côté sécurité: le verrou QR empêche la fraude “plusieurs comptes”.)
function renderResult({ qrText, packKey, holderName, ticketNumber } = {}) {
  const pack = packKey ? PACKS[packKey] : null;

  const packLabel = pack ? pack.label : "Non détecté";
  const conf = pack ? pack.conferencesAllowed : "—";
  const ws   = pack ? pack.workshopsAllowed : "—";

  // QR en image (pour affichage à scanner)
  const qrSvg = makeQrSvg(qrText || "");

  boxEl.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div style="font-weight:900; color:var(--tidoc); font-size:15px;">✅ Billet importé</div>

      <div style="border:1px solid var(--line); border-radius:14px; padding:12px;">
        <div style="font-weight:900; margin-bottom:8px;">QR Code</div>
        <div style="display:flex; justify-content:center; padding:8px 0;">${qrSvg}</div>
        <div style="font-size:12px; opacity:.65; overflow-wrap:anywhere;">${escapeHTML(qrText || "—")}</div>
      </div>

      <div style="border:1px solid var(--line); border-radius:14px; padding:12px;">
        <div><b>Nom :</b> ${escapeHTML(holderName || "—")}</div>
        <div><b>N° billet :</b> ${escapeHTML(ticketNumber || "—")}</div>
        <div style="margin-top:8px;"><b>Pack :</b> ${escapeHTML(packLabel)}</div>
        <div><b>Conférences :</b> ${escapeHTML(String(conf))}</div>
        <div><b>Workshops :</b> ${escapeHTML(String(ws))}</div>
      </div>

      ${!pack ? `
        <div style="border:1px dashed rgba(0,0,0,.18); border-radius:14px; padding:12px;">
          <div style="font-weight:900; margin-bottom:8px;">Pack à confirmer</div>
          <div style="font-size:13px; opacity:.8; margin-bottom:10px;">
            Pour afficher les quotas, sélectionne ton pack.
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

  boxEl.querySelectorAll("[data-pack]").forEach((b) => {
    b.addEventListener("click", async () => {
      const key = b.getAttribute("data-pack");
      setStatus(`⏳ Enregistrement du pack ${PACKS[key].label}…`);
      await saveTicketToFirestore({ qrText, packKey: key, holderName, ticketNumber });
      setStatus(`✅ Pack enregistré : ${PACKS[key].label}`);
      renderResult({ qrText, packKey: key, holderName, ticketNumber });
    });
  });
}

// ---------- QR scan helpers (jsQR) ----------
function scanCanvasForQR(canvas) {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(img.data, img.width, img.height);
    return code?.data || "";
  } catch { return ""; }
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
  } finally { URL.revokeObjectURL(url); }
}

// ---------- PDF scan helpers (pdf.js) ----------
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
  if (!window.pdfjsLib) throw new Error("pdfjsLib introuvable (PDF.js pas chargé).");
  if (!window.jsQR) throw new Error("jsQR introuvable (lib QR pas chargée).");

  const buf = await file.arrayBuffer();

  let pdf;
  try {
    pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  } catch (e) {
    // iOS/Safari fallback
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

// ---------- Sécurité QR : hash + claim ----------
async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// extraction simple depuis TON billet (basé sur ce que tu m’as montré)
function extractTicketMetaFromYourExampleImageLike(qrText) {
  // Le QR ne contient pas forcément le nom, donc on garde des champs optionnels.
  // Ici on met juste placeholders. Si tu veux, plus tard, on ajoutera OCR.
  return { holderName: "", ticketNumber: "" };
}

async function claimQrOrThrow({ qrText }) {
  const u = auth.currentUser;
  if (!u) throw new Error("Connexion requise.");

  const qrHash = await sha256Hex(qrText);

  const claimRef = doc(db, "qrClaims", qrHash);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(claimRef);

    if (!snap.exists()) {
      // ✅ pas encore claim → on claim pour ce compte
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
    // sinon: même user → ok
  });

  return qrHash;
}

// ---------- Persistance billet ----------
async function saveTicketToFirestore({ qrText, packKey, holderName, ticketNumber }) {
  const u = auth.currentUser;
  if (!u) throw new Error("Connexion requise.");

  const qrHash = await sha256Hex(qrText);

  const payload = {
    qrText,
    qrHash,
    packKey: packKey || "",
    holderName: holderName || "",
    ticketNumber: ticketNumber || "",
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, "userTickets", u.uid), payload, { merge: true });
}

// ---------- QR en image affichable ----------
function makeQrSvg(text) {
  // SVG “placeholder” si pas de lib QR generator.
  // IMPORTANT: Si tu veux un vrai QR parfaitement scannable,
  // je te donne une version avec une lib QR (qrcodejs) ou une petite lib ES module.
  // Là on affiche juste le texte + un cadre si tu n’as pas de générateur.
  // ➜ OPTION RECOMMANDÉE juste en dessous.
  return `
    <div style="width:220px; height:220px; border:2px solid var(--line); border-radius:16px;
                display:flex; align-items:center; justify-content:center; padding:14px; text-align:center;">
      <div style="font-size:12px; opacity:.7;">QR affichage : ajoute un générateur QR pour rendre ce bloc scannable</div>
    </div>
  `;
}

// ✅ OPTION RECOMMANDÉE : utiliser un vrai générateur QR (simple)
// 1) Ajoute dans billets.html avant billets.js :
//    <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
// 2) Puis remplace makeQrSvg + la zone d’affichage par un div id=qrRender et génère avec QRCode.
// Si tu veux, je te fais le patch exact (2 lignes HTML + 10 lignes JS).

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
      if (!window.pdfjsLib) throw new Error("PDF.js non chargé.");
      qrText = await scanPdfForQR(file);

    } else if (type.startsWith("image/")) {
      const canvas = await loadImageToCanvas(file);
      qrText = scanCanvasForQR(canvas);

    } else {
      throw new Error("Format non supporté. Choisis un PDF ou une photo.");
    }

    if (!qrText) throw new Error("QR introuvable. Essaie une photo plus nette / zoomée sur le QR.");

    // ✅ verrouille le QR pour ce compte
    setStatus("⏳ Vérification du billet…");
    const qrHash = await claimQrOrThrow({ qrText });

    // pack depuis QR si présent
    let packKey = detectPackFromText(qrText);

    // meta optionnelles (placeholder)
    const { holderName, ticketNumber } = extractTicketMetaFromYourExampleImageLike(qrText);

    // ✅ persiste
    await saveTicketToFirestore({ qrText, packKey, holderName, ticketNumber });

    setStatus(packKey ? `✅ Billet enregistré (Pack: ${PACKS[packKey].label})` : "✅ Billet enregistré (pack à confirmer)");
    renderResult({ qrText, packKey, holderName, ticketNumber, qrHash });

  } catch (e) {
    console.log("ticket read error:", e);
    setStatus("❌ " + (e?.message || e));
    boxEl.textContent = "Erreur lecture billet.";
  }
}

// ---------- Charger billet existant au démarrage ----------
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
