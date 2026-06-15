const { put, list } = require('@vercel/blob');

const BLOB_NAME = 'smash-profiles.json';

async function readProfiles() {
  const { blobs } = await list({ prefix: BLOB_NAME });
  if (!blobs.length) return [];
  const res = await fetch(blobs[0].url, { cache: 'no-store' });
  if (!res.ok) return [];
  return await res.json();
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
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── DIAGNOSTIC ENDPOINT: /api/profiles?debug=1 ──────────────
  if (req.method === 'GET' && req.query && req.query.debug) {
    const blobEnvKeys = Object.keys(process.env).filter(k => k.includes('BLOB'));
    const diag = { blobEnvVarNames: blobEnvKeys };
    try {
      const { blobs } = await list({ prefix: BLOB_NAME });
      diag.listOk = true;
      diag.blobCount = blobs.length;
      if (blobs.length) {
        diag.blobUrl = blobs[0].url;
        const r = await fetch(blobs[0].url, { cache: 'no-store' });
        diag.fetchStatus = r.status;
        const data = await r.json().catch(() => null);
        diag.profileCount = Array.isArray(data) ? data.length : 'not-an-array';
      }
    } catch (e) {
      diag.listOk = false;
      diag.listError = e.message;
    }
    try {
      const testPayload = [{ _test: true, ts: Date.now() }];
      await put(BLOB_NAME, JSON.stringify(testPayload), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });
      diag.putOk = true;
      // Clean up: write back empty array
      await put(BLOB_NAME, JSON.stringify([]), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });
    } catch (e) {
      diag.putOk = false;
      diag.putError = e.message;
    }
    return res.status(200).json(diag);
  }

  if (req.method === 'GET') {
    try {
      const profiles = await readProfiles();
      return res.status(200).json(profiles);
    } catch (e) {
      return res.status(200).json([]); // never break the deck on read failure
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
