import type { FlowStep, NodeConfig, ValueSource } from "@src/profiles/FlowProfile";
import { imageTextAssertionProblems, type ImageTextProblem } from "@src/validation/ImageTextAssertionContract";
import type { FlowDesignerNodeData } from "./flowDesignerTypes";

/**
 * N7.5 (awkit-vra.9.6): the Designer's view of an `assertImageText` node, judged by the same
 * `ImageTextAssertionContract` the flow validator and the step executor use, so the panel, the run gate and the
 * runner refuse a configuration in the same words. Builds only the fields that contract reads.
 */
export function imageTextStepFromDesigner(d: FlowDesignerNodeData): FlowStep {
  let valueSource: ValueSource | undefined;
  if (d.valueSourceType === "dynamic") {
    valueSource = {
      type: "dynamic",
      dataSourceScope: d.dataSourceScope,
      dataSourceId: d.dataSourceId || undefined,
      idMode: d.idMode,
      objectId: d.objectId || undefined,
      keyName: d.keyName || undefined
    };
  } else if (d.valueSourceType !== "static" && d.valueSourceType !== "none") {
    // A source the panel cannot author (secret, environment, ...) is judged exactly as saved.
    valueSource = d.valueSourceOriginal?.type === d.valueSourceType ? d.valueSourceOriginal : undefined;
  }
  return {
    id: "designer",
    type: "assertImageText",
    name: d.name,
    description: d.description,
    mode: d.originalStep?.mode,
    value: d.value,
    valueSource,
    // An unrecognised saved value is not editable, so it is judged as saved (and refused) until the author replaces it.
    config: {
      ...(d.ocrMatch !== undefined ? { ocrMatch: d.ocrMatch } : d.configOriginal?.ocrMatch !== undefined ? { ocrMatch: d.configOriginal.ocrMatch } : {}),
      ...(d.ocrCaseSensitive !== undefined
        ? { ocrCaseSensitive: d.ocrCaseSensitive }
        : d.configOriginal?.ocrCaseSensitive !== undefined
          ? { ocrCaseSensitive: d.configOriginal.ocrCaseSensitive }
          : {})
    } as NodeConfig
  };
}

export function imageTextDesignerProblems(d: FlowDesignerNodeData): ImageTextProblem[] {
  return imageTextAssertionProblems(imageTextStepFromDesigner(d));
}

/** Whether the node states an expected text: a literal, a dynamic binding or a saved non-authorable source. */
export function imageTextHasExpectation(d: FlowDesignerNodeData): boolean {
  if (d.valueSourceType === "dynamic") return true;
  if (d.valueSourceType !== "static" && d.valueSourceType !== "none") return d.valueSourceOriginal?.type === d.valueSourceType;
  return d.value.trim() !== "";
}

/** The registry's inline messages. Never quotes the expected text. */
export function imageTextDesignerMessages(d: FlowDesignerNodeData): string[] {
  const messages = imageTextHasExpectation(d) ? [] : ["Image text assertion requires an expected text or a dynamic binding."];
  for (const problem of imageTextDesignerProblems(d)) messages.push(`Image text assertion ${problem.message}.`);
  return messages;
}
