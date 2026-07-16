/**
 * Resolve hook (registered by electron-hook.mjs): map the bare specifier `electron` to the local stub.
 * All other specifiers fall through to the next hook (tsx / Node default).
 */
const STUB_URL = new URL("./electron-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "electron") {
    return { url: STUB_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
