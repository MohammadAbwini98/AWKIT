import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import type { InstanceExecutionContext, ResolvedDataSource } from "./InstanceExecutionContext";
import { resolveJsonPath, stringifyResolvedValue } from "@src/data/JsonPathResolver";
import type { ValueSource } from "@src/profiles/FlowProfile";

export class ValueResolver {
  constructor(private readonly context: InstanceExecutionContext) {}

  async resolve(valueSource?: ValueSource): Promise<string> {
    if (!valueSource) return "";

    switch (valueSource.type) {
      case "static":
        return String(valueSource.value ?? "");
      case "dynamic":
        return this.resolveDynamic(valueSource);
      case "runtimeInput":
        return String(this.context.runtimeInputs[valueSource.key ?? ""] ?? "");
      case "instanceVariable":
        return String(this.context.instanceInputs[valueSource.key ?? ""] ?? "");
      case "flowOutput":
        return String(this.context.flowOutputs[`${valueSource.flowId}.${valueSource.outputKey}`] ?? "");
      case "env":
        return String(process.env[valueSource.envKey ?? ""] ?? "");
      case "generated":
        return this.generateValue(valueSource.generator);
      case "currentRow":
        return stringifyResolvedValue(resolveJsonPath(this.context.currentRow, valueSource.path ?? "$"));
      case "json":
        return this.readJsonValue(valueSource.file, valueSource.path);
      default:
        throw new Error(`Unsupported value source: ${(valueSource as ValueSource).type}`);
    }
  }

  private async resolveDynamic(valueSource: ValueSource): Promise<string> {
    const scope = valueSource.dataSourceScope ?? "workflow";
    const dataSource =
      scope === "specific" && valueSource.dataSourceId
        ? this.context.dataSources?.[valueSource.dataSourceId]
        : this.context.workflowDataSource;

    if (!dataSource) {
      throw new Error(
        scope === "specific"
          ? `No data source selected for dynamic value (dataSourceId "${valueSource.dataSourceId ?? ""}").`
          : "This workflow has no data source selected for dynamic values."
      );
    }

    const keyName = valueSource.keyName?.trim();
    if (!keyName) throw new Error("Dynamic value requires a key name.");

    const rows = await this.loadRows(dataSource);
    const idMode = valueSource.idMode ?? "explicit";
    const id = idMode === "instanceOrder" ? String(this.context.instanceOrderNumber) : String(valueSource.objectId ?? "").trim();

    if (idMode === "explicit" && !id) {
      throw new Error("Explicit object id is required for this dynamic value.");
    }

    const row = rows.find((item) => item && typeof item === "object" && String((item as Record<string, unknown>).id) === id) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      throw new Error(
        idMode === "instanceOrder"
          ? `Instance order id "${id}" was not found in ${dataSource.name}.`
          : `Object with id "${id}" was not found in ${dataSource.name}.`
      );
    }

    if (!(keyName in row)) {
      throw new Error(`Key "${keyName}" does not exist in object id "${id}".`);
    }

    return stringifyResolvedValue(row[keyName]);
  }

  private async loadRows(dataSource: ResolvedDataSource): Promise<unknown[]> {
    if (dataSource.rows && dataSource.rows.length) return dataSource.rows;
    const data = JSON.parse(await readFile(dataSource.file, "utf8"));
    const resolved = resolveJsonPath(data, dataSource.rootArrayPath || "$");
    return Array.isArray(resolved) ? resolved : [];
  }

  private async readJsonValue(file?: string, path?: string): Promise<string> {
    if (!file) throw new Error("JSON value source requires a file.");
    if (!path) throw new Error("JSON value source requires a path.");

    const cached = this.context.jsonData?.[file];
    const source = cached ?? JSON.parse(await readFile(file, "utf8"));
    return stringifyResolvedValue(resolveJsonPath(source, path));
  }

  private generateValue(generator?: ValueSource["generator"]): string {
    if (generator === "timestamp") return Date.now().toString();
    if (generator === "uuid") return crypto.randomUUID();
    if (generator === "randomNumber") return Math.floor(Math.random() * 100000).toString();
    if (generator === "randomEmail") return `user_${Date.now()}@example.com`;

    throw new Error(`Unsupported generator: ${generator}`);
  }
}
