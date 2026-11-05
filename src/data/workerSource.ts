import rawWorkerCode from "../worker/index.ts?raw";

export const WORKER_INDEX_TS: string = rawWorkerCode;

export const WRANGLER_TOML = `name = "group-finder-pro-bot"
main = "src/index.ts"
compatibility_date = "2025-02-01"
compatibility_flags = ["nodejs_compat"]

# ----------------------------------------------------------------------------
# Cloudflare KV Namespace Binding (Required)
# Run: npx wrangler kv namespace create BOT_KV
# Replace the id below with the generated KV namespace ID from your terminal.
# ----------------------------------------------------------------------------
[[kv_namespaces]]
binding = "BOT_KV"
id = "YOUR_KV_NAMESPACE_ID_HERE"
preview_id = "YOUR_PREVIEW_KV_NAMESPACE_ID_HERE"

[vars]
BOT_USERNAME = "GroupFinderProBot"
# Optional: Direct image URL for Step 4 welcome banner photo
WELCOME_BANNER_URL = ""

# ----------------------------------------------------------------------------
# Secrets (Set via CLI for security — do not commit raw tokens):
# npx wrangler secret put BOT_TOKEN
# ----------------------------------------------------------------------------
`;

export const PACKAGE_JSON_SNIPPET = `{
  "name": "group-finder-pro-worker",
  "version": "1.0.0",
  "private": true,
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
    step: "01. Initialize Project & Install grammY",
    command:
      "npm create cloudflare@latest group-finder-pro -- --type=hello-world-ts && cd group-finder-pro && npm install grammy",
    description:
      "Scaffolds a TypeScript Cloudflare Worker and installs the official grammY Telegram Bot framework.",
  },
  {
    step: "02. Provision Cloudflare KV Namespace",
    command: "npx wrangler kv namespace create BOT_KV",
    description:
      "Creates the persistent BOT_KV database for users, referrals, approved/pending GCs, categories, and force-join channels. Copy the returned ID into wrangler.toml.",
  },
  {
    step: "03. Store Bot Token Secret & Deploy Worker",
    command: "npx wrangler secret put BOT_TOKEN && npx wrangler deploy",
    description:
      "Securely encrypts your BotFather token on Cloudflare's edge network and deploys the script globally.",
  },
  {
    step: "04. Bind Telegram Webhook Automatically",
    command: "curl https://group-finder-pro-bot.<YOUR-SUBDOMAIN>.workers.dev/setWebhook",
    description:
      "Calls the built-in /setWebhook helper route in src/index.ts to register your Worker URL with Telegram.",
  },
];
