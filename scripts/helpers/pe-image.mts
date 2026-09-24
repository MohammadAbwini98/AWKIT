/**
 * The import table of a Windows PE image (`.exe`, `.dll`, `.node`), read from its bytes.
 *
 * Shared by `verify:ai-packaged-runtime` and `verify:native-dependencies`. Each import carries the file
 * offset of its name string, so a verifier can rewrite the name in a scratch copy (same length) and
 * make the loader prove where the dependency really comes from.
 */
import fs from "node:fs";

/** Stands in for an old-style (address-based) delay-load descriptor, which this reader does not decode. */
export const OLD_STYLE_DELAY_LOAD = "<old-style delay-load descriptor>";

export interface PeImport {
  /** The DLL name exactly as the image spells it. */
  name: string;
  /** File offset of the NUL-terminated name; -1 for an old-style delay-load descriptor. */
  offset: number;
  /** From the delay-load directory rather than the import directory. */
  delay: boolean;
}

export interface PeImage {
  machine: number;
  /** MajorLinkerVersion.MinorLinkerVersion of the optional header. */
  linker: string;
  imports: PeImport[];
}

/** Null for anything that is not a PE image. */
export function readPeImage(b: Buffer): PeImage | null {
  if (b.length < 0x40 || b.readUInt16LE(0) !== 0x5a4d) return null;
  const pe = b.readUInt32LE(0x3c);
  if (pe + 24 > b.length || b.readUInt32LE(pe) !== 0x4550) return null;
  const sectionCount = b.readUInt16LE(pe + 6);
  const optional = pe + 24;
  const pe32plus = b.readUInt16LE(optional) === 0x20b;
  const directoryCount = b.readUInt32LE(optional + (pe32plus ? 108 : 92));
  const dataDirectory = optional + (pe32plus ? 112 : 96);
  const sectionTable = optional + b.readUInt16LE(pe + 20);
  const offsetOf = (rva: number): number => {
    for (let i = 0; i < sectionCount; i += 1) {
      const s = sectionTable + i * 40;
      const va = b.readUInt32LE(s + 12);
      if (rva >= va && rva < va + Math.max(b.readUInt32LE(s + 8), b.readUInt32LE(s + 16))) return rva - va + b.readUInt32LE(s + 20);
    }
    return -1;
  };
  const imports: PeImport[] = [];
  const read = (directoryRva: number, stride: number, nameField: number, delay: boolean): void => {
    for (let d = directoryRva ? offsetOf(directoryRva) : -1; d >= 0 && d + stride <= b.length; d += stride) {
      const nameRva = b.readUInt32LE(d + nameField);
      if (!nameRva) break;
      // An old-style delay descriptor (attribute bit 0 clear) holds addresses, not RVAs. It is reported
      // under a name that can never resolve, so a caller fails on it instead of silently skipping it.
      if (delay && (b.readUInt32LE(d) & 1) === 0) {
        imports.push({ name: OLD_STYLE_DELAY_LOAD, offset: -1, delay });
        continue;
      }
      const at = offsetOf(nameRva);
      if (at < 0) break;
      imports.push({ name: b.toString("latin1", at, b.indexOf(0, at)), offset: at, delay });
    }
  };
  // A directory the header does not declare is not there, whatever bytes follow the optional header.
  if (directoryCount > 1) read(b.readUInt32LE(dataDirectory + 8), 20, 12, false);
  if (directoryCount > 13) read(b.readUInt32LE(dataDirectory + 13 * 8), 32, 4, true);
  return { machine: b.readUInt16LE(pe + 4), linker: `${b.readUInt8(optional + 2)}.${b.readUInt8(optional + 3)}`, imports };
}

/** The DLL names a PE file imports, from its import and delay-load directories. */
export function peImports(file: string): string[] {
  return readPeImage(fs.readFileSync(file))?.imports.map((i) => i.name) ?? [];
}
