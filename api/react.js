import { createClient } from '@supabase/supabase-js';

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const ACTIVITY_META = {
  skiing: { emoji: '⛷️', label: 'Skiing',    color: '#00BFFF' },
  lake:   { emoji: '⛵', label: 'Lake/boat',  color: '#38BDF8' },
  golf:   { emoji: '⛳', label: 'Golf',       color: '#A8FF78' },
  home:   { emoji: '🏡', label: 'Home day',   color: '#94A3B8' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = supabase();

  // GET /api/react?t=TOKEN  — get reaction state + crew status for display
  if (req.method === 'GET') {
    const { t: token } = req.query;
    if (!token) return res.status(400).json({ error: 'token required' });

    const { data: reaction, error } = await db
      .from('reactions')
      .select('*, profiles(name), check_ins(date, crew_id)')
      .eq('reaction_token', token)
      .single();
    if (error) return res.status(404).json({ error: 'Reaction not found' });

    // Fetch crew status for this check-in
    const { data: allReactions } = await db
      .from('reactions')
      .select('profile_id, activity, note, reacted_at, profiles(name)')
      .eq('check_in_id', reaction.check_in_id);

    const { data: crew } = await db
      .from('crews')
      .select('name')
      .eq('id', reaction.check_ins?.crew_id)
      .single();

    return res.status(200).json({
      token,
      my_activity: reaction.activity,
      my_name: reaction.profiles?.name,
      date: reaction.check_ins?.date,
      crew_name: crew?.name,
      crew_status: (allReactions || []).map(r => ({
        name: r.profiles?.name,
        activity: r.activity,
        reacted_at: r.reacted_at,
      })),
    });
  }

  // POST /api/react  — submit or update a reaction
  if (req.method === 'POST') {
    let { token, activity, note, profile_id, check_in_id } = req.body;
    if (!activity) return res.status(400).json({ error: 'activity required' });
    if (!ACTIVITY_META[activity]) return res.status(400).json({ error: 'Invalid activity' });

    // Allow lookup by profile_id + check_in_id (in-app logging without an SMS token)
    if (!token && profile_id && check_in_id) {
      const { data: rxn } = await db.from('reactions').select('reaction_token').eq('profile_id', profile_id).eq('check_in_id', check_in_id).single();
      if (rxn) token = rxn.reaction_token;
    }
    if (!token) return res.status(400).json({ error: 'token or profile_id+check_in_id required' });

    const { data: reaction, error: findErr } = await db
      .from('reactions')
      .select('id, check_in_id, profiles(name), check_ins(date, crew_id)')
      .eq('reaction_token', token)
      .single();
    if (findErr) return res.status(404).json({ error: 'Invalid token' });

    const { error: updateErr } = await db
      .from('reactions')
      .update({ activity, note: note || null, reacted_at: new Date().toISOString() })
      .eq('reaction_token', token);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    // Return full crew status
    const { data: allReactions } = await db
      .from('reactions')
      .select('profile_id, activity, note, reacted_at, profiles(name)')
      .eq('check_in_id', reaction.check_in_id);

    const { data: crew } = await db
      .from('crews')
      .select('name')
      .eq('id', reaction.check_ins?.crew_id)
      .single();

    return res.status(200).json({
      ok: true,
      activity,
      my_name: reaction.profiles?.name,
      date: reaction.check_ins?.date,
      crew_name: crew?.name,
      crew_status: (allReactions || []).map(r => ({
        name: r.profiles?.name,
        activity: r.activity,
        reacted_at: r.reacted_at,
      })),
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
