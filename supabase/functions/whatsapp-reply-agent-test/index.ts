// Retired test copy of whatsapp-reply-agent. Kept only until it is deleted from the dashboard.
Deno.serve(() => new Response(JSON.stringify({ ok: false, error: "retired" }), { status: 410, headers: { "content-type": "application/json" } }));
