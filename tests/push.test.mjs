// push.test.mjs — the hand-rolled Web Push crypto must match the RFC exactly, or phones
// silently drop every notification.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const kp = crypto.createECDH("prime256v1"); kp.generateKeys();
process.env.VAPID_PUBLIC_KEY = kp.getPublicKey().toString("base64url");
process.env.VAPID_PRIVATE_KEY = kp.getPrivateKey().toString("base64url");
const { encryptPayload, vapidAuth, pushConfigured } = await import("../api/_push.js");

test("RFC 8291 Appendix A test vector", () => {
  const e = crypto.createECDH("prime256v1");
  e.setPrivateKey(Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"));
  const out = encryptPayload("When I grow up, I want to be a watermelon",
    { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
    { salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"), ecdh: e });
  assert.equal(out.toString("base64url"),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("VAPID token is a valid ES256 JWT for the push service's origin", () => {
  assert.equal(pushConfigured(), true);
  const header = vapidAuth("https://web.push.apple.com/QGuQyavXutnMH/abc");
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, process.env.VAPID_PUBLIC_KEY);
  const [h, c, s] = jwt.split(".");
  const pub = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: kp.getPublicKey().subarray(1, 33).toString("base64url"), y: kp.getPublicKey().subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
  const claims = JSON.parse(Buffer.from(c, "base64url"));
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400);
});

test("notification text exists in both languages", async () => {
  const { readFileSync } = await import("node:fs");
  const en = JSON.parse(readFileSync(new URL("../i18n/en.json", import.meta.url)));
  const es = JSON.parse(readFileSync(new URL("../i18n/es.json", import.meta.url)));
  assert.deepEqual(Object.keys(en.push), Object.keys(es.push));
  assert.deepEqual(Object.keys(en.whatsNew), Object.keys(es.whatsNew));
});
