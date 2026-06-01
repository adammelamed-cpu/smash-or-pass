import { createClient } from '@supabase/supabase-js';

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function cleanPhone(raw) {
  return (raw || '').replace(/\D/g, '').slice(-10);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = supabase();

  // GET /api/profile?id=xxx  or  ?phone=xxx
  if (req.method === 'GET') {
    const { id, phone } = req.query;
    if (!id && !phone) return res.status(400).json({ error: 'id or phone required' });

    let q = db.from('profiles').select('*');
    if (id)    q = q.eq('id', id);
    if (phone) q = q.eq('phone', cleanPhone(phone));
    const { data, error } = await q.single();

    if (error) return res.status(404).json({ error: 'Profile not found' });
    return res.status(200).json(data);
  }

  // POST /api/profile  — create or update (upsert on phone)
  if (req.method === 'POST') {
    const { name, phone, home_mountain, departure_city, section_prefs, checkin_time } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });

    const { data, error } = await db
      .from('profiles')
      .upsert(
        { name, phone: cleanPhone(phone), home_mountain, departure_city, section_prefs, checkin_time, updated_at: new Date().toISOString() },
        { onConflict: 'phone' }
      )
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // PUT /api/profile  — partial update by id
  if (req.method === 'PUT') {
    const { id, ...updates } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const { data, error } = await db
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
