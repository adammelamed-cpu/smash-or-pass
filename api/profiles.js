const { put, list } = require('@vercel/blob');

const BLOB_NAME = 'smash-profiles.json';

async function readProfiles() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  try {
    const { blobs } = await list({ prefix: BLOB_NAME });
    if (!blobs.length) return [];
    const res = await fetch(blobs[0].downloadUrl || blobs[0].url);
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

async function writeProfiles(profiles) {
  await put(BLOB_NAME, JSON.stringify(profiles), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const profiles = await readProfiles();
    return res.status(200).json(profiles);
  }

  if (req.method === 'POST') {
    const profiles = await readProfiles();
    const profile = { ...req.body, id: Date.now().toString() };
    profiles.push(profile);
    await writeProfiles(profiles);
    return res.status(200).json(profile);
  }

  if (req.method === 'PUT') {
    const profiles = await readProfiles();
    const { id, ...update } = req.body;
    const i = profiles.findIndex(p => p.id === id);
    if (i === -1) return res.status(404).json({ error: 'Not found' });
    profiles[i] = { ...profiles[i], ...update };
    await writeProfiles(profiles);
    return res.status(200).json(profiles[i]);
  }

  if (req.method === 'DELETE') {
    const profiles = await readProfiles();
    const filtered = profiles.filter(p => p.id !== req.query.id);
    await writeProfiles(filtered);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
};
