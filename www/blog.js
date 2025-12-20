// blog.js (MODULE)
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  deleteDoc,
  doc,
  setDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ✅ init
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ===== UI (IDs de ton blog.html) =====
const postsRoot  = document.getElementById("postsRoot");
const createBtn  = document.getElementById("createPostBtn");
const form       = document.getElementById("postForm");
const titleInput = document.getElementById("postTitle");
const textInput  = document.getElementById("postText");
const submitBtn  = document.getElementById("postSubmit");
const cancelBtn  = document.getElementById("postCancel");
const postMsg    = document.getElementById("postMsg");

// ✅ iPad/Safari: empêche le submit HTML du form (qui peut bloquer le clic sur "Publier")
form?.addEventListener("submit", (e) => e.preventDefault());

// ===== Helpers =====
function showMsg(t = "") { if (postMsg) postMsg.textContent = t; }

function requireLogin(actionText = "faire ça") {
  if (!auth.currentUser) {
    alert("Connexion requise 🔒\n\nPour " + actionText + ", connecte-toi.");
    return false;
  }
  return true;
}

function escapeHTML(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    if (!d) return "";
    return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

function currentUserId() { return auth.currentUser?.uid || ""; }
function currentUserEmail() { return (auth.currentUser?.email || "").toLowerCase(); }

// ✅ admin = email exact (comme tes rules)
function isAdminUser() {
  return currentUserEmail() === "tidoc.congres@gmail.com";
}

// ✅ joli nom affiché (évite “Utilisateur”)
function displayNameFrom(email = "") {
  const e = (email || "").trim();
  if (!e) return "Utilisateur";
  return e.split("@")[0] || "Utilisateur";
}

function bestAuthorName(p) {
  const n = (p.authorName || "").trim();
  if (n && n.toLowerCase() !== "utilisateur") return n;
  return displayNameFrom(p.authorEmail || "");
}

function myBestName() {
  const u = auth.currentUser;
  if (!u) return "Utilisateur";
  const dn = (u.displayName || "").trim();
  if (dn) return dn;
  return displayNameFrom(u.email || "");
}

function canDeletePost(p) {
  const uid = currentUserId();
  if (!uid) return false;
  return isAdminUser() || (p.authorUid && p.authorUid === uid);
}

// ===== LIKE SVG =====
const HEART_SVG = `
<svg viewBox="0 0 16 16" class="heart-icon" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M1.24264 8.24264L8 15L14.7574 8.24264C15.553 7.44699 16 6.36786 16 5.24264V5.05234C16 2.8143 14.1857 1 11.9477 1C10.7166 1 9.55233 1.55959 8.78331 2.52086L8 3.5L7.21669 2.52086C6.44767 1.55959 5.28338 1 4.05234 1C1.8143 1 0 2.8143 0 5.05234V5.24264C0 6.36786 0.44699 7.44699 1.24264 8.24264Z"/>
</svg>
`;

// ===== Likes =====
async function getLikesCount(postId) {
  const snap = await getDocs(collection(db, "posts", postId, "likes"));
  return snap.size;
}
async function isLikedByMe(postId) {
  const uid = currentUserId();
  if (!uid) return false;
  const likeRef = doc(db, "posts", postId, "likes", uid);
  const snap = await getDoc(likeRef);
  return snap.exists();
}
async function toggleLike(postId) {
  if (!requireLogin("liker ce post")) return;

  const uid = currentUserId();
  const likeRef = doc(db, "posts", postId, "likes", uid);
  const snap = await getDoc(likeRef);

  if (snap.exists()) await deleteDoc(likeRef);
  else await setDoc(likeRef, { createdAt: serverTimestamp() });

  await loadPosts();
}

// ===== Comments (lecture simple) =====
async function loadComments(postId, postData, containerEl) {
  containerEl.innerHTML = `<div style="opacity:.7;font-size:13px;">Chargement des commentaires…</div>`;

  const qy = query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"));
  const snap = await getDocs(qy);

  if (snap.empty) {
    containerEl.innerHTML = `<div style="opacity:.7;font-size:13px;">Aucun commentaire.</div>`;
    return;
  }

  containerEl.innerHTML = "";
  snap.forEach((d) => {
    const c = d.data();
    const row = document.createElement("div");
    row.className = "comment";
    row.innerHTML = `
      <div class="comment-row">
        <div>
          <div class="comment-author">${escapeHTML(c.authorName || displayNameFrom(c.authorEmail || ""))}</div>
          <div class="comment-text">${escapeHTML(c.text || "")}</div>
        </div>
      </div>
    `;
    containerEl.appendChild(row);
  });
}

async function addComment(postId, postData, inputEl, commentsWrap) {
  if (!requireLogin("commenter")) return;

  const txt = (inputEl.value || "").trim();
  if (!txt) return;

  const u = auth.currentUser;
  await addDoc(collection(db, "posts", postId, "comments"), {
    text: txt,
    authorUid: u.uid,
    authorEmail: u.email || "",
    authorName: (u.displayName || "").trim() || displayNameFrom(u.email || ""),
    createdAt: serverTimestamp()
  });

  inputEl.value = "";
  await loadComments(postId, postData, commentsWrap);
}

// ===== Form =====
function showForm(show) {
  if (!form) return;
  form.style.display = show ? "" : "none";
}
function clearForm() {
  if (titleInput) titleInput.value = "";
  if (textInput) textInput.value = "";
  showMsg("");
}

// ===== Create post =====
async function createPost() {
  if (!requireLogin("publier un post")) return;

  const title = (titleInput?.value || "").trim();
  const text  = (textInput?.value || "").trim();

  if (!title || !text) {
    showMsg("Titre + contenu requis 🙂");
    return;
  }

  const u = auth.currentUser;

  await addDoc(collection(db, "posts"), {
    title,
    text,
    authorUid: u.uid,
    authorEmail: u.email || "",
    authorName: myBestName(),     // ✅ vrai nom si dispo, sinon email prefix
    createdAt: serverTimestamp()
  });

  clearForm();
  showForm(false);
  await loadPosts();
}

// ===== Delete post =====
async function deletePost(postId) {
  if (!confirm("Supprimer ce post ?")) return;
  await deleteDoc(doc(db, "posts", postId));
  await loadPosts();
}

// ===== Render =====
function renderPostCard(postId, p) {
  const delOk = canDeletePost(p);

  const card = document.createElement("section");
  card.className = "card post-card";

  card.innerHTML = `
    <div class="post-head">
      <div>
        <div class="post-title">${escapeHTML(p.title || "")}</div>
        <div class="post-sub">${escapeHTML(bestAuthorName(p))} • ${fmtDate(p.createdAt)}</div>
      </div>
      ${delOk ? `<button class="delete-btn" type="button" data-del="${postId}">Supprimer</button>` : ""}
    </div>

    <div class="post-body">${escapeHTML(p.text || "")}</div>

    <div class="post-actions">
      <button class="like-btn" type="button" data-like="${postId}">
        ${HEART_SVG}
      </button>
      <span class="like-count" data-likecount="${postId}">…</span>

      <button class="btn-outline" type="button" data-togglecomments="${postId}">
        Commentaires
      </button>
    </div>

    <div class="comments" data-commentswrap="${postId}" style="display:none;">
      <div data-commentslist="${postId}" style="margin-top:8px;"></div>

      <div class="comment-form" style="margin-top:10px;">
        <input type="text" placeholder="Écrire un commentaire…" data-cinput="${postId}" />
        <button class="btn-primary" type="button" data-csend="${postId}" style="height:40px;">Envoyer</button>
      </div>
    </div>
  `;

  // delete
  if (delOk) {
    card.querySelector(`[data-del="${postId}"]`)?.addEventListener("click", () => deletePost(postId));
  }

  // like
  card.querySelector(`[data-like="${postId}"]`)?.addEventListener("click", () => toggleLike(postId));

  (async () => {
    const count = await getLikesCount(postId);
    const liked = await isLikedByMe(postId);

    const countEl = card.querySelector(`[data-likecount="${postId}"]`);
    const btn = card.querySelector(`[data-like="${postId}"]`);
    if (countEl) countEl.textContent = String(count);
    if (btn) btn.classList.toggle("liked", liked);
  })();

  // comments toggle
  const wrap = card.querySelector(`[data-commentswrap="${postId}"]`);
  const list = card.querySelector(`[data-commentslist="${postId}"]`);
  const toggleBtn = card.querySelector(`[data-togglecomments="${postId}"]`);

  toggleBtn?.addEventListener("click", async () => {
    const open = wrap.style.display !== "none";
    wrap.style.display = open ? "none" : "";
    if (!open) await loadComments(postId, p, list);
  });

  // add comment
  const uid = currentUserId();
  const input = card.querySelector(`[data-cinput="${postId}"]`);
  const sendBtn = card.querySelector(`[data-csend="${postId}"]`);

  if (!uid) {
    if (input) { input.disabled = true; input.placeholder = "Connecte-toi pour commenter."; }
    if (sendBtn) sendBtn.disabled = true;
  } else {
    sendBtn?.addEventListener("click", () => addComment(postId, p, input, list));
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addComment(postId, p, input, list);
    });
  }

  return card;
}

async function loadPosts() {
  if (!postsRoot) return;

  postsRoot.innerHTML = `<section class="card"><p>Chargement…</p></section>`;

  const qy = query(collection(db, "posts"), orderBy("createdAt", "desc"));
  const snap = await getDocs(qy);

  postsRoot.innerHTML = "";
  if (snap.empty) {
    postsRoot.innerHTML = `<section class="card"><p>Aucun post pour l’instant.</p></section>`;
    return;
  }

  snap.forEach((d) => postsRoot.appendChild(renderPostCard(d.id, d.data())));
}

// ===== Boot =====
document.addEventListener("DOMContentLoaded", () => {
  createBtn?.addEventListener("click", () => {
    if (!requireLogin("écrire un post")) return;
    showForm(true);
    titleInput?.focus();
  });

  cancelBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    clearForm();
    showForm(false);
  });

  // 🔥 FIX iPad / Safari : double écoute pointer + click
  submitBtn?.addEventListener("pointerup", (e) => {
    e.preventDefault();
    e.stopPropagation();
    createPost();
  });

  submitBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    createPost();
  });

  onAuthStateChanged(auth, () => loadPosts());
  loadPosts();
});
