export class BrowserProcessManager {
  private readonly contextsByProcess = new Map<string, Set<string>>();

  registerContext(processId: string, instanceId: string, maxContextsPerProcess: number): void {
    const contexts = this.contextsByProcess.get(processId) ?? new Set<string>();
    if (contexts.size >= maxContextsPerProcess) {
      throw new Error(`Browser process ${processId} reached max context capacity: ${maxContextsPerProcess}`);
    }

    contexts.add(instanceId);
    this.contextsByProcess.set(processId, contexts);
  }

  releaseContext(processId: string, instanceId: string): void {
    const contexts = this.contextsByProcess.get(processId);
    if (!contexts) return;

    contexts.delete(instanceId);
    if (!contexts.size) this.contextsByProcess.delete(processId);
  }

  getContextCount(processId: string): number {
    return this.contextsByProcess.get(processId)?.size ?? 0;
  }

  getProcessIds(): string[] {
    return [...this.contextsByProcess.keys()];
  }
}
