// api/_rest.js — the small Supabase REST helpers the newer endpoints share.
export function restBase() {
  return (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
}

export function restHeaders(extra = {}) {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  const headers = { apikey: key, "Content-Type": "application/json", ...extra };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

export async function select(table, params) {
  const res = await fetch(`${restBase()}/rest/v1/${table}?${new URLSearchParams(params)}`, { headers: restHeaders() });
  if (!res.ok) throw new Error(`Supabase ${table} read failed (${res.status})`);
  return res.json();
}

export async function insert(table, row) {
  const res = await fetch(`${restBase()}/rest/v1/${table}`, {
    method: "POST",
    headers: restHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify([row]),
  });
  if (!res.ok) throw new Error(`Supabase ${table} write failed (${res.status}): ${await res.text().catch(() => "")}`);
}

export async function patch(table, filter, fields) {
  const res = await fetch(`${restBase()}/rest/v1/${table}?${new URLSearchParams(filter)}`, {
    method: "PATCH",
    headers: restHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`Supabase ${table} update failed (${res.status})`);
}

export async function remove(table, filter) {
  const res = await fetch(`${restBase()}/rest/v1/${table}?${new URLSearchParams(filter)}`, {
    method: "DELETE",
    headers: restHeaders({ Prefer: "return=minimal" }),
  });
  if (!res.ok) throw new Error(`Supabase ${table} delete failed (${res.status})`);
}

export function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

export function newId() {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
}
