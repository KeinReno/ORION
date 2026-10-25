// Usage: generate-update-key.mjs <private-pem-outside-repository> <public-pem>
// Idempotent: existing private keys are reused; an existing different public key is never overwritten.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
const [privateFile, publicFile] = process.argv.slice(2);
if (!privateFile || !publicFile) throw new Error('Specify private and public PEM paths');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privatePath = path.resolve(privateFile);
if (privatePath === root || privatePath.startsWith(root + path.sep)) throw new Error('Private key must stay outside repository');
fs.mkdirSync(path.dirname(privatePath), { recursive: true });
if (!fs.existsSync(privatePath)) {
  const { privateKey } = generateKeyPairSync('ed25519');
  fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
}
const key = createPrivateKey(fs.readFileSync(privatePath));
if (key.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 key required');
const pem = createPublicKey(key).export({ type: 'spki', format: 'pem' });
if (fs.existsSync(publicFile) && fs.readFileSync(publicFile, 'utf8') !== pem) throw new Error('Public key differs: explicit key rotation requires a full installer');
fs.mkdirSync(path.dirname(path.resolve(publicFile)), { recursive: true });
fs.writeFileSync(publicFile, pem);
console.log('Update signing key ready. Private key content is never printed or bundled.');
