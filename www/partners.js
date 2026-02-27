import * as AuthMod from "./auth.js";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const db = AuthMod.db;
const auth = AuthMod.auth;

const ADMIN_EMAIL = "tidoc.congres@gmail.com";

function isAdmin(user){
  return (user?.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

const grid = document.getElementById("partnersGrid");
const btnAdd = document.getElementById("btnAddPartner");

async function loadPartners(){
  grid.innerHTML = "";
  const snap = await getDocs(collection(db, "partners"));

  snap.forEach(docSnap => {
    const data = docSnap.data();

    const card = document.createElement("div");
    card.style.background = "#fff";
    card.style.borderRadius = "16px";
    card.style.padding = "16px";
    card.style.display = "flex";
    card.style.alignItems = "center";
    card.style.justifyContent = "center";
    card.style.position = "relative";
    card.style.boxShadow = "0 10px 30px rgba(0,0,0,.08)";

    const img = document.createElement("img");
    img.src = data.logoUrl;
    img.alt = data.name || "Partenaire";
    img.style.maxWidth = "100%";
    img.style.maxHeight = "60px";
    img.style.objectFit = "contain";

    card.appendChild(img);

    // bouton delete admin
    if (isAdmin(auth.currentUser)){
      const del = document.createElement("button");
      del.textContent = "✕";
      del.style.position = "absolute";
      del.style.top = "8px";
      del.style.right = "8px";
      del.style.border = "none";
      del.style.background = "#ff3b30";
      del.style.color = "#fff";
      del.style.borderRadius = "50%";
      del.style.width = "24px";
      del.style.height = "24px";
      del.style.cursor = "pointer";

      del.onclick = async () => {
        await deleteDoc(doc(db, "partners", docSnap.id));
        loadPartners();
      };

      card.appendChild(del);
    }

    grid.appendChild(card);
  });
}

btnAdd?.addEventListener("click", async () => {
  const url = prompt("URL du logo (Cloudinary ou autre) :");
  if (!url) return;

  const name = prompt("Nom du partenaire :") || "";

  await addDoc(collection(db, "partners"), {
    logoUrl: url,
    name: name,
    createdAt: serverTimestamp()
  });

  loadPartners();
});

auth.onAuthStateChanged(user => {
  if (isAdmin(user)){
    btnAdd.style.display = "flex";
  }
  loadPartners();
});
