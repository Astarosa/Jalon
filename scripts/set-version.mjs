// Fixe la version de Jalon partout où elle apparaît.
// Usage : npm run version:set -- 1.2.0
import { readFileSync, writeFileSync } from "node:fs";

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? "")) {
  console.error("Usage : npm run version:set -- X.Y.Z");
  process.exit(1);
}
const json = (p, f) => {
  const o = JSON.parse(readFileSync(p, "utf8"));
  f(o);
  writeFileSync(p, JSON.stringify(o, null, 2) + "\n");
};
json("apps/local/src-tauri/tauri.conf.json", (o) => (o.version = v));
json("apps/local/package.json", (o) => (o.version = v));
json("package.json", (o) => (o.version = v));
const cargo = "apps/local/src-tauri/Cargo.toml";
writeFileSync(cargo, readFileSync(cargo, "utf8").replace(/^version = "[^"]+"/m, `version = "${v}"`));
console.log(`Version ${v} appliquée. Ensuite :
  git commit -am "Version ${v}"
  git tag -a v${v} -m "Nouveautés de la version ${v} (affichées dans l'application)"
  git push origin main v${v}`);
