import type {
  ConditionalConnectorConfig,
  ConnectorConditionOperator,
  ConnectorConditionSource,
  LoopConnectorConfig
} from "@src/profiles/FlowProfile";
import { FLOW_VALIDATION_LIMITS } from "@src/validation/FlowLimits";
import { defaultLoopCondition, defaultLoopConnectorConfig } from "./loopConnectorAuthoring";

const CONDITION_SOURCES: { value: ConnectorConditionSource; label: string }[] = [
  { value: "outcome", label: "Node outcome" },
  { value: "status", label: "Node status" },
  { value: "errorCode", label: "Error code" },
  { value: "variable", label: "Variable / output" },
  { value: "dataSourceValue", label: "Data source value" }
];

const CONDITION_OPERATORS: { value: ConnectorConditionOperator; label: string }[] = [
  { value: "always", label: "Always" },
  { value: "equals", label: "Equals" },
  { value: "notEquals", label: "Does not equal" },
  { value: "contains", label: "Contains" },
  { value: "notContains", label: "Does not contain" },
  { value: "exists", label: "Exists" },
  { value: "notExists", label: "Does not exist" },
  { value: "greaterThan", label: "Greater than" },
  { value: "greaterThanOrEqual", label: "Greater than or equal" },
  { value: "lessThan", label: "Less than" },
  { value: "lessThanOrEqual", label: "Less than or equal" },
  { value: "truthy", label: "Is truthy" },
  { value: "falsy", label: "Is falsy" }
];

interface ConditionFieldsProps {
  value: ConditionalConnectorConfig;
  onChange: (value: ConditionalConnectorConfig) => void;
}

export function ConditionalConnectorFields({ value, onChange }: ConditionFieldsProps) {
  const needsPath = value.sourceField === "variable" || value.sourceField === "dataSourceValue";
  const needsExpected = !["always", "exists", "notExists", "truthy", "falsy"].includes(value.operator);
  return (
    <>
      <label>
        Condition source
        <select value={value.sourceField} onChange={(event) => onChange({ ...value, sourceField: event.target.value as ConnectorConditionSource })}>
          {CONDITION_SOURCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {needsPath ? (
        <label>
          Variable / path
          <input
            value={value.variableName ?? ""}
            placeholder="outputs.flow.status"
            onChange={(event) => onChange({ ...value, variableName: event.target.value })}
          />
        </label>
      ) : null}
      <label>
        Operator
        <select value={value.operator} onChange={(event) => onChange({ ...value, operator: event.target.value as ConnectorConditionOperator })}>
          {CONDITION_OPERATORS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {needsExpected ? (
        <label>
          Expected value
          <input value={String(value.expectedValue ?? "")} onChange={(event) => onChange({ ...value, expectedValue: event.target.value })} />
        </label>
      ) : null}
    </>
  );
}

interface LoopConnectorEditorProps {
  value?: LoopConnectorConfig;
  onChange: (value: LoopConnectorConfig) => void;
  targetLabel: string;
  dataSources?: { id: string; name: string }[];
}

/** Shared authoring surface used by both visual designers. */
export function LoopConnectorEditor({ value, onChange, targetLabel, dataSources = [] }: LoopConnectorEditorProps) {
  const loop = value ?? defaultLoopConnectorConfig();
  const patch = (next: Partial<LoopConnectorConfig>) => onChange({ ...loop, ...next });

  return (
    <>
      <label>
        Loop target
        <input value={targetLabel} readOnly aria-readonly="true" />
        <small>Structured Loop connectors repeat their source node; the target is fixed to prevent accidental graph cycles.</small>
      </label>
      <label>
        Loop mode
        <select
          value={loop.mode}
          onChange={(event) => {
            const mode = event.target.value as LoopConnectorConfig["mode"];
            patch({ mode, condition: mode === "whileCondition" ? loop.condition ?? defaultLoopCondition() : loop.condition });
          }}
        >
          <option value="count">Count</option>
          <option value="staticList">Static list</option>
          <option value="dataSource">Data source</option>
          <option value="whileCondition">While condition</option>
        </select>
      </label>
      <label>
        Max iterations
        <input
          type="number"
          min={1}
          max={FLOW_VALIDATION_LIMITS.maxLoopIterations}
          value={loop.maxIterations}
          onChange={(event) => patch({ maxIterations: Number.parseInt(event.target.value, 10) || 1 })}
        />
        <small>Hard limit: {FLOW_VALIDATION_LIMITS.maxLoopIterations}. The Conditional exit is evaluated after the loop finishes.</small>
      </label>
      {loop.mode === "staticList" ? (
        <label>
          Static values (comma-separated)
          <input
            value={(loop.staticValues ?? []).join(", ")}
            placeholder="customer1, customer2, customer3"
            onChange={(event) => patch({ staticValues: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
          />
        </label>
      ) : null}
      {loop.mode === "dataSource" ? (
        <>
          <label>
            Data source
            <select value={loop.dataSourceId ?? ""} onChange={(event) => patch({ dataSourceId: event.target.value || undefined })}>
              <option value="">Workflow data source (default)</option>
              {dataSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>
          </label>
          <label>
            Row key (optional)
            <input
              value={loop.dataSourceBinding ?? ""}
              placeholder="email — blank passes the whole row"
              onChange={(event) => patch({ dataSourceBinding: event.target.value })}
            />
          </label>
        </>
      ) : null}
      <label>
        Parameter name (runtime input)
        <input value={loop.parameterName ?? ""} placeholder="item" onChange={(event) => patch({ parameterName: event.target.value })} />
        <small>Each count, list item, or data row is exposed to the repeated node under this key.</small>
      </label>
      <label>
        Delay between iterations (ms)
        <input type="number" min={0} value={loop.delayMs ?? 0} onChange={(event) => patch({ delayMs: Number.parseInt(event.target.value, 10) || 0 })} />
      </label>
      {loop.mode === "whileCondition" ? (
        <>
          <span className="form-message">Repeat while this condition matches the previous loop iteration, up to Max iterations.</span>
          <ConditionalConnectorFields value={loop.condition ?? defaultLoopCondition()} onChange={(condition) => patch({ condition })} />
        </>
      ) : null}
    </>
  );
}
