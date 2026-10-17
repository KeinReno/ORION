import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Самоподписанный сертификат хоста без внешних зависимостей: Node умеет проверять и использовать
 * X.509, но не создавать его, а openssl на машине пользователя может не быть. Минимальный DER-кодировщик
 * (ECDSA P-256 + SHA-256) проверяется тестом через `crypto.X509Certificate` и реальным TLS-рукопожатием.
 *
 * Доверие строится не на имени и не на цепочке, а на закреплении: клиент запоминает этот сертификат
 * при подключении и сверяет его при каждом запросе (pinned-request.ts).
 */
const der = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  const length =
    body.length < 128 ? Buffer.from([body.length]) : body.length < 256 ? Buffer.from([0x81, body.length]) : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
};
const seq = (...p: Buffer[]) => der(0x30, ...p);
const set = (...p: Buffer[]) => der(0x31, ...p);
const oid = (value: string) => {
  const parts = value.split(".").map(Number);
  const bytes = [parts[0]! * 40 + parts[1]!];
  for (const part of parts.slice(2)) {
    const chunk = [part & 0x7f];
    for (let rest = part >> 7; rest > 0; rest >>= 7) chunk.unshift((rest & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
};
const utf8 = (text: string) => der(0x0c, Buffer.from(text, "utf8"));
const utcTime = (date: Date) => der(0x17, Buffer.from(`${date.toISOString().replace(/[-:T]/g, "").slice(2, 14)}Z`));
const bitString = (data: Buffer) => der(0x03, Buffer.concat([Buffer.from([0]), data]));
const octets = (data: Buffer) => der(0x04, data);

const OID_CN = "2.5.4.3";
const OID_ORG = "2.5.4.10";
const OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2";
const OID_BASIC = "2.5.29.19";
const OID_SAN = "2.5.29.17";

function name(commonName: string): Buffer {
  const rdn = (type: string, value: string) => set(seq(oid(type), utf8(value)));
  return seq(rdn(OID_ORG, "ORION"), rdn(OID_CN, commonName));
}

function subjectAltName(dns: string[], ips: string[]): Buffer {
  const entries = [
    ...dns.map((value) => der(0x82, Buffer.from(value, "ascii"))),
    ...ips.map((ip) => der(0x87, Buffer.from(ip.split(".").map(Number))))
  ];
  return seq(oid(OID_SAN), octets(seq(...entries)));
}

export interface IssuedCertificate {
  keyPem: string;
  certPem: string;
  fingerprint: string;
}

/** SHA-256 DER-сертификата в виде `AA:BB:…` — тот же формат, что у `X509Certificate.fingerprint256`. */
export function fingerprintOfDer(derBytes: Buffer): string {
  return createHash("sha256").update(derBytes).digest("hex").toUpperCase().match(/../g)!.join(":");
}

export function pemToDer(pem: string): Buffer {
  return Buffer.from(pem.replace(/-----[^-]+-----|\s+/g, ""), "base64");
}

export function derToPem(derBytes: Buffer): string {
  return `-----BEGIN CERTIFICATE-----\n${derBytes.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
}

export function issueSelfSignedCertificate(options: { commonName: string; ipAddresses?: string[]; years?: number; now?: Date }): IssuedCertificate {
  const now = options.now ?? new Date();
  const notBefore = new Date(now.getTime() - 24 * 3600 * 1000);
  const notAfter = new Date(now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + (options.years ?? 10));
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const serial = randomBytes(16);
  serial[0] = (serial[0]! & 0x7f) || 1;
  const algorithm = seq(oid(OID_ECDSA_SHA256));
  const dnsName = /^[\x21-\x7e]+$/.test(options.commonName) ? options.commonName : "orion.local";
  const extensions = der(
    0xa3,
    seq(seq(oid(OID_BASIC), der(0x01, Buffer.from([0xff])), octets(seq())), subjectAltName([dnsName], options.ipAddresses ?? []))
  );
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    algorithm,
    name(options.commonName),
    seq(utcTime(notBefore), utcTime(notAfter)),
    name(options.commonName),
    publicKey.export({ type: "spki", format: "der" }),
    extensions
  );
  const certificate = seq(tbs, algorithm, bitString(sign("sha256", tbs, privateKey)));
  return {
    keyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    certPem: derToPem(certificate),
    fingerprint: fingerprintOfDer(certificate)
  };
}

/** Сертификат хоста создаётся один раз и живёт, пока лежат файлы: отпечаток — стабильный идентификатор узла. */
export function loadOrIssueHostCertificate(dir: string, commonName: string, ipAddresses: string[]): IssuedCertificate {
  const keyFile = path.join(dir, "host-key.pem");
  const certFile = path.join(dir, "host-cert.pem");
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    const certPem = fs.readFileSync(certFile, "utf8");
    return { keyPem: fs.readFileSync(keyFile, "utf8"), certPem, fingerprint: fingerprintOfDer(pemToDer(certPem)) };
  }
  const issued = issueSelfSignedCertificate({ commonName, ipAddresses });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, issued.keyPem, { mode: 0o600 });
  fs.writeFileSync(certFile, issued.certPem);
  return issued;
}
