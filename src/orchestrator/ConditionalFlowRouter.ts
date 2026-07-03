export class ConditionalFlowRouter {
  canEvaluate(expression: string): boolean {
    return expression.trim().length > 0;
  }

  route(expression: string, values: Record<string, unknown>): boolean {
    if (!this.canEvaluate(expression)) return false;

    const outputExpression = expression.match(/^\$\{outputs\.([^.]+)\.([^}]+)\}\s*(===|!==|>|<|>=|<=)\s*(.+)$/);
    if (!outputExpression) return false;

    const [, flowId, outputKey, operator, rawExpected] = outputExpression;
    const actual = values[`${flowId}.${outputKey}`];
    const expected = this.normalizeExpectedValue(rawExpected);

    switch (operator) {
      case "===":
        return String(actual) === String(expected);
      case "!==":
        return String(actual) !== String(expected);
      case ">":
        return Number(actual) > Number(expected);
      case "<":
        return Number(actual) < Number(expected);
      case ">=":
        return Number(actual) >= Number(expected);
      case "<=":
        return Number(actual) <= Number(expected);
      default:
        return false;
    }
  }

  private normalizeExpectedValue(value: string): string {
    return value.trim().replace(/^["']|["']$/g, "");
  }
}
