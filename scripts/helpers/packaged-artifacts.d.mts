/**
 * Types for `packaged-artifacts.mjs`.
 *
 * The implementation is `.mjs` because `verify-zvec-packaged-assets.mjs` runs under plain node and
 * cannot import a `.mts` module, while the two `.mts` verifiers are type-checked by
 * `tsconfig.scripts.json` and need declarations. One implementation, both callers, and the typecheck
 * gate stays green.
 */
export declare const repoRoot: string;
export declare function appVersion(root?: string): string;
export declare function portableExePath(root?: string): string;
export declare function setupExePath(root?: string): string;
export declare function setupExeName(root?: string): string;
export declare function missingArtifactHint(path: string, command: string): string;
export declare function portableExeExists(root?: string): boolean;
