// script.js (PAS un module)

document.addEventListener("DOMContentLoaded", () => {
  const inviteBtn = document.getElementById("inviteBtn");
  if (!inviteBtn) return;

  inviteBtn.addEventListener("click", async () => {
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Ti’Doc",
          text: "Viens voir l’app Ti’Doc 👇",
          url
        });
        return;
      } catch (e) {
        // si l’utilisateur annule ou si ça bug → on fallback
      }
    }

    // fallback : copier lien
    try {
      await navigator.clipboard.writeText(url);
      alert("Lien copié ✅");
    } catch (e) {
      alert("Copie manuelle du lien : " + url);
    }
  });
});