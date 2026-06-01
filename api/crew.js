import { createClient } from '@supabase/supabase-js';

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = supabase();

  // GET /api/crew?id=xxx  or  ?code=XXXX
  // Returns crew + members + latest check-in reactions
  if (req.method === 'GET') {
    const { id, code } = req.query;
    if (!id && !code) return res.status(400).json({ error: 'id or code required' });

    let q = db.from('crews').select('*');
    if (id)   q = q.eq('id', id);
    if (code) q = q.eq('invite_code', code.toUpperCase());
    const { data: crew, error: crewErr } = await q.single();
    if (crewErr) return res.status(404).json({ error: 'Crew not found' });

    // Members
    const { data: members } = await db
      .from('crew_members')
      .select('profile_id, joined_at, profiles(id, name, phone)')
      .eq('crew_id', crew.id);

    // Latest check-in for tomorrow or today
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    const todayStr    = new Date().toISOString().slice(0, 10);

    const { data: checkIn } = await db
      .from('check_ins')
      .select('*')
      .eq('crew_id', crew.id)
      .in('date', [tomorrowStr, todayStr])
      .order('date', { ascending: false })
      .limit(1)
      .single();

    let reactions = [];
    if (checkIn) {
      const { data: rxns } = await db
        .from('reactions')
        .select('profile_id, activity, note, reacted_at')
        .eq('check_in_id', checkIn.id);
      reactions = rxns || [];
    }

    return res.status(200).json({
      crew,
      members: (members || []).map(m => ({
        profile_id: m.profile_id,
        name: m.profiles?.name,
        joined_at: m.joined_at,
      })),
      check_in: checkIn || null,
      reactions,
    });
  }

  // POST /api/crew  — create a new crew
  if (req.method === 'POST') {
    const { name, profile_id } = req.body;
    if (!name || !profile_id) return res.status(400).json({ error: 'name and profile_id required' });

    const { data: crew, error } = await db
      .from('crews')
      .insert({ name, created_by: profile_id })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // Auto-join creator
    await db.from('crew_members').insert({ crew_id: crew.id, profile_id });

    return res.status(201).json(crew);
  }

  // PATCH /api/crew  — join a crew by invite code
  if (req.method === 'PATCH') {
    const { invite_code, profile_id } = req.body;
    if (!invite_code || !profile_id) return res.status(400).json({ error: 'invite_code and profile_id required' });

    const { data: crew, error: crewErr } = await db
      .from('crews')
      .select('*')
      .eq('invite_code', invite_code.toUpperCase())
      .single();
    if (crewErr) return res.status(404).json({ error: 'Crew not found — check the code and try again' });

    const { error: joinErr } = await db
      .from('crew_members')
      .upsert({ crew_id: crew.id, profile_id }, { onConflict: 'crew_id,profile_id' });
    if (joinErr) return res.status(500).json({ error: joinErr.message });

    return res.status(200).json(crew);
  }

  // DELETE /api/crew  — leave a crew
  if (req.method === 'DELETE') {
    const { crew_id, profile_id } = req.body;
    if (!crew_id || !profile_id) return res.status(400).json({ error: 'crew_id and profile_id required' });

    await db.from('crew_members').delete().match({ crew_id, profile_id });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
