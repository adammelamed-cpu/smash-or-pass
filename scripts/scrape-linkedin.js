#!/usr/bin/env node
// Scrapes recent posts + reactions from a fixed list of LinkedIn authors via Apify.
// Usage: APIFY_TOKEN=your_token node scripts/scrape-linkedin.js
// Or:    npm run scrape:linkedin

const { ApifyClient } = require('apify-client');
const fs = require('fs');
const path = require('path');

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) {
  console.error('Error: APIFY_TOKEN environment variable is required');
  console.error('Get yours at https://console.apify.com/account/integrations');
  process.exit(1);
}

const AUTHORS = [
  'https://www.linkedin.com/in/andreas-wernicke',
  'https://www.linkedin.com/in/seth-london',
  'https://www.linkedin.com/in/nickmehta',
  'https://www.linkedin.com/in/lfrodrigues',
  'https://www.linkedin.com/in/aatzberger',
  'https://www.linkedin.com/in/boxaaron',
  'https://www.linkedin.com/in/alex-lieberman',
  'https://www.linkedin.com/in/doniperry',
  'https://www.linkedin.com/in/ramnathbojeesh',
  'https://www.linkedin.com/in/johnghu',
];

const MAX_POSTS_PER_AUTHOR = 20;

// Actor: apify/linkedin-scraper
// https://apify.com/apify/linkedin-scraper
const ACTOR_ID = 'apify/linkedin-scraper';

async function main() {
  const client = new ApifyClient({ token: APIFY_TOKEN });

  console.log(`Scraping ${AUTHORS.length} LinkedIn profiles (up to ${MAX_POSTS_PER_AUTHOR} posts each)...`);
  console.log('This may take a few minutes.\n');

  const input = {
    startUrls: AUTHORS.map(url => ({ url })),
    maxPostCount: MAX_POSTS_PER_AUTHOR,
    proxy: {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL'],
    },
  };

  let run;
  try {
    run = await client.actor(ACTOR_ID).call(input, { waitSecs: 300 });
  } catch (err) {
    console.error('Actor run failed:', err.message);
    process.exit(1);
  }

  console.log(`Run finished (${run.status}). Fetching results...`);

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  const posts = items
    .filter(item => item.postText || item.text || item.content)
    .map(item => ({
      authorUrl: clean(item.authorUrl || item.profileUrl || item.linkedinUrl),
      authorName: item.authorName || item.fullName || item.name || null,
      text: item.postText || item.text || item.content || null,
      reactions: toNum(item.reactions ?? item.likesCount ?? item.likes),
      comments: toNum(item.commentsCount ?? item.comments),
      shares: toNum(item.sharesCount ?? item.shares),
      date: item.date || item.postedAt || item.createdAt || null,
      postUrl: clean(item.postUrl || item.url),
    }))
    .sort((a, b) => toNum(b.reactions) - toNum(a.reactions));

  const output = {
    scrapedAt: new Date().toISOString(),
    authorCount: AUTHORS.length,
    postCount: posts.length,
    authors: AUTHORS,
    posts,
  };

  const outPath = path.join(__dirname, '..', 'linkedin-posts.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`\nDone! ${posts.length} posts saved to linkedin-posts.json`);
  console.log(`Top post: ${posts[0]?.authorName} — ${toNum(posts[0]?.reactions)} reactions`);
}

function toNum(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseInt(val.replace(/,/g, ''), 10) || 0;
  return 0;
}

function clean(url) {
  if (!url) return null;
  return url.split('?')[0];
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
