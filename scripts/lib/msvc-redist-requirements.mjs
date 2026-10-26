/**
 * The app-local Microsoft Visual C++ runtime requirements of the local-AI packaging step (awkit-i6ot), as
 * `scripts/verify-packaging-host.mjs` reports them. `scripts/prepare-ai-native-host.mjs` keeps its own declarations,
 * because verify:ai-packaged-runtime runs a byte-identical copy of it alone in a scratch repository where no shared
 * module exists. The H6 check compares this module with those declarations value by value and fails on drift.
 *
 * Owner decision 2026-09-25: the runtime DLLs ship app-locally beside the native binaries, taken only from the
 * Visual Studio 2022 redist folder. Microsoft's Distributable Code list for Visual Studio 2022
 * (learn.microsoft.com/visualstudio/releases/2022/redistribution) grants the VC\redist files to validly licensed
 * Enterprise, Professional and Community 2022 only; Build Tools is not on it, and another major version has its own
 * terms, so nothing else is accepted.
 */

/** The runtime DLLs the staged llama/ggml binaries and the reflink addon import. */
export const MSVC_RUNTIME = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"];

/** Minimum runtime version: the 14.40 STL (VS 2022 17.10) floor, raised to the newest linker of a staged binary. */
export const MSVC_RUNTIME_FLOOR = [14, 40];

/** Both components are required: the tools write the redist version file, the redist component the CRT folder. */
export const VS_COMPONENTS = ["Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "Microsoft.VisualStudio.Component.VC.Redist.14.Latest"];

/** The Visual Studio 2022 editions whose license covers redistribution of the VC\redist files. */
export const VS_PRODUCTS = ["Microsoft.VisualStudio.Product.Community", "Microsoft.VisualStudio.Product.Professional", "Microsoft.VisualStudio.Product.Enterprise"];

/** Visual Studio 2022 only. */
export const VS_VERSION_RANGE = "[17.0,18.0)";

/** The exact remedy, in the Visual Studio Installer's own wording. */
export const MSVC_REMEDY =
  'add "MSVC v143 - VS 2022 C++ x64/x86 build tools (Latest)" and "C++ 2022 Redistributable Update" to a validly licensed ' +
  "Visual Studio 2022 Community, Professional or Enterprise (Visual Studio Installer, Modify, Individual components), " +
  "or package on a Windows x64 release host that has them; then run npm run verify:packaging-host";
