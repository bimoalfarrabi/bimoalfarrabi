// Generates pixel-art GitHub stats cards from real GitHub API data.
// Run from the repo root: node tools/gen-stats.mjs
// Env: GITHUB_TOKEN (optional locally, provided by Actions in CI)

import { rasterText, textWidth } from "./pixelfx-font.js";
import fs from "node:fs";

const USER = "bimoalfarrabi";
const TOKEN = process.env.GITHUB_TOKEN || "";
const C = {
  void: "#05070A",
  phos: "#3BFF8F",
  dim: "#0E3B24",
  text: "#C8D6CE",
  name: "#E8F2EC",
  amber: "#FFB347",
};

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "bimoalfarrabi-readme-stats",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function get(url, attempt = 0) {
  const res = await fetch(url, { headers });
  if ((res.status === 403 || res.status === 429) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return get(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function paginate(url) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const sep = url.includes("?") ? "&" : "?";
    const batch = await get(`${url}${sep}per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

// Real byte counts per language, excluding forks and archived repos.
async function languageBytes(repos) {
  const totals = {};
  const queue = repos.filter((r) => !r.fork && !r.archived);
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const repo = queue.shift();
      try {
        const langs = await get(`https://api.github.com/repos/${USER}/${repo.name}/languages`);
        for (const [name, bytes] of Object.entries(langs)) {
          totals[name] = (totals[name] || 0) + bytes;
        }
      } catch {
        // a repo with no language data is not fatal
      }
    }
  });
  await Promise.all(workers);
  return totals;
}

async function collect() {
  const user = await get(`https://api.github.com/users/${USER}`);
  const repos = await paginate(`https://api.github.com/users/${USER}/repos?type=owner`);

  const search = async (q) => {
    const r = await get(
      `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=1`,
    );
    return r.total_count;
  };

  const commitsRes = await get(
    `https://api.github.com/search/commits?q=${encodeURIComponent(`author:${USER} is:public`)}&per_page=1`,
  );

  const stars = repos.reduce((a, r) => a + r.stargazers_count, 0);

  const bytes = await languageBytes(repos);
  const totalBytes = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
  const topLangs = Object.entries(bytes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, b]) => ({ name, pct: (b / totalBytes) * 100 }));

  return {
    stars,
    commits: commitsRes.total_count,
    prs: await search(`author:${USER} type:pr is:public`),
    issues: await search(`author:${USER} type:issue is:public`),
    followers: user.followers,
    topLangs,
  };
}

function textPath(str, font, scale, x, y, color, opacity = 1) {
  const parts = [];
  rasterText(str, font, (px, py) => {
    parts.push(`M${x + px * scale} ${y + py * scale}h${scale}v${scale}h-${scale}z`);
  });
  return `<path d="${parts.join("")}" fill="${color}"${opacity !== 1 ? ` fill-opacity="${opacity}"` : ""}/>`;
}

function opacityFor(pct) {
  return Math.min(1, 0.35 + (pct / 100) * 1.6).toFixed(2);
}

function statRow(label, value, y, valueX) {
  return (
    textPath(label, "mini", 4, 40, y, C.text) +
    textPath(String(value), "mini", 4, valueX, y, C.name)
  );
}

function frame(W, H) {
  return `<rect width="${W}" height="${H}" fill="${C.void}"/>
  <rect x="0" y="0" width="${W}" height="4" fill="${C.dim}"/>
  <rect x="0" y="${H - 4}" width="${W}" height="4" fill="${C.dim}"/>
  <rect x="0" y="0" width="4" height="${H}" fill="${C.dim}"/>
  <rect x="${W - 4}" y="0" width="4" height="${H}" fill="${C.dim}"/>`;
}

function statsCard(d) {
  const W = 600;
  const H = 230;
  const rows = [
    ["TOTAL STARS", d.stars],
    ["PUBLIC COMMITS", d.commits],
    ["PULL REQUESTS", d.prs],
    ["ISSUES OPENED", d.issues],
    ["FOLLOWERS", d.followers],
  ];
  const body = rows.map(([l, v], i) => statRow(l, v, 68 + i * 30, 440)).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" shape-rendering="crispEdges">
  <title>Bimo Alfarrabi GitHub stats</title>
  <desc>Pixel art stats. ${rows.map(([l, v]) => `${l.toLowerCase()} ${v}`).join(", ")}. Counts cover public activity only.</desc>
  ${frame(W, H)}
  ${textPath("// TELEMETRY", "mini", 4, 40, 28, C.phos, 0.85)}
  <rect x="40" y="46" width="540" height="4" fill="${C.dim}"/>
  ${body}
</svg>
`;
}

function segWidths(langs, barW) {
  const raw = langs.map((l) => Math.max(8, Math.round(((l.pct / 100) * barW) / 4) * 4));
  const total = raw.reduce((a, b) => a + b, 0);
  const scaled = raw.map((w) => Math.max(4, Math.round((w * (barW / total)) / 4) * 4));
  scaled[0] += barW - scaled.reduce((a, b) => a + b, 0);
  return scaled;
}

function langsCard(d) {
  const W = 600;
  const H = 230;
  const barW = 520;
  const barX = 40;
  const barY = 56;
  const widths = segWidths(d.topLangs, barW);

  let cursor = barX;
  const segs = d.topLangs
    .map((l, i) => {
      const w = widths[i];
      const rect = `<rect x="${cursor}" y="${barY}" width="${w}" height="16" fill="${C.phos}" fill-opacity="${opacityFor(l.pct)}"/>`;
      cursor += w;
      return rect;
    })
    .join("");

  const legend = d.topLangs
    .map((l, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 40 + col * 280;
      const y = 100 + row * 26;
      return (
        `<rect x="${x}" y="${y + 6}" width="8" height="8" fill="${C.phos}" fill-opacity="${opacityFor(l.pct)}"/>` +
        textPath(`${l.name.toUpperCase()} ${l.pct.toFixed(1)}%`, "mini", 4, x + 16, y, C.text)
      );
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" shape-rendering="crispEdges">
  <title>Bimo Alfarrabi most used languages</title>
  <desc>Pixel art language breakdown by bytes of code, excluding forks and archived repositories: ${d.topLangs.map((l) => `${l.name} ${l.pct.toFixed(1)} percent`).join(", ")}.</desc>
  ${frame(W, H)}
  ${textPath("// LANGUAGES", "mini", 4, 40, 26, C.phos, 0.85)}
  ${segs}
  ${legend}
</svg>
`;
}

const data = await collect();

if (!data.topLangs.length || !Number.isFinite(data.commits)) {
  throw new Error("collect() returned incomplete data; refusing to write cards");
}

fs.writeFileSync("assets/stats.svg", statsCard(data));
fs.writeFileSync("assets/langs.svg", langsCard(data));
console.log("wrote assets/stats.svg and assets/langs.svg");
console.log(JSON.stringify(data, null, 2));
