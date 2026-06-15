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
    allowOverwrite: true,
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── DIAGNOSTIC ENDPOINT: /api/profiles?debug=1 ──────────────
  // NON-DESTRUCTIVE: reports the live profile count and round-trips a
  // SEPARATE throwaway file so it never touches real profile data.
  if (req.method === 'GET' && req.query && req.query.debug) {
    const blobEnvKeys = Object.keys(process.env).filter(k => k.includes('BLOB'));
    const diag = { blobEnvVarNames: blobEnvKeys };
    // 1. Report how many REAL profiles are currently stored (read-only)
    try {
      const profiles = await readProfiles();
      diag.liveProfileCount = profiles.length;
      diag.liveProfileNames = profiles.map(p => p.name);
    } catch (e) {
      diag.liveProfileCount = 'read-error';
      diag.liveReadError = e.message;
    }
    // 2. Round-trip a throwaway test file (does NOT touch smash-profiles.json)
    const TEST_NAME = 'smash-debug-test.json';
    try {
      await put(TEST_NAME, JSON.stringify([{ _test: true, ts: Date.now() }]), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      diag.putOk = true;
      const { blobs } = await list({ prefix: TEST_NAME });
      if (blobs.length) {
        const r = await get(blobs[0].url, { access: 'private' });
        const data = r && r.stream ? await new Response(r.stream).json() : null;
        diag.getOk = !!(r && r.stream);
        diag.getReadOk = Array.isArray(data) && data.length === 1;
      }
    } catch (e) {
      diag.putOk = diag.putOk || false;
      diag.getOk = false;
      diag.testError = e.message;
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
