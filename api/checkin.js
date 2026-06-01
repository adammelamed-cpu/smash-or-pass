import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const ACTIVITY_LABELS = {
  skiing: '⛷️ SKIING',
  lake:   '⛵ LAKE/BOAT',
  golf:   '⛳ GOLF',
  home:   '🏡 HOME DAY',
};

function buildSmsMessage(crewName, dateLabel, baseUrl, tokens) {
  const lines = [
    `SkiBrief 🎿  ${crewName}`,
    ``,
    `${dateLabel} — what's your plan?`,
    ``,
  ];
  for (const [activity, label] of Object.entries(ACTIVITY_LABELS)) {
    lines.push(`${label}: ${baseUrl}/react?t=${tokens[activity]}&a=${activity}`);
  }
  lines.push(``, `Or reply: SKI, LAKE, GOLF, or HOME`);
  return lines.join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { crew_id, profile_id, date } = req.body;
  if (!crew_id || !profile_id || !date) {
    return res.status(400).json({ error: 'crew_id, profile_id, and date required' });
  }

  const db = supabase();

  // Fetch crew + members with phones
  const { data: crew, error: crewErr } = await db.from('crews').select('*').eq('id', crew_id).single();
  if (crewErr) return res.status(404).json({ error: 'Crew not found' });

  const { data: members } = await db
    .from('crew_members')
    .select('profile_id, profiles(id, name, phone)')
    .eq('crew_id', crew_id);

  if (!members?.length) return res.status(400).json({ error: 'No crew members found' });

  // Upsert check-in record (idempotent)
  const { data: checkIn, error: ciErr } = await db
    .from('check_ins')
    .upsert({ crew_id, sent_by: profile_id, date }, { onConflict: 'crew_id,date' })
    .select()
    .single();
  if (ciErr) return res.status(500).json({ error: ciErr.message });

  // Pre-create reaction rows with unique tokens for each member
  const reactionInserts = members.map(m => ({
    check_in_id: checkIn.id,
    profile_id:  m.profile_id,
  }));
  await db.from('reactions')
    .upsert(reactionInserts, { onConflict: 'check_in_id,profile_id', ignoreDuplicates: true });

  // Fetch the reaction tokens we just created
  const { data: reactionRows } = await db
    .from('reactions')
    .select('profile_id, reaction_token')
    .eq('check_in_id', checkIn.id);

  const tokenByProfile = Object.fromEntries((reactionRows || []).map(r => [r.profile_id, r.reaction_token]));

  // Build date label
  const d = new Date(date + 'T12:00:00');
  const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const baseUrl = process.env.APP_BASE_URL || 'https://ski-briefing.vercel.app';

  // Send SMS via Twilio
  const twilioMissing = !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER;
  let smsResults = [];

  if (!twilioMissing) {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    for (const m of members) {
      const phone = m.profiles?.phone;
      const token = tokenByProfile[m.profile_id];
      if (!phone || !token) continue;

      // Build per-person links (each activity gets the same token, activity pre-selected)
      const tokens = Object.fromEntries(Object.keys(ACTIVITY_LABELS).map(a => [a, token]));
      const body = buildSmsMessage(crew.name, dateLabel, baseUrl, tokens);

      try {
        await client.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to: `+1${phone}` });
        smsResults.push({ profile_id: m.profile_id, name: m.profiles?.name, sent: true });
      } catch (err) {
        smsResults.push({ profile_id: m.profile_id, name: m.profiles?.name, sent: false, error: err.message });
      }
    }
  }

  return res.status(200).json({
    check_in: checkIn,
    sms_sent: !twilioMissing,
    sms_results: smsResults,
    members_count: members.length,
    date_label: dateLabel,
  });
}
