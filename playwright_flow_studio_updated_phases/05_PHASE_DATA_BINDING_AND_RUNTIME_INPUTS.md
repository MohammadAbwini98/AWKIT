# Phase 5 — Data Binding & Runtime Inputs

## Objective

Allow automation steps to use dynamic values from JSON files, runtime UI fields, environment variables, previous flow outputs, or generated values.

This is required so users do not hardcode values into Playwright scripts.

## Supported Value Sources

```text
Static value
JSON file value
Runtime UI input
Environment variable
Previous flow output
Generated value
```

## Example Use Cases

```text
Fill first name from customers.json
Fill email from users.json
Select account type from Windows UI dropdown
Select country from Windows UI dropdown
Use username/password from .env
Use customer ID from previous flow output
Generate random email
Generate timestamp
Generate UUID
```

## Example JSON Data File

```json
{
  "customer": {
    "firstName": "Mohammad",
    "lastName": "Abwini",
    "email": "mohammad@example.com",
    "country": "JO",
    "accountType": "BUSINESS"
  }
}
```

## Fill Input From JSON

```json
{
  "id": "fill-first-name",
  "type": "fill",
  "name": "Fill First Name",
  "locator": {
    "strategy": "id",
    "value": "firstName"
  },
  "valueSource": {
    "type": "json",
    "file": "data/customers.json",
    "path": "$.customer.firstName"
  },
  "next": "fill-last-name"
}
```

This means:

```text
Find element with id firstName.
Read $.customer.firstName from data/customers.json.
Fill the input with the resolved value.
```

## Dropdown Selection From Windows UI

```json
{
  "id": "select-account-type",
  "type": "select",
  "name": "Select Account Type",
  "locator": {
    "strategy": "id",
    "value": "accountType"
  },
  "selectionMode": "value",
  "valueSource": {
    "type": "runtimeInput",
    "key": "selectedAccountType"
  }
}
```

Runtime input example:

```json
{
  "selectedAccountType": "BUSINESS",
  "selectedCountry": "JO",
  "customerSegment": "VIP"
}
```

The Playwright runner should execute:

```ts
await page.locator("#accountType").selectOption("BUSINESS");
```

## Dropdown Selection Modes

```text
By value
By label
By index
```

Example by label:

```json
{
  "type": "select",
  "selectionMode": "label",
  "valueSource": {
    "type": "runtimeInput",
    "key": "countryLabel"
  }
}
```

Example by index:

```json
{
  "type": "select",
  "selectionMode": "index",
  "valueSource": {
    "type": "static",
    "value": "2"
  }
}
```

## Runtime Input Definition

Each scenario can define runtime input fields.

```json
{
  "runtimeInputs": [
    {
      "key": "selectedAccountType",
      "label": "Account Type",
      "type": "dropdown",
      "required": true,
      "options": [
        { "label": "Personal", "value": "PERSONAL" },
        { "label": "Business", "value": "BUSINESS" },
        { "label": "Corporate", "value": "CORPORATE" }
      ],
      "defaultValue": "BUSINESS"
    },
    {
      "key": "selectedCountry",
      "label": "Country",
      "type": "dropdown",
      "required": true,
      "options": [
        { "label": "Jordan", "value": "JO" },
        { "label": "Saudi Arabia", "value": "SA" },
        { "label": "United Arab Emirates", "value": "AE" }
      ],
      "defaultValue": "JO"
    }
  ]
}
```

## Runtime Input UI

The Windows app should show:

```text
Customer Onboarding Scenario

Customer Data File: [customers.json] [Browse]
Account Type:       [Business ▼]
Country:            [Jordan ▼]
Customer Segment:   [VIP ▼]
Number of Instances:[3]

[Validate Inputs] [Run Scenario]
```

## ValueSource TypeScript Schema

```ts
export type ValueSourceType =
  | "static"
  | "json"
  | "runtimeInput"
  | "env"
  | "flowOutput"
  | "generated";

export interface ValueSource {
  type: ValueSourceType;

  value?: string;

  file?: string;
  path?: string;

  key?: string;

  envKey?: string;

  flowId?: string;
  outputKey?: string;

  generator?: "uuid" | "timestamp" | "randomEmail" | "randomNumber";
}
```

## Value Resolver

The `ValueResolver` is responsible for resolving the final value.

```ts
export class ValueResolver {
  constructor(
    private readonly runtimeInputs: Record<string, unknown>,
    private readonly flowOutputs: Record<string, unknown>
  ) {}

  async resolve(valueSource?: ValueSource): Promise<string> {
    if (!valueSource) return "";

    switch (valueSource.type) {
      case "static":
        return String(valueSource.value ?? "");

      case "runtimeInput":
        return String(this.runtimeInputs[valueSource.key ?? ""] ?? "");

      case "flowOutput":
        return String(
          this.flowOutputs[`${valueSource.flowId}.${valueSource.outputKey}`] ?? ""
        );

      case "env":
        return String(process.env[valueSource.envKey ?? ""] ?? "");

      case "generated":
        return this.generateValue(valueSource.generator);

      case "json":
        return this.readJsonValue(valueSource.file!, valueSource.path!);

      default:
        throw new Error(`Unsupported value source: ${(valueSource as any).type}`);
    }
  }

  private async readJsonValue(file: string, path: string): Promise<string> {
    // Load JSON file and resolve JSONPath.
    return "";
  }

  private generateValue(generator?: string): string {
    if (generator === "timestamp") return Date.now().toString();
    if (generator === "uuid") return crypto.randomUUID();
    if (generator === "randomNumber") return Math.floor(Math.random() * 100000).toString();

    if (generator === "randomEmail") {
      return `user_${Date.now()}@example.com`;
    }

    throw new Error(`Unsupported generator: ${generator}`);
  }
}
```

## Data Binding UI Components

```text
DataBindingEditor.tsx
JsonFilePicker.tsx
JsonPathPicker.tsx
RuntimeValueInput.tsx
DropdownValueSelector.tsx
VariableMapper.tsx
```

## Deliverables

- JSON data loader.
- Runtime input store.
- Value resolver.
- Data binding editor.
- JSON path picker.
- Runtime input panel.
- Fill input from JSON.
- Dropdown select from runtime UI.


## Update: Concurrent Data Context

For concurrent runs, each instance receives an isolated value context: global runtime inputs, scenario inputs, instance inputs, current JSON row, flow outputs, environment variables, and generated values. Add `currentRow` and `instanceVariable` as supported value sources.
