const { put, list } = require('@vercel/blob');

const BLOB_NAME = 'smash-profiles.json';

// Vercel names the token BLOB_READ_WRITE_TOKEN, but when a store is connected
// it can also be suffixed with the store name (e.g. BLOB_READ_WRITE_TOKEN_XYZ).
// Find whichever one exists.
function getToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const key = Object.keys(process.env).find(
    k => k.includes('BLOB') && k.includes('READ_WRITE_TOKEN')
  );
  return key ? process.env[key] : undefined;
}

async function readProfiles() {
  const token = getToken();
  const { blobs } = await list({ prefix: BLOB_NAME, token });
  if (!blobs.length) return [];
  const res = await fetch(blobs[0].url, { cache: 'no-store' });
  if (!res.ok) return [];
  return await res.json();
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
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── DIAGNOSTIC ENDPOINT: /api/profiles?debug=1 ──────────────
  if (req.method === 'GET' && req.query && req.query.debug) {
    const token = getToken();
    const blobEnvKeys = Object.keys(process.env).filter(k => k.includes('BLOB'));
    const diag = {
      tokenFound: !!token,
      tokenPrefix: token ? token.slice(0, 18) + '…' : null,
      blobEnvVarNames: blobEnvKeys,
    };
    try {
      const { blobs } = await list({ prefix: BLOB_NAME, token });
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
      diag.error = e.message;
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
