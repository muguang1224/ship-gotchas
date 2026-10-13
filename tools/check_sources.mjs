#!/usr/bin/env node
/**
 * Verify every cited source.
 *
 * A citation is a claim about someone else's page.  Pages change; a guide whose
 * sources have quietly gone stale is worse than one with no sources, because it
 * still looks checked.
 *
 * So each source has two requirements:
 *   1. the URL still resolves (2xx)
 *   2. at least one `mustContain` phrase is still on the page
 *
 * If the phrase is gone, the vendor rewrote the page and the entry that cites
 * it needs a human to look again.  The build fails; that is the point.
 *
 *   node tools/check_sources.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 30_000;
const ATTEMPTS = 3;

const UA =
  "ship-gotchas-source-check/1.0 (+https://github.com/muguang1224/ship-gotchas)";

function decode(body) {
  // Pages are HTML; the phrases we look for are plain text, but entities and
  // whitespace differ between the DOM and the bytes.  Normalise both sides.
  return body
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ");
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html,*/*" },
    });
    const body = await response.text();
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function check(source) {
  const phrases = source.mustContain.map((phrase) => phrase.replace(/\s+/g, " "));
  let lastError = "unknown";

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const { status, body } = await fetchOnce(source.url);
      if (status < 200 || status >= 300) {
        lastError = `HTTP ${status}`;
        continue;
      }
      const text = decode(body);
      const found = phrases.filter((phrase) => text.includes(phrase));
      if (found.length > 0) {
        return { id: source.id, ok: true, matched: found[0], tried: phrases.length };
      }
      return {
        id: source.id,
        ok: false,
        reason: `页面上找不到任何一句：${phrases.join(" / ")}`,
        fatal: true, // 重试没有意义，页面确实变了
      };
    } catch (error) {
      lastError = error.name === "AbortError" ? "超时" : String(error.message ?? error);
    }
  }
  return { id: source.id, ok: false, reason: lastError };
}

async function main() {
  const config = JSON.parse(readFileSync(join(ROOT, "sources.json"), "utf8"));
  const sources = config.sources;

  console.log(`校验 ${sources.length} 个来源…\n`);
  const results = await Promise.all(sources.map(check));

  let failed = 0;
  for (const result of results) {
    const source = sources.find((item) => item.id === result.id);
    if (result.ok) {
      console.log(`  ✓ ${result.id}`);
      console.log(`      ${source.url}`);
      console.log(`      命中: ${JSON.stringify(result.matched)}\n`);
    } else {
      failed += 1;
      console.log(`  ✗ ${result.id}  — ${result.reason}`);
      console.log(`      ${source.url}`);
      console.log(`      用于: ${source.usedBy.join(", ")}`);
      console.log(`      声称: ${source.claim}\n`);
    }
  }

  if (failed > 0) {
    console.log(`${failed} 个来源需要重新核实。`);
    console.log("不要直接删掉断言——先打开链接看官方现在怎么说，再改对应的条目和短语。");
    process.exit(1);
  }
  console.log("全部通过：每条引用今天仍然成立。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
