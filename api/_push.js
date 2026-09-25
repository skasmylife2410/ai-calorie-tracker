// api/_push.js — Web Push with no dependencies: VAPID signing (RFC 8292) and payload
// encryption (RFC 8291, aes128gcm), using Node's built-in crypto. Works for iPhone home-screen
// apps (iOS 16.4+), Android Chrome and desktop browsers alike.
//
// Env (Vercel):
//   VAPID_PUBLIC_KEY   65-byte uncompressed P-256 point, base64url (the phone subscribes with it)
//   VAPID_PRIVATE_KEY  32-byte private scalar, base64url (never leaves the server)
//   VAPID_SUBJECT      optional; mailto: or https: contact for the push services
//
// Subscriptions live in snapcal_push_subs (one row per phone). A phone that has uninstalled
// or revoked permission answers 404/410 and its row is deleted on the spot.

import crypto from "node:crypto";
import { select, remove, patch, restBase } from "./_rest.js";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(String(s || ""), "base64url");

export function pushConfigured() {
  return unb64u(process.env.VAPID_PUBLIC_KEY).length === 65 && unb64u(process.env.VAPID_PRIVATE_KEY).length === 32;
}

export function publicKey() {
  return (process.env.VAPID_PUBLIC_KEY || "").trim();
}

function vapidPrivateKey() {
  const pub = unb64u(process.env.VAPID_PUBLIC_KEY);
  return crypto.createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: b64u(unb64u(process.env.VAPID_PRIVATE_KEY)), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: "jwk",
  });
}

/** Authorization header value for one push service (aud = the endpoint's origin). */
export function vapidAuth(endpoint, { now = Date.now(), key = vapidPrivateKey() } = {}) {
  const subject = (process.env.VAPID_SUBJECT || "https://ai-calorie-tracker-gules.vercel.app").trim();
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${publicKey()}`;
}

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

/** RFC 8291 encryption of `plaintext` for one subscription. Returns the full request body. */
export function encryptPayload(plaintext, { p256dh, auth }, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const server = ecdh ?? crypto.createECDH("prime256v1");
  if (!ecdh) server.generateKeys();
  const asPublic = server.getPublicKey();
  const shared = server.computeSecret(uaPublic);

  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** Sends one message to one subscription row. Resolves to the HTTP status (0 = network error). */
export async function sendOne(sub, message, { ttl = 24 * 3600, key } = {}) {
  const payload = encryptPayload(JSON.stringify(message), sub);
  try {
    const r = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuth(sub.endpoint, { key }),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttl),
        Urgency: "normal",
      },
      body: payload,
    });
    return r.status;
  } catch {
    return 0;
  }
}

/**
 * Notifies people. `messageFor(lang)` returns { title, body, url?, tag? } in "en" or "es";
 * each phone gets the language it subscribed in. Never throws: notifications are a nicety and
 * must not break the post, comment or job that triggered them.
 */
export async function notify(owners, messageFor) {
  const list = [...new Set((owners ?? []).filter(Boolean))];
  if (!list.length || !pushConfigured() || !restBase()) return { sent: 0 };
  try {
    const subs = await select("snapcal_push_subs", { select: "endpoint,owner,p256dh,auth,lang", owner: `in.(${list.map((o) => `"${o}"`).join(",")})`, limit: "200" });
    const key = vapidPrivateKey();
    const results = await Promise.all(subs.map(async (s) => {
      const status = await sendOne(s, messageFor(s.lang === "es" ? "es" : "en"), { key });
      if (status === 404 || status === 410) await remove("snapcal_push_subs", { endpoint: `eq.${s.endpoint}` }).catch(() => {});
      else if (status >= 200 && status < 300) await patch("snapcal_push_subs", { endpoint: `eq.${s.endpoint}` }, { last_ok_at: new Date().toISOString() }).catch(() => {});
      return status;
    }));
    return { sent: results.filter((s) => s >= 200 && s < 300).length, of: subs.length };
  } catch (err) {
    console.warn("push: notify failed", err?.message ?? err);
    return { sent: 0, error: String(err?.message ?? err) };
  }
}

/** Display name (falls back to the username) for notification text. */
export async function displayName(username) {
  try {
    const [row] = await select("snapcal_profile", { select: "data", owner: `eq.${username}`, limit: "1" });
    const name = String(row?.data?.displayName ?? "").trim();
    return name || username.replace(/(^|[-_])([a-z])/g, (_, sep, c) => (sep ? " " : "") + c.toUpperCase());
  } catch {
    return username;
  }
}
