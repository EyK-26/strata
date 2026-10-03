declare module "*.html" {
  const value: import("bun").HTMLBundle;
  export default value;
}

// Bun's browser bundler accepts CSS imports for their side effects.
declare module "*.css";
