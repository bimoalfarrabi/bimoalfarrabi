// Generates pixel-art GitHub stats cards from real GitHub API data.
// Run from the repo root: node tools/gen-stats.mjs
// Env:
//   STATS_TOKEN  optional PAT with repo scope; when set, private activity is
//                counted too. Without it the cards fall back to public data.
//   GITHUB_TOKEN optional; raises rate limits only.

import { rasterText, textWidth } from "./pixelfx-font.js";
import fs from "node:fs";

const USER = "bimoalfarrabi";
const PAT = process.env.STATS_TOKEN || "";
const TOKEN = PAT || process.env.GITHUB_TOKEN || "";
const INCLUDES_PRIVATE = Boolean(PAT);
const C = {
  void: "#05070A",
  phos: "#3BFF8F",
  dim: "#0E3B24",
  text: "#C8D6CE",
  name: "#E8F2EC",
  amber: "#FFB347",
};

// Official GitHub linguist colours. A few are near-black because linguist
// targets light backgrounds, so readableOnDark() lifts those for the void.
const LANG_COLORS = {
  Assembly: "#6E4C13",
  Blade: "#f7523f",
  C: "#555555",
  "C#": "#178600",
  "C++": "#f34b7d",
  CSS: "#563d7c",
  Dart: "#00B4AB",
  GDScript: "#355570",
  Go: "#00ADD8",
  HTML: "#e34c26",
  Java: "#b07219",
  JavaScript: "#f1e05a",
  Kotlin: "#A97BFF",
  Lua: "#000080",
  Makefile: "#427819",
  "Objective-C": "#438eff",
  PHP: "#4F5D95",
  Python: "#3572A5",
  Ruby: "#701516",
  Rust: "#dea584",
  Shell: "#89e051",
  Swift: "#F05138",
  TypeScript: "#3178c6",
  Vue: "#41b883",
};
const FALLBACK_LANG_COLOR = "#8B949E";

function readableOnDark(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum >= 90) return hex;
  const t = Math.min(0.78, (90 - lum) / (255 - lum));
  const mix = (c) => Math.round(c + (255 - c) * t);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function colorFor(name) {
  return readableOnDark(LANG_COLORS[name] || FALLBACK_LANG_COLOR);
}

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

  // /users/:u/repos only ever returns public repos. With a PAT we ask for the
  // authenticated owner's repos so private work counts too.
  const repos = INCLUDES_PRIVATE
    ? await paginate(`https://api.github.com/user/repos?affiliation=owner&visibility=all`)
    : await paginate(`https://api.github.com/users/${USER}/repos?type=owner`);

  const search = async (q) => {
    const r = await get(
      `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=1`,
    );
    return r.total_count;
  };

  // Commit search silently omits repos the token cannot index, so compare the
  // unfiltered query with the public-only one. Equal counts mean the token is
  // not actually seeing private commits, and the card must not claim it is.
  const commitsAll = (
    await get(`https://api.github.com/search/commits?q=${encodeURIComponent(`author:${USER}`)}&per_page=1`)
  ).total_count;
  const commitsPublic = (
    await get(
      `https://api.github.com/search/commits?q=${encodeURIComponent(`author:${USER} is:public`)}&per_page=1`,
    )
  ).total_count;
  const privateVisible = INCLUDES_PRIVATE && commitsAll > commitsPublic;

  let scopes = "unknown";
  try {
    const probe = await fetch("https://api.github.com/user", { headers });
    scopes = probe.headers.get("x-oauth-scopes") ?? "fine-grained";
  } catch {
    // diagnostics only
  }

  if (process.env.STATS_DEBUG) {
    console.error(
      JSON.stringify(
        { includesPrivate: INCLUDES_PRIVATE, commitsAll, commitsPublic, privateVisible, scopes },
        null,
        2,
      ),
    );
  }

  const stars = repos.reduce((a, r) => a + r.stargazers_count, 0);

  const bytes = await languageBytes(repos);
  const totalBytes = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
  const topLangs = Object.entries(bytes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, b]) => ({ name, pct: (b / totalBytes) * 100 }));

  const visibility = privateVisible ? "" : " is:public";
  const prsAll = await search(`author:${USER} type:pr`);
  const prsPublic = await search(`author:${USER} type:pr is:public`);
  const issuesAll = await search(`author:${USER} type:issue`);
  const issuesPublic = await search(`author:${USER} type:issue is:public`);

  return {
    stars,
    commits: privateVisible ? commitsAll : commitsPublic,
    prs: privateVisible ? prsAll : prsPublic,
    issues: privateVisible ? issuesAll : issuesPublic,
    followers: user.followers,
    includesPrivate: privateVisible,
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
    [d.includesPrivate ? "TOTAL COMMITS" : "PUBLIC COMMITS", d.commits],
    ["PULL REQUESTS", d.prs],
    ["ISSUES OPENED", d.issues],
    ["FOLLOWERS", d.followers],
  ];
  const body = rows.map(([l, v], i) => statRow(l, v, 68 + i * 30, 440)).join("");

  const scope = d.includesPrivate ? "INCL PRIVATE" : "PUBLIC ONLY";
  const scopeScale = 3;
  const scopeX = W - 40 - textWidth(scope, "mini") * scopeScale;
  const scopeTag = textPath(scope, "mini", scopeScale, scopeX, 30, C.phos, 0.6);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" shape-rendering="crispEdges">
  <title>Bimo Alfarrabi GitHub stats</title>
  <desc>Pixel art stats. ${rows.map(([l, v]) => `${l.toLowerCase()} ${v}`).join(", ")}. ${d.includesPrivate ? "Counts include private repositories." : "Counts cover public activity only."}</desc>
  ${frame(W, H)}
  ${textPath("// TELEMETRY", "mini", 4, 40, 28, C.phos, 0.85)}
  ${scopeTag}
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
      const rect = `<rect x="${cursor}" y="${barY}" width="${w}" height="16" fill="${colorFor(l.name)}"/>`;
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
        `<rect x="${x}" y="${y + 6}" width="8" height="8" fill="${colorFor(l.name)}"/>` +
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
