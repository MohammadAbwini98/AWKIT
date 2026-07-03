import type { RunnerWorkerMessage } from "./RunnerWorker";

export class RunnerWorkerHost {
  private readonly queue: RunnerWorkerMessage[] = [];

  enqueue(message: RunnerWorkerMessage): void {
    this.queue.push(message);
  }

  dequeue(): RunnerWorkerMessage | undefined {
    return this.queue.shift();
  }

  list(): RunnerWorkerMessage[] {
    return [...this.queue];
  }

  size(): number {
    return this.queue.length;
  }
}
