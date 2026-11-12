import { full, parseSdn } from "../bench/pairs.ts";

const people = parseSdn(await Bun.file("data/ofac/SDN.XML").text());
const names = [...new Set(people.flatMap((p) => [p.name, ...p.aliases].map(full)))];
await Bun.write("demo/names.json", JSON.stringify(names));
console.log(`${names.length} names from ${people.length} individuals`);
