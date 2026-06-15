const { put, list, get } = require('@vercel/blob');

const BLOB_NAME = 'smash-profiles.json';

async function readProfiles() {
  const { blobs } = await list({ prefix: BLOB_NAME });
  if (!blobs.length) return [];
  const result = await get(blobs[0].url, { access: 'private' });
  if (!result || !result.stream) return [];
  const data = await new Response(result.stream).json();
  return Array.isArray(data) ? data : [];
}

async function writeProfiles(profiles) {
  await put(BLOB_NAME, JSON.stringify(profiles), {
    access: 'private',
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
    } catch (e) {
      diag.listOk = false;
      diag.listError = e.message;
    }
    try {
      const testPayload = [{ _test: true, ts: Date.now() }];
      await put(BLOB_NAME, JSON.stringify(testPayload), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
      });
      diag.putOk = true;
    } catch (e) {
      diag.putOk = false;
      diag.putError = e.message;
    }
    if (diag.putOk) {
      try {
        const { blobs } = await list({ prefix: BLOB_NAME });
        if (blobs.length) {
          const r = await get(blobs[0].url, { access: 'private' });
          const data = r && r.stream ? await new Response(r.stream).json() : null;
          diag.getOk = !!(r && r.stream);
          diag.readProfileCount = Array.isArray(data) ? data.length : 'not-an-array';
        }
        // Clean up test data
        await put(BLOB_NAME, JSON.stringify([]), {
          access: 'private',
          contentType: 'application/json',
          addRandomSuffix: false,
        });
        diag.cleanupOk = true;
      } catch (e) {
        diag.getOk = false;
        diag.getError = e.message;
      }
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
