/**
 * Dependency-free self-signed X.509 certificate generator for local HTTPS test servers.
 *
 * AWKIT is offline-first and adds no runtime/dev dependencies for this, and Node has no built-in
 * certificate ISSUER (`crypto.X509Certificate` only parses). So the verifier builds a minimal v3
 * certificate by hand: DER-encode the TBSCertificate, sign it with the generated RSA key, and wrap
 * the result. Everything below is standard ASN.1/DER per RFC 5280.
 *
 * TEST-ONLY. The key is generated in memory, per run, and never written to disk or the repo.
 */
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";

// ── Minimal DER encoders ─────────────────────────────────────────────────────

/** DER length: short form under 128, else 0x80|byteCount followed by big-endian length. */
function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), len(content.length), content]);
}

const seq = (...parts: Buffer[]) => tlv(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]) => tlv(0x31, Buffer.concat(parts));
const utf8 = (value: string) => tlv(0x0c, Buffer.from(value, "utf8"));
const ia5 = (value: string) => tlv(0x16, Buffer.from(value, "ascii"));
const bool = (value: boolean) => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const octets = (content: Buffer) => tlv(0x04, content);
const nul = () => tlv(0x05, Buffer.alloc(0));

/** INTEGER — two's-complement, so a leading high bit needs a 0x00 pad to stay positive. */
function integer(value: Buffer): Buffer {
  const trimmed = value[0] === 0 && value.length > 1 ? value.subarray(1) : value;
  return tlv(0x02, (trimmed[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed);
}

/** BIT STRING with a leading "0 unused bits" octet (always whole bytes here). */
const bitString = (content: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), content]));

/** OID — first two arcs collapse into one byte, remaining arcs are base-128 varints. */
function oid(dotted: string): Buffer {
  const arcs = dotted.split(".").map(Number);
  const bytes: number[] = [40 * arcs[0] + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const chunks: number[] = [arc & 0x7f];
    for (let v = arc >>> 7; v > 0; v >>>= 7) chunks.unshift((v & 0x7f) | 0x80);
    bytes.push(...chunks);
  }
  return tlv(0x06, Buffer.from(bytes));
}

/** UTCTime (YYMMDDHHMMSSZ) — valid for all years this test cert will ever see. */
function utcTime(date: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, "0");
  const text =
    `${p(date.getUTCFullYear() % 100)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(text, "ascii"));
}

/** Context-specific tag; `constructed` sets the 0x20 bit ([n] EXPLICIT wrappers). */
const ctx = (n: number, content: Buffer, constructed = true) =>
  tlv(0x80 | (constructed ? 0x20 : 0) | n, content);

// ── Certificate assembly ─────────────────────────────────────────────────────

const OID_COMMON_NAME = "2.5.4.3";
const OID_SHA256_RSA = "1.2.840.113549.1.1.11";
const OID_SUBJECT_ALT_NAME = "2.5.29.17";
const OID_BASIC_CONSTRAINTS = "2.5.29.19";

/** RDNSequence with a single CN. */
const name = (commonName: string) => seq(set(seq(oid(OID_COMMON_NAME), utf8(commonName))));

/** AlgorithmIdentifier for sha256WithRSAEncryption (RSA requires the explicit NULL params). */
const sha256WithRsa = () => seq(oid(OID_SHA256_RSA), nul());

/**
 * subjectAltName covering `localhost` + 127.0.0.1 so Chromium accepts the host it actually connects
 * to. GeneralName: dNSName is [2] IMPLICIT IA5String, iPAddress is [7] IMPLICIT OCTET STRING.
 */
function subjectAltName(dnsNames: string[], ipAddresses: string[]): Buffer {
  const names = [
    ...dnsNames.map((dns) => tlv(0x82, Buffer.from(dns, "ascii"))),
    ...ipAddresses.map((ip) => tlv(0x87, Buffer.from(ip.split(".").map(Number))))
  ];
  return seq(oid(OID_SUBJECT_ALT_NAME), octets(seq(...names)));
}

/** basicConstraints: cA TRUE, marked critical (a self-signed leaf is its own issuer). */
const basicConstraints = () => seq(oid(OID_BASIC_CONSTRAINTS), bool(true), octets(seq(bool(true))));

function pem(label: string, der: Buffer): string {
  const body = der.toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

export interface SelfSignedCertificate {
  /** PEM certificate, for `https.createServer({ cert })`. */
  cert: string;
  /** PEM PKCS#8 private key, for `https.createServer({ key })`. */
  key: string;
}

export interface SelfSignedCertificateOptions {
  commonName?: string;
  dnsNames?: string[];
  ipAddresses?: string[];
  /** Negative values produce an ALREADY-EXPIRED certificate (used for the ERR_CERT_DATE_INVALID case). */
  validityDays?: number;
}

/**
 * Generate a fresh self-signed certificate + key. Untrusted by definition (no CA issued it), which is
 * exactly what the certificate-trust tests need: Chromium rejects it with `net::ERR_CERT_AUTHORITY_INVALID`
 * unless `ignoreHTTPSErrors` is set on the browser context.
 */
export function createSelfSignedCertificate(options: SelfSignedCertificateOptions = {}): SelfSignedCertificate {
  const commonName = options.commonName ?? "localhost";
  const validityDays = options.validityDays ?? 365;

  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  // An SPKI DER export IS the SubjectPublicKeyInfo structure the certificate needs.
  const spki = (publicKey as KeyObject).export({ type: "spki", format: "der" }) as Buffer;

  const now = Date.now();
  // A negative validity window ends before it starts; back-date notBefore so the cert is unambiguously
  // expired rather than not-yet-valid.
  const notBefore = new Date(validityDays < 0 ? now + validityDays * 86_400_000 * 2 : now - 3_600_000);
  const notAfter = new Date(now + validityDays * 86_400_000);

  const tbs = seq(
    ctx(0, integer(Buffer.from([2]))), // version v3
    integer(Buffer.from([0x01, ...Buffer.from(String(now % 1_000_000)).subarray(0, 6)])), // serial
    sha256WithRsa(),
    name(commonName),
    seq(utcTime(notBefore), utcTime(notAfter)),
    name(commonName), // self-signed: issuer === subject
    spki,
    ctx(3, seq(basicConstraints(), subjectAltName(options.dnsNames ?? [commonName], options.ipAddresses ?? ["127.0.0.1"])))
  );

  const signature = createSign("RSA-SHA256").update(tbs).sign(privateKey);
  const certificate = seq(tbs, sha256WithRsa(), bitString(signature));

  return {
    cert: pem("CERTIFICATE", certificate),
    key: (privateKey as KeyObject).export({ type: "pkcs8", format: "pem" }) as string
  };
}
