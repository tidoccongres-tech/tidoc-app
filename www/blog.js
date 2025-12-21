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
  limit,
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

// ✅ iPad/Safari: empêche submit HTML si jamais un <form> existe
form?.addEventListener("submit", (e) => e.preventDefault());

// ===== Anti-doublons =====
let postInflight = false;
const commentInflight = new Set(); // postId en cours d'envoi

// ===== Helpers =====

function showMsg(t = "") {
  if (postMsg) postMsg.textContent = t;
}

function requireLogin(actionText = "faire ça") {
  if (!auth.currentUser) {
    alert(
      "Connexion requise 🔒\n\n" +
      "Pour " + actionText + ", connecte-toi."
    );
    return false;
  }
  return true;
}

const nameCache = new Map();

async function getNameByUid(uid, fallback = "Utilisateur") {
  if (!uid) return fallback;
  if (nameCache.has(uid)) return nameCache.get(uid);

  try {
    const snap = await getDoc(doc(db, "users", uid));
    const d = snap.exists() ? (snap.data() || {}) : {};
    const n = (d.displayName || d.username || "").trim();
    const finalName = n || fallback;
    nameCache.set(uid, finalName);
    return finalName;
  } catch {
    return fallback;
  }
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

function isAdminUser() {
  return currentUserEmail() === "tidoc.congres@gmail.com";
}

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
  const cached = (localStorage.getItem("tidoc_name") || "").trim();
  if (cached) return cached;

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

function isAdminEmail(email = "") {
  return email.toLowerCase() === "tidoc.congres@gmail.com";
}

async function createNotif(toUid, payload){
  if (!toUid) return;
  try{
    await addDoc(collection(db, "notifications", toUid, "items"), {
      ...payload,
      read: false,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.log("createNotif error:", e);
  }
}

async function getPostData(postId){
  const snap = await getDoc(doc(db, "posts", postId));
  return snap.exists() ? (snap.data() || null) : null;
}

// ===== Notifications helpers =====
function shouldNotify(toUid) {
  const fromUid = currentUserId();
  if (!fromUid || !toUid) return false;
  // ✅ évite les auto-notifs (si tu veux les autoriser, supprime cette ligne)
  return fromUid !== toUid;
}

async function createNotif({ toUid, type, text, postId }) {
  if (!shouldNotify(toUid)) return;

  const from = auth.currentUser;
  const fromUid = from?.uid || "";
  const fromEmail = from?.email || "";

  await addDoc(collection(db, "notifications", toUid, "items"), {
    toUid,
    fromUid,
    fromEmail,
    type: type || "info",
    text: text || "Notification",
    postId: postId || "",
    read: false,
    createdAt: serverTimestamp(),
  });
}

// ===== LIKE SVG =====
const HEART_SVG = `
<svg viewBox="0 0 16 16" class="heart-icon" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M1.24264 8.24264L8 15L14.7574 8.24264C15.553 7.44699 16 6.36786 16 5.24264V5.05234C16 2.8143 14.1857 1 11.9477 1C10.7166 1 9.55233 1.55959 8.78331 2.52086L8 3.5L7.21669 2.52086C6.44767 1.55959 5.28338 1 4.05234 1C1.8143 1 0 2.8143 0 5.05234V5.24264C0 6.36786 0.44699 7.44699 1.24264 8.24264Z"/>
</svg>
`;

const CROWN_GRAY_SVG = `
<svg viewBox="0 0 24 24" width="14" height="14"
     style="display:inline-block;vertical-align:-2px;margin-left:4px;fill:currentColor;"
     aria-hidden="true">
  <path d="M21.609 13.5616L21.8382 11.1263C22.0182 9.2137 22.1082 8.25739 21.781 7.86207C21.604 7.64823 21.3633 7.5172 21.106 7.4946C20.6303 7.45282 20.0329 8.1329 18.8381 9.49307C18.2202 10.1965 17.9113 10.5482 17.5666 10.6027C17.3757 10.6328 17.1811 10.6018 17.0047 10.5131C16.6865 10.3529 16.4743 9.91812 16.0499 9.04851L13.8131 4.46485C13.0112 2.82162 12.6102 2 12 2C11.3898 2 10.9888 2.82162 10.1869 4.46486L7.95007 9.04852C7.5257 9.91812 7.31351 10.3529 6.99526 10.5131C6.81892 10.6018 6.62434 10.6328 6.43337 10.6027C6.08872 10.5482 5.77977 10.1965 5.16187 9.49307C3.96708 8.1329 3.36968 7.45282 2.89399 7.4946C2.63666 7.5172 2.39598 7.64823 2.21899 7.86207C1.8918 8.25739 1.9818 9.2137 2.16181 11.1263L2.391 13.5616C2.76865 17.5742 2.95748 19.5805 4.14009 20.7902C5.32271 22 7.09517 22 10.6401 22H13.3599C16.9048 22 18.6773 22 19.8599 20.7902C21.0425 19.5805 21.2313 17.5742 21.609 13.5616Z"/>
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

  if (snap.exists()) {
    await deleteDoc(likeRef);
  } else {
    await setDoc(likeRef, { createdAt: serverTimestamp() });

    // ✅ notif "like" à l’auteur du post
    try {
      const postSnap = await getDoc(doc(db, "posts", postId));
      if (postSnap.exists()) {
        const p = postSnap.data() || {};
        const toUid = p.authorUid || "";
        await createNotif({
          toUid,
          type: "like",
          text: `${myBestName()} a aimé ton post`,
          postId
        });
      }
    } catch (_) {}
  }

  await loadPosts();
}

// ===== Comments =====
async function loadComments(postId, postData, containerEl) {
  containerEl.innerHTML = `<div style="opacity:.7;font-size:13px;">Chargement des commentaires…</div>`;

  const qy = query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"));
  const snap = await getDocs(qy);

  if (snap.empty) {
    containerEl.innerHTML = `<div style="opacity:.7;font-size:13px;">Aucun commentaire.</div>`;
    return;
  }

  containerEl.innerHTML = "";

  for (const d of snap.docs) {
    const c = d.data();

    const fallbackName = (c.authorName || "").trim() || displayNameFrom(c.authorEmail || "");
    const prettyName = await getNameByUid(c.authorUid, fallbackName);

    const row = document.createElement("div");
    row.className = "comment";
    row.innerHTML = `
      <div class="comment-row">
        <div>
          <div class="comment-author">
            ${escapeHTML(prettyName)}${isAdminEmail(c.authorEmail) ? `<span class="crown-inline">${CROWN_GRAY_SVG}</span>` : ""}
          </div>
          <div class="comment-text">${escapeHTML(c.text || "")}</div>
        </div>
      </div>
    `;
    containerEl.appendChild(row);
  }
}

async function addComment(postId, postData, inputEl, commentsWrap, sendBtn) {
  if (!requireLogin("commenter")) return;

  const txt = (inputEl?.value || "").trim();
  if (!txt) return;

  if (commentInflight.has(postId)) return;
  commentInflight.add(postId);
  if (sendBtn) sendBtn.disabled = true;

  try {
    const u = auth.currentUser;

    await addDoc(collection(db, "posts", postId, "comments"), {
      text: txt,
      authorUid: u.uid,
      authorEmail: u.email || "",
      authorName: myBestName(),
      createdAt: serverTimestamp()
    });

    // ✅ notif "comment" à l’auteur du post
    try {
      const toUid = postData?.authorUid || "";
      await createNotif({
        toUid,
        type: "comment",
        text: `${myBestName()} a commenté ton post`,
        postId
      });
    } catch (_) {}
    
    // ✅ notif au propriétaire du post (si pas soi-même)
    const p = postData || await getPostData(postId);
    const toUid = p?.authorUid || "";
    if (toUid && toUid !== u.uid) {
      await createNotif(toUid, {
        type: "comment",
        text: `${myBestName()} a commenté ton post`,
        postId,
        fromUid: u.uid
      });
    }

    inputEl.value = "";
    await loadComments(postId, postData, commentsWrap);
  } finally {
    commentInflight.delete(postId);
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ===== Form =====
function showForm(show) {
  if (!form) return;
  form.style.display = show ? "block" : "none";
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
    authorName: myBestName(),
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

  const author = escapeHTML(bestAuthorName(p));
  const isAdmin = isAdminEmail(p.authorEmail);

  card.innerHTML = `
    <div class="post-head">
      <div>
        <div class="post-title">${escapeHTML(p.title || "")}</div>

        <div class="post-sub">
          <span class="post-author">
            ${author}
            ${isAdmin ? `<span class="crown-inline">${CROWN_GRAY_SVG}</span>` : ""}
          </span>
          • ${fmtDate(p.createdAt)}
        </div>
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

  if (delOk) {
    card.querySelector(`[data-del="${postId}"]`)?.addEventListener("click", () => deletePost(postId));
  }

  card.querySelector(`[data-like="${postId}"]`)?.addEventListener("click", () => toggleLike(postId));

  (async () => {
    const count = await getLikesCount(postId);
    const liked = await isLikedByMe(postId);

    const countEl = card.querySelector(`[data-likecount="${postId}"]`);
    const btn = card.querySelector(`[data-like="${postId}"]`);
    if (countEl) countEl.textContent = String(count);
    if (btn) btn.classList.toggle("liked", liked);
  })();

  const wrap = card.querySelector(`[data-commentswrap="${postId}"]`);
  const list = card.querySelector(`[data-commentslist="${postId}"]`);
  const toggleBtn = card.querySelector(`[data-togglecomments="${postId}"]`);

  toggleBtn?.addEventListener("click", async () => {
    const open = wrap.style.display !== "none";
    wrap.style.display = open ? "none" : "";
    if (!open) await loadComments(postId, p, list);
  });

  const uid = currentUserId();
  const input = card.querySelector(`[data-cinput="${postId}"]`);
  const sendBtn = card.querySelector(`[data-csend="${postId}"]`);

  if (!uid) {
    if (input) { input.disabled = true; input.placeholder = "Connecte-toi pour commenter."; }
    if (sendBtn) sendBtn.disabled = true;
  } else {
    sendBtn?.addEventListener("click", () => addComment(postId, p, input, list, sendBtn));
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        addComment(postId, p, input, list, sendBtn);
      }
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
// ===== Boot =====

// bouton créer post
createBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!requireLogin("écrire un post")) return;

  showForm(true);
  form?.scrollIntoView({ behavior: "smooth", block: "start" });
  titleInput?.focus();
});

// annuler
cancelBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  clearForm();
  showForm(false);
});

// publier
submitBtn?.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();

  if (postInflight) return;
  postInflight = true;
  submitBtn.disabled = true;

  try {
    await createPost();
  } catch (err) {
    console.error("createPost error:", err);
    showMsg("Erreur: " + (err?.message || String(err)));
  } finally {
    postInflight = false;
    submitBtn.disabled = false;
  }
});

// auth + chargement posts
onAuthStateChanged(auth, () => loadPosts());
loadPosts();
