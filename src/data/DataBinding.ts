import type { ValueSource } from "@src/profiles/FlowProfile";

export interface DataBindingPreview {
  label: string;
  valueSource: ValueSource;
  resolvedValue: string;
  status: "resolved" | "missing" | "error";
  detail?: string;
}
