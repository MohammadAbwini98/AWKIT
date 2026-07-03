export interface RunnerWorkerMessage {
  executionId: string;
  instanceId: string;
  scenarioId: string;
  dataRowIndex?: number;
}

export class RunnerWorker {
  async run(message: RunnerWorkerMessage): Promise<RunnerWorkerMessage> {
    return message;
  }
}
