import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://chatbot:chatbot_secret@localhost:5432/chatbot',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwt: {
    secret: process.env.JWT_SECRET ?? 'change-me-in-production-min-32-chars!!',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  },
  azure: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? '',
    apiKey: process.env.AZURE_OPENAI_API_KEY ?? '',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4',
  },
  defaultModel: process.env.DEFAULT_MODEL ?? 'gpt-4-turbo-preview',
  defaultProvider: process.env.DEFAULT_PROVIDER ?? 'openai',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
  },
  // ─── Platform Integration credentials ────────────────────────────────────
  discord: {
    publicKey:     process.env.DISCORD_PUBLIC_KEY ?? '',
    applicationId: process.env.DISCORD_APPLICATION_ID ?? '',
    botToken:      process.env.DISCORD_BOT_TOKEN ?? '',
    tenantId:      process.env.DISCORD_TENANT_ID ?? '',
  },
  slack: {
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    botToken:      process.env.SLACK_BOT_TOKEN ?? '',
    tenantId:      process.env.SLACK_TENANT_ID ?? '',
  },
  telegram: {
    botToken:  process.env.TELEGRAM_BOT_TOKEN ?? '',
    tenantId:  process.env.TELEGRAM_TENANT_ID ?? '',
  },
  teams: {
    appId:       process.env.TEAMS_APP_ID ?? '',
    appPassword: process.env.TEAMS_APP_PASSWORD ?? '',
    tenantId:    process.env.TEAMS_TENANT_ID ?? '',
  },
  whatsapp: {
    verifyToken:   process.env.WHATSAPP_VERIFY_TOKEN ?? '',
    accessToken:   process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    tenantId:      process.env.WHATSAPP_TENANT_ID ?? '',
  },
};
