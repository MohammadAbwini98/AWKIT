// Ambient types for Vite static-asset imports in the renderer. Vite resolves these to the bundled
// asset URL (a string). Keep this list to the formats actually imported by renderer source.
declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}
