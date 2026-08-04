// bt-delete-account — the second half of one-action deletion.
//
// learning-design.md §8.7 requires that a user can delete everything in ONE action,
// and "everything" includes the account itself, not just its rows. Deleting an auth
// user needs the service-role key, which must never ship in an extension, so it lives
// here and nowhere else.
//
// The only authority this function has is over its CALLER. It derives the user id
// from the presented JWT and deletes exactly that id — it accepts no user id as
// input, so there is no parameter to tamper with. `bt_chunks.user_id` is
// `on delete cascade`, so the rows go with the account even if the client's own
// delete pass failed halfway.
//
//   supabase functions deploy bt-delete-account

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'missing bearer token' }, 401);

  // Resolve the caller through GoTrue rather than by decoding the JWT here: decoding
  // would accept a well-formed but revoked or forged token, and this endpoint is the
  // one place where being wrong is unrecoverable.
  const who = await fetch(`${URL_}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: ANON },
  });
  if (!who.ok) return json({ error: 'invalid token' }, 401);
  const user = await who.json();
  if (!user?.id) return json({ error: 'no user' }, 401);

  const del = await fetch(`${URL_}/auth/v1/admin/users/${user.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
  });
  if (!del.ok) {
    return json({ error: 'delete failed', detail: await del.text() }, 500);
  }
  return json({ deleted: user.id });
});
