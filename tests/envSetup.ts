import { config as loadDotenv } from "dotenv";

// Tests exercise business behavior, not per-IP rate-limit counters. Set this
// before dotenv so a developer .env cannot override it.
process.env.NODE_ENV = "test";

// Test config precedence: the developer's .env fills real credentials where
// present; dummies keep optional services from blocking the offline suite.
loadDotenv();

process.env.PORT = process.env.PORT ?? "0";
process.env.DB_URL = process.env.DB_URL ?? "mongodb://dummy:dummy@127.0.0.1:1/test-db";
process.env.BCRYPT_SALT_ROUND = process.env.BCRYPT_SALT_ROUND ?? "10";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret";
process.env.JWT_ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES ?? "1h";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret";
process.env.JWT_REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES ?? "1d";
process.env.SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? "superadmin@example.com";
process.env.SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? "Super#Password1";
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "google-client-id";
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "google-client-secret";
process.env.GOOGLE_CALLBACK_URL =
  process.env.GOOGLE_CALLBACK_URL ?? "http://localhost/api/v1/auth/google/callback";
process.env.EXPRESS_SESSION_SECRET =
  process.env.EXPRESS_SESSION_SECRET ?? "express-session-test-secret";
process.env.FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
process.env.ORS_API_KEY = process.env.ORS_API_KEY ?? "";
process.env.SMTP_HOST = process.env.SMTP_HOST ?? "127.0.0.1";
process.env.SMTP_PORT = process.env.SMTP_PORT ?? "587";
process.env.SMTP_USER = process.env.SMTP_USER ?? "smtp-user";
process.env.SMTP_PASS = process.env.SMTP_PASS ?? "smtp-pass";
process.env.SMTP_FROM = process.env.SMTP_FROM ?? "noreply@example.com";
process.env.REDIS_HOST = process.env.REDIS_HOST ?? "127.0.0.1";
process.env.REDIS_PORT = process.env.REDIS_PORT ?? "6379";
process.env.REDIS_USERNAME = process.env.REDIS_USERNAME ?? "default";
process.env.REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? "redis-password";
