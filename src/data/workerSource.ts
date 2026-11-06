import rawWorkerCode from "../index.ts?raw";
import rawWranglerToml from "../../wrangler.toml?raw";

export const WORKER_INDEX_TS: string = rawWorkerCode;

export const WRANGLER_TOML: string = rawWranglerToml;

export const PACKAGE_JSON_SNIPPET = `{
  "name": "group-finder-pro",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "grammy": "^1.35.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250204.0",
    "typescript": "^5.7.3",
    "wrangler": "^3.107.0"
  }
}`;

export const DEPLOYMENT_STEPS = [
  {
    step: "01. Provision & Bind Cloudflare KV Namespace (BOT_KV)",
    command: "npx wrangler kv namespace create BOT_KV",
    description:
      "Creates the BOT_KV namespace and outputs its ID. Replace YOUR_KV_NAMESPACE_ID_HERE in wrangler.toml with this ID (or bind BOT_KV directly in the Cloudflare Dashboard -> Worker Settings -> Bindings).",
  },
  {
    step: "02. Add Encrypted Secret BOT_TOKEN",
    command: "npx wrangler secret put BOT_TOKEN",
    description:
      "Prompts you to paste your Telegram Bot Token from @BotFather and stores it as an encrypted secret variable.",
  },
  {
    step: "03. Deploy Pure Cloudflare Worker Module (has_modules: true)",
    command: "npx wrangler deploy",
    description:
      "Deploys src/index.ts as an ES Module Worker using wrangler.toml (with zero static [assets] blocks so Cloudflare runs export default { fetch }).",
  },
  {
    step: "04. Register Telegram Webhook Automatically",
    command: "curl https://group-finder-pro.<YOUR-SUBDOMAIN>.workers.dev/setWebhook",
    description:
      "Invokes the built-in GET /setWebhook handler in src/index.ts to bind your Worker URL to the Telegram Bot API.",
  },
];
