#!/usr/bin/env node
/**
 * Scrape LinkedIn posts + reactions for a list of profiles via Apify.
 *
 * Usage:
 *   APIFY_TOKEN=apify_api_... node scrape-linkedin.js
 *   node scrape-linkedin.js --token apify_api_...
 *
 * Output: results.json in the current directory.
 *
 * Actor: 2SyF0bVxmgGr8IVCZ  (LinkedIn Profile Scraper — supports posts + reactions)
 * Swap ACTOR_ID below if you use a different actor.
 */

const https = require("https");
const fs = require("fs");

const ACTOR_ID = "apify/linkedin-profile-scraper";
const BASE = "api.apify.com";

const TOKEN =
  process.env.APIFY_TOKEN ||
  (() => {
    const i = process.argv.indexOf("--token");
    return i !== -1 ? process.argv[i + 1] : null;
  })();

if (!TOKEN) {
  console.error("Error: provide APIFY_TOKEN env var or --token <token>");
  process.exit(1);
}

const INPUT = {
  startUrls: [
    { url: "https://www.linkedin.com/in/andreas-wernicke" },
    { url: "https://www.linkedin.com/in/seth-london" },
    { url: "https://www.linkedin.com/in/nickmehta" },
    { url: "https://www.linkedin.com/in/lfrodrigues" },
    { url: "https://www.linkedin.com/in/aatzberger" },
    { url: "https://www.linkedin.com/in/boxaaron" },
    { url: "https://www.linkedin.com/in/alex-lieberman" },
    { url: "https://www.linkedin.com/in/doniperry" },
    { url: "https://www.linkedin.com/in/ramnathbojeesh" },
    { url: "https://www.linkedin.com/in/johnghu" },
  ],
  maxPostCount: 20,
  scrapeReactions: true,       // request reactions per post where supported
  proxy: {
    useApifyProxy: true,
    apifyProxyGroups: ["RESIDENTIAL"],
  },
};

// ── helpers ────────────────────────────────────────────────────────────────

function apifyRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE,
      port: 443,
      path: `${path}?token=${TOKEN}`,
      method,
      headers: { "Content-Type": "application/json" },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  // 1. Start the actor run
  console.log(`Starting actor run for ${INPUT.startUrls.length} profiles…`);
  const start = await apifyRequest(
    "POST",
    `/v2/acts/${ACTOR_ID}/runs`,
    INPUT
  );

  if (start.status !== 201) {
    console.error("Failed to start run:", JSON.stringify(start.body, null, 2));
    process.exit(1);
  }

  const run = start.body.data;
  const runId = run.id;
  const datasetId = run.defaultDatasetId;
  console.log(`Run started: ${runId}  dataset: ${datasetId}`);
  console.log(`Track at: https://console.apify.com/view/runs/${runId}`);

  // 2. Poll until finished
  let status = run.status;
  let dots = 0;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    process.stdout.write(`\rStatus: ${status} ${"·".repeat(++dots % 4 + 1)}   `);
    await sleep(10000);
    const poll = await apifyRequest("GET", `/v2/actor-runs/${runId}`);
    status = poll.body?.data?.status || "UNKNOWN";
  }
  console.log(`\nRun finished with status: ${status}`);

  if (status !== "SUCCEEDED") {
    console.error("Run did not succeed. Check the Apify console for logs.");
    process.exit(1);
  }

  // 3. Fetch dataset items
  const items = await apifyRequest(
    "GET",
    `/v2/datasets/${datasetId}/items`
  );

  if (items.status !== 200 || !Array.isArray(items.body)) {
    console.error("Failed to fetch dataset:", JSON.stringify(items.body, null, 2));
    process.exit(1);
  }

  console.log(`Fetched ${items.body.length} profile(s) from dataset.`);

  // 4. Write to file
  const out = "results.json";
  fs.writeFileSync(out, JSON.stringify(items.body, null, 2));
  console.log(`Saved to ${out}`);

  // 5. Quick summary
  for (const p of items.body) {
    const name = p.fullName || p.name || "(unknown)";
    const postCount = (p.posts || []).length;
    const reactionCount = (p.posts || []).reduce(
      (sum, post) => sum + (post.reactions || post.reactionCount || 0),
      0
    );
    console.log(`  ${name}: ${postCount} posts, ${reactionCount} reactions`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
