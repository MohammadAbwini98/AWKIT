export class FlowOutputRegistry {
  private readonly outputs = new Map<string, unknown>();

  set(flowId: string, outputKey: string, value: unknown): void {
    this.outputs.set(`${flowId}.${outputKey}`, value);
  }

  get(flowId: string, outputKey: string): unknown {
    return this.outputs.get(`${flowId}.${outputKey}`);
  }
}
