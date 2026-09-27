// api/_mail.js — sends the app's few emails (password reset) through Brevo's HTTP API.
//
// Brevo's free plan sends up to 300 emails a day from a single verified sender address, with no
// domain of your own needed — a Gmail address works. Set in Vercel:
//   BREVO_API_KEY   Brevo -> SMTP & API -> API keys
//   MAIL_FROM       the sender address you verified in Brevo (Senders & IP -> Senders)
// Without both, mailConfigured() is false and the app says email recovery isn't set up.

export function mailConfigured() {
  return Boolean((process.env.BREVO_API_KEY || "").trim() && (process.env.MAIL_FROM || "").trim());
}

/** @returns {Promise<boolean>} true once Brevo accepted the message */
export async function sendMail({ to, subject, text, html }) {
  if (!mailConfigured()) return false;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY.trim(), "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "SnapCal", email: process.env.MAIL_FROM.trim() },
        to: [{ email: to }],
        subject,
        textContent: text,
        htmlContent: html,
      }),
    });
    if (!res.ok) console.error(`mail: Brevo HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    return res.ok;
  } catch (err) {
    console.error("mail:", err);
    return false;
  }
}

/** Where links in emails point. Never taken from the request, so a forged Host can't redirect them. */
export function appUrl() {
  const set = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (set) return set;
  const prod = (process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  return prod ? `https://${prod}` : "";
}
