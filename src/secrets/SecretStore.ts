/**
 * Encrypted local secret store (audit §15) — pure core. Operator secrets (portal passwords, API
 * tokens) are kept OUT of workflow/flow JSON and out of `.env`. Values are encrypted at rest via an
 * injected {@link SecretCrypto} backend (Windows DPAPI through Electron `safeStorage` in production;
 * a fake in tests) and referenced from steps by name (`valueSource.type = "secret"`, `secretName`).
 *
 * This module is UI/Electron-agnostic: the OS keystore binding + runtime path live in
 * `app/main/secretStore.ts`, which constructs this class with the real crypto backend.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Pluggable crypto backend so the store is unit-testable without a live Electron keystore. */
export interface SecretCrypto {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

interface SecretRecord {
  cipher: string; // base64 of the OS-encrypted bytes
  createdAt: string;
  updatedAt: string;
}
interface SecretFile {
  version: number;
  secrets: Record<string, SecretRecord>;
}

/** Metadata returned to the renderer — never includes the secret value. */
export interface SecretSummary {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export const SECRET_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export class SecretStore {
  constructor(
    private readonly filePath: string,
    private readonly crypto: SecretCrypto
  ) {}

  /** Whether the OS keystore is available; when false the store refuses to persist secrets. */
  isAvailable(): boolean {
    return this.crypto.isAvailable();
  }

  /** Secret names + timestamps only — never values. */
  list(): SecretSummary[] {
    const file = this.read();
    return Object.entries(file.secrets)
      .map(([name, rec]) => ({ name, createdAt: rec.createdAt, updatedAt: rec.updatedAt }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  has(name: string): boolean {
    return name in this.read().secrets;
  }

  /** Encrypt + persist a secret under `name`. Throws if the keystore is unavailable or the name/value is invalid. */
  set(name: string, value: string): void {
    const clean = (name ?? "").trim();
    if (!SECRET_NAME_PATTERN.test(clean)) {
      throw new Error("Secret name must be 1–64 characters of letters, numbers, dot, dash or underscore.");
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("Secret value cannot be empty.");
    }
    if (value.length > 8192) {
      throw new Error("Secret value is too long (max 8192 characters).");
    }
    if (!this.crypto.isAvailable()) {
      throw new Error("Secure storage is not available on this system, so secrets cannot be saved.");
    }
    const file = this.read();
    const now = new Date().toISOString();
    const cipher = this.crypto.encrypt(value).toString("base64");
    file.secrets[clean] = { cipher, createdAt: file.secrets[clean]?.createdAt ?? now, updatedAt: now };
    this.write(file);
  }

  delete(name: string): void {
    const file = this.read();
    if (file.secrets[name]) {
      delete file.secrets[name];
      this.write(file);
    }
  }

  /** Decrypt and return a secret value (MAIN process only — never sent to the renderer). */
  get(name: string): string | undefined {
    const rec = this.read().secrets[name];
    if (!rec) return undefined;
    if (!this.crypto.isAvailable()) return undefined;
    try {
      return this.crypto.decrypt(Buffer.from(rec.cipher, "base64"));
    } catch {
      return undefined;
    }
  }

  private read(): SecretFile {
    try {
      if (!existsSync(this.filePath)) return { version: 1, secrets: {} };
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8").replace(/^﻿/, "")) as SecretFile;
      if (!parsed || typeof parsed !== "object" || typeof parsed.secrets !== "object") return { version: 1, secrets: {} };
      return { version: parsed.version ?? 1, secrets: parsed.secrets ?? {} };
    } catch {
      return { version: 1, secrets: {} };
    }
  }

  private write(file: SecretFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(file, null, 2), "utf8");
    try {
      renameSync(tmp, this.filePath); // atomic replace (Windows MOVEFILE_REPLACE_EXISTING)
    } catch (error) {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore cleanup failure */
      }
      throw error;
    }
  }
}
