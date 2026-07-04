import type { InstanceResourcePolicy } from "./InstanceResourcePolicy";

export class InstanceLockManager {
  private readonly locks = new Map<string, string>();

  acquire(instanceId: string, policy: InstanceResourcePolicy): void {
    const keys = this.toKeys(policy);
    const conflict = keys.find((key) => this.locks.has(key));

    if (conflict) {
      throw new Error(`Instance ${instanceId} cannot acquire locked resource: ${conflict} owned by ${this.locks.get(conflict)}`);
    }

    keys.forEach((key) => this.locks.set(key, instanceId));
  }

  release(policy: InstanceResourcePolicy): void {
    this.toKeys(policy).forEach((key) => this.locks.delete(key));
  }

  releaseForInstance(instanceId: string): void {
    [...this.locks.entries()].forEach(([key, owner]) => {
      if (owner === instanceId) this.locks.delete(key);
    });
  }

  listLocks(): Array<{ key: string; instanceId: string }> {
    return [...this.locks.entries()].map(([key, instanceId]) => ({ key, instanceId }));
  }

  private toKeys(policy: InstanceResourcePolicy): string[] {
    return [
      policy.exclusiveAccountKey ? `account:${policy.exclusiveAccountKey}` : undefined,
      policy.storageStatePath ? `storageState:${policy.storageStatePath}` : undefined,
      policy.userDataDir ? `userDataDir:${policy.userDataDir}` : undefined,
      `downloads:${policy.downloadsPath}`,
      policy.screenshotsPath ? `screenshots:${policy.screenshotsPath}` : undefined,
      policy.logsPath ? `logs:${policy.logsPath}` : undefined,
      ...(policy.outputPaths ?? []).map((outputPath) => `output:${outputPath}`)
    ].filter((key): key is string => Boolean(key));
  }
}
