import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StructuredLog } from "./StructuredLog";
import { SecretMasker } from "./SecretMasker";

export class StructuredLogger {
  private readonly masker = new SecretMasker();

  constructor(private readonly logFilePath?: string) {}

  async log(entry: StructuredLog): Promise<StructuredLog> {
    const masked = this.mask(entry);

    if (this.logFilePath) {
      await mkdir(dirname(this.logFilePath), { recursive: true });
      await appendFile(this.logFilePath, `${JSON.stringify(masked)}\n`, "utf8");
    }

    return masked;
  }

  mask(entry: StructuredLog): StructuredLog {
    return {
      ...entry,
      message: this.masker.maskText(entry.message),
      data: entry.data ? this.masker.maskRecord(entry.data) : undefined
    };
  }
}
