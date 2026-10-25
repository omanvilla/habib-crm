// Retired 2026-10-25: the one-off partner-account probe is no longer needed.
// Partner metrics live in instagram-discovery. Delete from the dashboard when convenient.
Deno.serve(() => new Response(JSON.stringify({ ok: false, error: "retired" }), { status: 410, headers: { "content-type": "application/json" } }));
