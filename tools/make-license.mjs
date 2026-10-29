#!/usr/bin/env node
/* Decargo licence key generator (owner only).
 *
 *   node tools/make-license.mjs --vessel "MV EXAMPLE" --holder "John Smith" --until 2027-04-30 [--kind trial] [--key <signing-key.pem>]
 *
 * Prints one key line (DCL1.…) to send to the vessel, and appends a record
 * to licences-issued.csv next to the signing key.
 *
 * The signing key (Ed25519, PKCS#8 PEM) must NEVER be committed or shared:
 * anyone holding it can issue keys. Default location: $DECARGO_SIGNING_KEY,
 * else ~/Downloads/Decargo-License/decargo-signing-key.pem. Keep a backup —
 * without it no new key can be issued for installed copies.
 */
import { createPrivateKey, createPublicKey, sign, randomBytes } from 'node:crypto';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if(a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const die = m => { console.error('make-license: ' + m); process.exit(1); };

const vessel = String(args.vessel || '').trim();
const holder = String(args.holder || '').trim();
const until = String(args.until || '').trim();
const kind = String(args.kind || 'trial').trim();
if(!vessel) die('--vessel is required');
if(!/^\d{4}-\d{2}-\d{2}$/.test(until) || isNaN(Date.parse(until + 'T00:00:00Z'))) die('--until must be YYYY-MM-DD');
if(!['trial', 'full', 'owner'].includes(kind)) die('--kind must be trial, full or owner');

const keyPath = args.key || process.env.DECARGO_SIGNING_KEY || join(homedir(), 'Downloads', 'Decargo-License', 'decargo-signing-key.pem');
if(!existsSync(keyPath)) die('signing key not found: ' + keyPath);
const priv = createPrivateKey(readFileSync(keyPath));

const b64u = b => Buffer.from(b).toString('base64url');
const today = new Date().toISOString().slice(0, 10);
const payload = { v: 1, id: 'L' + today.replace(/-/g, '') + '-' + randomBytes(3).toString('hex').toUpperCase(),
  vessel, holder, issued: today, until, kind };
const p64 = b64u(JSON.stringify(payload));
const sig = sign(null, Buffer.from(p64), priv);
const key = `DCL1.${p64}.${b64u(sig)}`;

const pub = createPublicKey(priv).export({ format: 'jwk' }).x;
const log = join(dirname(keyPath), 'licences-issued.csv');
if(!existsSync(log)) appendFileSync(log, 'issued,id,vessel,holder,until,kind,public_key\n');
appendFileSync(log, [today, payload.id, vessel, holder, until, kind, pub].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',') + '\n');

console.log(key);
