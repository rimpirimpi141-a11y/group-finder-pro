/**
 * ============================================================================
 * 𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔 (Group Finder Pro) — Cloudflare Worker Telegram Bot
 * ============================================================================
 * Framework : grammY (https://grammy.dev) — Webhooks on Cloudflare Workers
 * Module    : ES Module Worker (has_modules: true) -> export default { fetch }
 * Storage   : Cloudflare Workers KV (Binding: BOT_KV)
 * Owner     : @aaditya334356
 * Admin ID  : 8838351233
 * ============================================================================
 */

import { Bot, Context, InlineKeyboard, webhookCallback } from "grammy";

// ----------------------------------------------------------------------------
// 1. CLOUDFLARE WORKER KV & ENVIRONMENT INTERFACES
// ----------------------------------------------------------------------------

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface Env {
  BOT_KV: KVNamespace;
  BOT_TOKEN: string;
  BOT_USERNAME?: string;
  WELCOME_BANNER_URL?: string;
}

export const BOT_NAME = "𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔";
export const OWNER_USERNAME = "@aaditya334356";
export const OWNER_URL = "https://t.me/aaditya334356";
export const ADMIN_ID = 8838351233;

export const DEFAULT_CATEGORIES: string[] = [
  "Earning Discussion",
  "Promotion Zone",
  "Chatting & Friends",
  "Escrow GC",
  "Gaming / Tech",
];

export type SessionStep =
  | "IDLE"
  | "SUBMIT_GC_LINK"
  | "SUBMIT_GC_TITLE"
  | "SUBMIT_GC_NOTE"
  | "SEARCH_GC_QUERY"
  | "REPORT_GC_REASON"
  | "ADMIN_ADD_FORCE_CHANNEL"
  | "ADMIN_ADD_CATEGORY"
  | "ADMIN_ADD_SPONSORED"
  | "ADMIN_BROADCAST"
  | "ADMIN_REJECT_NOTE"
  | "ADMIN_SET_REWARDS";

export interface UserProfile {
  id: number;
  username: string;
  firstName: string;
  joinedAt: string;
  referredBy: number | null;
  referrals: number[]; // Array of referred Telegram user IDs
  submittedGcIds: string[];
  step: SessionStep;
  draft: {
    category?: string;
    link?: string;
    title?: string;
    targetGcId?: string;
  };
}

export interface GroupChatItem {
  id: string;
  title: string;
  category: string;
  link: string;
  note: string;
  submittedBy: number;
  submitterUsername: string;
  status: "pending" | "approved" | "rejected";
  isSponsored?: boolean;
  createdAt: string;
  adminNote?: string;
}

export interface ForceChannel {
  id: string; // e.g., "@channelusername" or "-100123456789"
  title: string;
  inviteLink: string;
}

export interface BotConfig {
  maintenanceMode: boolean;
  requiredReferrals: number;
  baseGcLimit: number;
  unlockedGcLimit: number;
  rewardAnnouncement: string;
  sponsoredBannerText: string;
  sponsoredBannerUrl: string;
}

const DEFAULT_CONFIG: BotConfig = {
  maintenanceMode: false,
  requiredReferrals: 3,
  baseGcLimit: 2,
  unlockedGcLimit: 10,
  rewardAnnouncement:
    "Refer 3 active users to unlock 🌟 Sponsored / Top GCs & boost your submission limit to 10 GCs!",
  sponsoredBannerText:
    "🔥 Promote your Group or Channel here! Contact @aaditya334356 for pinned Sponsored slots.",
  sponsoredBannerUrl: "https://t.me/aaditya334356",
};

// ----------------------------------------------------------------------------
// 2. CLOUDFLARE KV DATABASE HELPERS
// ----------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getKvJson<T>(kv: KVNamespace, key: string, fallback: T): Promise<T> {
  const raw = await kv.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function setKvJson<T>(kv: KVNamespace, key: string, value: T): Promise<void> {
  await kv.put(key, JSON.stringify(value));
}

async function getConfig(kv: KVNamespace): Promise<BotConfig> {
  return getKvJson<BotConfig>(kv, "config:settings", DEFAULT_CONFIG);
}

async function saveConfig(kv: KVNamespace, config: BotConfig): Promise<void> {
  await setKvJson(kv, "config:settings", config);
}

async function getCategories(kv: KVNamespace): Promise<string[]> {
  return getKvJson<string[]>(kv, "config:categories", DEFAULT_CATEGORIES);
}

async function saveCategories(kv: KVNamespace, categories: string[]): Promise<void> {
  await setKvJson(kv, "config:categories", categories);
}

async function getForceChannels(kv: KVNamespace): Promise<ForceChannel[]> {
  return getKvJson<ForceChannel[]>(kv, "config:force_channels", []);
}

async function saveForceChannels(kv: KVNamespace, channels: ForceChannel[]): Promise<void> {
  await setKvJson(kv, "config:force_channels", channels);
}

async function getOrCreateUser(
  kv: KVNamespace,
  from: { id: number; username?: string; first_name?: string }
): Promise<{ user: UserProfile; isNew: boolean }> {
  const key = `user:${from.id}`;
  const existing = await getKvJson<UserProfile | null>(kv, key, null);

  if (existing) {
    let updated = false;
    const cleanUsername = from.username ? `@${from.username}` : "NoUsername";
    if (existing.username !== cleanUsername) {
      existing.username = cleanUsername;
      updated = true;
    }
    if (from.first_name && existing.firstName !== from.first_name) {
      existing.firstName = from.first_name;
      updated = true;
    }
    if (updated) await setKvJson(kv, key, existing);
    return { user: existing, isNew: false };
  }

  const newUser: UserProfile = {
    id: from.id,
    username: from.username ? `@${from.username}` : "NoUsername",
    firstName: from.first_name || "User",
    joinedAt: new Date().toISOString(),
    referredBy: null,
    referrals: [],
    submittedGcIds: [],
    step: "IDLE",
    draft: {},
  };

  await setKvJson(kv, key, newUser);

  // Register in master user index for Admin Users List & Broadcasts
  const index = await getKvJson<number[]>(kv, "users:index", []);
  if (!index.includes(from.id)) {
    index.push(from.id);
    await setKvJson(kv, "users:index", index);
  }

  return { user: newUser, isNew: true };
}

async function saveUser(kv: KVNamespace, user: UserProfile): Promise<void> {
  await setKvJson(kv, `user:${user.id}`, user);
}

async function getApprovedGcs(kv: KVNamespace): Promise<GroupChatItem[]> {
  return getKvJson<GroupChatItem[]>(kv, "gcs:approved", []);
}

async function getPendingGcs(kv: KVNamespace): Promise<GroupChatItem[]> {
  return getKvJson<GroupChatItem[]>(kv, "gcs:pending", []);
}

// ----------------------------------------------------------------------------
// 3. KEYBOARD BUILDERS (USER MENU & ADMIN PANEL)
// ----------------------------------------------------------------------------

function buildUserMainMenu(userId: number, isUnlocked: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("📂 Browse Categories", "menu:categories")
    .text(
      isUnlocked ? "🌟 Sponsored / Top GCs" : "🌟 Sponsored / Top GCs 🔒",
      "menu:sponsored"
    )
    .row()
    .text("➕ Submit New GC", "menu:submit_gc")
    .text("📂 My Submitted GCs", "menu:my_gcs")
    .row()
    .text("🎁 Refer & Unlock", "menu:refer")
    .text("📊 My Referral Stats", "menu:ref_stats")
    .row()
    .text("🔍 Quick Search GC", "menu:search")
    .text("🚨 Report Inactive GC", "menu:report")
    .row()
    .text("❓ How It Works", "menu:how_it_works")
    .url("💬 Support / Contact", OWNER_URL);

  if (userId === ADMIN_ID) {
    kb.row().text("🛡️ Admin Control Panel (Owner)", "admin:home");
  }

  return kb;
}

function buildAdminPanelKeyboard(maintenanceMode: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .text("🟢 Manage Payouts/Rewards", "admin:rewards")
    .text("👥 View Users List (GC Count)", "admin:users:0")
    .row()
    .text("➕ Add Force Channels", "admin:add_fsub")
    .text("📋 View/Remove Channels/GCs", "admin:manage_items")
    .row()
    .text("📥 Pending Submissions", "admin:pending:0")
    .text("⚙️ Manage Categories", "admin:categories")
    .row()
    .text("🏷️ Add Sponsored Banner", "admin:sponsored")
    .text(
      maintenanceMode ? "🟢 Disable Maintenance Mode" : "🔴 Toggle Maintenance Mode",
      "admin:toggle_maint"
    )
    .row()
    .text("📊 Bot Detailed Stats", "admin:stats")
    .text("📢 Broadcast Message", "admin:broadcast")
    .row()
    .text("🔴 Back to User Menu", "menu:home");
}

function buildBackToMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🔙 Back to Main Menu", "menu:home");
}

function buildBackToAdminKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🔴 Back to Admin Panel", "admin:home");
}

// ----------------------------------------------------------------------------
// 4. FORCE SUBSCRIPTION VERIFICATION
// ----------------------------------------------------------------------------

async function checkForceSubscription(
  ctx: Context,
  kv: KVNamespace,
  userId: number
): Promise<{ passed: boolean; missing: ForceChannel[] }> {
  if (userId === ADMIN_ID) return { passed: true, missing: [] };

  const channels = await getForceChannels(kv);
  if (channels.length === 0) return { passed: true, missing: [] };

  const missing: ForceChannel[] = [];
  for (const ch of channels) {
    try {
      const member = await ctx.api.getChatMember(ch.id, userId);
      if (member.status === "left" || member.status === "kicked") {
        missing.push(ch);
      }
    } catch {
      // If bot is not admin in target channel yet, skip blocking to prevent lockouts
    }
  }

  return { passed: missing.length === 0, missing };
}

// ----------------------------------------------------------------------------
// 5. DASHBOARD TEXT FORMATTER
// ----------------------------------------------------------------------------

function formatWelcomeCaption(
  user: UserProfile,
  config: BotConfig,
  totalApprovedGcs: number
): string {
  const isUnlocked = user.referrals.length >= config.requiredReferrals;
  return (
    `✨ <b>Welcome to ${BOT_NAME}</b> ✨\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👋 Hello, <b>${escapeHtml(user.firstName)}</b>!\n` +
    `🌐 The #1 Verified Telegram Group Directory & Discovery Engine.\n\n` +
    `📌 <b>Your Account Status:</b>\n` +
    `├ 🆔 <b>User ID:</b> <code>${user.id}</code>\n` +
    `├ 👥 <b>Referrals:</b> <code>${user.referrals.length} / ${config.requiredReferrals}</code>\n` +
    `├ 🌟 <b>VIP Access:</b> ${isUnlocked ? "✅ <b>Unlocked</b>" : "🔒 <b>Locked (Refer to Unlock)</b>"}\n` +
    `└ 📂 <b>Verified GCs Live:</b> <code>${totalApprovedGcs}</code>\n\n` +
    `📢 <b>Sponsored:</b> ${escapeHtml(config.sponsoredBannerText)}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👨‍💻 <b>Developer:</b> ${OWNER_USERNAME}\n` +
    `👇 <i>Choose an option from the interactive menu below:</i>`
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ----------------------------------------------------------------------------
// 6. MAIN CLOUDFLARE WORKER MODULE ENTRYPOINT (has_modules: true)
// ----------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check & automatic Telegram webhook registration route
    if (request.method === "GET") {
      if (url.pathname === "/setWebhook") {
        if (!env.BOT_TOKEN) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "BOT_TOKEN secret is not configured yet. Run: npx wrangler secret put BOT_TOKEN",
            }),
            { status: 500, headers: { "content-type": "application/json" } }
          );
        }
        const webhookUrl = `${url.origin}/`;
        const res = await fetch(
          `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
        );
        const data = await res.json();
        return new Response(
          JSON.stringify({ ok: true, webhookUrl, telegramResponse: data }, null, 2),
          { headers: { "content-type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          bot: BOT_NAME,
          owner: OWNER_USERNAME,
          adminId: ADMIN_ID,
          workerModule: true,
          kvBound: Boolean(env.BOT_KV),
          tokenConfigured: Boolean(env.BOT_TOKEN),
          status: "Cloudflare Worker Module Active",
          tip: "Visit /setWebhook to bind your Telegram Bot webhook automatically.",
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    if (!env.BOT_TOKEN) {
      return new Response("Missing BOT_TOKEN secret", { status: 500 });
    }

    const bot = new Bot(env.BOT_TOKEN);
    const kv = env.BOT_KV;

    // ------------------------------------------------------------------------
    // MIDDLEWARE: Maintenance Mode & Force Subscription Check
    // ------------------------------------------------------------------------
    bot.use(async (c, next) => {
      if (!c.from) return;
      const config = await getConfig(kv);

      // Maintenance Lock (Admin bypasses)
      if (config.maintenanceMode && c.from.id !== ADMIN_ID) {
        if (c.callbackQuery) {
          await c.answerCallbackQuery({
            text: "🛠️ Group Finder Pro is currently undergoing scheduled maintenance. Please try again shortly!",
            show_alert: true,
          });
        } else {
          await c.reply(
            `🛠️ <b>${BOT_NAME} — Maintenance Mode</b>\n\nWe are upgrading our directory servers. Please check back soon!\n\n💬 Contact: ${OWNER_USERNAME}`,
            { parse_mode: "HTML" }
          );
        }
        return;
      }

      // Allow /start to run so referral tracking happens first, then check force sub
      const isStartCmd = c.message?.text?.startsWith("/start");
      if (!isStartCmd && c.from.id !== ADMIN_ID) {
        const fsub = await checkForceSubscription(c, kv, c.from.id);
        if (!fsub.passed) {
          const kb = new InlineKeyboard();
          for (const ch of fsub.missing) {
            kb.url(`📢 Join ${ch.title}`, ch.inviteLink).row();
          }
          kb.text("✅ I Have Joined — Verify", "fsub:verify");

          const msgText =
            `🔒 <b>Access Restricted!</b>\n\n` +
            `To use <b>${BOT_NAME}</b>, you must be a member of our official sponsor channels below. Join and tap <b>Verify</b>:`;

          if (c.callbackQuery) {
            await c.answerCallbackQuery({
              text: "⚠️ Please join required channels first!",
              show_alert: true,
            });
            await c.reply(msgText, { parse_mode: "HTML", reply_markup: kb });
          } else {
            await c.reply(msgText, { parse_mode: "HTML", reply_markup: kb });
          }
          return;
        }
      }

      await next();
    });

    // ------------------------------------------------------------------------
    // COMMAND: /start (With 4-Step Dynamic Loading Animation & Referral Credit)
    // ------------------------------------------------------------------------
    bot.command("start", async (c) => {
      if (!c.from) return;
      const { user, isNew } = await getOrCreateUser(kv, c.from);
      const config = await getConfig(kv);

      // Reset any active input state
      user.step = "IDLE";
      user.draft = {};

      // Process Referral Deep-Link Payload (e.g., /start ref_123456)
      const payload = c.match?.trim() || "";
      if (isNew && payload.startsWith("ref_")) {
        const refId = parseInt(payload.replace("ref_", ""), 10);
        if (!isNaN(refId) && refId !== user.id) {
          const referrer = await getKvJson<UserProfile | null>(kv, `user:${refId}`, null);
          if (referrer && !referrer.referrals.includes(user.id)) {
            user.referredBy = refId;
            referrer.referrals.push(user.id);
            await saveUser(kv, referrer);

            // Notify Referrer of successful referral
            try {
              await c.api.sendMessage(
                refId,
                `🎉 <b>New Referral Joined!</b>\n\n` +
                  `👤 <b>User:</b> ${escapeHtml(user.firstName)}\n` +
                  `📊 <b>Total Referrals:</b> <code>${referrer.referrals.length} / ${config.requiredReferrals}</code>\n` +
                  (referrer.referrals.length >= config.requiredReferrals
                    ? `🌟 <b>Congratulations! You have unlocked Sponsored / Top GCs & extra GC slots!</b>`
                    : `🎁 Refer <code>${config.requiredReferrals - referrer.referrals.length}</code> more friends to unlock VIP features!`),
                { parse_mode: "HTML" }
              );
            } catch {
              // Ignore if referrer blocked the bot
            }
          }
        }
      }

      await saveUser(kv, user);

      // 4-Step Smooth Dynamic Loading Sequence
      const loadingMsg = await c.reply("⚡ <b>Loading Universal Directory...</b>", {
        parse_mode: "HTML",
      });

      await sleep(650);
      try {
        await c.api.editMessageText(
          c.chat.id,
          loadingMsg.message_id,
          "🔄 <b>Fetching Categories & Verified GCs [35%]</b>\n<code>[████░░░░░░]</code>",
          { parse_mode: "HTML" }
        );
      } catch {}

      await sleep(650);
      try {
        await c.api.editMessageText(
          c.chat.id,
          loadingMsg.message_id,
          "✨ <b>Optimizing Experience [100%]</b>\n<code>[██████████]</code>",
          { parse_mode: "HTML" }
        );
      } catch {}

      await sleep(450);

      // Check Force Subscription before revealing dashboard
      const fsub = await checkForceSubscription(c, kv, user.id);
      if (!fsub.passed) {
        const kb = new InlineKeyboard();
        for (const ch of fsub.missing) {
          kb.url(`📢 Join ${ch.title}`, ch.inviteLink).row();
        }
        kb.text("✅ I Have Joined — Verify", "fsub:verify");

        await c.api.editMessageText(
          c.chat.id,
          loadingMsg.message_id,
          `🔒 <b>Almost There, ${escapeHtml(user.firstName)}!</b>\n\nPlease join our official channels below to unlock the <b>${BOT_NAME}</b> directory:`,
          { parse_mode: "HTML", reply_markup: kb }
        );
        return;
      }

      const approvedGcs = await getApprovedGcs(kv);
      const isUnlocked = user.referrals.length >= config.requiredReferrals;
      const caption = formatWelcomeCaption(user, config, approvedGcs.length);
      const menuKb = buildUserMainMenu(user.id, isUnlocked);

      // Step 4: Final Welcome Banner Photo or Rich Dashboard Message
      if (env.WELCOME_BANNER_URL) {
        try {
          await c.api.deleteMessage(c.chat.id, loadingMsg.message_id);
          await c.replyWithPhoto(env.WELCOME_BANNER_URL, {
            caption,
            parse_mode: "HTML",
            reply_markup: menuKb,
          });
          return;
        } catch {
          // Fallback to text edit if photo URL fails
        }
      }

      await c.api.editMessageText(c.chat.id, loadingMsg.message_id, caption, {
        parse_mode: "HTML",
        reply_markup: menuKb,
        link_preview_options: { is_disabled: true },
      });
    });

    // ------------------------------------------------------------------------
    // COMMAND: /admin (Direct shortcut for Admin ID: 8838351233)
    // ------------------------------------------------------------------------
    bot.command("admin", async (c) => {
      if (!c.from || c.from.id !== ADMIN_ID) {
        await c.reply(
          "⛔ <b>Access Denied:</b> This area is restricted to the Bot Owner (@aaditya334356).",
          { parse_mode: "HTML" }
        );
        return;
      }
      const config = await getConfig(kv);
      await c.reply(
        `🛡️ <b>${BOT_NAME} — Admin Control Center</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👑 <b>Owner:</b> ${OWNER_USERNAME} (<code>${ADMIN_ID}</code>)\n` +
          `🛠️ <b>Maintenance:</b> ${config.maintenanceMode ? "🔴 ACTIVE" : "🟢 OFF"}\n` +
          `🎁 <b>Required Referrals:</b> <code>${config.requiredReferrals}</code>\n\n` +
          `Select an administrative module below:`,
        {
          parse_mode: "HTML",
          reply_markup: buildAdminPanelKeyboard(config.maintenanceMode),
        }
      );
    });

    // ------------------------------------------------------------------------
    // CALLBACK QUERIES: USER MENU & NAVIGATION
    // ------------------------------------------------------------------------
    bot.on("callback_query:data", async (c) => {
      const data = c.callbackQuery.data;
      const from = c.from;
      const { user } = await getOrCreateUser(kv, from);
      const config = await getConfig(kv);
      const approvedGcs = await getApprovedGcs(kv);
      const isUnlocked = user.referrals.length >= config.requiredReferrals;

      // Helper to safely edit current message (handles photo captions vs text messages)
      const renderScreen = async (text: string, kb: InlineKeyboard) => {
        try {
          if (c.callbackQuery.message?.photo) {
            await c.editMessageCaption({ caption: text, parse_mode: "HTML", reply_markup: kb });
          } else {
            await c.editMessageText(text, {
              parse_mode: "HTML",
              reply_markup: kb,
              link_preview_options: { is_disabled: true },
            });
          }
        } catch {
          await c.reply(text, {
            parse_mode: "HTML",
            reply_markup: kb,
            link_preview_options: { is_disabled: true },
          });
        }
      };

      // 1. Force Sub Verify
      if (data === "fsub:verify") {
        const fsub = await checkForceSubscription(c, kv, user.id);
        if (!fsub.passed) {
          await c.answerCallbackQuery({
            text: "❌ You still haven't joined all required channels!",
            show_alert: true,
          });
          return;
        }
        await c.answerCallbackQuery({ text: "✅ Verified! Welcome to Group Finder Pro." });
        await renderScreen(
          formatWelcomeCaption(user, config, approvedGcs.length),
          buildUserMainMenu(user.id, isUnlocked)
        );
        return;
      }

      // 2. Main Home Menu
      if (data === "menu:home") {
        user.step = "IDLE";
        user.draft = {};
        await saveUser(kv, user);
        await c.answerCallbackQuery();
        await renderScreen(
          formatWelcomeCaption(user, config, approvedGcs.length),
          buildUserMainMenu(user.id, isUnlocked)
        );
        return;
      }

      // 3. Browse Categories
      if (data === "menu:categories") {
        const categories = await getCategories(kv);
        const kb = new InlineKeyboard();
        categories.forEach((cat, idx) => {
          const count = approvedGcs.filter((g) => g.category === cat).length;
          kb.text(`📂 ${cat} (${count})`, `cat:view:${idx}:0`);
          if (idx % 2 === 1) kb.row();
        });
        kb.row().text("🔙 Back to Main Menu", "menu:home");

        await c.answerCallbackQuery();
        await renderScreen(
          `📂 <b>Browse Verified Categories</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Select a category below to explore active Telegram Groups & Communities:`,
          kb
        );
        return;
      }

      // 4. View Specific Category (Paginated)
      if (data.startsWith("cat:view:")) {
        const [, , catIdxStr, pageStr] = data.split(":");
        const catIdx = parseInt(catIdxStr, 10);
        const page = parseInt(pageStr, 10) || 0;
        const categories = await getCategories(kv);
        const categoryName = categories[catIdx] || "Category";

        const items = approvedGcs.filter((g) => g.category === categoryName);
        const pageSize = 5;
        const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
        const slice = items.slice(page * pageSize, (page + 1) * pageSize);

        const kb = new InlineKeyboard();
        let text =
          `📂 <b>Category: ${escapeHtml(categoryName)}</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n`;

        if (slice.length === 0) {
          text += `<i>No groups have been approved in this category yet. Be the first to submit one!</i>\n`;
          kb.text("➕ Submit GC Here", `submit:pick:${catIdx}`).row();
        } else {
          slice.forEach((gc, idx) => {
            const num = page * pageSize + idx + 1;
            text +=
              `<b>${num}. ${escapeHtml(gc.title)}</b> ${gc.isSponsored ? "🌟" : ""}\n` +
              `├ 📝 <i>${escapeHtml(gc.note)}</i>\n` +
              `└ 🆔 Code: <code>${gc.id}</code>\n\n`;
            kb.url(`🚀 Join: ${gc.title}`, gc.link).row();
          });

          // Pagination row
          if (totalPages > 1) {
            if (page > 0) kb.text("⬅️ Prev", `cat:view:${catIdx}:${page - 1}`);
            kb.text(`📄 ${page + 1}/${totalPages}`, "noop");
            if (page + 1 < totalPages) kb.text("Next ➡️", `cat:view:${catIdx}:${page + 1}`);
            kb.row();
          }
        }

        kb.text("🔙 Back to Categories", "menu:categories").text("🏠 Home", "menu:home");
        await c.answerCallbackQuery();
        await renderScreen(text, kb);
        return;
      }

      // 5. Sponsored / Top GCs (Refer-to-Unlock Gate)
      if (data === "menu:sponsored") {
        if (!isUnlocked && user.id !== ADMIN_ID) {
          const needed = config.requiredReferrals - user.referrals.length;
          await c.answerCallbackQuery({
            text: `🔒 Locked! Refer ${needed} more friend(s) to unlock Sponsored & Top GCs.`,
            show_alert: true,
          });

          const botUsername = env.BOT_USERNAME || c.me.username;
          const refLink = `https://t.me/${botUsername}?start=ref_${user.id}`;
          const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent("🔥 Join Group Finder Pro — Discover & Promote the best Telegram Groups!")}`;

          const kb = new InlineKeyboard()
            .url("📤 Share Referral Link Now", shareUrl)
            .row()
            .text("🔙 Back to Main Menu", "menu:home");

          await renderScreen(
            `🔒 <b>Sponsored / Top GCs — Locked!</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━━━\n` +
              `To maintain high quality and reward active community members, access to <b>🌟 Sponsored / Top GCs</b> and extra GC submission slots requires <b>${config.requiredReferrals} Referrals</b>.\n\n` +
              `📊 <b>Your Progress:</b> <code>${user.referrals.length} / ${config.requiredReferrals}</code> Referrals\n` +
              `🔗 <b>Your Unique Referral Link:</b>\n<code>${refLink}</code>\n\n` +
              `💡 <i>Share your link with ${needed} more friend(s) to unlock immediately!</i>`,
            kb
          );
          return;
        }

        const sponsoredList = approvedGcs.filter((g) => g.isSponsored);
        const topList = sponsoredList.length > 0 ? sponsoredList : approvedGcs.slice(0, 5);

        const kb = new InlineKeyboard();
        let text =
          `🌟 <b>Sponsored & Top Verified GCs</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🏆 <i>Exclusive high-engagement communities unlocked via your VIP status:</i>\n\n`;

        if (topList.length === 0) {
          text += `<i>No sponsored groups listed right now. Contact ${OWNER_USERNAME} for featured placement!</i>\n`;
        } else {
          topList.forEach((gc, i) => {
            text +=
              `🌟 <b>${i + 1}. ${escapeHtml(gc.title)}</b> [<i>${escapeHtml(gc.category)}</i>]\n` +
              `└ 📝 ${escapeHtml(gc.note)}\n\n`;
            kb.url(`🌟 Join ${gc.title}`, gc.link).row();
          });
        }

        kb.url("💎 Buy Sponsored Slot", config.sponsoredBannerUrl).row();
        kb.text("🔙 Back to Main Menu", "menu:home");
        await c.answerCallbackQuery();
        await renderScreen(text, kb);
        return;
      }

      // 6. Submit New GC (Step 1: Choose Category)
      if (data === "menu:submit_gc") {
        const maxAllowed = isUnlocked ? config.unlockedGcLimit : config.baseGcLimit;
        if (user.submittedGcIds.length >= maxAllowed && user.id !== ADMIN_ID) {
          await c.answerCallbackQuery({
            text: `⚠️ Limit Reached (${maxAllowed} GCs). Refer ${config.requiredReferrals} friends to unlock up to ${config.unlockedGcLimit} submissions!`,
            show_alert: true,
          });
          return;
        }

        const categories = await getCategories(kv);
        const kb = new InlineKeyboard();
        categories.forEach((cat, idx) => {
          kb.text(`📁 ${cat}`, `submit:pick:${idx}`);
          if (idx % 2 === 1) kb.row();
        });
        kb.row().text("🔙 Cancel", "menu:home");

        await c.answerCallbackQuery();
        await renderScreen(
          `➕ <b>Submit a New Group Chat (GC)</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📊 <b>Submission Quota:</b> <code>${user.submittedGcIds.length} / ${maxAllowed}</code> used\n\n` +
            `<b>Step 1 of 3:</b> Select the category that best fits your Group Chat:`,
          kb
        );
        return;
      }

      if (data.startsWith("submit:pick:")) {
        const catIdx = parseInt(data.split(":")[2], 10);
        const categories = await getCategories(kv);
        const chosenCat = categories[catIdx] || categories[0];

        user.step = "SUBMIT_GC_TITLE";
        user.draft = { category: chosenCat };
        await saveUser(kv, user);

        await c.answerCallbackQuery();
        await renderScreen(
          `➕ <b>Submit New GC — Step 2 of 3</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📂 <b>Selected Category:</b> ${escapeHtml(chosenCat)}\n\n` +
            `✏️ <b>Please send the Name / Title of your Group Chat</b> (e.g., <i>Crypto Traders Hub</i>):`,
          buildBackToMainKeyboard()
        );
        return;
      }

      // 7. My Submitted GCs
      if (data === "menu:my_gcs") {
        const pendingGcs = await getPendingGcs(kv);
        const myApproved = approvedGcs.filter((g) => g.submittedBy === user.id);
        const myPending = pendingGcs.filter((g) => g.submittedBy === user.id);

        let text =
          `📂 <b>My Submitted Group Chats</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `✅ <b>Approved:</b> <code>${myApproved.length}</code> | ⏳ <b>Pending:</b> <code>${myPending.length}</code>\n\n`;

        if (myApproved.length === 0 && myPending.length === 0) {
          text += `<i>You haven't submitted any Group Chats yet. Tap "➕ Submit New GC" to list your community!</i>`;
        } else {
          myApproved.forEach((g) => {
            text += `🟢 <b>${escapeHtml(g.title)}</b> (${escapeHtml(g.category)})\n└ 🔗 ${escapeHtml(g.link)}\n\n`;
          });
          myPending.forEach((g) => {
            text += `🟡 <b>${escapeHtml(g.title)}</b> (${escapeHtml(g.category)}) — <i>Pending Admin Review</i>\n\n`;
          });
        }

        const kb = new InlineKeyboard()
          .text("➕ Submit New GC", "menu:submit_gc")
          .row()
          .text("🔙 Back to Main Menu", "menu:home");

        await c.answerCallbackQuery();
        await renderScreen(text, kb);
        return;
      }

      // 8. Refer & Unlock + My Referral Stats
      if (data === "menu:refer" || data === "menu:ref_stats") {
        const botUsername = env.BOT_USERNAME || c.me.username;
        const refLink = `https://t.me/${botUsername}?start=ref_${user.id}`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent("🔥 Discover & Promote Verified Telegram Groups on Group Finder Pro!")}`;

        const kb = new InlineKeyboard()
          .url("📤 Share Referral Link", shareUrl)
          .row()
          .text("🔙 Back to Main Menu", "menu:home");

        await c.answerCallbackQuery();
        await renderScreen(
          `🎁 <b>Refer & Unlock VIP Perks</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🏆 <b>Reward Policy:</b>\n${escapeHtml(config.rewardAnnouncement)}\n\n` +
            `📊 <b>Your Live Referral Stats:</b>\n` +
            `├ 👥 <b>Total Referrals:</b> <code>${user.referrals.length}</code>\n` +
            `├ 🎯 <b>Target Goal:</b> <code>${config.requiredReferrals} Referrals</code>\n` +
            `├ 🌟 <b>Sponsored GCs:</b> ${isUnlocked ? "✅ Unlocked" : "🔒 Locked"}\n` +
            `└ 📂 <b>GC Submission Limit:</b> <code>${isUnlocked ? config.unlockedGcLimit : config.baseGcLimit} GCs</code>\n\n` +
            `🔗 <b>Your Personal Invite Link:</b>\n<code>${refLink}</code>`,
          kb
        );
        return;
      }

      // 9. Quick Search GC
      if (data === "menu:search") {
        user.step = "SEARCH_GC_QUERY";
        await saveUser(kv, user);
        await c.answerCallbackQuery();
        await renderScreen(
          `🔍 <b>Quick Search Directory</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Send any keyword, topic, or category name to search across all verified Group Chats:`,
          buildBackToMainKeyboard()
        );
        return;
      }

      // 10. Report Inactive GC
      if (data === "menu:report") {
        user.step = "REPORT_GC_REASON";
        await saveUser(kv, user);
        await c.answerCallbackQuery();
        await renderScreen(
          `🚨 <b>Report Inactive or Scam GC</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Please send the <b>GC Code / Link</b> along with the reason for reporting. Our admin (${OWNER_USERNAME}) will review it immediately:`,
          buildBackToMainKeyboard()
        );
        return;
      }

      // 11. How It Works
      if (data === "menu:how_it_works") {
        const kb = new InlineKeyboard()
          .text("📂 Explore Categories", "menu:categories")
          .text("➕ Submit GC", "menu:submit_gc")
          .row()
          .text("🔙 Back to Main Menu", "menu:home");

        await c.answerCallbackQuery();
        await renderScreen(
          `❓ <b>How ${BOT_NAME} Works</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `1️⃣ <b>Browse Categories:</b> Explore curated Telegram groups across Earning, Promotion, Chatting, Escrow, and Gaming/Tech.\n\n` +
            `2️⃣ <b>Submit Your GC:</b> List your own Telegram group with a custom note. Every submission is verified by our Admin team to prevent spam.\n\n` +
            `3️⃣ <b>Refer & Unlock:</b> Invite <b>${config.requiredReferrals} friends</b> using your unique referral link to unlock <b>🌟 Sponsored / Top GCs</b> and increase your submission limit from ${config.baseGcLimit} to ${config.unlockedGcLimit} GCs!\n\n` +
            `👨‍💻 <b>Owner & Support:</b> ${OWNER_USERNAME}`,
          kb
        );
        return;
      }

      // ======================================================================
      // SECURE ADMIN PANEL HANDLERS (STRICTLY ADMIN_ID: 8838351233)
      // ======================================================================
      if (data.startsWith("admin:")) {
        if (from.id !== ADMIN_ID) {
          await c.answerCallbackQuery({
            text: "⛔ Unauthorized! Admin ID 8838351233 required.",
            show_alert: true,
          });
          return;
        }

        // Admin Home
        if (data === "admin:home") {
          user.step = "IDLE";
          user.draft = {};
          await saveUser(kv, user);
          await c.answerCallbackQuery();
          await renderScreen(
            `🛡️ <b>${BOT_NAME} — Admin Control Panel</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━━━\n` +
              `👑 <b>Admin:</b> ${OWNER_USERNAME} (<code>${ADMIN_ID}</code>)\n` +
              `🛠️ <b>Maintenance Mode:</b> ${config.maintenanceMode ? "🔴 ON" : "🟢 OFF"}\n` +
              `📂 <b>Approved GCs:</b> <code>${approvedGcs.length}</code>\n\n` +
              `<i>Color Key: 🟢 Action | 👥/📋 Navigation | 🔴 Destructive/Back</i>`,
            buildAdminPanelKeyboard(config.maintenanceMode)
          );
          return;
        }

        // [ 🟢 Manage Payouts/Rewards ]
        if (data === "admin:rewards") {
          user.step = "ADMIN_SET_REWARDS";
          await saveUser(kv, user);
          await c.answerCallbackQuery();
          await renderScreen(
            `🟢 <b>Manage Payouts & Referral Rewards</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━━━\n` +
              `Current Required Referrals: <code>${config.requiredReferrals}</code>\n` +
              `Current Base GC Limit: <code>${config.baseGcLimit}</code>\n` +
              `Current Unlocked GC Limit: <code>${config.unlockedGcLimit}</code>\n` +
              `Current Announcement: <i>${escapeHtml(config.rewardAnnouncement)}</i>\n\n` +
              `✏️ <b>Send new settings in format:</b>\n<code>RequiredRefs | BaseLimit | UnlockedLimit | Announcement Text</code>\n\n` +
              `Example:\n<code>3 | 2 | 10 | Refer 3 friends to unlock VIP GCs & 10 slots!</code>`,
            buildBackToAdminKeyboard()
          );
          return;
        }

        // [ 👥 View Users List (GC Count) ]
        if (data.startsWith("admin:users:")) {
          const page = parseInt(data.split(":")[2], 10) || 0;
          const userIds = await getKvJson<number[]>(kv, "users:index", []);
          const pageSize = 8;
          const totalPages = Math.max(1, Math.ceil(userIds.length / pageSize));
          const sliceIds = userIds.slice(page * pageSize, (page + 1) * pageSize);

          let text =
            `👥 <b>Registered Users List (Total: ${userIds.length})</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n`;

          if (sliceIds.length === 0) {
            text += `<i>No users registered yet.</i>\n`;
          } else {
            for (const uid of sliceIds) {
              const u = await getKvJson<UserProfile | null>(kv, `user:${uid}`, null);
              if (u) {
                text +=
                  `👤 <b>${escapeHtml(u.firstName)}</b> (${escapeHtml(u.username)})\n` +
                  `└ 🆔 <code>${u.id}</code> | 🎁 Refs: <code>${u.referrals.length}</code> | 📂 GCs: <code>${u.submittedGcIds.length}</code>\n\n`;
              }
            }
          }

          const kb = new InlineKeyboard();
          if (totalPages > 1) {
            if (page > 0) kb.text("⬅️ Prev", `admin:users:${page - 1}`);
            kb.text(`📄 ${page + 1}/${totalPages}`, "noop");
            if (page + 1 < totalPages) kb.text("Next ➡️", `admin:users:${page + 1}`);
            kb.row();
          }
          kb.text("🔴 Back to Admin Panel", "admin:home");

          await c.answerCallbackQuery();
          await renderScreen(text, kb);
          return;
        }

        // [ ➕ Add Force Channels ]
        if (data === "admin:add_fsub") {
          user.step = "ADMIN_ADD_FORCE_CHANNEL";
          await saveUser(kv, user);
          await c.answerCallbackQuery();
          await renderScreen(
            `➕ <b>Add Force Subscription Channel</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━━━\n` +
              `Make sure the bot is promoted as an <b>Admin</b> in the target channel.\n\n` +
              `✏️ <b>Send channel details in format:</b>\n<code>@ChannelUsername_or_ID | Channel Title | https://t.me/invite_link</code>`,
            buildBackToAdminKeyboard()
          );
          return;
        }

        // [ 📋 View/Remove Channels/GCs ]
        if (data === "admin:manage_items") {
          const channels = await getForceChannels(kv);
          const kb = new InlineKeyboard();

          let text =
            `📋 <b>Manage Force Channels & Approved GCs</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📢 <b>Active Force Channels (${channels.length}):</b>\n`;

          if (channels.length === 0) {
            text += `<i>None configured.</i>\n\n`;
          } else {
            channels.forEach((ch, idx) => {
              text += `• <b>${escapeHtml(ch.title)}</b> (<code>${escapeHtml(ch.id)}</code>)\n`;
              kb.text(`🗑️ Remove Channel: ${ch.title}`, `admin:del_fsub:${idx}`).row();
            });
            text += `\n`;
          }

          text += `📂 <b>Recent Approved GCs (${approvedGcs.length}):</b>\n`;
          approvedGcs.slice(0, 6).forEach((gc) => {
            text += `• <b>${escapeHtml(gc.title)}</b> [<code>${gc.id}</code>]\n`;
            kb.text(`🗑️ Delete GC: ${gc.title}`, `admin:del_gc:${gc.id}`).row();
          });

          kb.text("🔴 Back to Admin Panel", "admin:home");
          await c.answerCallbackQuery();
          await renderScreen(text, kb);
          return;
        }

        if (data.startsWith("admin:del_fsub:")) {
          const idx = parseInt(data.split(":")[2], 10);
          const channels = await getForceChannels(kv);
          channels.splice(idx, 1);
          await saveForceChannels(kv, channels);
          await c.answerCallbackQuery({ text: "✅ Force channel removed!" });
          await renderScreen("✅ <b>Force channel removed successfully.</b>", buildBackToAdminKeyboard());
          return;
        }

        if (data.startsWith("admin:del_gc:")) {
          const gcId = data.split(":")[2];
          const updated = approvedGcs.filter((g) => g.id !== gcId);
          await setKvJson(kv, "gcs:approved", updated);
          await c.answerCallbackQuery({ text: "🗑️ GC deleted from directory!" });
          await renderScreen(
            `✅ <b>Group Chat (<code>${gcId}</code>) removed from directory.</b>`,
            buildBackToAdminKeyboard()
          );
          return;
        }

        // [ 📥 Pending Submissions ]
        if (data.startsWith("admin:pending:")) {
          const pending = await getPendingGcs(kv);
          if (pending.length === 0) {
            await c.answerCallbackQuery();
            await renderScreen(
              `📥 <b>Pending GC Submissions</b>\n━━━━━━━━━━━━━━━━━━━━━━\n✅ <i>All caught up! There are 0 pending submissions in the queue.</i>`,
              buildBackToAdminKeyboard()
            );
            return;
          }

          const item = pending[0];
          const kb = new InlineKeyboard()
            .text("🟢 Approve & Publish", `admin:approve:${item.id}`)
            .text("🌟 Approve as Sponsored", `admin:approve_spon:${item.id}`)
            .row()
            .text("🔴 Reject with Note", `admin:reject:${item.id}`)
            .row()
            .text("🔴 Back to Admin Panel", "admin:home");

          await c.answerCallbackQuery();
          await renderScreen(
            `📥 <b>Pending Submission Review (1 of ${pending.length})</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━━━\n` +
              `🏷️ <b>Title:</b> ${escapeHtml(item.title)}\n` +
              `📂 <b>Category:</b> ${escapeHtml(item.category)}\n` +
              `🔗 <b>Link:</b> ${escapeHtml(item.link)}\n` +
              `📝 <b>Note:</b> ${escapeHtml(item.note)}\n` +
              `👤 <b>Submitted By:</b> ${escapeHtml(item.submitterUsername)} (<code>${item.submittedBy}</code>)\n` +
              `🕒 <b>Submitted At:</b> <code>${item.createdAt}</code>`,
            kb
          );
          return;
        }

        if (data.startsWith("admin:approve:") || data.startsWith("admin:approve_spon:")) {
          const isSponsored = data.startsWith("admin:approve_spon:");
          const gcId = data.split(":")[2];
          const pending = await getPendingGcs(kv);
          const idx = pending.findIndex((g) => g.id === gcId);
          if (idx === -1) {
            await c.answerCallbackQuery({ text: "⚠️ Submission already processed." });
            return;
          }

          const [item] = pending.splice(idx, 1);
          item.status = "approved";
          item.isSponsored = isSponsored;
          approvedGcs.unshift(item);

          await setKvJson(kv, "gcs:pending", pending);
          await setKvJson(kv, "gcs:approved", approvedGcs);

          // Notify submitter
          try {
            await c.api.sendMessage(
              item.submittedBy,
              `🎉 <b>Your Group Chat Was Approved!</b>\n\n` +
                `🏷️ <b>Title:</b> ${escapeHtml(item.title)}\n` +
                `📂 <b>Category:</b> ${escapeHtml(item.category)}\n` +
                `🌟 <b>Placement:</b> ${isSponsored ? "Sponsored / Top GC" : "Standard Directory"}\n\n` +
                `Thank you for growing <b>${BOT_NAME}</b>!`,
              { parse_mode: "HTML" }
            );
          } catch {}

          await c.answerCallbackQuery({ text: "✅ Approved & Published!" });
          await renderScreen(
            `✅ <b>Approved: ${escapeHtml(item.title)}</b>\nRemaining in queue: <code>${pending.length}</code>`,
            new InlineKeyboard()
              .text("📥 Next Pending Submission", "admin:pending:0")
              .row()
              .text("🔴 Back to Admin Panel", "admin:home")
          );
          return;
        }

        if (data.startsWith("admin:reject:")) {
          const gcId = data.split(":")[2];
          user.step = "ADMIN_REJECT_NOTE";
          user.draft = { targetGcId: gcId };
          await saveUser(kv, user);
          await c.answerCallbackQuery();
          await renderScreen(
            `🔴 <b>Reject Submission (<code>${gcId}</code>)</b>\n\nPlease send the rejection reason/note to forward to the user:`,
            buildBackToAdminKeyboard()
          );
          return;
        }

        // [ ⚙️ Manage Categories ]
        if (data === "admin:categories") {
          const categories = await getCategories(kv);
          const kb = new InlineKeyboard().text("🟢 Add New Category", "admin:add_cat").row();
          categories.forEach((cat, idx) => {
            kb.text(`🗑️ Remove: ${cat}`, `admin:del_cat:${idx}`).row();
          });
          kb.text("🔴 Back to Admin Panel", "admin:home");

          await c.answerCallbackQuery();
          await renderScreen(
            `⚙️ <b>Manage Directory Categories (${categories.length})</b>\n━━━━━━━━━━━━━━━━━━━━━━\nClick to add a new category or remove an existing one:`,
            kb
          );
          return;
        }

        if (data === "admin:add_cat") {
          user.step = "ADMIN_ADD_CATEGORY";
          await saveUser(kv, user);
          await c.answerCallbackQuery();
          await renderScreen(
            `🟢 <b>Add New Directory Category</b>\n\nSend the name of the new category (e.g., <i>Web3 & Airdrops</i>):`,
            buildBackToAdminKeyboard()
          );
          return;
        }

        if (data.startsWith("admin:del_cat:")) {
          const idx = parseInt(data.split(":")[2], 10);
          const categories = await getCategories(kv);
          if (categories.length <= 1) {
            await c.answerCallbackQuery({
              text: "⚠️ Cannot delete the last category!",
              show_alert: true,
            });
            return;
          }
          const removed = categories.splice(idx, 1);
          await saveCategories(kv, categories);
          await c.answerCallbackQuery({ text: `🗑️ Removed ${removed[0]}` });
          await renderScreen(
            `✅ <b>Category "${escapeHtml(removed[0])}" removed.</b>`,
            buildBackToAdminKeyboard()
          );
          return;
        }

        // [ 🏷️ Add Sponsored Banner ]
        if (data === "admin:sponsored") {
          user.step = "ADMIN_ADD_SPONSORED";
          await saveUser(kv, user);
          await c.answerCallbackQuery();
          await renderScreen(
            `🏷️ <b>Update Sponsored Banner</b>\n━━━━━━━━━━━━━━━━━━━━━━\nCurrent Text: <i>${escapeHtml(config.sponsoredBannerText)}</i>\nCurrent Link: <code>${escapeHtml(config.sponsoredBannerUrl)}</code>\n\n✏️ <b>Send new banner in format:</b>\n<code>Banner Promotional Text | https://t.me/target_link</code>`,
            buildBackToAdminKeyboard()
          );
          return;
        }

        // [ 🔴 Toggle Maintenance Mode ]
        if (data === "admin:toggle_maint") {
          config.maintenanceMode = !config.maintenanceMode;
          await saveConfig(kv, config);
          await c.answerCallbackQuery({
            text: `🛠️ Maintenance Mode is now ${config.maintenanceMode ? "ENABLED (ON)" : "DISABLED (OFF)"}`,
            show_alert: true,
          });
          await renderScreen(
            `🛡️ <b>${BOT_NAME} — Admin Control Panel</b>\n━━━━━━━━━━━━━━━━━━━━━━\n🛠️ <b>Maintenance Mode:</b> ${config.maintenanceMode ? "🔴 ON" : "🟢 OFF"}`,
            buildAdminPanelKeyboard(config.maintenanceMode)
          );
          return;
        }

        // [ 📊 Bot Detailed Stats ]
        if (data === "admin:stats") {
          const userIds = await getKvJson<number[]>(kv, "users:index", []);
          const pending = await getPendingGcs(kv);
          const categories = await getCategories(kv);
          const fsub = await getForceChannels(kv);
          const reports = await getKvJson<string[]>(kv, "gcs:reports", []);

          await c.answerCallbackQuery();
          await renderScreen(
            `📊 <b>${BOT_NAME} — Live KV Telemetry</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━━━\n` +
              `👥 <b>Total Registered Users:</b> <code>${userIds.length}</code>\n` +
              `📂 <b>Approved GCs Live:</b> <code>${approvedGcs.length}</code>\n` +
              `🌟 <b>Sponsored GCs:</b> <code>${approvedGcs.filter((g) => g.isSponsored).length}</code>\n` +
              `⏳ <b>Pending Approvals:</b> <code>${pending.length}</code>\n` +
              `📁 <b>Active Categories:</b> <code>${categories.length}</code>\n` +
              `📢 <b>Force Join Channels:</b> <code>${fsub.length}</code>\n` +
              `🚨 <b>User Reports Logged:</b> <code>${reports.length}</code>\n` +
              `🛠️ <b>Maintenance Status:</b> ${config.maintenanceMode ? "🔴 Active" : "🟢 Normal"}`,
            buildBackToAdminKeyboard()
          );
          return;
        }

        // [ 📢 Broadcast Message ]
        if (data === "admin:broadcast") {
          user.step = "ADMIN_BROADCAST";
          await saveUser(kv, user);
          await c.answerCallbackQuery();
          await renderScreen(
            `📢 <b>Global Broadcast System</b>\n━━━━━━━━━━━━━━━━━━━━━━\nSend any <b>Text Message</b> or <b>Photo with Caption</b> now, and the Worker will broadcast it to all registered users in KV:`,
            buildBackToAdminKeyboard()
          );
          return;
        }
      }

      await c.answerCallbackQuery();
    });

    // ------------------------------------------------------------------------
    // CONVERSATIONAL INPUT HANDLER (TEXT & PHOTO MESSAGES)
    // ------------------------------------------------------------------------
    bot.on(["message:text", "message:photo"], async (c) => {
      if (!c.from) return;
      const { user } = await getOrCreateUser(kv, c.from);
      const config = await getConfig(kv);
      const text = c.message.text?.trim() || c.message.caption?.trim() || "";

      if (user.step === "IDLE") {
        const approvedGcs = await getApprovedGcs(kv);
        const isUnlocked = user.referrals.length >= config.requiredReferrals;
        await c.reply(formatWelcomeCaption(user, config, approvedGcs.length), {
          parse_mode: "HTML",
          reply_markup: buildUserMainMenu(user.id, isUnlocked),
          link_preview_options: { is_disabled: true },
        });
        return;
      }

      // 1. GC Submission Flow: Title -> Link -> Note
      if (user.step === "SUBMIT_GC_TITLE") {
        if (text.length < 3 || text.length > 60) {
          await c.reply("⚠️ Please enter a valid Group Title between 3 and 60 characters.");
          return;
        }
        user.draft.title = text;
        user.step = "SUBMIT_GC_LINK";
        await saveUser(kv, user);
        await c.reply(
          `✅ <b>Title Saved:</b> ${escapeHtml(text)}\n\n<b>Step 3a of 3:</b> Now send your valid Telegram Group Link (must start with <code>https://t.me/</code>):`,
          { parse_mode: "HTML", reply_markup: buildBackToMainKeyboard() }
        );
        return;
      }

      if (user.step === "SUBMIT_GC_LINK") {
        if (!text.startsWith("https://t.me/")) {
          await c.reply(
            "⚠️ Invalid link! Please send a valid Telegram invite link starting with https://t.me/"
          );
          return;
        }
        user.draft.link = text;
        user.step = "SUBMIT_GC_NOTE";
        await saveUser(kv, user);
        await c.reply(
          `🔗 <b>Link Saved!</b>\n\n<b>Step 3b of 3:</b> Finally, send a short <b>Note / Description</b> (max 140 chars) describing your group:`,
          { parse_mode: "HTML", reply_markup: buildBackToMainKeyboard() }
        );
        return;
      }

      if (user.step === "SUBMIT_GC_NOTE") {
        const newGc: GroupChatItem = {
          id: `GC-${Date.now().toString(36).toUpperCase()}`,
          title: user.draft.title || "Untitled Group",
          category: user.draft.category || DEFAULT_CATEGORIES[0],
          link: user.draft.link || "https://t.me/",
          note: text.slice(0, 140),
          submittedBy: user.id,
          submitterUsername: user.username,
          status: "pending",
          createdAt: new Date().toISOString().split("T")[0],
        };

        const pending = await getPendingGcs(kv);
        pending.push(newGc);
        await setKvJson(kv, "gcs:pending", pending);

        user.submittedGcIds.push(newGc.id);
        user.step = "IDLE";
        user.draft = {};
        await saveUser(kv, user);

        // Alert Admin (8838351233) immediately
        try {
          await c.api.sendMessage(
            ADMIN_ID,
            `📥 <b>New GC Submitted for Review!</b>\n\n` +
              `🏷️ <b>Title:</b> ${escapeHtml(newGc.title)}\n` +
              `📂 <b>Category:</b> ${escapeHtml(newGc.category)}\n` +
              `🔗 <b>Link:</b> ${escapeHtml(newGc.link)}\n` +
              `📝 <b>Note:</b> ${escapeHtml(newGc.note)}\n` +
              `👤 <b>User:</b> ${escapeHtml(user.username)} (<code>${user.id}</code>)`,
            {
              parse_mode: "HTML",
              reply_markup: new InlineKeyboard().text("📥 Open Pending Queue", "admin:pending:0"),
            }
          );
        } catch {}

        await c.reply(
          `🎉 <b>Submission Sent for Approval!</b>\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 <b>Submission ID:</b> <code>${newGc.id}</code>\n` +
            `🏷️ <b>Group:</b> ${escapeHtml(newGc.title)}\n` +
            `📂 <b>Category:</b> ${escapeHtml(newGc.category)}\n\n` +
            `⏳ Our Admin (${OWNER_USERNAME}) will review and publish your group shortly!`,
          { parse_mode: "HTML", reply_markup: buildBackToMainKeyboard() }
        );
        return;
      }

      // 2. Quick Search Flow
      if (user.step === "SEARCH_GC_QUERY") {
        user.step = "IDLE";
        await saveUser(kv, user);

        const approvedGcs = await getApprovedGcs(kv);
        const q = text.toLowerCase();
        const matches = approvedGcs.filter(
          (g) =>
            g.title.toLowerCase().includes(q) ||
            g.category.toLowerCase().includes(q) ||
            g.note.toLowerCase().includes(q)
        );

        const kb = new InlineKeyboard();
        let replyText = `🔍 <b>Search Results for "${escapeHtml(text)}" (${matches.length})</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;

        if (matches.length === 0) {
          replyText += `<i>No matching groups found. Try another keyword or browse categories!</i>`;
        } else {
          matches.slice(0, 6).forEach((g, idx) => {
            replyText += `<b>${idx + 1}. ${escapeHtml(g.title)}</b> [${escapeHtml(g.category)}]\n└ 📝 ${escapeHtml(g.note)}\n\n`;
            kb.url(`🚀 Join ${g.title}`, g.link).row();
          });
        }
        kb.text("🔙 Back to Main Menu", "menu:home");

        await c.reply(replyText, { parse_mode: "HTML", reply_markup: kb });
        return;
      }

      // 3. Report Inactive GC Flow
      if (user.step === "REPORT_GC_REASON") {
        user.step = "IDLE";
        await saveUser(kv, user);

        const reports = await getKvJson<string[]>(kv, "gcs:reports", []);
        reports.push(`[${new Date().toISOString()}] From ${user.id} (${user.username}): ${text}`);
        await setKvJson(kv, "gcs:reports", reports);

        try {
          await c.api.sendMessage(
            ADMIN_ID,
            `🚨 <b>New Inactive/Scam GC Report</b>\n\n👤 <b>From:</b> ${escapeHtml(user.username)} (<code>${user.id}</code>)\n📝 <b>Report:</b> ${escapeHtml(text)}`,
            { parse_mode: "HTML" }
          );
        } catch {}

        await c.reply(
          "✅ <b>Report Submitted!</b> Thank you for keeping Group Finder Pro clean and verified.",
          { parse_mode: "HTML", reply_markup: buildBackToMainKeyboard() }
        );
        return;
      }

      // ======================================================================
      // ADMIN INPUT FLOWS (Restricted strictly to ADMIN_ID: 8838351233)
      // ======================================================================
      if (user.id !== ADMIN_ID) return;

      if (user.step === "ADMIN_SET_REWARDS") {
        const parts = text.split("|").map((s) => s.trim());
        if (parts.length < 4) {
          await c.reply(
            "⚠️ Format error! Send: RequiredRefs | BaseLimit | UnlockedLimit | Announcement"
          );
          return;
        }
        config.requiredReferrals = Math.max(1, parseInt(parts[0], 10) || 3);
        config.baseGcLimit = Math.max(1, parseInt(parts[1], 10) || 2);
        config.unlockedGcLimit = Math.max(1, parseInt(parts[2], 10) || 10);
        config.rewardAnnouncement = parts.slice(3).join(" | ");
        await saveConfig(kv, config);

        user.step = "IDLE";
        await saveUser(kv, user);
        await c.reply("✅ <b>Payouts & Referral Rewards Updated!</b>", {
          parse_mode: "HTML",
          reply_markup: buildBackToAdminKeyboard(),
        });
        return;
      }

      if (user.step === "ADMIN_ADD_FORCE_CHANNEL") {
        const parts = text.split("|").map((s) => s.trim());
        if (parts.length < 3) {
          await c.reply("⚠️ Format error! Send: @ChannelID | Title | https://t.me/link");
          return;
        }
        const channels = await getForceChannels(kv);
        channels.push({ id: parts[0], title: parts[1], inviteLink: parts[2] });
        await saveForceChannels(kv, channels);

        user.step = "IDLE";
        await saveUser(kv, user);
        await c.reply(`✅ <b>Force Channel Added:</b> ${escapeHtml(parts[1])}`, {
          parse_mode: "HTML",
          reply_markup: buildBackToAdminKeyboard(),
        });
        return;
      }

      if (user.step === "ADMIN_ADD_CATEGORY") {
        const categories = await getCategories(kv);
        if (!categories.includes(text)) {
          categories.push(text);
          await saveCategories(kv, categories);
        }
        user.step = "IDLE";
        await saveUser(kv, user);
        await c.reply(`✅ <b>Category Added:</b> ${escapeHtml(text)}`, {
          parse_mode: "HTML",
          reply_markup: buildBackToAdminKeyboard(),
        });
        return;
      }

      if (user.step === "ADMIN_ADD_SPONSORED") {
        const parts = text.split("|").map((s) => s.trim());
        if (parts.length < 2) {
          await c.reply("⚠️ Format error! Send: Banner Text | https://t.me/link");
          return;
        }
        config.sponsoredBannerText = parts[0];
        config.sponsoredBannerUrl = parts[1];
        await saveConfig(kv, config);

        user.step = "IDLE";
        await saveUser(kv, user);
        await c.reply("✅ <b>Sponsored Banner Updated!</b>", {
          parse_mode: "HTML",
          reply_markup: buildBackToAdminKeyboard(),
        });
        return;
      }

      if (user.step === "ADMIN_REJECT_NOTE") {
        const gcId = user.draft.targetGcId;
        const pending = await getPendingGcs(kv);
        const idx = pending.findIndex((g) => g.id === gcId);
        if (idx !== -1) {
          const [rejected] = pending.splice(idx, 1);
          await setKvJson(kv, "gcs:pending", pending);
          try {
            await c.api.sendMessage(
              rejected.submittedBy,
              `❌ <b>Your GC Submission Was Declined</b>\n\n🏷️ <b>Group:</b> ${escapeHtml(rejected.title)}\n📝 <b>Admin Note:</b> ${escapeHtml(text)}`,
              { parse_mode: "HTML" }
            );
          } catch {}
        }
        user.step = "IDLE";
        user.draft = {};
        await saveUser(kv, user);
        await c.reply("✅ <b>Submission Rejected & User Notified.</b>", {
          parse_mode: "HTML",
          reply_markup: buildBackToAdminKeyboard(),
        });
        return;
      }

      if (user.step === "ADMIN_BROADCAST") {
        user.step = "IDLE";
        await saveUser(kv, user);

        const userIds = await getKvJson<number[]>(kv, "users:index", []);
        let sentCount = 0;
        let failCount = 0;

        const photoId = c.message.photo
          ? c.message.photo[c.message.photo.length - 1].file_id
          : null;

        for (const uid of userIds) {
          try {
            if (photoId) {
              await c.api.sendPhoto(uid, photoId, {
                caption: `📢 <b>Broadcast from ${BOT_NAME}</b>\n\n${escapeHtml(text)}`,
                parse_mode: "HTML",
              });
            } else {
              await c.api.sendMessage(
                uid,
                `📢 <b>Broadcast from ${BOT_NAME}</b>\n\n${escapeHtml(text)}`,
                { parse_mode: "HTML" }
              );
            }
            sentCount++;
          } catch {
            failCount++;
          }
        }

        await c.reply(
          `📢 <b>Broadcast Completed!</b>\n━━━━━━━━━━━━━━━━━━━━━━\n✅ <b>Delivered:</b> <code>${sentCount}</code>\n❌ <b>Failed/Blocked:</b> <code>${failCount}</code>`,
          { parse_mode: "HTML", reply_markup: buildBackToAdminKeyboard() }
        );
        return;
      }
    });

    // Execute grammY webhook handler on Cloudflare Worker fetch request
    return webhookCallback(bot, "cloudflare-mod")(request);
  },
};
