// ui-fullscreen.js (MODULE) — bouton global "mode focus" (cache UI)
const LS_KEY = "tidoc_ui_focus"; // persiste le choix

function svgToDataUrl(svgString){
  const cleaned = svgString.trim().replace(/\s+/g, " ");
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(cleaned);
}

// ✅ tes SVG (tu peux changer stroke si tu veux)
const SVG_FULLSCREEN = `<?xml version="1.0" encoding="utf-8"?>
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path opacity="0.5" d="M12.9999 21.9994C17.055 21.9921 19.1784 21.8926 20.5354 20.5355C21.9999 19.0711 21.9999 16.714 21.9999 12C21.9999 7.28595 21.9999 4.92893 20.5354 3.46447C19.071 2 16.714 2 11.9999 2C7.28587 2 4.92884 2 3.46438 3.46447C2.10734 4.8215 2.00779 6.94493 2.00049 11" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round"/>
<path d="M12 12L17 7M17 7H13.25M17 7V10.75" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M2 18C2 16.1144 2 15.1716 2.58579 14.5858C3.17157 14 4.11438 14 6 14C7.88562 14 8.82843 14 9.41421 14.5858C10 15.1716 10 16.1144 10 18C10 19.8856 10 20.8284 9.41421 21.4142C8.82843 22 7.88562 22 6 22C4.11438 22 3.17157 22 2.58579 21.4142C2 20.8284 2 19.8856 2 18Z" stroke="#FFFFFF" stroke-width="1.5"/>
</svg>`;

const SVG_MINIMIZE = `<?xml version="1.0" encoding="utf-8"?>
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path opacity="0.5" d="M12.9999 21.9994C17.055 21.9921 19.1784 21.8926 20.5354 20.5355C21.9999 19.0711 21.9999 16.714 21.9999 12C21.9999 7.28595 21.9999 4.92893 20.5354 3.46447C19.071 2 16.714 2 11.9999 2C7.28587 2 4.92884 2 3.46438 3.46447C2.10734 4.8215 2.00779 6.94493 2.00049 11" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round"/>
<path d="M17 7L12 12M12 12H15.75M12 12V8.25" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M2 18C2 16.1144 2 15.1716 2.58579 14.5858C3.17157 14 4.11438 14 6 14C7.88562 14 8.82843 14 9.41421 14.5858C10 15.1716 10 16.1144 10 18C10 19.8856 10 20.8284 9.41421 21.4142C8.82843 22 7.88562 22 6 22C4.11438 22 3.17157 22 2.58579 21.4142C2 20.8284 2 19.8856 2 18Z" stroke="#FFFFFF" stroke-width="1.5"/>
</svg>`;

const ICON_ON  = svgToDataUrl(SVG_FULLSCREEN);
const ICON_OFF = svgToDataUrl(SVG_MINIMIZE);

function ensureButton(){
  let btn = document.getElementById("btnFocusMode");
  if (btn) return btn;

  btn = document.createElement("button");
  btn.id = "btnFocusMode";
  btn.type = "button";
  btn.setAttribute("aria-label", "Mode plein écran (masquer l'UI)");

  btn.style.cssText = `
    position: fixed;
    right: calc(14px + env(safe-area-inset-right));
    top: calc(14px + env(safe-area-inset-top));
    z-index: 99999;
    width: 44px;
    height: 44px;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,.14);
    background: rgba(0,0,0,.55);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 10px 26px rgba(0,0,0,.25);
    display: grid;
    place-items: center;
    padding: 0;
    cursor: pointer;
  `;

  const img = document.createElement("img");
  img.alt = "";
  img.width = 22;
  img.height = 22;
  img.style.cssText = "display:block; opacity:.95;";
  btn.appendChild(img);

  document.body.appendChild(btn);
  return btn;
}

function applyFocus(on){
  document.body.classList.toggle("ui-hidden", !!on);
  localStorage.setItem(LS_KEY, on ? "1" : "0");

  const btn = document.getElementById("btnFocusMode");
  const img = btn?.querySelector("img");
  if (img) img.src = on ? ICON_OFF : ICON_ON;
}

// API globale si tu veux l’appeler depuis d’autres scripts
window.setFocusMode = (on) => applyFocus(!!on);
window.toggleFocusMode = () => applyFocus(!document.body.classList.contains("ui-hidden"));

export function initFocusMode(){
  const btn = ensureButton();
  btn.addEventListener("click", () => window.toggleFocusMode());

  // restaure préférence
  const saved = localStorage.getItem(LS_KEY) === "1";
  applyFocus(saved);
}
