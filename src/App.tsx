/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Copy,
  Check,
  Download,
  Send,
  Terminal,
  Database,
  Shield,
  UserCheck,
  RefreshCw,
  Code2,
  Play,
  ExternalLink,
  Trash2,
  Plus,
} from "lucide-react";
import {
  WORKER_INDEX_TS,
  WRANGLER_TOML,
  PACKAGE_JSON_SNIPPET,
  DEPLOYMENT_STEPS,
} from "./data/workerSource";
import {
  SEEDED_BULK_GCS,
  DEFAULT_CATEGORIES,
  ADMIN_ID,
  deduplicateGcsByLink,
  normalizeTelegramLink,
  type GroupChatItem,
} from "./index";

// ============================================================================
// SIMULATED CLOUDFLARE KV TYPES & INITIAL SEED DATA
// ============================================================================

interface SimUser {
  id: number;
  username: string;
  firstName: string;
  joinedAt: string;
  referredBy: number | null;
  referrals: number[];
  submittedGcIds: string[];
  step: string;
  draft: {
    category?: string;
    title?: string;
    link?: string;
    targetGcId?: string;
  };
}

interface SimForceChannel {
  id: string;
  title: string;
  inviteLink: string;
}

interface SimConfig {
  maintenanceMode: boolean;
  requiredReferrals: number;
  baseGcLimit: number;
  unlockedGcLimit: number;
  rewardAnnouncement: string;
  sponsoredBannerText: string;
  sponsoredBannerUrl: string;
}

interface InlineBtn {
  text: string;
  callbackData?: string;
  url?: string;
}

interface ChatMessage {
  id: string;
  sender: "user" | "bot";
  text: string;
  timestamp: string;
  isBanner?: boolean;
  loadingProgress?: number;
  keyboard?: InlineBtn[][];
}

const STD_USER_ID = 551920411;

const INITIAL_PENDING_GCS: GroupChatItem[] = [
  {
    id: "GC-998P",
    title: "Indie SaaS Founders Network",
    category: "Promotion Zone",
    link: "https://t.me/indiesaas_demo",
    note: "Share MRR milestones, beta launches, and growth tactics with fellow founders.",
    submittedBy: STD_USER_ID,
    submitterUsername: "@rohan_crypto",
    status: "pending",
    createdAt: "2026-11-05",
  },
];

export default function App() {
  // Active Top-Level Section
  const [activeTab, setActiveTab] = useState<"code" | "simulator" | "kv" | "deploy">("code");
  const [selectedFile, setSelectedFile] = useState<"index.ts" | "wrangler.toml" | "package.json">("index.ts");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Simulated Cloudflare KV State (Initialized with the 29 Deduplicated Bulk GCs)
  const [config, setConfig] = useState<SimConfig>({
    maintenanceMode: false,
    requiredReferrals: 3,
    baseGcLimit: 2,
    unlockedGcLimit: 10,
    rewardAnnouncement:
      "Refer 3 active users to unlock 🌟 Sponsored / Top GCs & boost your submission limit to 10 GCs!",
    sponsoredBannerText:
      "🔥 Promote your Group or Channel here! Contact @aaditya334356 for pinned Sponsored slots.",
    sponsoredBannerUrl: "https://t.me/aaditya334356",
  });

  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [approvedGcs, setApprovedGcs] = useState<GroupChatItem[]>(SEEDED_BULK_GCS);
  const [pendingGcs, setPendingGcs] = useState<GroupChatItem[]>(INITIAL_PENDING_GCS);
  const [forceChannels, setForceChannels] = useState<SimForceChannel[]>([]);
  const [reports, setReports] = useState<string[]>([
    "[2026-11-05T03:15:00Z] From 551920411 (@rohan_crypto): GC-404X invite link expired",
  ]);

  const [users, setUsers] = useState<Record<number, SimUser>>({
    [ADMIN_ID]: {
      id: ADMIN_ID,
      username: "@aaditya334356",
      firstName: "Aaditya (Owner)",
      joinedAt: "2026-10-15",
      referredBy: null,
      referrals: [551920411, 771829100, 991827364],
      submittedGcIds: SEEDED_BULK_GCS.map((g) => g.id),
      step: "IDLE",
      draft: {},
    },
    [STD_USER_ID]: {
      id: STD_USER_ID,
      username: "@rohan_crypto",
      firstName: "Rohan Sharma",
      joinedAt: "2026-11-02",
      referredBy: ADMIN_ID,
      referrals: [800100201],
      submittedGcIds: ["GC-998P"],
      step: "IDLE",
      draft: {},
    },
  });

  // Active Simulator Persona (Admin 8838351233 vs Regular User 551920411)
  const [activeUserId, setActiveUserId] = useState<number>(ADMIN_ID);
  const [joinedForceChannels, setJoinedForceChannels] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>("");
  const [isAnimatingStart, setIsAnimatingStart] = useState<boolean>(false);
  const [toastAlert, setToastAlert] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const currentUser = users[activeUserId];

  const showToast = (msg: string) => {
    setToastAlert(msg);
    setTimeout(() => setToastAlert(null), 3200);
  };

  // Build menus matching the exact worker code (with "🌐 All GC" at top)
  const getMainMenuKeyboard = (uid: number, unlocked: boolean, gcTotal: number): InlineBtn[][] => {
    const rows: InlineBtn[][] = [
      [{ text: `🌐 All GC (${gcTotal})`, callbackData: "menu:all_gcs:0" }],
      [
        { text: "📂 Browse Categories", callbackData: "menu:categories" },
        {
          text: unlocked ? "🌟 Sponsored / Top GCs" : "🌟 Sponsored / Top GCs 🔒",
          callbackData: "menu:sponsored",
        },
      ],
      [
        { text: "➕ Submit New GC", callbackData: "menu:submit_gc" },
        { text: "📂 My Submitted GCs", callbackData: "menu:my_gcs" },
      ],
      [
        { text: "🎁 Refer & Unlock", callbackData: "menu:refer" },
        { text: "📊 My Referral Stats", callbackData: "menu:ref_stats" },
      ],
      [
        { text: "🔍 Quick Search GC", callbackData: "menu:search" },
        { text: "🚨 Report Inactive GC", callbackData: "menu:report" },
      ],
      [
        { text: "❓ How It Works", callbackData: "menu:how_it_works" },
        { text: "💬 Support / Contact", url: "https://t.me/aaditya334356" },
      ],
    ];
    if (uid === ADMIN_ID) {
      rows.push([{ text: "🛡️ Admin Control Panel (Owner)", callbackData: "admin:home" }]);
    }
    return rows;
  };

  const getAdminMenuKeyboard = (maint: boolean): InlineBtn[][] => [
    [
      { text: "🟢 Manage Payouts/Rewards", callbackData: "admin:rewards" },
      { text: "👥 View Users List (GC Count)", callbackData: "admin:users:0" },
    ],
    [
      { text: "➕ Add Force Channels", callbackData: "admin:add_fsub" },
      { text: "📋 View/Remove Channels/GCs", callbackData: "admin:manage_items" },
    ],
    [
      { text: "📥 Pending Submissions", callbackData: "admin:pending:0" },
      { text: "⚙️ Manage Categories", callbackData: "admin:categories" },
    ],
    [
      { text: "🏷️ Add Sponsored Banner", callbackData: "admin:sponsored" },
      {
        text: maint ? "🟢 Disable Maintenance Mode" : "🔴 Toggle Maintenance Mode",
        callbackData: "admin:toggle_maint",
      },
    ],
    [
      { text: "📊 Bot Detailed Stats", callbackData: "admin:stats" },
      { text: "📢 Broadcast Message", callbackData: "admin:broadcast" },
    ],
    [{ text: "🔴 Back to User Menu", callbackData: "menu:home" }],
  ];

  const buildWelcomeText = (u: SimUser, cfg: SimConfig, gcCount: number) => {
    const unlocked = u.referrals.length >= cfg.requiredReferrals;
    return (
      `✨ Welcome to 𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔 ✨\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👋 Hello, ${u.firstName}!\n` +
      `🌐 The #1 Verified Telegram Group Directory & Discovery Engine.\n\n` +
      `📌 Your Account Status:\n` +
      `├ 🆔 User ID: ${u.id}\n` +
      `├ 👥 Referrals: ${u.referrals.length} / ${cfg.requiredReferrals}\n` +
      `├ 🌟 VIP Access: ${unlocked ? "✅ Unlocked" : "🔒 Locked (Refer to Unlock)"}\n` +
      `└ 📂 Verified GCs Live: ${gcCount}\n\n` +
      `📢 Sponsored: ${cfg.sponsoredBannerText}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👨‍💻 Developer: @aaditya334356\n` +
      `👇 Tap "🌐 All GC (${gcCount})" or choose a category below:`
    );
  };

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const adminUser = {
      id: ADMIN_ID,
      username: "@aaditya334356",
      firstName: "Aaditya (Owner)",
      joinedAt: "2026-10-15",
      referredBy: null,
      referrals: [551920411, 771829100, 991827364],
      submittedGcIds: SEEDED_BULK_GCS.map((g) => g.id),
      step: "IDLE",
      draft: {},
    };
    return [
      {
        id: "init-1",
        sender: "user",
        text: "/start",
        timestamp: "04:45",
      },
      {
        id: "init-2",
        sender: "bot",
        isBanner: true,
        text: buildWelcomeText(
          adminUser,
          {
            maintenanceMode: false,
            requiredReferrals: 3,
            baseGcLimit: 2,
            unlockedGcLimit: 10,
            rewardAnnouncement:
              "Refer 3 active users to unlock 🌟 Sponsored / Top GCs & boost your submission limit to 10 GCs!",
            sponsoredBannerText:
              "🔥 Promote your Group or Channel here! Contact @aaditya334356 for pinned Sponsored slots.",
            sponsoredBannerUrl: "https://t.me/aaditya334356",
          },
          SEEDED_BULK_GCS.length
        ),
        timestamp: "04:45",
        keyboard: [
          [{ text: `🌐 All GC (${SEEDED_BULK_GCS.length})`, callbackData: "menu:all_gcs:0" }],
          [
            { text: "📂 Browse Categories", callbackData: "menu:categories" },
            { text: "🌟 Sponsored / Top GCs", callbackData: "menu:sponsored" },
          ],
          [
            { text: "➕ Submit New GC", callbackData: "menu:submit_gc" },
            { text: "📂 My Submitted GCs", callbackData: "menu:my_gcs" },
          ],
          [
            { text: "🎁 Refer & Unlock", callbackData: "menu:refer" },
            { text: "📊 My Referral Stats", callbackData: "menu:ref_stats" },
          ],
          [
            { text: "🔍 Quick Search GC", callbackData: "menu:search" },
            { text: "🚨 Report Inactive GC", callbackData: "menu:report" },
          ],
          [
            { text: "❓ How It Works", callbackData: "menu:how_it_works" },
            { text: "💬 Support / Contact", url: "https://t.me/aaditya334356" },
          ],
          [{ text: "🛡️ Admin Control Panel (Owner)", callbackData: "admin:home" }],
        ],
      },
    ];
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const nowTime = () => {
    const d = new Date();
    return d.toTimeString().slice(0, 5);
  };

  // Copy Helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Download Helper
  const handleDownload = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Trigger the 4-Step Dynamic /start Loading Sequence
  const triggerStartAnimation = (targetUid = activeUserId) => {
    if (isAnimatingStart) return;
    setIsAnimatingStart(true);

    const userMsgId = `u-${Date.now()}`;
    const botMsgId = `b-${Date.now() + 1}`;
    const u = users[targetUid];

    // Reset user step
    setUsers((prev) => ({
      ...prev,
      [targetUid]: { ...prev[targetUid], step: "IDLE", draft: {} },
    }));

    // Step 1: Send "/start" & "⚡ Loading Universal Directory..."
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, sender: "user", text: "/start", timestamp: nowTime() },
      {
        id: botMsgId,
        sender: "bot",
        text: "⚡ Loading Universal Directory...",
        loadingProgress: 15,
        timestamp: nowTime(),
      },
    ]);

    // Step 2: 650ms -> "🔄 Fetching Categories & Verified GCs [35%]"
    setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMsgId
            ? {
                ...m,
                text: "🔄 Fetching Categories & Verified GCs [35%]\n[████░░░░░░]",
                loadingProgress: 35,
              }
            : m
        )
      );
    }, 650);

    // Step 3: 1300ms -> "✨ Optimizing Experience [100%]"
    setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMsgId
            ? {
                ...m,
                text: "✨ Optimizing Experience [100%]\n[██████████]",
                loadingProgress: 100,
              }
            : m
        )
      );
    }, 1300);

    // Step 4: 1850ms -> Final Welcome Banner & Dashboard
    setTimeout(() => {
      const unlocked = u.referrals.length >= config.requiredReferrals;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMsgId
            ? {
                ...m,
                isBanner: true,
                loadingProgress: undefined,
                text: buildWelcomeText(u, config, approvedGcs.length),
                keyboard: getMainMenuKeyboard(u.id, unlocked, approvedGcs.length),
              }
            : m
        )
      );
      setIsAnimatingStart(false);
    }, 1850);
  };

  // Simulate a Friend Clicking Referral Deep-Link
  const simulateReferralJoin = () => {
    const newRefUserId = Math.floor(100000000 + Math.random() * 899999999);
    const updatedUser: SimUser = {
      ...currentUser,
      referrals: [...currentUser.referrals, newRefUserId],
    };

    setUsers((prev) => ({
      ...prev,
      [activeUserId]: updatedUser,
      [newRefUserId]: {
        id: newRefUserId,
        username: `@friend_${newRefUserId.toString().slice(-4)}`,
        firstName: `Referred Friend #${updatedUser.referrals.length}`,
        joinedAt: new Date().toISOString().split("T")[0],
        referredBy: activeUserId,
        referrals: [],
        submittedGcIds: [],
        step: "IDLE",
        draft: {},
      },
    }));

    const isNowUnlocked = updatedUser.referrals.length >= config.requiredReferrals;
    setMessages((prev) => [
      ...prev,
      {
        id: `ref-${Date.now()}`,
        sender: "bot",
        timestamp: nowTime(),
        text:
          `🎉 New Referral Joined via /start ref_${activeUserId}!\n\n` +
          `👤 New User ID: ${newRefUserId}\n` +
          `📊 Your Total Referrals: ${updatedUser.referrals.length} / ${config.requiredReferrals}\n` +
          (isNowUnlocked
            ? `🌟 Congratulations! You have unlocked Sponsored / Top GCs & ${config.unlockedGcLimit} GC submission slots!`
            : `🎁 Refer ${config.requiredReferrals - updatedUser.referrals.length} more friend(s) to unlock VIP features!`),
        keyboard: [[{ text: "🏠 Refresh Dashboard", callbackData: "menu:home" }]],
      },
    ]);
    showToast(`+1 Referral credited to ${currentUser.username} in BOT_KV!`);
  };

  // Handle Inline Keyboard Button Clicks inside Simulator
  const handleCallbackClick = (cbData: string) => {
    if (cbData === "noop") return;

    // Maintenance Check
    if (config.maintenanceMode && activeUserId !== ADMIN_ID) {
      showToast("🛠️ Maintenance Mode Active! Non-admin users are currently blocked.");
      return;
    }

    // Force Subscription Gate Check
    if (
      forceChannels.length > 0 &&
      !joinedForceChannels &&
      activeUserId !== ADMIN_ID &&
      cbData !== "fsub:verify"
    ) {
      const kb: InlineBtn[][] = forceChannels.map((ch) => [
        { text: `📢 Join ${ch.title}`, url: ch.inviteLink },
      ]);
      kb.push([{ text: "✅ I Have Joined — Verify", callbackData: "fsub:verify" }]);

      updateLastBotMessage(
        `🔒 Access Restricted!\n\nTo use 𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔, you must join our required sponsor channels below and tap Verify:`,
        kb,
        false
      );
      return;
    }

    const unlocked = currentUser.referrals.length >= config.requiredReferrals;

    if (cbData === "fsub:verify") {
      setJoinedForceChannels(true);
      showToast("✅ Force subscription verified!");
      updateLastBotMessage(
        buildWelcomeText(currentUser, config, approvedGcs.length),
        getMainMenuKeyboard(activeUserId, unlocked, approvedGcs.length),
        true
      );
      return;
    }

    if (cbData === "menu:home") {
      setUsers((prev) => ({
        ...prev,
        [activeUserId]: { ...prev[activeUserId], step: "IDLE", draft: {} },
      }));
      updateLastBotMessage(
        buildWelcomeText(currentUser, config, approvedGcs.length),
        getMainMenuKeyboard(activeUserId, unlocked, approvedGcs.length),
        true
      );
      return;
    }

    // "🌐 All GC" Paginated View
    if (cbData.startsWith("menu:all_gcs:")) {
      const page = parseInt(cbData.split(":")[2], 10) || 0;
      const pageSize = 10;
      const totalPages = Math.max(1, Math.ceil(approvedGcs.length / pageSize));
      const safePage = Math.min(Math.max(0, page), totalPages - 1);
      const slice = approvedGcs.slice(safePage * pageSize, (safePage + 1) * pageSize);

      let text =
        `🌐 All Verified Group Chats (${approvedGcs.length} Total)\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📄 Showing Page ${safePage + 1} of ${totalPages} (Deduplicated & Verified):\n\n`;

      const kb: InlineBtn[][] = [];
      let row: InlineBtn[] = [];

      slice.forEach((gc, idx) => {
        const num = safePage * pageSize + idx + 1;
        text += `${num}. ${gc.title} ${gc.isSponsored ? "🌟" : ""}\n├ 📂 ${gc.category}\n└ 🔗 ${gc.link}\n\n`;
        row.push({ text: `🚀 ${num}. ${gc.title}`, url: gc.link });
        if (row.length === 2) {
          kb.push(row);
          row = [];
        }
      });
      if (row.length > 0) kb.push(row);

      if (totalPages > 1) {
        const navRow: InlineBtn[] = [];
        if (safePage > 0) navRow.push({ text: "⬅️ Prev", callbackData: `menu:all_gcs:${safePage - 1}` });
        navRow.push({ text: `📄 ${safePage + 1}/${totalPages}`, callbackData: "noop" });
        if (safePage + 1 < totalPages)
          navRow.push({ text: "Next ➡️", callbackData: `menu:all_gcs:${safePage + 1}` });
        kb.push(navRow);
      }

      kb.push([
        { text: "📂 By Category", callbackData: "menu:categories" },
        { text: "🔙 Main Menu", callbackData: "menu:home" },
      ]);

      updateLastBotMessage(text, kb, false);
      return;
    }

    if (cbData === "menu:categories") {
      const kb: InlineBtn[][] = [
        [{ text: `🌐 All GC (${approvedGcs.length})`, callbackData: "menu:all_gcs:0" }],
      ];
      let row: InlineBtn[] = [];
      categories.forEach((cat, idx) => {
        const count = approvedGcs.filter((g) => g.category === cat).length;
        row.push({ text: `📂 ${cat} (${count})`, callbackData: `cat:view:${idx}:0` });
        if (row.length === 2) {
          kb.push(row);
          row = [];
        }
      });
      if (row.length > 0) kb.push(row);
      kb.push([{ text: "🔙 Back to Main Menu", callbackData: "menu:home" }]);

      updateLastBotMessage(
        `📂 Browse Verified Categories\n━━━━━━━━━━━━━━━━━━━━━━\nTap 🌐 All GC (${approvedGcs.length}) to view the full master list or select a category below:`,
        kb,
        false
      );
      return;
    }

    if (cbData.startsWith("cat:view:")) {
      const [, , catIdxStr, pageStr] = cbData.split(":");
      const catIdx = parseInt(catIdxStr, 10);
      const page = parseInt(pageStr, 10) || 0;
      const catName = categories[catIdx] || categories[0];
      const items = approvedGcs.filter((g) => g.category === catName);
      const pageSize = 6;
      const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
      const slice = items.slice(page * pageSize, (page + 1) * pageSize);

      let text = `📂 Category: ${catName} (${items.length})\n━━━━━━━━━━━━━━━━━━━━━━\n`;
      const kb: InlineBtn[][] = [];

      if (slice.length === 0) {
        text += `No groups have been approved in this category yet. Be the first to submit one!`;
        kb.push([{ text: "➕ Submit GC Here", callbackData: `submit:pick:${catIdx}` }]);
      } else {
        slice.forEach((gc, i) => {
          const num = page * pageSize + i + 1;
          text += `${num}. ${gc.title} ${gc.isSponsored ? "🌟" : ""}\n├ 📝 ${gc.note}\n└ 🆔 Code: ${gc.id}\n\n`;
          kb.push([{ text: `🚀 Join: ${gc.title}`, url: gc.link }]);
        });

        if (totalPages > 1) {
          const navRow: InlineBtn[] = [];
          if (page > 0) navRow.push({ text: "⬅️ Prev", callbackData: `cat:view:${catIdx}:${page - 1}` });
          navRow.push({ text: `📄 ${page + 1}/${totalPages}`, callbackData: "noop" });
          if (page + 1 < totalPages)
            navRow.push({ text: "Next ➡️", callbackData: `cat:view:${catIdx}:${page + 1}` });
          kb.push(navRow);
        }
      }
      kb.push([
        { text: "🌐 All GC", callbackData: "menu:all_gcs:0" },
        { text: "🔙 Categories", callbackData: "menu:categories" },
      ]);
      kb.push([{ text: "🏠 Back to Main Menu", callbackData: "menu:home" }]);
      updateLastBotMessage(text, kb, false);
      return;
    }

    if (cbData === "menu:sponsored") {
      if (!unlocked && activeUserId !== ADMIN_ID) {
        const needed = config.requiredReferrals - currentUser.referrals.length;
        showToast(`🔒 Locked! Refer ${needed} more friend(s) to unlock Sponsored GCs.`);
        const refLink = `https://t.me/GroupFinderProBot?start=ref_${activeUserId}`;
        updateLastBotMessage(
          `🔒 Sponsored / Top GCs — Locked!\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Access to 🌟 Sponsored / Top GCs and extra GC submission slots requires ${config.requiredReferrals} Referrals.\n\n` +
            `📊 Your Progress: ${currentUser.referrals.length} / ${config.requiredReferrals} Referrals\n` +
            `🔗 Your Unique Referral Link:\n${refLink}\n\n` +
            `💡 Tip: Click the "+1 Simulate Referral" button in the top simulator bar to test unlocking right now!`,
          [[{ text: "🔙 Back to Main Menu", callbackData: "menu:home" }]],
          false
        );
        return;
      }

      const sponsored = approvedGcs.filter((g) => g.isSponsored);
      let text = `🌟 Sponsored & Top Verified GCs\n━━━━━━━━━━━━━━━━━━━━━━\n🏆 Exclusive high-engagement communities unlocked via your VIP status:\n\n`;
      const kb: InlineBtn[][] = [];
      sponsored.forEach((gc, i) => {
        text += `🌟 ${i + 1}. ${gc.title} [${gc.category}]\n└ 📝 ${gc.note}\n\n`;
        kb.push([{ text: `🌟 Join ${gc.title}`, url: gc.link }]);
      });
      kb.push([{ text: "💎 Buy Sponsored Slot (@aaditya334356)", url: config.sponsoredBannerUrl }]);
      kb.push([{ text: "🔙 Back to Main Menu", callbackData: "menu:home" }]);
      updateLastBotMessage(text, kb, false);
      return;
    }

    if (cbData === "menu:submit_gc") {
      const maxAllowed = unlocked ? config.unlockedGcLimit : config.baseGcLimit;
      if (currentUser.submittedGcIds.length >= maxAllowed && activeUserId !== ADMIN_ID) {
        showToast(
          `⚠️ Limit Reached (${maxAllowed} GCs). Refer ${config.requiredReferrals} friends to unlock ${config.unlockedGcLimit} slots!`
        );
        return;
      }

      const kb: InlineBtn[][] = [];
      let row: InlineBtn[] = [];
      categories.forEach((cat, idx) => {
        row.push({ text: `📁 ${cat}`, callbackData: `submit:pick:${idx}` });
        if (row.length === 2) {
          kb.push(row);
          row = [];
        }
      });
      if (row.length > 0) kb.push(row);
      kb.push([{ text: "🔙 Cancel", callbackData: "menu:home" }]);

      updateLastBotMessage(
        `➕ Submit a New Group Chat (GC)\n━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 Submission Quota: ${currentUser.submittedGcIds.length} / ${maxAllowed} used\n\n` +
          `Step 1 of 3: Select the category that best fits your Group Chat:`,
        kb,
        false
      );
      return;
    }

    if (cbData.startsWith("submit:pick:")) {
      const catIdx = parseInt(cbData.split(":")[2], 10);
      const chosenCat = categories[catIdx] || categories[0];
      setUsers((prev) => ({
        ...prev,
        [activeUserId]: {
          ...prev[activeUserId],
          step: "SUBMIT_GC_TITLE",
          draft: { category: chosenCat },
        },
      }));
      updateLastBotMessage(
        `➕ Submit New GC — Step 2 of 3\n━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📂 Selected Category: ${chosenCat}\n\n` +
          `✏️ Please type and send the Name / Title of your Group Chat in the chat input below:`,
        [[{ text: "🔙 Cancel", callbackData: "menu:home" }]],
        false
      );
      return;
    }

    if (cbData === "menu:my_gcs") {
      const myApproved = approvedGcs.filter((g) => g.submittedBy === activeUserId);
      const myPending = pendingGcs.filter((g) => g.submittedBy === activeUserId);

      let text =
        `📂 My Submitted Group Chats\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ Approved: ${myApproved.length} | ⏳ Pending: ${myPending.length}\n\n`;

      myApproved.slice(0, 8).forEach((g) => {
        text += `🟢 ${g.title} (${g.category})\n└ 🔗 ${g.link}\n\n`;
      });
      myPending.forEach((g) => {
        text += `🟡 ${g.title} (${g.category}) — Pending Admin Review\n\n`;
      });

      updateLastBotMessage(
        text,
        [
          [{ text: "➕ Submit New GC", callbackData: "menu:submit_gc" }],
          [{ text: "🔙 Back to Main Menu", callbackData: "menu:home" }],
        ],
        false
      );
      return;
    }

    if (cbData === "menu:refer" || cbData === "menu:ref_stats") {
      const refLink = `https://t.me/GroupFinderProBot?start=ref_${activeUserId}`;
      updateLastBotMessage(
        `🎁 Refer & Unlock VIP Perks\n━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🏆 Reward Policy:\n${config.rewardAnnouncement}\n\n` +
          `📊 Your Live Referral Stats:\n` +
          `├ 👥 Total Referrals: ${currentUser.referrals.length}\n` +
          `├ 🎯 Target Goal: ${config.requiredReferrals} Referrals\n` +
          `├ 🌟 Sponsored GCs: ${unlocked ? "✅ Unlocked" : "🔒 Locked"}\n` +
          `└ 📂 GC Submission Limit: ${unlocked ? config.unlockedGcLimit : config.baseGcLimit} GCs\n\n` +
          `🔗 Your Personal Invite Link:\n${refLink}`,
        [[{ text: "🔙 Back to Main Menu", callbackData: "menu:home" }]],
        false
      );
      return;
    }

    if (cbData === "menu:search") {
      setUsers((prev) => ({
        ...prev,
        [activeUserId]: { ...prev[activeUserId], step: "SEARCH_GC_QUERY" },
      }));
      updateLastBotMessage(
        `🔍 Quick Search Directory\n━━━━━━━━━━━━━━━━━━━━━━\nSend any keyword, topic, or category name in the message bar below to search across all ${approvedGcs.length} verified Group Chats:`,
        [[{ text: "🔙 Back to Main Menu", callbackData: "menu:home" }]],
        false
      );
      return;
    }

    if (cbData === "menu:report") {
      setUsers((prev) => ({
        ...prev,
        [activeUserId]: { ...prev[activeUserId], step: "REPORT_GC_REASON" },
      }));
      updateLastBotMessage(
        `🚨 Report Inactive or Scam GC\n━━━━━━━━━━━━━━━━━━━━━━\nPlease type the GC Code / Link along with the reason for reporting below. Our admin (@aaditya334356) will review it immediately:`,
        [[{ text: "🔙 Back to Main Menu", callbackData: "menu:home" }]],
        false
      );
      return;
    }

    if (cbData === "menu:how_it_works") {
      updateLastBotMessage(
        `❓ How 𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔 Works\n━━━━━━━━━━━━━━━━━━━━━━\n` +
          `1️⃣ All GC & Categories: Browse all ${approvedGcs.length} verified Telegram groups under 🌐 All GC or filter by Earning, Promotion, Chatting, Escrow, and Gaming/Tech.\n\n` +
          `2️⃣ Submit Your GC: List your own Telegram group with automatic duplicate-link detection. Every submission is verified by our Admin team.\n\n` +
          `3️⃣ Refer & Unlock: Invite ${config.requiredReferrals} friends using your unique referral link to unlock 🌟 Sponsored / Top GCs and increase your submission limit from ${config.baseGcLimit} to ${config.unlockedGcLimit} GCs!\n\n` +
          `👨‍💻 Owner & Support: @aaditya334356`,
        [
          [
            { text: `🌐 All GC (${approvedGcs.length})`, callbackData: "menu:all_gcs:0" },
            { text: "📂 Categories", callbackData: "menu:categories" },
          ],
          [
            { text: "➕ Submit GC", callbackData: "menu:submit_gc" },
            { text: "🔙 Main Menu", callbackData: "menu:home" },
          ],
        ],
        false
      );
      return;
    }

    // ========================================================================
    // ADMIN PANEL HANDLERS (Secured strictly for Admin ID: 8838351233)
    // ========================================================================
    if (cbData.startsWith("admin:")) {
      if (activeUserId !== ADMIN_ID) {
        showToast("⛔ Unauthorized! Switch persona to Admin (8838351233) to access Admin Panel.");
        return;
      }

      if (cbData === "admin:home") {
        setUsers((prev) => ({
          ...prev,
          [activeUserId]: { ...prev[activeUserId], step: "IDLE", draft: {} },
        }));
        updateLastBotMessage(
          `🛡️ 𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔 — Admin Control Panel\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👑 Admin: @aaditya334356 (${ADMIN_ID})\n` +
            `🛠️ Maintenance Mode: ${config.maintenanceMode ? "🔴 ON" : "🟢 OFF"}\n` +
            `📂 Approved GCs: ${approvedGcs.length} | 📥 Pending: ${pendingGcs.length}\n\n` +
            `Color Key: 🟢 Action | 👥/📋 Navigation | 🔴 Destructive/Back`,
          getAdminMenuKeyboard(config.maintenanceMode),
          false
        );
        return;
      }

      if (cbData === "admin:rewards") {
        setUsers((prev) => ({
          ...prev,
          [activeUserId]: { ...prev[activeUserId], step: "ADMIN_SET_REWARDS" },
        }));
        updateLastBotMessage(
          `🟢 Manage Payouts & Referral Rewards\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Current Required Referrals: ${config.requiredReferrals}\n` +
            `Current Base GC Limit: ${config.baseGcLimit}\n` +
            `Current Unlocked GC Limit: ${config.unlockedGcLimit}\n` +
            `Current Announcement: ${config.rewardAnnouncement}\n\n` +
            `✏️ Send new settings in chat below using format:\nRequiredRefs | BaseLimit | UnlockedLimit | Announcement`,
          [[{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]],
          false
        );
        return;
      }

      if (cbData.startsWith("admin:users:")) {
        const allUsers = Object.values(users);
        let text = `👥 Registered Users List (Total: ${allUsers.length})\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        allUsers.forEach((u) => {
          text +=
            `👤 ${u.firstName} (${u.username})\n` +
            `└ 🆔 ${u.id} | 🎁 Refers: ${u.referrals.length} | 📂 Submitted GCs: ${u.submittedGcIds.length}\n\n`;
        });
        updateLastBotMessage(
          text,
          [[{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]],
          false
        );
        return;
      }

      if (cbData === "admin:add_fsub") {
        setUsers((prev) => ({
          ...prev,
          [activeUserId]: { ...prev[activeUserId], step: "ADMIN_ADD_FORCE_CHANNEL" },
        }));
        updateLastBotMessage(
          `➕ Add Force Subscription Channel\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Send channel details in chat using format:\n@ChannelUsername | Channel Title | https://t.me/invite_link`,
          [[{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]],
          false
        );
        return;
      }

      if (cbData === "admin:manage_items") {
        let text =
          `📋 Manage Force Channels & Approved GCs\n━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📢 Active Force Channels (${forceChannels.length}):\n`;
        const kb: InlineBtn[][] = [];

        if (forceChannels.length === 0) {
          text += `None configured.\n\n`;
        } else {
          forceChannels.forEach((ch, idx) => {
            text += `• ${ch.title} (${ch.id})\n`;
            kb.push([{ text: `🗑️ Remove Channel: ${ch.title}`, callbackData: `admin:del_fsub:${idx}` }]);
          });
          text += `\n`;
        }

        text += `📂 Recent Approved GCs (${approvedGcs.length} total):\n`;
        approvedGcs.slice(0, 8).forEach((gc) => {
          text += `• ${gc.title} [${gc.id}]\n`;
          kb.push([{ text: `🗑️ Delete GC: ${gc.title}`, callbackData: `admin:del_gc:${gc.id}` }]);
        });

        kb.push([{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]);
        updateLastBotMessage(text, kb, false);
        return;
      }

      if (cbData.startsWith("admin:del_fsub:")) {
        const idx = parseInt(cbData.split(":")[2], 10);
        setForceChannels((prev) => prev.filter((_, i) => i !== idx));
        showToast("🗑️ Force channel removed from BOT_KV!");
        updateLastBotMessage(
          `✅ Force channel removed successfully.`,
          [[{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]],
          false
        );
        return;
      }

      if (cbData.startsWith("admin:del_gc:")) {
        const gcId = cbData.split(":")[2];
        setApprovedGcs((prev) => prev.filter((g) => g.id !== gcId));
        showToast(`🗑️ Deleted ${gcId} from BOT_KV!`);
        updateLastBotMessage(
          `✅ Group Chat (${gcId}) removed from directory.`,
          [[{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]],
          false
        );
        return;
      }

      if (cbData.startsWith("admin:pending:")) {
        if (pendingGcs.length === 0) {
          updateLastBotMessage(
            `📥 Pending GC Submissions\n━━━━━━━━━━━━━━━━━━━━━━\n✅ All caught up! There are 0 pending submissions in the queue.`,
            [[{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]],
            false
          );
          return;
        }
        const item = pendingGcs[0];
        updateLastBotMessage(
          `📥 Pending Submission Review (1 of ${pendingGcs.length})\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🏷️ Title: ${item.title}\n` +
            `📂 Category: ${item.category}\n` +
            `🔗 Link: ${item.link}\n` +
            `📝 Note: ${item.note}\n` +
            `👤 Submitted By: ${item.submitterUsername} (${item.submittedBy})\n` +
            `🕒 Submitted At: ${item.createdAt}`,
          [
            [
              { text: "🟢 Approve & Publish", callbackData: `admin:approve:${item.id}` },
              { text: "🌟 Approve as Sponsored", callbackData: `admin:approve_spon:${item.id}` },
            ],
            [{ text: "🔴 Reject with Note", callbackData: `admin:reject:${item.id}` }],
            [{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }],
          ],
          false
        );
        return;
      }

      if (cbData.startsWith("admin:approve:") || cbData.startsWith("admin:approve_spon:")) {
        const isSponsored = cbData.startsWith("admin:approve_spon:");
        const gcId = cbData.split(":")[2];
        const target = pendingGcs.find((g) => g.id === gcId);
        if (!target) return;

        const approvedItem: GroupChatItem = { ...target, status: "approved", isSponsored };
        setPendingGcs((prev) => prev.filter((g) => g.id !== gcId));
        setApprovedGcs((prev) => deduplicateGcsByLink([approvedItem, ...prev]));
        showToast(`✅ Approved "${target.title}" and published to BOT_KV!`);

        updateLastBotMessage(
          `✅ Approved & Published: ${target.title}\nPlacement: ${isSponsored ? "🌟 Sponsored / Top GC" : "📂 Standard Directory"}`,
          [
            [{ text: "📥 Next Pending Submission", callbackData: "admin:pending:0" }],
            [{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }],
          ],
          false
        );
        return;
      }

      if (cbData.startsWith("admin:reject:")) {
        const gcId = cbData.split(":")[2];
        setUsers((prev) => ({
          ...prev,
          [activeUserId]: {
            ...prev[activeUserId],
            step: "ADMIN_REJECT_NOTE",
            draft: { targetGcId: gcId },
          },
        }));
        updateLastBotMessage(
          `🔴 Reject Submission (${gcId})\n\nPlease send the rejection reason/note in the chat input below to notify the submitter:`,
          [[{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]],
          false
        );
        return;
      }

      if (cbData === "admin:categories") {
        const kb: InlineBtn[][] = [[{ text: "🟢 Add New Category", callbackData: "admin:add_cat" }]];
        categories.forEach((cat, idx) => {
          kb.push([{ text: `🗑️ Remove: ${cat}`, callbackData: `admin:del_cat:${idx}` }]);
        });
        kb.push([{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]);

        updateLastBotMessage(
          `⚙️ Manage Directory Categories (${categories.length})\n━━━━━━━━━━━━━━━━━━━━━━\nClick to add a new category or remove an existing one:`,
          kb,
          false
        );
        return;
      }

      if (cbData === "admin:add_cat") {
        setUsers((prev) => ({
          ...prev,
          [activeUserId]: { ...prev[activeUserId], step: "ADMIN_ADD_CATEGORY" },
        }));
        updateLastBotMessage(
          `🟢 Add New Directory Category\n\nSend the name of the new category in the chat input below:`,
          [[{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]],
          false
        );
        return;
      }

      if (cbData.startsWith("admin:del_cat:")) {
        const idx = parseInt(cbData.split(":")[2], 10);
        if (categories.length <= 1) {
          showToast("⚠️ Cannot delete the last category!");
          return;
        }
        const removed = categories[idx];
        setCategories((prev) => prev.filter((_, i) => i !== idx));
        showToast(`🗑️ Removed category "${removed}"`);
        updateLastBotMessage(
          `✅ Category "${removed}" removed from BOT_KV.`,
          [[{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]],
          false
        );
        return;
      }

      if (cbData === "admin:sponsored") {
        setUsers((prev) => ({
          ...prev,
          [activeUserId]: { ...prev[activeUserId], step: "ADMIN_ADD_SPONSORED" },
        }));
        updateLastBotMessage(
          `🏷️ Update Sponsored Banner\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Current Text: ${config.sponsoredBannerText}\n` +
            `Current Link: ${config.sponsoredBannerUrl}\n\n` +
            `✏️ Send new banner in chat using format:\nBanner Promotional Text | https://t.me/target_link`,
          [[{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]],
          false
        );
        return;
      }

      if (cbData === "admin:toggle_maint") {
        const nextMaint = !config.maintenanceMode;
        setConfig((prev) => ({ ...prev, maintenanceMode: nextMaint }));
        showToast(`🛠️ Maintenance Mode ${nextMaint ? "ENABLED" : "DISABLED"}`);
        updateLastBotMessage(
          `🛡️ 𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔 — Admin Control Panel\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🛠️ Maintenance Mode: ${nextMaint ? "🔴 ON (Non-admins blocked)" : "🟢 OFF (Normal operation)"}`,
          getAdminMenuKeyboard(nextMaint),
          false
        );
        return;
      }

      if (cbData === "admin:stats") {
        updateLastBotMessage(
          `📊 𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔 — Live KV Telemetry\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👥 Total Registered Users: ${Object.keys(users).length}\n` +
            `📂 Approved GCs Live: ${approvedGcs.length}\n` +
            `🌟 Sponsored GCs: ${approvedGcs.filter((g) => g.isSponsored).length}\n` +
            `⏳ Pending Approvals: ${pendingGcs.length}\n` +
            `📁 Active Categories: ${categories.length}\n` +
            `📢 Force Join Channels: ${forceChannels.length}\n` +
            `🚨 User Reports Logged: ${reports.length}\n` +
            `🛠️ Maintenance Status: ${config.maintenanceMode ? "🔴 Active" : "🟢 Normal"}`,
          [[{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]],
          false
        );
        return;
      }

      if (cbData === "admin:broadcast") {
        setUsers((prev) => ({
          ...prev,
          [activeUserId]: { ...prev[activeUserId], step: "ADMIN_BROADCAST" },
        }));
        updateLastBotMessage(
          `📢 Global Broadcast System\n━━━━━━━━━━━━━━━━━━━━━━\nSend any announcement message in the chat bar below, and the Worker will broadcast it to all ${Object.keys(users).length} registered users in KV:`,
          [[{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]],
          false
        );
        return;
      }
    }
  };

  const updateLastBotMessage = (text: string, keyboard: InlineBtn[][], isBanner: boolean) => {
    setMessages((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].sender === "bot") {
          copy[i] = { ...copy[i], text, keyboard, isBanner };
          return copy;
        }
      }
      return [
        ...copy,
        { id: `b-${Date.now()}`, sender: "bot", text, keyboard, isBanner, timestamp: nowTime() },
      ];
    });
  };

  // Handle Chat Input Submission inside Simulator
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");

    if (text === "/start" || text.startsWith("/start ")) {
      triggerStartAnimation(activeUserId);
      return;
    }

    // Append user message
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: "user",
      text,
      timestamp: nowTime(),
    };

    const replyBot = (botText: string, kb: InlineBtn[][]) => {
      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: `b-${Date.now() + 1}`,
          sender: "bot",
          text: botText,
          keyboard: kb,
          timestamp: nowTime(),
        },
      ]);
    };

    if (text === "/admin") {
      if (activeUserId !== ADMIN_ID) {
        replyBot("⛔ Access Denied: Restricted to Admin ID 8838351233 (@aaditya334356).", [
          [{ text: "🏠 Back to Main Menu", callbackData: "menu:home" }],
        ]);
      } else {
        replyBot(
          `🛡️ 𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔 — Admin Control Panel\n━━━━━━━━━━━━━━━━━━━━━━\n👑 Owner: @aaditya334356 (${ADMIN_ID})`,
          getAdminMenuKeyboard(config.maintenanceMode)
        );
      }
      return;
    }

    const step = currentUser.step;

    // Step 1 -> 2 -> 3 GC Submission with Duplicate Detection
    if (step === "SUBMIT_GC_TITLE") {
      setUsers((prev) => ({
        ...prev,
        [activeUserId]: {
          ...prev[activeUserId],
          step: "SUBMIT_GC_LINK",
          draft: { ...prev[activeUserId].draft, title: text },
        },
      }));
      replyBot(
        `✅ Title Saved: ${text}\n\nStep 3a of 3: Now send your valid Telegram Group Link (must start with https://t.me/):`,
        [[{ text: "🔙 Cancel", callbackData: "menu:home" }]]
      );
      return;
    }

    if (step === "SUBMIT_GC_LINK") {
      if (!text.startsWith("https://t.me/")) {
        replyBot("⚠️ Invalid link! Please send a link starting with https://t.me/", [
          [{ text: "🔙 Cancel", callbackData: "menu:home" }],
        ]);
        return;
      }

      const candidateKey = normalizeTelegramLink(text);
      const isDuplicate = [...approvedGcs, ...pendingGcs].some(
        (g) => normalizeTelegramLink(g.link) === candidateKey
      );
      if (isDuplicate) {
        showToast("⚠️ Duplicate link detected and blocked!");
        replyBot(
          "⚠️ Duplicate Group Detected!\nThis Telegram group link is already listed in our directory or awaiting review. Please send a different group link:",
          [[{ text: "🔙 Cancel", callbackData: "menu:home" }]]
        );
        return;
      }

      setUsers((prev) => ({
        ...prev,
        [activeUserId]: {
          ...prev[activeUserId],
          step: "SUBMIT_GC_NOTE",
          draft: { ...prev[activeUserId].draft, link: text },
        },
      }));
      replyBot(
        `🔗 Link Verified (No Duplicates)!\n\nStep 3b of 3: Finally, send a short Note / Description describing your group:`,
        [[{ text: "🔙 Cancel", callbackData: "menu:home" }]]
      );
      return;
    }

    if (step === "SUBMIT_GC_NOTE") {
      const newGc: GroupChatItem = {
        id: `GC-${Math.floor(100 + Math.random() * 899)}N`,
        title: currentUser.draft.title || "Untitled Group",
        category: currentUser.draft.category || categories[0],
        link: currentUser.draft.link || "https://t.me/aaditya334356",
        note: text,
        submittedBy: activeUserId,
        submitterUsername: currentUser.username,
        status: "pending",
        createdAt: new Date().toISOString().split("T")[0],
      };

      setPendingGcs((prev) => [...prev, newGc]);
      setUsers((prev) => ({
        ...prev,
        [activeUserId]: {
          ...prev[activeUserId],
          submittedGcIds: [...prev[activeUserId].submittedGcIds, newGc.id],
          step: "IDLE",
          draft: {},
        },
      }));
      showToast(`📥 GC "${newGc.title}" added to Pending Queue in BOT_KV!`);

      replyBot(
        `🎉 Submission Sent for Approval!\n━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🆔 Submission ID: ${newGc.id}\n` +
          `🏷️ Group: ${newGc.title}\n` +
          `📂 Category: ${newGc.category}\n\n` +
          `⏳ Admin (@aaditya334356) will review and publish your group shortly!`,
        [[{ text: "🔙 Back to Main Menu", callbackData: "menu:home" }]]
      );
      return;
    }

    if (step === "SEARCH_GC_QUERY") {
      setUsers((prev) => ({
        ...prev,
        [activeUserId]: { ...prev[activeUserId], step: "IDLE" },
      }));
      const q = text.toLowerCase();
      const matches = approvedGcs.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          g.category.toLowerCase().includes(q) ||
          g.note.toLowerCase().includes(q) ||
          g.link.toLowerCase().includes(q)
      );

      let resText = `🔍 Search Results for "${text}" (${matches.length})\n━━━━━━━━━━━━━━━━━━━━━━\n`;
      const kb: InlineBtn[][] = [];
      if (matches.length === 0) {
        resText += `No matching groups found. Try another keyword!`;
      } else {
        matches.slice(0, 8).forEach((g, i) => {
          resText += `${i + 1}. ${g.title} [${g.category}]\n└ 📝 ${g.note}\n\n`;
          kb.push([{ text: `🚀 Join ${g.title}`, url: g.link }]);
        });
      }
      kb.push([
        { text: "🌐 All GC", callbackData: "menu:all_gcs:0" },
        { text: "🔙 Main Menu", callbackData: "menu:home" },
      ]);
      replyBot(resText, kb);
      return;
    }

    if (step === "REPORT_GC_REASON") {
      setUsers((prev) => ({
        ...prev,
        [activeUserId]: { ...prev[activeUserId], step: "IDLE" },
      }));
      setReports((prev) => [
        ...prev,
        `[${new Date().toISOString()}] From ${activeUserId} (${currentUser.username}): ${text}`,
      ]);
      showToast("🚨 Report logged in BOT_KV and forwarded to Admin!");
      replyBot(
        `✅ Report Submitted! Thank you for keeping 𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔 clean and verified.`,
        [[{ text: "🔙 Back to Main Menu", callbackData: "menu:home" }]]
      );
      return;
    }

    // Admin Input Steps
    if (activeUserId === ADMIN_ID) {
      if (step === "ADMIN_SET_REWARDS") {
        const parts = text.split("|").map((s) => s.trim());
        if (parts.length >= 4) {
          setConfig((prev) => ({
            ...prev,
            requiredReferrals: Math.max(1, parseInt(parts[0], 10) || 3),
            baseGcLimit: Math.max(1, parseInt(parts[1], 10) || 2),
            unlockedGcLimit: Math.max(1, parseInt(parts[2], 10) || 10),
            rewardAnnouncement: parts.slice(3).join(" | "),
          }));
        }
        setUsers((prev) => ({ ...prev, [activeUserId]: { ...prev[activeUserId], step: "IDLE" } }));
        replyBot(`✅ Payouts & Referral Rewards Updated in BOT_KV!`, [
          [{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }],
        ]);
        return;
      }

      if (step === "ADMIN_ADD_FORCE_CHANNEL") {
        const parts = text.split("|").map((s) => s.trim());
        const ch: SimForceChannel = {
          id: parts[0] || "@SponsorChannel",
          title: parts[1] || parts[0] || "Official Sponsor Channel",
          inviteLink: parts[2] || "https://t.me/aaditya334356",
        };
        setForceChannels((prev) => [...prev, ch]);
        setJoinedForceChannels(false);
        setUsers((prev) => ({ ...prev, [activeUserId]: { ...prev[activeUserId], step: "IDLE" } }));
        showToast(`➕ Force channel "${ch.title}" added to BOT_KV!`);
        replyBot(`✅ Force Channel Added: ${ch.title}`, [
          [{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }],
        ]);
        return;
      }

      if (step === "ADMIN_ADD_CATEGORY") {
        if (!categories.includes(text)) {
          setCategories((prev) => [...prev, text]);
        }
        setUsers((prev) => ({ ...prev, [activeUserId]: { ...prev[activeUserId], step: "IDLE" } }));
        showToast(`⚙️ Category "${text}" added to BOT_KV!`);
        replyBot(`✅ Category Added: ${text}`, [
          [{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }],
        ]);
        return;
      }

      if (step === "ADMIN_ADD_SPONSORED") {
        const parts = text.split("|").map((s) => s.trim());
        setConfig((prev) => ({
          ...prev,
          sponsoredBannerText: parts[0] || text,
          sponsoredBannerUrl: parts[1] || prev.sponsoredBannerUrl,
        }));
        setUsers((prev) => ({ ...prev, [activeUserId]: { ...prev[activeUserId], step: "IDLE" } }));
        showToast("🏷️ Sponsored Banner updated in BOT_KV!");
        replyBot(`✅ Sponsored Banner Updated!`, [
          [{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }],
        ]);
        return;
      }

      if (step === "ADMIN_REJECT_NOTE") {
        const gcId = currentUser.draft.targetGcId;
        setPendingGcs((prev) => prev.filter((g) => g.id !== gcId));
        setUsers((prev) => ({
          ...prev,
          [activeUserId]: { ...prev[activeUserId], step: "IDLE", draft: {} },
        }));
        showToast(`🔴 Rejected ${gcId} with note.`);
        replyBot(`✅ Submission (${gcId}) Rejected & User Notified.\nNote sent: "${text}"`, [
          [{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }],
        ]);
        return;
      }

      if (step === "ADMIN_BROADCAST") {
        setUsers((prev) => ({ ...prev, [activeUserId]: { ...prev[activeUserId], step: "IDLE" } }));
        const totalUsers = Object.keys(users).length;
        showToast(`📢 Broadcast delivered to ${totalUsers} users!`);
        replyBot(
          `📢 Broadcast Completed!\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `✅ Delivered: ${totalUsers} users\n❌ Failed: 0\n\n` +
            `Preview:\n"${text}"`,
          [[{ text: "🔴 Back to Admin Panel", callbackData: "admin:home" }]]
        );
        return;
      }
    }

    // Default fallback
    const unlocked = currentUser.referrals.length >= config.requiredReferrals;
    replyBot(
      buildWelcomeText(currentUser, config, approvedGcs.length),
      getMainMenuKeyboard(activeUserId, unlocked, approvedGcs.length)
    );
  };

  const activeCodeContent =
    selectedFile === "index.ts"
      ? WORKER_INDEX_TS
      : selectedFile === "wrangler.toml"
      ? WRANGLER_TOML
      : PACKAGE_JSON_SNIPPET;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Notification Toast */}
      {toastAlert && (
        <div className="fixed bottom-6 right-6 z-50 bg-sky-500 text-slate-950 font-semibold text-sm px-4 py-3 rounded-lg shadow-lg flex items-center gap-2.5">
          <Check className="w-4 h-4 shrink-0" />
          <span>{toastAlert}</span>
        </div>
      )}

      {/* TOP BAR CONTRACT: Strictly 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur sticky top-0 z-40">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab("code");
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 font-display"
        >
          𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔 Studio
        </a>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            onClick={() => setActiveTab("code")}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
              activeTab === "code" ? "text-white border-b-2 border-sky-400" : ""
            }`}
          >
            Worker Code
          </button>
          <button
            onClick={() => setActiveTab("simulator")}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
              activeTab === "simulator" ? "text-white border-b-2 border-sky-400" : ""
            }`}
          >
            Bot Simulator
          </button>
          <button
            onClick={() => setActiveTab("kv")}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
              activeTab === "kv" ? "text-white border-b-2 border-sky-400" : ""
            }`}
          >
            Cloudflare KV
          </button>
          <button
            onClick={() => setActiveTab("deploy")}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
              activeTab === "deploy" ? "text-white border-b-2 border-sky-400" : ""
            }`}
          >
            Wrangler Setup
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => handleCopy(WORKER_INDEX_TS, "header-copy")}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
          >
            {copiedId === "header-copy" ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Copied index.ts
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy Worker Script
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Workspace Container */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8 space-y-8">
        {/* Hero Overview Banner + Quick Architecture Strip */}
        <section className="border border-slate-800 bg-slate-900/50 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono">
              <span>has_modules: true (ES Worker)</span>
              <span aria-hidden="true">·</span>
              <span>{approvedGcs.length} Verified GCs in All GC</span>
              <span aria-hidden="true">·</span>
              <span>Owner: @aaditya334356</span>
              <span aria-hidden="true">·</span>
              <span>Admin ID: 8838351233</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight font-display">
              𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔 — Pure Cloudflare Worker Module & All GC Directory
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Updated with all <strong className="text-white">{approvedGcs.length} deduplicated Telegram groups</strong>{" "}
              integrated under the <code className="text-sky-300 font-mono">🌐 All GC</code> inline
              keyboard menu and categorized across Earning, Promotion, Chatting, Escrow, and
              Gaming/Tech. Configured strictly for pure Cloudflare Worker Module deployment (
              <code className="text-emerald-400 font-mono">compatibility_date = "2026-11-04"</code>).
            </p>
          </div>

          {/* Segmented View Switcher (Mobile + Desktop Quick Access) */}
          <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-950 border border-slate-800 rounded-lg shrink-0">
            <button
              onClick={() => setActiveTab("code")}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeTab === "code"
                  ? "bg-sky-500 text-slate-950 font-semibold"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              Source Code
            </button>
            <button
              onClick={() => setActiveTab("simulator")}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeTab === "simulator"
                  ? "bg-sky-500 text-slate-950 font-semibold"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Play className="w-3.5 h-3.5" />
              Interactive Simulator
            </button>
            <button
              onClick={() => setActiveTab("kv")}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeTab === "kv"
                  ? "bg-sky-500 text-slate-950 font-semibold"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              All GC & KV Store ({approvedGcs.length})
            </button>
            <button
              onClick={() => setActiveTab("deploy")}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeTab === "deploy"
                  ? "bg-sky-500 text-slate-950 font-semibold"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              Wrangler & KV Guide
            </button>
          </div>
        </section>

        {/* ===================================================================
            TAB 1: WORKER SOURCE CODE + SIDE-BY-SIDE LIVE SIMULATOR
        =================================================================== */}
        {activeTab === "code" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 7 Columns: Full Production Code Explorer */}
            <div className="lg:col-span-7 border border-slate-800 bg-slate-900/60 rounded-xl overflow-hidden flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 border-b border-slate-800 bg-slate-900">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSelectedFile("index.ts")}
                    className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedFile === "index.ts"
                        ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    src/index.ts
                  </button>
                  <button
                    onClick={() => setSelectedFile("wrangler.toml")}
                    className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedFile === "wrangler.toml"
                        ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    wrangler.toml
                  </button>
                  <button
                    onClick={() => setSelectedFile("package.json")}
                    className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedFile === "package.json"
                        ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    package.json
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopy(activeCodeContent, "code-viewer")}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedId === "code-viewer" ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy File
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleDownload(selectedFile, activeCodeContent)}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </button>
                </div>
              </div>

              <div className="p-4 overflow-x-auto max-h-[680px] overflow-y-auto bg-slate-950/80">
                <pre className="text-xs font-mono leading-relaxed text-slate-200 select-all">
                  <code>{activeCodeContent}</code>
                </pre>
              </div>
            </div>

            {/* Right 5 Columns: Live Interactive Bot Preview */}
            <div className="lg:col-span-5 flex flex-col border border-slate-800 bg-slate-900/60 rounded-xl overflow-hidden">
              <SimulatorPanel
                activeUserId={activeUserId}
                setActiveUserId={setActiveUserId}
                currentUser={currentUser}
                config={config}
                messages={messages}
                chatInput={chatInput}
                setChatInput={setChatInput}
                handleSendMessage={handleSendMessage}
                handleCallbackClick={handleCallbackClick}
                triggerStartAnimation={triggerStartAnimation}
                simulateReferralJoin={simulateReferralJoin}
                isAnimatingStart={isAnimatingStart}
                chatEndRef={chatEndRef}
              />
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 2: FULL-SCREEN INTERACTIVE BOT SIMULATOR & TESTBENCH
        =================================================================== */}
        {activeTab === "simulator" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 border border-slate-800 bg-slate-900/60 rounded-xl overflow-hidden">
              <SimulatorPanel
                activeUserId={activeUserId}
                setActiveUserId={setActiveUserId}
                currentUser={currentUser}
                config={config}
                messages={messages}
                chatInput={chatInput}
                setChatInput={setChatInput}
                handleSendMessage={handleSendMessage}
                handleCallbackClick={handleCallbackClick}
                triggerStartAnimation={triggerStartAnimation}
                simulateReferralJoin={simulateReferralJoin}
                isAnimatingStart={isAnimatingStart}
                chatEndRef={chatEndRef}
              />
            </div>

            {/* Right 5 Columns: Quick Feature Test Triggers */}
            <div className="lg:col-span-5 space-y-6">
              <div className="border border-slate-800 bg-slate-900/60 rounded-xl p-5 space-y-4">
                <h2 className="text-base font-semibold text-white font-display">
                  01. Test Scenarios & All GC Quick Triggers
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Click <strong className="text-white">🌐 Open All GC ({approvedGcs.length})</strong>{" "}
                  below or inside the Telegram bot menu to test the paginated inline keyboard containing
                  all 29 deduplicated Telegram group links.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    onClick={() => handleCallbackClick("menu:all_gcs:0")}
                    className="px-3.5 py-2.5 text-xs font-medium bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-500/40 rounded-lg text-left transition-colors cursor-pointer"
                  >
                    🌐 Open All GC ({approvedGcs.length} Links)
                  </button>
                  <button
                    onClick={() => triggerStartAnimation(activeUserId)}
                    className="px-3.5 py-2.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-left transition-colors cursor-pointer"
                  >
                    ⚡ Run 4-Step /start Animation
                  </button>
                  <button
                    onClick={simulateReferralJoin}
                    className="px-3.5 py-2.5 text-xs font-medium bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded-lg text-left transition-colors cursor-pointer"
                  >
                    🎁 +1 Simulate Friend Referral
                  </button>
                  <button
                    onClick={() => {
                      setActiveUserId(ADMIN_ID);
                      setTimeout(() => handleCallbackClick("admin:home"), 50);
                    }}
                    className="px-3.5 py-2.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-left transition-colors cursor-pointer"
                  >
                    🛡️ Open Admin Panel (8838351233)
                  </button>
                </div>
              </div>

              <div className="border border-slate-800 bg-slate-900/60 rounded-xl p-5 space-y-3">
                <h2 className="text-base font-semibold text-white font-display">
                  02. Live Bot Session Telemetry (KV State)
                </h2>
                <div className="divide-y divide-slate-800/80 text-xs">
                  <div className="py-2 flex items-center justify-between">
                    <span className="text-slate-400">Active Persona ID</span>
                    <span className="font-mono text-white tabular-nums">{currentUser.id}</span>
                  </div>
                  <div className="py-2 flex items-center justify-between">
                    <span className="text-slate-400">Current Session Step</span>
                    <span className="font-mono text-sky-300">{currentUser.step}</span>
                  </div>
                  <div className="py-2 flex items-center justify-between">
                    <span className="text-slate-400">Referral Unlock Progress</span>
                    <span className="font-mono text-emerald-400 tabular-nums">
                      {currentUser.referrals.length} / {config.requiredReferrals} Referrals
                    </span>
                  </div>
                  <div className="py-2 flex items-center justify-between">
                    <span className="text-slate-400">Deduplicated All GC Count</span>
                    <span className="font-mono text-slate-200 tabular-nums">
                      {approvedGcs.length} Verified GCs
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 3: CLOUDFLARE KV DATABASE INSPECTOR
        =================================================================== */}
        {activeTab === "kv" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-4">
                <div className="text-xs text-slate-400">KV Namespace Binding</div>
                <div className="text-lg font-bold text-white font-mono mt-1">env.BOT_KV</div>
                <div className="text-xs text-slate-400 mt-1">
                  {Object.keys(users).length} user keys · {categories.length} categories
                </div>
              </div>
              <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-4">
                <div className="text-xs text-slate-400">All GC Directory (gcs:approved)</div>
                <div className="text-lg font-bold text-emerald-400 font-mono tabular-nums mt-1">
                  {approvedGcs.length} Verified Links
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  0 Duplicates · Auto-normalized URLs
                </div>
              </div>
              <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-4">
                <div className="text-xs text-slate-400">Pending Queue (gcs:pending)</div>
                <div className="text-lg font-bold text-amber-400 font-mono tabular-nums mt-1">
                  {pendingGcs.length} Awaiting Review
                </div>
                <div className="text-xs text-slate-400 mt-1">Admin ID 8838351233 approval queue</div>
              </div>
              <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-4">
                <div className="text-xs text-slate-400">Force Channels (config:force_channels)</div>
                <div className="text-lg font-bold text-sky-400 font-mono tabular-nums mt-1">
                  {forceChannels.length} Active Gates
                </div>
                <div className="text-xs text-slate-400 mt-1">Checked via getChatMember API</div>
              </div>
            </div>

            {/* KV Approved & Pending GCs Table (All 29 GCs) */}
            <div className="border border-slate-800 bg-slate-900/50 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-white font-display">
                    All GC Master Directory (<code className="text-sky-300 font-mono">gcs:approved</code> —{" "}
                    {approvedGcs.length} Unique Groups)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Every link is automatically parsed, categorized, and deduplicated via{" "}
                    <code className="text-slate-300 font-mono">normalizeTelegramLink()</code>.
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/60">
                      <th className="py-3 px-4 font-medium">#</th>
                      <th className="py-3 px-4 font-medium">GC ID</th>
                      <th className="py-3 px-4 font-medium">Group Title</th>
                      <th className="py-3 px-4 font-medium">Category</th>
                      <th className="py-3 px-4 font-medium">Telegram Link</th>
                      <th className="py-3 px-4 font-medium">Status</th>
                      <th className="py-3 px-4 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {[...pendingGcs, ...approvedGcs].map((gc, idx) => (
                      <tr key={gc.id} className="hover:bg-slate-800/30">
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-500">{idx + 1}</td>
                        <td className="py-3 px-4 font-mono text-slate-300">{gc.id}</td>
                        <td className="py-3 px-4 font-medium text-white">
                          {gc.title} {gc.isSponsored ? "🌟" : ""}
                        </td>
                        <td className="py-3 px-4 text-slate-300">{gc.category}</td>
                        <td className="py-3 px-4 font-mono text-sky-300">
                          <a
                            href={gc.link}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline inline-flex items-center gap-1"
                          >
                            {gc.link}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                        <td className="py-3 px-4">
                          {gc.status === "approved" ? (
                            <span className="text-emerald-400 font-medium">Approved</span>
                          ) : (
                            <span className="text-amber-400 font-medium">Pending Queue</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {gc.status === "pending" ? (
                            <button
                              onClick={() => {
                                setActiveUserId(ADMIN_ID);
                                handleCallbackClick(`admin:approve:${gc.id}`);
                              }}
                              className="px-2.5 py-1 text-xs font-medium bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 rounded transition-colors cursor-pointer"
                            >
                              Approve Now
                            </button>
                          ) : (
                            <button
                              onClick={() =>
                                setApprovedGcs((prev) => prev.filter((item) => item.id !== gc.id))
                              }
                              className="px-2.5 py-1 text-xs font-medium bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 rounded transition-colors cursor-pointer inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" />
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* KV Users Table */}
            <div className="border border-slate-800 bg-slate-900/50 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white font-display">
                    KV Key Prefix: <code className="text-sky-300 font-mono">user:&lt;id&gt;</code> &{" "}
                    <code className="text-sky-300 font-mono">users:index</code>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Real-time state of registered Telegram users, referral counts, and submitted GC quotas.
                  </p>
                </div>
                <button
                  onClick={simulateReferralJoin}
                  className="px-3 py-1.5 text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Simulate Referral User
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/60">
                      <th className="py-3 px-4 font-medium">KV Key</th>
                      <th className="py-3 px-4 font-medium">Telegram ID</th>
                      <th className="py-3 px-4 font-medium">Username & Name</th>
                      <th className="py-3 px-4 font-medium text-right">Total Refers</th>
                      <th className="py-3 px-4 font-medium text-right">Submitted GCs</th>
                      <th className="py-3 px-4 font-medium">VIP Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {Object.values(users).map((u) => {
                      const isVip = u.referrals.length >= config.requiredReferrals || u.id === ADMIN_ID;
                      return (
                        <tr key={u.id} className="hover:bg-slate-800/30">
                          <td className="py-3 px-4 font-mono text-sky-300">user:{u.id}</td>
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-200">{u.id}</td>
                          <td className="py-3 px-4 text-slate-200">
                            <span className="font-medium text-white">{u.firstName}</span>{" "}
                            <span className="text-slate-400">({u.username})</span>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-right text-emerald-400">
                            {u.referrals.length}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-200">
                            {u.submittedGcIds.length}
                          </td>
                          <td className="py-3 px-4 text-slate-300">
                            {isVip ? "✅ Unlocked" : "🔒 Locked"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            TAB 4: WRANGLER.TOML & KV BINDINGS DEPLOYMENT GUIDE
        =================================================================== */}
        {activeTab === "deploy" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 space-y-4">
              <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-6 space-y-5">
                <h2 className="text-lg font-bold text-white font-display">
                  Step-by-Step Cloudflare Workers & KV Deployment Guide
                </h2>
                <div className="space-y-4">
                  {DEPLOYMENT_STEPS.map((item) => (
                    <div
                      key={item.step}
                      className="border border-slate-800 bg-slate-950/70 rounded-lg p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-white">{item.step}</h3>
                        <button
                          onClick={() => handleCopy(item.command, item.step)}
                          className="px-2.5 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          {copiedId === item.step ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              Copy Command
                            </>
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-slate-400">{item.description}</p>
                      <pre className="p-3 bg-slate-900 border border-slate-800 rounded text-xs font-mono text-sky-300 overflow-x-auto">
                        <code>{item.command}</code>
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 space-y-6">
              <div className="border border-slate-800 bg-slate-900/50 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900">
                  <span className="text-xs font-mono font-semibold text-sky-300">wrangler.toml</span>
                  <button
                    onClick={() => handleCopy(WRANGLER_TOML, "wrangler-copy")}
                    className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedId === "wrangler-copy" ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy wrangler.toml
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
                  <code>{WRANGLER_TOML}</code>
                </pre>
              </div>

              <div className="border border-slate-800 bg-slate-900/50 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900">
                  <span className="text-xs font-mono font-semibold text-sky-300">package.json</span>
                  <button
                    onClick={() => handleCopy(PACKAGE_JSON_SNIPPET, "pkg-copy")}
                    className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedId === "pkg-copy" ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy package.json
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
                  <code>{PACKAGE_JSON_SNIPPET}</code>
                </pre>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-slate-800/80 py-5 px-6 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-4 max-w-[1400px] w-full mx-auto">
        <div>
          𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔 (Group Finder Pro) · Owner: @aaditya334356 · Admin ID: 8838351233
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => handleDownload("index.ts", WORKER_INDEX_TS)}
            className="hover:text-slate-300 transition-colors cursor-pointer"
          >
            Download index.ts
          </button>
          <span>·</span>
          <button
            onClick={() => handleDownload("wrangler.toml", WRANGLER_TOML)}
            className="hover:text-slate-300 transition-colors cursor-pointer"
          >
            Download wrangler.toml
          </button>
        </div>
      </footer>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENT: TELEGRAM BOT INTERACTIVE SIMULATOR
// ============================================================================

interface SimulatorPanelProps {
  activeUserId: number;
  setActiveUserId: (id: number) => void;
  currentUser: SimUser;
  config: SimConfig;
  messages: ChatMessage[];
  chatInput: string;
  setChatInput: (val: string) => void;
  handleSendMessage: (e: React.FormEvent) => void;
  handleCallbackClick: (cbData: string) => void;
  triggerStartAnimation: (uid?: number) => void;
  simulateReferralJoin: () => void;
  isAnimatingStart: boolean;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}

function SimulatorPanel({
  activeUserId,
  setActiveUserId,
  currentUser,
  config,
  messages,
  chatInput,
  setChatInput,
  handleSendMessage,
  handleCallbackClick,
  triggerStartAnimation,
  simulateReferralJoin,
  isAnimatingStart,
  chatEndRef,
}: SimulatorPanelProps) {
  return (
    <div className="flex flex-col h-[680px]">
      {/* Simulator Header with Persona Switcher */}
      <div className="p-3.5 border-b border-slate-800 bg-slate-900 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-300 font-bold text-xs">
            GF
          </div>
          <div>
            <div className="text-xs font-bold text-white">𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔</div>
            <div className="text-[11px] text-slate-400 font-mono">
              Acting as: {currentUser.username} ({currentUser.id})
            </div>
          </div>
        </div>

        {/* Role Switcher & Quick /start */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setActiveUserId(ADMIN_ID)}
            title="Switch to Admin ID 8838351233"
            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
              activeUserId === ADMIN_ID
                ? "bg-emerald-500 text-slate-950 font-semibold"
                : "bg-slate-800 text-slate-300 hover:text-white"
            }`}
          >
            <Shield className="w-3 h-3" />
            Admin (8838351233)
          </button>
          <button
            onClick={() => setActiveUserId(STD_USER_ID)}
            title="Switch to Regular User"
            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
              activeUserId === STD_USER_ID
                ? "bg-sky-500 text-slate-950 font-semibold"
                : "bg-slate-800 text-slate-300 hover:text-white"
            }`}
          >
            <UserCheck className="w-3 h-3" />
            User ({currentUser.referrals.length}/{config.requiredReferrals} Refs)
          </button>
        </div>
      </div>

      {/* Quick Action Utility Bar */}
      <div className="px-3.5 py-2 bg-slate-950 border-b border-slate-800/80 flex items-center justify-between gap-2 text-[11px]">
        <button
          onClick={() => triggerStartAnimation(activeUserId)}
          disabled={isAnimatingStart}
          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-sky-300 rounded font-mono flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3 h-3 ${isAnimatingStart ? "animate-spin" : ""}`} />
          Send /start
        </button>
        <button
          onClick={() => handleCallbackClick("menu:all_gcs:0")}
          className="px-2.5 py-1 bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 rounded font-mono flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
        >
          🌐 View All GC (29)
        </button>
        <button
          onClick={simulateReferralJoin}
          className="px-2.5 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded font-mono flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
        >
          +1 Referral
        </button>
      </div>

      {/* Chat Viewport */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/90">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[92%] rounded-xl p-3.5 text-xs leading-relaxed ${
                msg.sender === "user"
                  ? "bg-sky-500 text-slate-950 font-medium"
                  : "bg-slate-900 border border-slate-800 text-slate-100"
              }`}
            >
              {/* Welcome Banner Header Graphic on Step 4 */}
              {msg.isBanner && (
                <div className="mb-3 rounded-lg bg-gradient-to-r from-slate-950 via-sky-950 to-slate-950 border border-sky-500/30 p-3.5">
                  <div className="text-[10px] font-mono text-sky-400">
                    VERIFIED DIRECTORY · CLOUDFLARE EDGE KV
                  </div>
                  <div className="text-base font-bold text-white mt-0.5 font-display">
                    𝕲𝖗𝖔𝖚𝖕 𝕱𝖎𝖓𝖉𝖊𝖗 𝕻𝖗𝖔
                  </div>
                  <div className="text-[11px] text-slate-300 mt-0.5">
                    Curated Telegram Communities · Managed by @aaditya334356
                  </div>
                </div>
              )}

              {/* Loading Progress Bar during /start steps 1-3 */}
              {typeof msg.loadingProgress === "number" && (
                <div className="mb-2 w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-sky-400 h-full transition-all duration-300"
                    style={{ width: `${msg.loadingProgress}%` }}
                  />
                </div>
              )}

              <div className="whitespace-pre-wrap font-sans">{msg.text}</div>
              <div
                className={`text-[10px] mt-1.5 text-right font-mono ${
                  msg.sender === "user" ? "text-slate-900/70" : "text-slate-500"
                }`}
              >
                {msg.timestamp}
              </div>
            </div>

            {/* Inline Keyboard Buttons */}
            {msg.keyboard && msg.keyboard.length > 0 && (
              <div className="w-full max-w-[92%] mt-1.5 space-y-1">
                {msg.keyboard.map((row, rIdx) => {
                  const gridCols =
                    row.length === 1
                      ? "grid-cols-1"
                      : row.length === 3
                      ? "grid-cols-3"
                      : "grid-cols-2";
                  return (
                    <div key={rIdx} className={`grid ${gridCols} gap-1`}>
                      {row.map((btn, bIdx) => {
                        if (btn.url) {
                          return (
                            <a
                              key={bIdx}
                              href={btn.url}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2.5 py-2 bg-slate-800/90 hover:bg-slate-700 border border-slate-700/80 text-slate-100 rounded-lg text-[11px] font-medium text-center transition-colors flex items-center justify-center gap-1 truncate"
                            >
                              <span className="truncate">{btn.text}</span>
                              <ExternalLink className="w-3 h-3 text-slate-400 shrink-0" />
                            </a>
                          );
                        }
                        return (
                          <button
                            key={bIdx}
                            onClick={() =>
                              btn.callbackData && handleCallbackClick(btn.callbackData)
                            }
                            className="px-2.5 py-2 bg-slate-800/90 hover:bg-slate-700 active:scale-[0.99] border border-slate-700/80 text-slate-100 rounded-lg text-[11px] font-medium text-center transition-all truncate cursor-pointer"
                          >
                            {btn.text}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Chat Input Form */}
      <form
        onSubmit={handleSendMessage}
        className="p-3 border-t border-slate-800 bg-slate-900 flex items-center gap-2"
      >
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder={
            currentUser.step === "IDLE"
              ? "Type /start, /admin, or click 🌐 All GC..."
              : `Awaiting input for ${currentUser.step}...`
          }
          className="flex-1 bg-slate-950 border border-slate-800 focus:border-sky-400 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          className="px-3.5 py-2 bg-sky-400 hover:bg-sky-300 text-slate-950 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          Send
        </button>
      </form>
    </div>
  );
}
