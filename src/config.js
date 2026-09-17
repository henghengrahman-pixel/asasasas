export function bool(v, fallback=false) {
  if (v == null || v === '') return fallback;
  return ['1','true','yes','on'].includes(String(v).toLowerCase());
}
export function int(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
export const config = {
  port: int(process.env.PORT, 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: bool(process.env.DATABASE_SSL, false),
  // Shared AI brain database. Keep runtime DATABASE_URL separate per LC instance
  // so Telegram reports, chat state, sessions and logs never mix between LC 2/LC 4.
  brainDatabaseUrl: process.env.BRAIN_DATABASE_URL || process.env.DATABASE_URL || '',
  brainDatabaseSsl: bool(process.env.BRAIN_DATABASE_SSL, bool(process.env.DATABASE_SSL, false)),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  sessionSecret: process.env.SESSION_SECRET || '',

  lcAccountId: process.env.LIVECHAT_ACCOUNT_ID || '',
  lcPat: process.env.LIVECHAT_PAT || '',
  lcApiBase: (process.env.LIVECHAT_API_BASE || 'https://api.livechatinc.com/v3.5/agent/action').replace(/\/$/, ''),
  lcSyncMode: process.env.LIVECHAT_SYNC_MODE || 'polling',
  // Near real-time polling; production floor is 1 second.
  lcPollMs: Math.max(1000, int(process.env.LIVECHAT_POLL_MS, 1000)),
  lcListLimit: Math.min(100, Math.max(1, int(process.env.LIVECHAT_LIST_LIMIT, 100))),
  lcInboxMode: process.env.LIVECHAT_INBOX_MODE || 'my_active',
  lcWebhookSecret: process.env.LIVECHAT_WEBHOOK_SECRET || '',
  lcCannedApiBase: (process.env.LIVECHAT_CANNED_API_BASE || 'https://api.livechatinc.com/v3.5/configuration/action').replace(/\/$/, ''),
  lcCannedSyncEnabled: bool(process.env.LIVECHAT_CANNED_SYNC_ENABLED, false),
  lcCannedSyncMinutes: Math.max(5, int(process.env.LIVECHAT_CANNED_SYNC_MINUTES, 15)),
  bootstrapReplyMaxAgeSeconds: Math.max(0, int(process.env.LIVECHAT_BOOTSTRAP_REPLY_MAX_AGE_SECONDS, 30)),
  memberDebounceMs: Math.min(6000, Math.max(0, int(process.env.MEMBER_DEBOUNCE_MS, 2200))),

  learningEnabled: bool(process.env.LEARNING_ENABLED, true),
  learningBatchSize: Math.min(500, Math.max(25, int(process.env.LEARNING_BATCH_SIZE, 200))),
  learningCatchupDelayMs: Math.max(2000, int(process.env.LEARNING_CATCHUP_DELAY_MS, 5000)),
  learningActiveDelayMs: Math.max(10000, int(process.env.LEARNING_ACTIVE_DELAY_MS, 30000)),
  learningIdleDelayMs: Math.max(30000, int(process.env.LEARNING_IDLE_DELAY_MS, 60000)),
  learningErrorDelayMs: Math.max(10000, int(process.env.LEARNING_ERROR_DELAY_MS, 30000)),
  learningMaxRuntimeMs: Math.min(60000, Math.max(5000, int(process.env.LEARNING_MAX_RUNTIME_MS, 15000))),
  learningLogHeartbeatMs: Math.max(300000, int(process.env.LEARNING_LOG_HEARTBEAT_MS, 900000)),

  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  openaiStyle: process.env.OPENAI_API_STYLE || 'responses',
  openaiMaxOutput: Math.max(64, int(process.env.OPENAI_MAX_OUTPUT_TOKENS, 220)),
  openaiTimeoutMs: Math.max(5000, int(process.env.OPENAI_TIMEOUT_MS, 12000)),
  openaiRetries: Math.min(5, Math.max(0, int(process.env.OPENAI_RETRIES, 2))),
  openaiRetryBaseMs: Math.max(100, int(process.env.OPENAI_RETRY_BASE_MS, 500)),

  aiMode: process.env.AI_MODE || 'safe_auto',
  aiConfidence: Number(process.env.AI_CONFIDENCE_THRESHOLD || 0.86),
  aiMaxContext: Math.min(50, Math.max(4, int(process.env.AI_MAX_CONTEXT_MESSAGES, 24))),
  autoReplyDefault: bool(process.env.AUTO_REPLY_ENABLED, true),
  humanTakeoverMinutes: Math.max(1, int(process.env.HUMAN_TAKEOVER_MINUTES, 30)),
  timezone: process.env.APP_TIMEZONE || 'Asia/Jakarta',
  greetingEnabled: bool(process.env.AI_GREETING_ENABLED, true),
  greetingCooldownHours: Math.max(1, int(process.env.AI_GREETING_COOLDOWN_HOURS, 8)),
  greetingTriggerMaxAgeSeconds: Math.max(5, int(process.env.AI_GREETING_TRIGGER_MAX_AGE_SECONDS, 120)),
  greetingTriggerPatterns: String(process.env.AI_GREETING_TRIGGER_PATTERNS || 'Lebih Mudah Menghubungi Kami Via Telegram & Whatsapp Hanya Dengan Klik Link').split('||').map(s=>s.trim()).filter(Boolean),
  humanAskEnabled: bool(process.env.AI_HUMAN_ASK_ENABLED, true),
  takeoverOnEnable: false,
  defaultSiteName: process.env.DEFAULT_SITE_NAME || '',
  defaultSiteLoginUrl: process.env.DEFAULT_SITE_LOGIN_URL || '',
  defaultSiteRegisterUrl: process.env.DEFAULT_SITE_REGISTER_URL || '',
  defaultSiteRtpUrl: process.env.DEFAULT_SITE_RTP_URL || '',

  // Optional Railway ENV bootstrap for Telegram Human Bridge. Panel settings still work;
  // ENV values only override when explicitly provided.
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramEnabled: bool(process.env.TELEGRAM_BRIDGE_ENABLED, false),
  telegramDefaultChatId: process.env.TELEGRAM_DEFAULT_CHAT_ID || '',
  telegramFailoverChatId: process.env.TELEGRAM_FAILOVER_CHAT_ID || '',
  telegramFailoverTopicId: process.env.TELEGRAM_FAILOVER_TOPIC_ID || '',
  // Telegram operator access defaults to ALL group members. Existing TELEGRAM_ALLOWED_USER_IDS
  // values are ignored unless TELEGRAM_OPERATOR_ACCESS_MODE=whitelist is explicitly enabled.
  telegramOperatorAccessMode: String(process.env.TELEGRAM_OPERATOR_ACCESS_MODE || 'all').trim().toLowerCase(),
  telegramAllowedUserIds: String(process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map(x=>x.trim()).filter(Boolean),
  bridgeMaxRetries: Math.min(8, Math.max(1, int(process.env.TELEGRAM_BRIDGE_MAX_RETRIES, 4))),
  bridgeRetryBaseMs: Math.max(250, int(process.env.TELEGRAM_BRIDGE_RETRY_BASE_MS, 750)),
  bridgeSlaMinutes: Math.max(1, int(process.env.TELEGRAM_BRIDGE_SLA_MINUTES, 5)),
  telegramRoutes: {
    RESET_PASSWORD: { chatId: process.env.TELEGRAM_RESET_CHAT_ID || '', topicId: process.env.TELEGRAM_RESET_TOPIC_ID || '' },
    WD_PROBLEM: { chatId: process.env.TELEGRAM_WD_CHAT_ID || '', topicId: process.env.TELEGRAM_WD_TOPIC_ID || '' },
    DEPOSIT_PROBLEM: { chatId: process.env.TELEGRAM_DEPOSIT_CHAT_ID || '', topicId: process.env.TELEGRAM_DEPOSIT_TOPIC_ID || '' },
    BONUS: { chatId: process.env.TELEGRAM_BONUS_CHAT_ID || '', topicId: process.env.TELEGRAM_BONUS_TOPIC_ID || '' },
    ISSUE: { chatId: process.env.TELEGRAM_ISSUE_CHAT_ID || '', topicId: process.env.TELEGRAM_ISSUE_TOPIC_ID || '' }
  }
};

export function validateConfig() {
  const warnings = [];
  if (!config.databaseUrl) warnings.push('DATABASE_URL belum diisi');
  if (!config.brainDatabaseUrl) warnings.push('BRAIN_DATABASE_URL belum diisi (fallback ke DATABASE_URL tidak tersedia)');
  if (!config.adminPasswordHash && !config.adminPassword) warnings.push('ADMIN_PASSWORD_HASH belum diisi');
  if (!config.adminPasswordHash && config.adminPassword) warnings.push('Security: gunakan ADMIN_PASSWORD_HASH (scrypt) untuk production');
  if (config.sessionSecret.length < 32) warnings.push('SESSION_SECRET sebaiknya minimal 32 karakter');
  if (!config.lcAccountId || !config.lcPat) warnings.push('LIVECHAT_ACCOUNT_ID/LIVECHAT_PAT belum lengkap');
  if (!config.openaiKey) warnings.push('OPENAI_API_KEY belum diisi');
  if (config.telegramEnabled && !config.telegramBotToken) warnings.push('TELEGRAM_BRIDGE_ENABLED aktif tetapi TELEGRAM_BOT_TOKEN belum diisi');
  if (config.telegramEnabled && !config.telegramDefaultChatId && !Object.values(config.telegramRoutes).some(r=>String(r?.chatId||'').trim())) warnings.push('Telegram aktif tetapi TELEGRAM_DEFAULT_CHAT_ID/route chat belum diisi');
  if (!['my_active','all'].includes(config.lcInboxMode)) warnings.push('LIVECHAT_INBOX_MODE harus my_active atau all');
  return warnings;
}

export function assertBootConfig() {
  if (!config.databaseUrl) throw new Error('CONFIG_ERROR: DATABASE_URL tidak tersedia. Hubungkan service PostgreSQL Railway ke aplikasi.');
  if (!config.brainDatabaseUrl) throw new Error('CONFIG_ERROR: BRAIN_DATABASE_URL tidak tersedia.');
  if (!config.adminPasswordHash && !config.adminPassword) throw new Error('CONFIG_ERROR: ADMIN_PASSWORD_HASH wajib diisi (ADMIN_PASSWORD hanya fallback legacy).');
  if (config.sessionSecret.length < 32) throw new Error('CONFIG_ERROR: SESSION_SECRET minimal 32 karakter.');
}
