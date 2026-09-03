import type { ConcurrentRunReport } from "../reports/ExecutionReport";
import type { SessionCaptureStatus, SessionProfile } from "../session/SessionProfile";

/**
 * The session operations used while executing Auto Secure Login and Reuse Session nodes.
 * Electron main supplies the concrete SessionCaptureService; the runner depends only on this shape.
 */
export interface ExecutionSessionAccess {
  list(): Promise<SessionProfile[]>;
  getById(id: string): Promise<SessionProfile | null>;
  startCapture(name: string, targetUrl: string, source?: SessionProfile["source"]): Promise<SessionCaptureStatus>;
  getStatus(): SessionCaptureStatus;
  stopCapture(): void;
  hasCapturedData(sessionId: string): boolean;
  markUsed(id: string): Promise<void>;
}

/** Persists the profile-store projection of the JSON report written by ReportService. */
export interface ExecutionReportPersistence {
  persist(report: ConcurrentRunReport & { id: string }): Promise<void>;
}

/** Required Electron-main composition for the production ExecutionEngine singleton. */
export interface ExecutionEnginePorts {
  sessionAccess: ExecutionSessionAccess;
  reportPersistence: ExecutionReportPersistence;
}
