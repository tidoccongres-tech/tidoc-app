// billets.js — Upload PDF + lecture pack + affichage QR

/* ================= CONFIG PACKS ================= */
const PACKS = [
  { key: "Essentiel", conferencesAllowed: 2, workshopsAllowed: 1 },
  { key: "Standard",  conferencesAllowed: 4, workshopsAllowed: 2 },
  { key: "Premium",   conferencesAllowed: 7, workshopsAllowed: 3 },
];

/* ================= DOM ================= */
const uploadBtn   = document.getElementById("uploadTicketBtn");
const fileInput   = document.getElementById("ticketFileInput");
const ticketBox   = document.getElementById("ticketBox");
const ticketMsg   = document.getElementById("ticketStatus");

/* ================= HELPERS ================= */
function show(msg = "") {
  if (ticketMsg) ticketMsg.textContent = msg;
}

function clearBox() {
  if (ticketBox) ticketBox.innerHTML = "";
}

function detectPackFromText(text = "") {
  const upper = text.toUpperCase();
  return PACKS.find(p => upper.includes(p.key.toUpperCase())) || null;
}

/* ================= PDF PARSE ================= */
async function parsePDF(file) {
  show("📄 Analyse du billet…");

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(it => it.str);
    fullText += " " + strings.join(" ");
  }

  return fullText;
}

/* ================= RENDER ================= */
function renderTicket(pack) {
  clearBox();

  ticketBox.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;color:var(--tidoc)">🎟️ Mon billet</h3>

      <p><b>Pack :</b> ${pack.key}</p>
      <p><b>Conférences autorisées :</b> ${pack.conferencesAllowed}</p>
      <p><b>Workshops autorisés :</b> ${pack.workshopsAllowed}</p>

      <p style="font-size:13px;opacity:.7;margin-top:10px;">
        Le QR code sera présenté à l’entrée.
      </p>
    </div>
  `;
}

/* ================= MAIN ================= */
async function handleFile(file) {
  if (!file || file.type !== "application/pdf") {
    show("❌ Merci de sélectionner un fichier PDF.");
    return;
  }

  try {
    const text = await parsePDF(file);
    const pack = detectPackFromText(text);

    if (!pack) {
      show("❌ Impossible de détecter le pack dans le billet.");
      return;
    }

    show("✅ Billet reconnu");
    renderTicket(pack);

  } catch (e) {
    console.error(e);
    show("❌ Erreur lors de la lecture du billet.");
  }
}

/* ================= EVENTS ================= */
uploadBtn?.addEventListener("click", () => {
  fileInput?.click();
});

fileInput?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});
