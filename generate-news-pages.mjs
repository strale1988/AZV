#!/usr/bin/env node
/**
 * Generates one small static page per published news item (vesti/<id>/index.html)
 * plus sitemap.xml, so Viber / Facebook / Google can read the title, description and
 * image of a shared news link (they do not run JavaScript).
 *
 * Visitors who open such a page are redirected straight to the app: ../../#/vesti/<id>
 *
 * Usage:
 *   node scripts/generate-news-pages.mjs                 # reads the live Supabase table
 *   node scripts/generate-news-pages.mjs --from-file rows.json   # offline test
 *
 * Env (all optional):
 *   SITE_URL   public address of the site (default https://alarmzavazduh.com)
 *   OUT_DIR    where to write (default: current directory)
 */
import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

const SITE_URL = (process.env.SITE_URL || "https://alarmzavazduh.com").replace(/\/+$/, "") + "/";
const OUT_DIR = process.env.OUT_DIR || process.cwd();
const SITE_NAME = "Alarm za vazduh";
const FALLBACK_IMAGE = SITE_URL + "icons/og-image.png";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (v, n) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
const safeId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);

async function loadRows() {
  const i = process.argv.indexOf("--from-file");
  if (i !== -1) return JSON.parse(await readFile(process.argv[i + 1], "utf8"));

  // Public (anon) credentials are read from index.html so they live in one place.
  const html = await readFile(path.join(OUT_DIR, "index.html"), "utf8");
  const url = (html.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
  const key = (html.match(/SUPABASE_KEY\s*=\s*"([^"]+)"/) || [])[1];
  if (!url || !key) throw new Error("Could not find SUPABASE_URL / SUPABASE_KEY in index.html");
  const res = await fetch(
    `${url}/rest/v1/news?select=id,created_at,title_sr,excerpt_sr,images&published=eq.true&order=created_at.desc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "azv" } }
  );
  if (!res.ok) throw new Error(`Supabase responded ${res.status}: ${await res.text()}`);
  return res.json();
}

function pageFor(row) {
  const id = row.id;
  const url = `${SITE_URL}vesti/${id}/`;
  const title = clip(row.title_sr, 110);
  const desc = clip(row.excerpt_sr || row.title_sr, 200);
  const cover = Array.isArray(row.images) && row.images[0] && /^https:\/\//.test(row.images[0].url || "") ? row.images[0].url : null;
  const image = cover || FALLBACK_IMAGE;
  const iso = new Date(row.created_at).toISOString();
  const ld = {
    "@context": "https://schema.org", "@type": "NewsArticle", headline: title, description: desc,
    datePublished: iso, image: [image], mainEntityOfPage: url,
    publisher: { "@type": "Organization", name: SITE_NAME, logo: { "@type": "ImageObject", url: SITE_URL + "icons/icon-512.png" } },
  };
  return `<!doctype html>
<html lang="sr-Latn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${SITE_NAME}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="sr_RS">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">${cover ? "" : `
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">`}
<meta property="article:published_time" content="${esc(iso)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(image)}">
<link rel="icon" href="../../icons/favicon.png">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<script>location.replace("../../#/vesti/${encodeURIComponent(id)}");</script>
<style>body{margin:0;font:17px/1.6 Georgia,serif;background:#F3F4F0;color:#132029}main{max-width:680px;margin:0 auto;padding:40px 20px}a{color:#0060B0;font-weight:700}small{color:#566669}</style>
</head>
<body>
<main>
<small>${SITE_NAME}</small>
<h1>${esc(title)}</h1>
<p>${esc(desc)}</p>
<p><a href="../../#/vesti/${encodeURIComponent(id)}">Pročitajte ceo tekst</a></p>
</main>
</body>
</html>
`;
}

const rows = (await loadRows()).filter((r) => safeId(r.id) && r.title_sr);
const vestiDir = path.join(OUT_DIR, "vesti");
await mkdir(vestiDir, { recursive: true });

for (const row of rows) {
  const dir = path.join(vestiDir, row.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), pageFor(row));
}

// Remove pages of news that were unpublished or deleted.
const keep = new Set(rows.map((r) => r.id));
for (const entry of await readdir(vestiDir, { withFileTypes: true })) {
  if (entry.isDirectory() && safeId(entry.name) && !keep.has(entry.name)) await rm(path.join(vestiDir, entry.name), { recursive: true, force: true });
}

const urls = [`  <url><loc>${SITE_URL}</loc></url>`].concat(
  rows.map((r) => `  <url><loc>${esc(SITE_URL + "vesti/" + r.id + "/")}</loc><lastmod>${new Date(r.created_at).toISOString().slice(0, 10)}</lastmod></url>`)
);
await writeFile(path.join(OUT_DIR, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);

console.log(`Generated ${rows.length} news page(s) and sitemap.xml`);
