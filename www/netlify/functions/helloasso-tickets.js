export async function handler(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) {
      return json(400, { error: "Missing email" });
    }

    // Env Netlify
    const clientId = process.env.HELLOASSO_CLIENT_ID;
    const clientSecret = process.env.HELLOASSO_CLIENT_SECRET;
    const organizationSlug = process.env.HELLOASSO_ORG_SLUG;

    if (!clientId || !clientSecret || !organizationSlug) {
      return json(500, { error: "Missing HELLOASSO env vars" });
    }

    // 1) OAuth token (HelloAsso)
    const tokenRes = await fetch("https://api.helloasso.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret
      })
    });

    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      return json(500, { error: "Token error", details: t });
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    // 2) Cherche des paiements récents de l'orga
    // On récupère une page et on filtre par email (simple pour démarrer).
    const paymentsUrl =
      `https://api.helloasso.com/v5/organizations/${encodeURIComponent(organizationSlug)}/payments?pageIndex=1&pageSize=50`;

    const payRes = await fetch(paymentsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!payRes.ok) {
      const t = await payRes.text();
      return json(500, { error: "Payments error", details: t });
    }

    const payJson = await payRes.json();
    const items = Array.isArray(payJson?.data) ? payJson.data : [];

    // 3) Trouve un paiement qui correspond à l’email
    const match = items.find(p => {
      const payerEmail =
        (p?.payer?.email || p?.payerEmail || p?.email || "").toString().toLowerCase();
      return payerEmail === email;
    });

    if (!match) {
      return json(200, { found: false });
    }

    // 4) Déduire le pack d'après le libellé / produit
    // ⚠️ À adapter à TES libellés HelloAsso (Essentiel/Standard/Premium)
    const label =
      (match?.items?.[0]?.name || match?.order?.formName || match?.paymentReceiptUrl || "").toString().toLowerCase();

    let ticketType = null;
    if (label.includes("essentiel")) ticketType = "essentiel";
    if (label.includes("standard")) ticketType = "standard";
    if (label.includes("premium")) ticketType = "premium";

    // Si impossible de deviner -> renvoie "found" mais pas de pack
    if (!ticketType) {
      return json(200, {
        found: true,
        email,
        helloassoOrderId: match?.order?.id || match?.id || ""
      });
    }

    // 5) Quotas fixes (comme ton Firestore ticketTypes)
    // (On met ça ici pour que ça marche tout de suite, puis après on pourra lire Firestore.)
    const quotas = {
      essentiel: { workshopsAllowed: 1, conferencesAllowed: 2 },
      standard: { workshopsAllowed: 2, conferencesAllowed: 4 },
      premium: { workshopsAllowed: 3, conferencesAllowed: 7 }
    };

    return json(200, {
      found: true,
      email,
      ticketType,
      ...quotas[ticketType],
      helloassoOrderId: match?.order?.id || match?.id || ""
    });

  } catch (e) {
    return json(500, { error: "Server error", details: String(e) });
  }
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(obj)
  };
}
