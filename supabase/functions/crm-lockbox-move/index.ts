// SQL137 (18 Nov 2026, Ahmed's review [75]): one-off copy of the key-box photos from the PUBLIC bucket property-images
// to the private bucket property-keys. For each property whose lockbox_image_url is still a public URL of its own
// company/property folder, the file is downloaded and uploaded under the same path in property-keys, then the column
// gets that path (only if it did not change meanwhile). Idempotent: running it again does nothing. Nothing is deleted:
// the old public files stay until Ahmed says yes (they are returned in `old_public_files`).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const MARK = "/storage/v1/object/public/property-images/";
const PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "post_only" }, 405);
  const rows = await db.from("properties").select("id,company_id,lockbox_image_url").like("lockbox_image_url", "https://%" + MARK + "%");
  if (rows.error) return json({ ok: false, error: rows.error.message }, 500);
  const moved: unknown[] = [], skipped: unknown[] = [], old_public_files: string[] = [];
  for (const p of rows.data || []) {
    const url = String(p.lockbox_image_url);
    let path = "";
    try { path = decodeURIComponent(url.slice(url.indexOf(MARK) + MARK.length).split("?")[0]); } catch { path = ""; }
    const [co, prop] = path.split("/");
    if (!PATH.test(path) || co !== p.company_id || prop !== p.id) { skipped.push({ id: p.id, why: "path_not_own_folder" }); continue; }
    const dl = await db.storage.from("property-images").download(path);
    if (dl.error || !dl.data) { skipped.push({ id: p.id, why: "download_failed" }); continue; }
    const up = await db.storage.from("property-keys").upload(path, dl.data, { contentType: dl.data.type || "image/jpeg", upsert: false });
    if (up.error && !/exists|duplicate/i.test(up.error.message)) { skipped.push({ id: p.id, why: "upload_failed: " + up.error.message }); continue; }
    const upd = await db.from("properties").update({ lockbox_image_url: path }).eq("id", p.id).eq("lockbox_image_url", url).select("id");
    if (upd.error || !(upd.data || []).length) { skipped.push({ id: p.id, why: "row_changed" }); continue; }
    moved.push({ id: p.id, path });
    old_public_files.push("property-images/" + path);
  }
  return json({ ok: true, moved, skipped, old_public_files });
});
