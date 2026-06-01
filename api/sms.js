// Twilio inbound SMS webhook
// Configure at: twilio.com → Phone Numbers → your number → Messaging → Webhook
// Set to: POST https://your-app.vercel.app/api/sms

import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const KEYWORD_MAP = {
  SKI:    'skiing',
  SKIING: 'skiing',
  SNOW:   'skiing',
  LAKE:   'lake',
  BOAT:   'lake',
  GOLF:   'golf',
  HOME:   'home',
  OUT:    'home',
  SKIP:   'home',
  NO:     'home',
};

const REPLY_LABELS = {
  skiing: "⛷️ Skiing — your crew will see you're in!",
  lake:   "⛵ Lake/boat — enjoy the water!",
  golf:   "⛳ Golf — have a great round!",
  home:   "🏡 Home day — see you next time!",
};

export default async function handler(req, res) {
  // Twilio sends form-encoded POST
  if (req.method !== 'POST') return res.status(405).send('');

  const db  = supabase();
  const twiml = new twilio.twiml.MessagingResponse();

  const from = (req.body?.From || '').replace(/\D/g, '').slice(-10);
  const body = (req.body?.Body || '').trim().toUpperCase().split(/\s+/)[0];

  const activity = KEYWORD_MAP[body];
  if (!activity) {
    twiml.message('Reply SKI, LAKE, GOLF, or HOME to log your plan for the day.');
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml.toString());
  }

  // Look up profile by phone
  const { data: profile } = await db.from('profiles').select('id').eq('phone', from).single();
  if (!profile) {
    twiml.message("Couldn't find your SkiBrief account. Open the app to get started.");
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml.toString());
  }

  // Find their latest pending reaction (most recent check-in they haven't responded to)
  const { data: reaction } = await db
    .from('reactions')
    .select('reaction_token, check_in_id, check_ins(date)')
    .eq('profile_id', profile.id)
    .is('activity', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!reaction) {
    // Already responded or no pending check-in — update their most recent reaction
    const { data: latest } = await db
      .from('reactions')
      .select('reaction_token, check_in_id')
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (latest) {
      await db.from('reactions')
        .update({ activity, reacted_at: new Date().toISOString() })
        .eq('reaction_token', latest.reaction_token);
    }
  } else {
    await db.from('reactions')
      .update({ activity, reacted_at: new Date().toISOString() })
      .eq('reaction_token', reaction.reaction_token);
  }

  twiml.message(`Got it! ${REPLY_LABELS[activity]}`);
  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(twiml.toString());
}
