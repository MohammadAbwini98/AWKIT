import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { CoverageDimension, CoverageEntry, CoverageSnapshot } from "../random/CoverageTracker";
import type { FailureCategory } from "../failures/FailureArtifactWriter";
import type { RandomRunOutcome, RandomTestRunResult } from "../runtime/RandomTestRunner";

export const CAMPAIGN_REPORT_SCHEMA_VERSION = 1;

export interface CampaignFailureRecord {
  readonly executionId: string;
  readonly category: FailureCategory;
  readonly signature?: string;
  readonly reproductionCommand: string;
}

export interface CampaignReportRequest {
  readonly campaignId: string;
  readonly seed: string;
  readonly generatorVersion: string;
  readonly coverage: CoverageSnapshot;
  /** Individual run results only. Aggregated duration/resource summaries are intentionally not accepted. */
  readonly runs: readonly RandomTestRunResult[];
  readonly failures?: readonly CampaignFailureRecord[];
  readonly secretCanaries?: readonly string[];
}

export interface CoverageDimensionReport {
  readonly dimension: CoverageDimension;
  readonly entries: readonly CoverageEntry[];
  readonly blocked: readonly CoverageEntry[];
}

export interface DurationSummary {
  readonly rawSamplesMs: readonly number[];
  readonly minMs: number;
  readonly maxMs: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

export interface CampaignPeakResources {
  readonly activeBrowsers: number;
  readonly activeContexts: number;
  readonly activePages: number;
  readonly activeFlows: number;
  readonly queueDepth: number;
  readonly processRssMb: number;
}

export interface FailureCategoryReport {
  readonly category: FailureCategory;
  readonly count: number;
  readonly signatures: readonly string[];
  readonly reproductionCommands: readonly string[];
}

export interface CampaignReport {
  readonly schemaVersion: typeof CAMPAIGN_REPORT_SCHEMA_VERSION;
  readonly campaignId: string;
  readonly createdAt: string;
  readonly seed: string;
  readonly generatorVersion: string;
  readonly runCount: number;
  readonly outcomes: Readonly<Record<RandomRunOutcome, number>>;
  readonly coverage: readonly CoverageDimensionReport[];
  readonly duration: DurationSummary;
  readonly peaks: CampaignPeakResources;
  readonly failures: readonly FailureCategoryReport[];
  readonly reproductionCommands: readonly string[];
}

export interface CampaignReportWriterOptions {
  readonly outputDirectory?: string;
  readonly now?: () => Date;
}

export interface WrittenCampaignReport {
  readonly directory: string;
  readonly jsonPath: string;
  readonly markdownPath: string;
  readonly report: CampaignReport;
}

function nearestRank(sorted: readonly number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
  return sorted[Math.min(sorted.length - 1, rank - 1)] ?? 0;
}

function durationSummary(runs: readonly RandomTestRunResult[]): DurationSummary {
  const rawSamplesMs = runs.map((run) => run.durationMs);
  const sorted = [...rawSamplesMs].sort((left, right) => left - right);
  return {
    rawSamplesMs,
    minMs: sorted[0] ?? 0,
    maxMs: sorted.at(-1) ?? 0,
    p50Ms: nearestRank(sorted, 50),
    p90Ms: nearestRank(sorted, 90),
    p95Ms: nearestRank(sorted, 95),
    p99Ms: nearestRank(sorted, 99)
  };
}

function coverageByDimension(snapshot: CoverageSnapshot): CoverageDimensionReport[] {
  const dimensions = new Map<CoverageDimension, CoverageEntry[]>();
  for (const entry of snapshot.entries) {
    const list = dimensions.get(entry.dimension) ?? [];
    list.push(structuredClone(entry));
    dimensions.set(entry.dimension, list);
  }
  return [...dimensions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dimension, entries]) => ({
      dimension,
      entries: entries.sort((left, right) => left.key.localeCompare(right.key)),
      blocked: entries.filter((entry) => entry.blockedReason !== undefined)
    }));
}

function peakResources(runs: readonly RandomTestRunResult[]): CampaignPeakResources {
  const samples = runs.flatMap((run) => run.capacitySamples);
  const peak = (pick: (sample: RandomTestRunResult["capacitySamples"][number]) => number): number =>
    samples.reduce((maximum, sample) => Math.max(maximum, pick(sample)), 0);
  return {
    activeBrowsers: peak((sample) => sample.activeBrowsers),
    activeContexts: peak((sample) => sample.activeContexts),
    activePages: peak((sample) => sample.activePages),
    activeFlows: peak((sample) => sample.activeFlows),
    queueDepth: peak((sample) => sample.queueDepth),
    processRssMb: peak((sample) => sample.processRssMb)
  };
}

function failureReports(records: readonly CampaignFailureRecord[]): FailureCategoryReport[] {
  const grouped = new Map<FailureCategory, CampaignFailureRecord[]>();
  for (const record of records) {
    const list = grouped.get(record.category) ?? [];
    list.push(record);
    grouped.set(record.category, list);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, entries]) => ({
      category,
      count: entries.length,
      signatures: [...new Set(entries.flatMap((entry) => (entry.signature ? [entry.signature] : [])))].sort(),
      reproductionCommands: [...new Set(entries.map((entry) => entry.reproductionCommand))].sort()
    }));
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "campaign";
}

async function createUniqueDirectory(root: string, preferredName: string): Promise<string> {
  await mkdir(root, { recursive: true });
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const candidate = join(root, suffix === 0 ? preferredName : `${preferredName}-${suffix}`);
    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Unable to allocate a unique campaign-report directory under ${root}.`);
}

function markdownCell(value: unknown): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function toMarkdown(report: CampaignReport): string {
  const lines = [
    `# Random Test Campaign — ${report.campaignId}`,
    "",
    `- Seed: \`${report.seed}\``,
    `- Generator: \`${report.generatorVersion}\``,
    `- Runs: ${report.runCount}`,
    `- Outcomes: completed ${report.outcomes.completed}, failed ${report.outcomes.failed}, cancelled ${report.outcomes.cancelled}, labTimeout ${report.outcomes.labTimeout}`,
    "",
    "## Duration from raw samples",
    "",
    `Raw samples (ms): ${report.duration.rawSamplesMs.join(", ") || "none"}`,
    "",
    "| Min | P50 | P90 | P95 | P99 | Max |",
    "| ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${report.duration.minMs} | ${report.duration.p50Ms} | ${report.duration.p90Ms} | ${report.duration.p95Ms} | ${report.duration.p99Ms} | ${report.duration.maxMs} |`,
    "",
    "## Peak resources",
    "",
    "| Browsers | Contexts | Pages | Flows | Queue | Process RSS MB |",
    "| ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${report.peaks.activeBrowsers} | ${report.peaks.activeContexts} | ${report.peaks.activePages} | ${report.peaks.activeFlows} | ${report.peaks.queueDepth} | ${report.peaks.processRssMb} |`,
    "",
    "## Coverage",
    ""
  ];
  for (const dimension of report.coverage) {
    lines.push(`### ${dimension.dimension}`, "", "| Key | Generated | Executed | Passed | Blocked reason |", "| --- | ---: | ---: | ---: | --- |");
    for (const entry of dimension.entries) {
      lines.push(
        `| ${markdownCell(entry.key)} | ${entry.counts.generated} | ${entry.counts.executed} | ${entry.counts.passed} | ${markdownCell(entry.blockedReason)} |`
      );
    }
    lines.push("");
  }
  lines.push("## Failures", "");
  if (report.failures.length === 0) lines.push("None.", "");
  for (const failure of report.failures) {
    lines.push(`### ${failure.category} (${failure.count})`, "");
    if (failure.signatures.length > 0) lines.push(`Signatures: ${failure.signatures.map((value) => `\`${value}\``).join(", ")}`, "");
    for (const command of failure.reproductionCommands) lines.push(`- \`${command.replace(/`/g, "\\`")}\``);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export class CampaignReportWriter {
  private readonly outputDirectory: string;
  private readonly now: () => Date;

  constructor(options: CampaignReportWriterOptions = {}) {
    this.outputDirectory = resolve(options.outputDirectory ?? join(process.cwd(), "reports", "random-tests", "campaigns"));
    this.now = options.now ?? (() => new Date());
  }

  async write(request: CampaignReportRequest): Promise<WrittenCampaignReport> {
    const failureRecords = request.failures ?? [];
    const uncoveredRuns = request.runs.filter(
      (run) =>
        (run.outcome !== "completed" || !run.invariants.passed) &&
        !failureRecords.some((failure) => failure.executionId === run.executionId)
    );
    if (uncoveredRuns.length > 0) {
      throw new Error(
        `Campaign failure metadata is missing for: ${uncoveredRuns.map((run) => run.executionId).join(", ")}.`
      );
    }
    if (failureRecords.some((failure) => failure.reproductionCommand.trim().length === 0)) {
      throw new Error("Every campaign failure must include a reproduction command.");
    }
    const createdAt = this.now().toISOString();
    const outcomes: Record<RandomRunOutcome, number> = {
      completed: 0,
      failed: 0,
      cancelled: 0,
      labTimeout: 0
    };
    request.runs.forEach((run) => {
      outcomes[run.outcome] += 1;
    });
    const failures = failureReports(failureRecords);
    const report: CampaignReport = {
      schemaVersion: CAMPAIGN_REPORT_SCHEMA_VERSION,
      campaignId: request.campaignId,
      createdAt,
      seed: request.seed,
      generatorVersion: request.generatorVersion,
      runCount: request.runs.length,
      outcomes,
      coverage: coverageByDimension(request.coverage),
      duration: durationSummary(request.runs),
      peaks: peakResources(request.runs),
      failures,
      reproductionCommands: [...new Set(failures.flatMap((failure) => failure.reproductionCommands))].sort()
    };
    const serialized = JSON.stringify(report);
    for (const canary of request.secretCanaries ?? []) {
      if (serialized.includes(canary)) throw new Error("Refusing to write a campaign report containing a secret canary.");
    }

    const preferredName = `${createdAt.replace(/[:.]/g, "-")}-${safeSegment(request.campaignId)}`;
    const directory = await createUniqueDirectory(this.outputDirectory, preferredName);
    const jsonPath = join(directory, "campaign.json");
    const markdownPath = join(directory, "campaign.md");
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await writeFile(markdownPath, toMarkdown(report), { encoding: "utf8", flag: "wx" });
    return { directory, jsonPath, markdownPath, report };
  }
}
