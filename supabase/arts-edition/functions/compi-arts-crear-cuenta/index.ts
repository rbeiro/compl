// Crea la cuenta de un empleado con correo y contrasena generados. Solo el ejecutivo (rango 1) de su hotel.
// La clave de administrador permanece en el servidor. La contrasena se devuelve una vez y nunca se registra ni se guarda.
const base = Deno.env.get("SUPABASE_URL")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const site = "https://compi-hotel-arts.leonardo-vincere.chatgpt.site";
const origins = [site, "https://compichef.com", "https://compi-web.mcgradi3000.workers.dev", "http://127.0.0.1:4173", "http://localhost:4173"];
const adminHeaders = {apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json"};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // sin 0/O, 1/l/I

// 16 caracteres con CSPRNG, sin sesgo (rechazo) y con mayuscula, minuscula y cifra.
function generatePassword(): string {
  while (true) {
    let out = "";
    while (out.length < 16) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      for (const b of bytes) { if (b < 228 && out.length < 16) out += alphabet[b % alphabet.length]; }
    }
    if (/[A-Z]/.test(out) && /[a-z]/.test(out) && /[2-9]/.test(out)) return out;
  }
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("Content-Length")) > 4096) throw 413;
  const text = await req.text();
  if (text.length > 4096) throw 413;
  try { const value = JSON.parse(text); if (value && typeof value === "object" && !Array.isArray(value)) return value; } catch { /* 400 */ }
  throw 400;
}
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length >= 1 && value.length <= max ? value : null;

Deno.serve(async (req) => {
  const headers = new Headers({"Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin"});
  const reply = (status: number, data: object = {}) => new Response(JSON.stringify(data), {status, headers});
  const origin = req.headers.get("origin");
  if (origin && !origins.includes(origin)) return reply(403);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  if (req.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Headers", "apikey,content-type,authorization");
    headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
    return new Response(null, {status: 204, headers});
  }
  if (req.method !== "POST") return reply(405);

  let createdUser: string | null = null;
  try {
    const bearer = /^Bearer ([A-Za-z0-9._-]{20,4000})$/.exec(req.headers.get("authorization") || "")?.[1];
    if (!bearer) return reply(401);
    const input = await readJson(req);
    const hotel = typeof input.h === "string" && /^[a-z0-9-]{3,60}$/.test(input.h) ? input.h : null;
    const requestId = typeof input.request_id === "string" && uuid.test(input.request_id) ? input.request_id : null;
    const given = text(input.given_name, 60), surname = text(input.surname, 60);
    const position = text(input.position_name, 120), outlet = text(input.outlet_name, 120);
    const rank = Number.isInteger(input.access_rank) && (input.access_rank === 2 || input.access_rank === 3) ? input.access_rank : null;
    if (!hotel || !requestId || !given || !surname || !position || !outlet || !rank) return reply(400);

    // Quien llama: su identidad sale de su propio token, nunca del cuerpo de la peticion.
    const who = await fetch(base + "/auth/v1/user", {headers: {apikey: anon, Authorization: "Bearer " + bearer}});
    if (!who.ok) return reply(401);
    const creator = (await who.json())?.id;
    if (typeof creator !== "string" || !uuid.test(creator)) return reply(401);

    // El registro del empleado se hace con el token del ejecutivo: la base de datos exige rango 1 en ese hotel.
    const register = await fetch(base + "/rest/v1/rpc/compi_register_employee", {
      method: "POST", headers: {apikey: anon, Authorization: "Bearer " + bearer, "Content-Type": "application/json"},
      body: JSON.stringify({h: hotel, request_id: requestId, given_name: given, surname, position_name: position, outlet_name: outlet, access_rank: rank}),
    });
    if (!register.ok) return reply(register.status === 400 ? 400 : register.status >= 500 ? 503 : 403);
    const email = await register.json();
    if (typeof email !== "string" || !/^[a-z0-9._+-]+@compichef\.com$/.test(email)) return reply(503);

    const rows = await (await fetch(base + "/rest/v1/compi_staff?id=eq." + requestId + "&select=id,email,hotel_key,user_id,invite_state", {headers: adminHeaders})).json();
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!row || row.email !== email || row.hotel_key !== hotel) return reply(503);
    if (row.user_id || row.invite_state !== "prepared") return reply(409, {error: "already_created"}); // la contrasena no se puede volver a mostrar

    const password = generatePassword();
    const create = await fetch(base + "/auth/v1/admin/users", {
      method: "POST", headers: adminHeaders, redirect: "error",
      body: JSON.stringify({email, password, email_confirm: true}),
    });
    if (!create.ok) return reply(create.status === 422 ? 409 : 503);
    createdUser = (await create.json())?.id ?? null;
    if (typeof createdUser !== "string") return reply(503);

    const link = await fetch(base + "/rest/v1/rpc/compi_link_created_account", {
      method: "POST", headers: adminHeaders, body: JSON.stringify({employee: requestId, uid: createdUser, creator}),
    });
    if (!link.ok) {
      await fetch(base + "/auth/v1/admin/users/" + createdUser, {method: "DELETE", headers: adminHeaders}); // sin cuentas huerfanas
      createdUser = null;
      return reply(link.status === 429 ? 429 : link.status === 409 ? 409 : link.status === 403 ? 403 : 503);
    }
    createdUser = null;
    return reply(200, {email, password, must_change: true});
  } catch (e) {
    if (createdUser) await fetch(base + "/auth/v1/admin/users/" + createdUser, {method: "DELETE", headers: adminHeaders}).catch(() => {});
    return reply(typeof e === "number" ? e : 503);
  }
});
