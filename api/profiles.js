const { put, list } = require('@vercel/blob');

const BLOB_NAME = 'smash-profiles.json';

// Vercel may name the token BLOB_READ_WRITE_TOKEN or BLOB_READ_WRITE_TOKEN_<STORE>
function getToken() {
  const envKeys = Object.keys(process.env);
  const key = envKeys.find(k => k === 'BLOB_READ_WRITE_TOKEN') ||
               envKeys.find(k => k.startsWith('BLOB_READ_WRITE_TOKEN_'));
  return key ? process.env[key] : null;
}

async function readProfiles() {
  const token = getToken();
  if (!token) return [];
  try {
    const { blobs } = await list({ prefix: BLOB_NAME, token });
    if (!blobs.length) return [];
    const url = blobs[0].url || blobs[0].downloadUrl;
    if (!url) return [];
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.error('readProfiles error:', e.message);
    return [];
  }
}

async function writeProfiles(profiles) {
  const token = getToken();
  await put(BLOB_NAME, JSON.stringify(profiles), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    token,
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Prevent edge caching so all visitors always get the latest profiles
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const profiles = await readProfiles();
      return res.status(200).json(profiles);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const profiles = await readProfiles();
      const profile = { ...req.body, id: Date.now().toString() };
      profiles.push(profile);
      await writeProfiles(profiles);
      return res.status(200).json(profile);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'PUT') {
    try {
      const profiles = await readProfiles();
      const { id, ...update } = req.body;
      const i = profiles.findIndex(p => p.id === id);
      if (i === -1) return res.status(404).json({ error: 'Not found' });
      profiles[i] = { ...profiles[i], ...update };
      await writeProfiles(profiles);
      return res.status(200).json(profiles[i]);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const profiles = await readProfiles();
      const filtered = profiles.filter(p => p.id !== req.query.id);
      await writeProfiles(filtered);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
};
