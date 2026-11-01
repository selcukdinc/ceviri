import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // WRANGLER_CONFIG=wrangler.local.jsonc ile Cloudflare hesabı olmadan yerel geliştirme yapılabilir
    cloudflare({ configPath: process.env.WRANGLER_CONFIG || "wrangler.jsonc" }),
  ],
});
