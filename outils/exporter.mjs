// Transforme l'export de la base de l'appli Claude en data.enc.json (chiffré avec le code d'accès).
// Usage : CODE=xxxx node outils/exporter.mjs <dossier_export> [sortie]
// <dossier_export> contient config/depot.json, equipe/*.json, dossiers/*.json (format ArtifactData out_dir).
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { webcrypto as crypto } from "node:crypto";

const [src, out = "data.enc.json"] = process.argv.slice(2);
const code = process.env.CODE;
if (!src || !code) { console.error("Usage : CODE=xxxx node outils/exporter.mjs <dossier_export> [sortie]"); process.exit(1); }

const lire = f => { const j = JSON.parse(readFileSync(f, "utf8")); return j.data ?? j; };
const col = n => { const d = join(src, n); return existsSync(d) ? readdirSync(d).filter(f => f.endsWith(".json")).map(f => ({ id: f.replace(/\.json$/, ""), ...lire(join(d, f)) })) : []; };

const depot = existsSync(join(src, "config", "depot.json")) ? lire(join(src, "config", "depot.json")) : {};
const donnees = {
  recus: Number(depot.recus) || 0,
  majLe: depot.majLe || null,
  exporteLe: new Date().toISOString(),
  equipe: col("equipe").map(p => ({ id: p.id, nom: String(p.nom || p.id), donnes: Number(p.donnes) || 0 })),
  // Seulement ce que les collaborateurs doivent voir : pas de photos ni d'identifiants Drive.
  dossiers: col("dossiers").map(d => ({
    nom: String(d.nom || ""), poseur: d.poseur || "", stations: Math.max(1, parseInt(d.stations, 10) || 1),
    lieu: d.lieu || "", poseLe: d.poseLe || d.ajouteLe || null, certif: d.certif || ""
  }))
};

const deriver = (s, usage) => crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"])
  .then(b => crypto.subtle.deriveKey({ name: "PBKDF2", salt: s, iterations: 250000, hash: "SHA-256" }, b, { name: "AES-GCM", length: 256 }, false, [usage]));

// Ne rien réécrire si les chiffres n'ont pas changé depuis le dernier export.
if (existsSync(out)) {
  try {
    const f = JSON.parse(readFileSync(out, "utf8"));
    const un = s => Buffer.from(s, "base64");
    const avant = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: un(f.iv) }, await deriver(un(f.sel), "decrypt"), un(f.data))));
    const sans = d => JSON.stringify({ ...d, exporteLe: null });
    if (sans(avant) === sans(donnees)) { console.log("inchangé"); process.exit(0); }
  } catch (e) { /* ancien fichier illisible : on le remplace */ }
}

const sel = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));

const cle = await deriver(sel, "encrypt");
const chiffre = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cle, new TextEncoder().encode(JSON.stringify(donnees)));
const b64 = u => Buffer.from(u).toString("base64");
writeFileSync(out, JSON.stringify({ v: 1, sel: b64(sel), iv: b64(iv), data: b64(new Uint8Array(chiffre)) }) + "\n");
console.log(`${out} : ${donnees.equipe.length} personnes, ${donnees.dossiers.length} dossiers, ${donnees.recus} reçus`);
