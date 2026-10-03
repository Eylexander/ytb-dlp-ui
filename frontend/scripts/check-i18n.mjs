// Fails when the language files don't define the same keys, or a translation drops or
// renames a {placeholder}. Keys used in code are already type-checked against en-US.json
// (see AppConfig in src/i18n.ts), so `npm run typecheck` covers the other direction.
import { readFileSync } from "node:fs";

const locales = ["en-US", "fr-FR"];
const load = (l) => JSON.parse(readFileSync(new URL(`../messages/${l}.json`, import.meta.url), "utf8"));
const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
// ICU argument names ({name}, {name, plural, ...}), skipping plural/select branch bodies
// such as `=1 {Download}` or `other {…}`, which are text, not arguments.
const args = (msg) =>
  new Set([...msg.matchAll(/(?<!(?:=\d+|zero|one|two|few|many|other|none)\s*)\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]));

const [base, ...others] = locales.map((l) => [l, new Map(flatten(load(l)))]);
const problems = [];
for (const [l, msgs] of others) {
  for (const [k, v] of base[1]) {
    if (!msgs.has(k)) { problems.push(`${l}.json lacks "${k}"`); continue; }
    const want = [...args(v)].sort().join(","), got = [...args(msgs.get(k))].sort().join(",");
    if (want !== got) problems.push(`${l}.json "${k}" uses {${got}} but ${base[0]}.json uses {${want}}`);
  }
  for (const k of msgs.keys()) if (!base[1].has(k)) problems.push(`${base[0]}.json lacks "${k}" (defined in ${l}.json)`);
}

if (problems.length) {
  console.error(problems.join("\n") + `\n\n${problems.length} i18n problem(s)`);
  process.exit(1);
}
console.log(`i18n: ${base[1].size} keys present in ${locales.join(", ")}`);
