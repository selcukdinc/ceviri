import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";

// wrangler.jsonc kişiseldir ve git'e girmez; yoksa (CI, ilk klon) şablon kullanılır.
const configPath =
  process.env.WRANGLER_CONFIG || (existsSync("wrangler.jsonc") ? "wrangler.jsonc" : "wrangler.example.jsonc");

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // WRANGLER_CONFIG=wrangler.local.jsonc ile Cloudflare hesabı olmadan yerel geliştirme yapılabilir
    cloudflare({ configPath }),
  ],
});
