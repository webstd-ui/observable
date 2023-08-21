import { defineConfig } from "vite"

import typescript from "@rollup/plugin-typescript"

export default defineConfig(({ command, mode }) => ({
    plugins: [typescript()],
    build: {
        lib: {
            entry: "src/index.ts",
            name: "@webstd-ui/observable",
            formats: ["es"],
            fileName: "index",
        },
    },
    clearScreen: command === "serve" && mode === "development",
}))
