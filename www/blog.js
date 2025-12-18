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
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ✅ évite double init
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ====== UI (adapte si tes IDs diffèrent) ======
const postsRoot =
  document.getElementById("postsRoot") ||
  document.getElementById("postsList") ||
  document.getElementById("postsContainer");

const createBtn =
  document.getElementById("createPostBtn") ||
  document.querySelector(".create-post");

const form =
  document.getElementById("postForm") ||
  document.getElementById("createPostForm");

const titleInput =
  document.getElementById("postTitle") ||
  document.getElementById("titleInput");

const textInput =
  document.getElementById("postText") ||
  document.getElementById("contentInput");

const submitBtn =
  document.getElementById("postSubmit") ||
  document.getElementById("submitPostBtn");

const cancelBtn =
  document.getElementById("postCancel") ||
  document.getElementById("cancelPostBtn");

// ====== Helpers ======
function isAdmin() {
  return !!window.TIDOC_AUTH?.isAdmin;
}

function requireLogin(actionText = "faire ça") {
  if (!auth.currentUser) {
    alert(
      "Connexion requise 🔒\n\n" +
      `Pour ${actionText}, connecte-toi avec Google via l’icône Profil (en haut à gauche).`
    );
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

function currentUserId() {
  return auth.currentUser?.uid || "";
}
function currentUserEmail() {
  return (auth.currentUser?.email || "").toLowerCase();
}

function canDeletePost(post) {
  const uid = currentUserId();
  const email = currentUserEmail();
  const owner =
    (post.authorUid && post.authorUid === uid) ||
    (post.authorEmail && post.authorEmail.toLowerCase() === email);

  return isAdmin() || owner;
}

// ✅ Admin OR auteur du commentaire OR (bonus) propriétaire du post
function canDeleteComment(comment, post) {
  const uid = currentUserId();
  const email = currentUserEmail();

  const isCommentOwner =
    (comment.authorUid && comment.authorUid === uid) ||
    (comment.authorEmail && comment.authorEmail.toLowerCase() === email);

  const isPostOwner =
    (post.authorUid && post.authorUid === uid) ||
    (post.authorEmail && post.authorEmail.toLowerCase() === email);

  return isAdmin() || isCommentOwner || isPostOwner;
}

function showForm(show) {
  if (!form) return;
  form.style.display = show ? "" : "none";
}
function clearForm() {
  if (titleInput) titleInput.value = "";
  if (textInput) textInput.value = "";
}

// ====== Likes ======
async function getLikesCount(postId) {
  const snap = await getDocs(collection(db, "posts", postId, "likes"));
  return snap.size;
}

async function isLikedByMe(postId) {
  const uid = currentUserId();
  if (!uid) return false;
  const ref = doc(db, "posts", postId, "likes", uid);
  const snap = await getDoc(ref);
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
  }

  await loadPosts();
}

// ====== Comments ======
async function loadComments(postId, postData, containerEl) {
  containerEl.innerHTML = `<div style="opacity:.7;font-size:13px;">Chargement des commentaires…</div>`;

  const qy = query(
    collection(db, "posts", postId, "comments"),
    orderBy("createdAt", "asc")
  );
  const snap = await getDocs(qy);

  if (snap.empty) {
    containerEl.innerHTML = `<div style="opacity:.7;font-size:13px;">Aucun commentaire.</div>`;
    return;
  }

  const uid = currentUserId();

  containerEl.innerHTML = "";
  snap.forEach((d) => {
    const c = d.data();
    const canDel = !!uid && canDeleteComment(c, postData);

    const row = document.createElement("div");
    row.className = "comment";

    row.innerHTML = `
      <div class="comment-row">
        <div>
          <div class="comment-author">${escapeHTML(c.authorName || "Utilisateur")}</div>
          <div class="comment-text">${escapeHTML(c.text || "")}</div>
        </div>
        ${canDel ? `<button class="comment-del" type="button" data-cdel="${d.id}">Supprimer</button>` : ""}
      </div>
    `;

    containerEl.appendChild(row);

    if (canDel) {
      row.querySelector(`[data-cdel="${d.id}"]`)?.addEventListener("click", async () => {
        if (!confirm("Supprimer ce commentaire ?")) return;
        await deleteDoc(doc(db, "posts", postId, "comments", d.id));
        await loadComments(postId, postData, containerEl);
      });
    }
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
    authorName: u.displayName || "Utilisateur",
    createdAt: serverTimestamp()
  });

  inputEl.value = "";
  await loadComments(postId, postData, commentsWrap);
}

// ====== Posts ======
async function deletePost(postId) {
  if (!confirm("Supprimer ce post ?")) return;
  await deleteDoc(doc(db, "posts", postId));
  await loadPosts();
}

function renderPostCard(postId, p) {
  const uid = currentUserId();
  const delOk = !!uid && canDeletePost(p);

  const card = document.createElement("section");
  card.className = "card post-card";

  card.innerHTML = `
    <div class="post-head">
      <div>
        <div class="post-title">${escapeHTML(p.title || "")}</div>
        <div class="post-sub">${escapeHTML(p.authorName || "Utilisateur")} • ${fmtDate(p.createdAt)}</div>
      </div>
      ${delOk ? `<button class="delete-btn" type="button" data-del="${postId}">Supprimer</button>` : ""}
    </div>

    <div class="post-body">${escapeHTML(p.text || "")}</div>

    <div class="post-actions">
      <button class="like-btn" type="button" data-like="${postId}">❤</button>
      <span class="like-meta" data-likecount="${postId}">…</span>

      <button class="btn-outline" type="button" data-togglecomments="${postId}" style="height:36px;">
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

  // delete post
  if (delOk) {
    card.querySelector(`[data-del="${postId}"]`)?.addEventListener("click", () => deletePost(postId));
  }

  // like + count + liked state
  (async () => {
    const count = await getLikesCount(postId);
    const liked = await isLikedByMe(postId);

    const countEl = card.querySelector(`[data-likecount="${postId}"]`);
    const likeBtn = card.querySelector(`[data-like="${postId}"]`);

    if (countEl) countEl.textContent = `${count} like${count > 1 ? "s" : ""}`;
    if (likeBtn) likeBtn.classList.toggle("liked", liked);
  })();

  card.querySelector(`[data-like="${postId}"]`)?.addEventListener("click", () => toggleLike(postId));

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
  const input = card.querySelector(`[data-cinput="${postId}"]`);
  const sendBtn = card.querySelector(`[data-csend="${postId}"]`);

  // si pas connecté → désactive visuellement
  if (!uid) {
    if (input) {
      input.disabled = true;
      input.placeholder = "Connecte-toi pour commenter.";
    }
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

  snap.forEach((d) => {
    const p = d.data();
    postsRoot.appendChild(renderPostCard(d.id, p));
  });
}

async function createPost() {
  if (!requireLogin("publier un post")) return;

  const title = (titleInput?.value || "").trim();
  const text = (textInput?.value || "").trim();

  if (!title || !text) {
    alert("Titre + texte requis 🙂");
    return;
  }

  const u = auth.currentUser;

  await addDoc(collection(db, "posts"), {
    title,
    text,
    authorUid: u.uid,
    authorEmail: u.email || "",
    authorName: u.displayName || "Utilisateur",
    createdAt: serverTimestamp()
  });

  clearForm();
  showForm(false);
  await loadPosts();
}

// ====== Boot ======
document.addEventListener("DOMContentLoaded", () => {
  // ouverture du formulaire
  createBtn?.addEventListener("click", () => {
    if (!requireLogin("écrire un post")) return;
    showForm(true);
  });

  cancelBtn?.addEventListener("click", () => {
    clearForm();
    showForm(false);
  });

  submitBtn?.addEventListener("click", createPost);

  // état auth → reload posts (et permissions)
  onAuthStateChanged(auth, () => loadPosts());

  // premier chargement
  loadPosts();
});

