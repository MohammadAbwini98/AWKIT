/**
 * Types for the plain-JS `build-oracle-bridge.mjs` helper, so the `.mts` verifiers that import it
 * type-check under `tsconfig.scripts.json` instead of falling back to an implicit `any`.
 * Mirrors the single export and its return shape; kept beside the module it describes.
 */
export declare function buildOracleBridge(options?: { quiet?: boolean }): {
  /** Resolved JDK ≥17 (see `resolveJdk` in the implementation). */
  jdk: { home: string; javac: string; java: string; jar: string };
  jarPath: string;
  classesDir: string;
  mainClass: string;
  oracleCompiled: boolean;
};
