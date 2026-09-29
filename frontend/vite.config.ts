import { defineConfig } from "vite";

export default defineConfig({
  base: "/apps/excel-material-search/",
  server: { proxy: { "/apps/excel-material-search/api": "http://127.0.0.1:8080" } }
});
