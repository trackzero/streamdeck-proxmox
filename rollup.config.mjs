import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/plugin.ts",
  output: {
    file: "./com.trackzero.proxmox.sdPlugin/bin/plugin.js",
    format: "cjs",
    sourcemap: true,
    exports: "auto"
  },
  plugins: [
    resolve({
      preferBuiltins: true,
      exportConditions: ["node"]
    }),
    commonjs(),
    json(),
    typescript({
      tsconfig: "./tsconfig.json",
      compilerOptions: {
        module: "ES2022"
      }
    })
  ],
  external: []
};
