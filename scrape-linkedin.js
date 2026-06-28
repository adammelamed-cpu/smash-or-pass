#!/usr/bin/env node
'use strict';

// Usage:
//   APIFY_TOKEN=xxx node scrape-linkedin.js https://linkedin.com/in/person1 https://linkedin.com/in/person2
//   Or put one URL per line in linkedin-urls.txt and run without args.
//
// Optional env vars:
//   LINKEDIN_ACTOR   — Apify actor ID (default: anchor~linkedin-profile-scraper)
//   PROFILES_API_URL — if set, POSTs scraped profiles to your /api/profiles endpoint

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ID = (process.env.LINKEDIN_ACTOR || 'anchor~linkedin-profile-scraper');
const API_BASE = 'https://api.apify.com/v2';

function apiFetch(path, method = 'GET', body) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${API_BASE}${path}${sep}token=${APIFY_TOKEN}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

async function getProfileUrls() {
  const args = process.argv.slice(2).filter(a => a.startsWith('http'));
  if (args.length) return args;

  try {
    const { readFileSync } = require('fs');
    return readFileSync('linkedin-urls.txt', 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && l.startsWith('http'));
  } catch {
    return [];
  }
}

async function startRun(profileUrls) {
  const res = await apiFetch(`/acts/${encodeURIComponent(ACTOR_ID)}/runs`, 'POST', {
    profileUrls,
  });

  if (!res.ok) {
    const body = await res.text();
    // Some actors use startUrls instead of profileUrls — retry with that shape
    if (res.status === 400 && body.includes('startUrls')) {
      const res2 = await apiFetch(`/acts/${encodeURIComponent(ACTOR_ID)}/runs`, 'POST', {
        startUrls: profileUrls.map(url => ({ url })),
      });
      if (!res2.ok) throw new Error(`Failed to start actor (${res2.status}): ${await res2.text()}`);
      const { data } = await res2.json();
      return data;
    }
    throw new Error(`Failed to start actor (${res.status}): ${body}`);
  }

  const { data } = await res.json();
  return data;
}

async function waitForRun(runId) {
  process.stdout.write('  Waiting for run to complete');
  for (;;) {
    await new Promise(r => setTimeout(r, 6000));
    process.stdout.write('.');

    const res = await apiFetch(`/actor-runs/${runId}`);
    if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
    const { data } = await res.json();

    if (data.status === 'SUCCEEDED') {
      process.stdout.write(' done\n');
      return data.defaultDatasetId;
    }
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(data.status)) {
      process.stdout.write('\n');
      throw new Error(`Actor run ${data.status}: ${JSON.stringify(data.stats || {})}`);
    }
  }
}

async function fetchDataset(datasetId) {
  const res = await apiFetch(`/datasets/${datasetId}/items?format=json&clean=1`);
  if (!res.ok) throw new Error(`Failed to fetch dataset (${res.status})`);
  return res.json();
}

function pick(...vals) {
  return vals.find(v => v && typeof v === 'string' && v.trim()) || '';
}

function pickPhoto(...vals) {
  return vals.find(v => v && typeof v === 'string' && v.startsWith('http')) || null;
}

function mapToProfile(item) {
  // Handle various field name conventions across different Apify LinkedIn actors
  const fullName = pick(item.name, item.fullName,
    [item.firstName, item.lastName].filter(Boolean).join(' '));
  const firstName = fullName.split(/\s+/)[0];

  const photos = [
    pickPhoto(item.profilePicture, item.profilePictureUrl, item.photoUrl,
              item.photo, item.pictureUrl, item.imgUrl),
    pickPhoto(item.backgroundImage, item.backgroundPicture, item.backgroundUrl),
  ].filter(Boolean);

  const bio = pick(
    item.headline, item.summary, item.about,
    item.description, item.occupation,
  );

  const tags = [];
  const company = pick(
    item.company, item.currentCompany,
    item.experiences?.[0]?.companyName,
    item.positions?.positionHistory?.[0]?.companyName,
  );
  if (company) tags.push(company);

  const location = pick(item.location, item.city, item.geo?.country);
  if (location) tags.push(location);

  if (Array.isArray(item.skills)) {
    tags.push(...item.skills.slice(0, 3).map(s => (typeof s === 'string' ? s : s.name || '')));
  }

  // Estimate age from earliest grad year (rough)
  let age = '';
  const edus = item.educations || item.education || [];
  if (Array.isArray(edus) && edus.length) {
    const years = edus
      .map(e => parseInt(e.endDate || e.timePeriod?.endDate?.year || e.graduationYear))
      .filter(y => y > 1985 && y < 2030)
      .sort((a, b) => a - b);
    if (years.length) {
      const approxBirth = years[0] - 22;
      age = String(new Date().getFullYear() - approxBirth);
    }
  }

  return {
    name: firstName,
    age,
    photos,
    bio,
    tags: [...new Set(tags.filter(Boolean))].slice(0, 5),
    distance: 'on LinkedIn',
    linkedinUrl: pick(item.url, item.profileUrl, item.linkedinUrl),
  };
}

async function main() {
  if (!APIFY_TOKEN) {
    console.error('Error: APIFY_TOKEN environment variable is required.');
    process.exit(1);
  }

  const profileUrls = await getProfileUrls();
  if (!profileUrls.length) {
    console.error('No LinkedIn profile URLs found.');
    console.error('Usage: node scrape-linkedin.js https://linkedin.com/in/person1 ...');
    console.error('  Or:  add one URL per line to linkedin-urls.txt');
    process.exit(1);
  }

  console.log(`Scraping ${profileUrls.length} LinkedIn profile(s) via Apify (${ACTOR_ID})...`);
  profileUrls.forEach(u => console.log(`  ${u}`));

  const run = await startRun(profileUrls);
  console.log(`Run started: ${run.id}`);

  const datasetId = await waitForRun(run.id);
  const items = await fetchDataset(datasetId);
  console.log(`Fetched ${items.length} item(s) from dataset.`);

  const profiles = items
    .map(mapToProfile)
    .filter(p => p.name && p.photos.length > 0);

  if (!profiles.length) {
    console.warn('\nNo usable profiles found (all lacked a name or photo).');
    console.warn('Raw items saved to scraped-raw.json for inspection.');
    require('fs').writeFileSync('scraped-raw.json', JSON.stringify(items, null, 2));
    process.exit(1);
  }

  require('fs').writeFileSync('scraped-profiles.json', JSON.stringify(profiles, null, 2));
  console.log(`\nSaved ${profiles.length} profile(s) to scraped-profiles.json`);

  const apiUrl = process.env.PROFILES_API_URL;
  if (apiUrl) {
    console.log(`\nPosting to ${apiUrl}...`);
    for (const profile of profiles) {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const data = await res.json().catch(() => ({}));
      console.log(`  ${profile.name}: ${res.ok ? 'OK' : `FAILED — ${JSON.stringify(data)}`}`);
    }
  }

  console.log('\nProfiles scraped:');
  profiles.forEach(p => {
    const preview = p.bio ? `  ${p.bio.slice(0, 70)}${p.bio.length > 70 ? '…' : ''}` : '';
    console.log(`  ${p.name}${p.age ? `, ${p.age}` : ''} — ${p.photos.length} photo(s)`);
    if (preview) console.log(preview);
  });
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
