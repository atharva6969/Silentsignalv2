import express, { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import twilio from "twilio";
import nodemailer from "nodemailer";
import bcrypt from "bcrypt";
import cors from "cors";
import jwt from "jsonwebtoken";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import "dotenv/config";
import { seedUserNotes } from "./server/notes.ts";
import { evaluateAiSignals, generateIncidentReport } from "./server/ai.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, "data");
const uploadDir = path.join(__dirname, "uploads", "evidence");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });
const db = new Database(process.env.DATABASE_PATH || path.join(dataDir, "silent_signal.db"));

// ─── Validation Utilities ─────────────────────────────────────────────────
function validateUsername(username: string): boolean {
  return typeof username === "string" && username.length >= 3 && username.length <= 50;
}

function validatePassword(password: string): boolean {
  return typeof password === "string" && /^\d{4}$/.test(password);
}

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (() => {
    const key = crypto.randomBytes(32).toString("hex");
    console.warn("⚠️  JWT_SECRET not set — generated ephemeral secret (tokens invalid after restart)");
    return key;
  })();

const JWT_EXPIRY = (process.env.JWT_EXPIRY || "7d") as jwt.SignOptions["expiresIn"];
const EVIDENCE_TTL_HOURS = Number(process.env.EVIDENCE_TTL_HOURS) || 168;

function signToken(userId: number, username: string): string {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function evidenceExpiresAt(): string {
  const d = new Date();
  d.setHours(d.getHours() + EVIDENCE_TTL_HOURS);
  return d.toISOString();
}

function isEvidenceExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

function validatePhone(phone: string): boolean {
  return typeof phone === "string" && phone.length >= 10 && /^[\d+\-() ]+$/.test(phone);
}

function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return typeof email === "string" && emailRegex.test(email);
}

// ─── AES-256-GCM Location Encryption ──────────────────────────────────────
// CRITICAL: Load from environment or generate warning (never auto-generate in production)
let ENCRYPTION_KEY: Buffer;
try {
  if (process.env.ENCRYPTION_KEY) {
    ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  } else {
    ENCRYPTION_KEY = crypto.randomBytes(32);
    console.warn("⚠️  WARNING: ENCRYPTION_KEY not set in environment. Generated a random key.");
    console.warn("⚠️  Set ENCRYPTION_KEY=<64-char hex string> to persist encryption across restarts.");
  }
} catch (e) {
  console.error("❌ Failed to initialize ENCRYPTION_KEY:", e);
  process.exit(1);
}

function encryptCoords(lat: number, lng: number): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const payload = JSON.stringify({ lat, lng });
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptCoords(blob: string): { lat: number; lng: number } | null {
  try {
    const buf = Buffer.from(blob, "base64");
    const iv = buf.slice(0, 12);
    const authTag = buf.slice(12, 28);
    const encrypted = buf.slice(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}

// ─── Multi-Channel Alert Dispatcher ───────────────────────────────────────
function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || sid === "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx") return null;
  return twilio(sid, token);
}

function getMailTransporter() {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!user || !pass) return null;

  const port = Number(process.env.SMTP_PORT) || 587;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { minVersion: "TLSv1.2" },
  });
}

function formatTriggerMethod(method: string): string {
  const labels: Record<string, string> = {
    DURESS_PIN: "Duress PIN login (silent emergency mode)",
    GESTURE: "Secret gesture detected",
    SHAKE: "Device shake detected",
    SAFE_WORD: "Safe word spoken",
    AI_SUGGESTED: "AI-assisted confirmation (user confirmed)",
    POWER_BUTTON_5X: "Power button pressed 5 times",
    PANIC_TIMER: "Panic timer expired without dismissal",
    MANUAL: "Manual SOS activation",
    INTERVAL: "Live location update",
    BATCH: "Queued location sync",
  };
  return labels[method] || method.replace(/_/g, " ");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildAlertContent(
  username: string,
  lat: number,
  lng: number,
  triggerMethod: string,
  evidenceUrl: string,
  panicMessage?: string
) {
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const timestamp = new Date().toLocaleString("en-IN", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: "Asia/Kolkata",
  });
  const triggerLabel = formatTriggerMethod(triggerMethod);
  const safeUser = escapeHtml(username);
  const safeTrigger = escapeHtml(triggerLabel);
  const safePanic = panicMessage ? escapeHtml(panicMessage) : "";

  const smsBody =
    `🚨 EMERGENCY ALERT — SILENT SIGNAL\n\n` +
    `${username} may be in danger and needs immediate help.\n\n` +
    `👤 Person: ${username}\n` +
    `⚠️ Trigger: ${triggerLabel}\n` +
    `🕐 Time: ${timestamp}\n` +
    `📍 Location: ${lat.toFixed(6)}, ${lng.toFixed(6)}\n` +
    `🗺️ Open in Maps: ${mapsUrl}\n` +
    `🎙️ Listen to audio evidence: ${evidenceUrl}\n` +
    (panicMessage ? `\nMessage: ${panicMessage}\n` : "") +
    `\nThis is an automated emergency alert. Please respond immediately.`;

  const emailSubject = `🚨 EMERGENCY — ${username} needs help NOW`;

  const emailText = smsBody;

  const emailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:3px solid #dc2626;border-radius:12px;overflow:hidden;">
      <div style="background:#dc2626;color:#fff;padding:20px 24px;">
        <h1 style="margin:0;font-size:22px;">🚨 EMERGENCY ALERT</h1>
        <p style="margin:8px 0 0;opacity:0.95;font-size:15px;">Silent Signal — Someone needs immediate help</p>
      </div>
      <div style="padding:24px;">
        <p style="font-size:18px;color:#111;margin:0 0 20px;">
          <strong>${safeUser}</strong> has triggered a silent emergency alert and may be in danger.
        </p>
        ${safePanic ? `<p style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;color:#991b1b;margin:0 0 20px;">${safePanic}</p>` : ""}
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:15px;">
          <tr style="background:#f9fafb;">
            <td style="padding:12px;font-weight:bold;color:#555;width:130px;">Person</td>
            <td style="padding:12px;color:#111;font-weight:bold;">${safeUser}</td>
          </tr>
          <tr>
            <td style="padding:12px;font-weight:bold;color:#555;">Triggered via</td>
            <td style="padding:12px;color:#111;">${safeTrigger}</td>
          </tr>
          <tr style="background:#f9fafb;">
            <td style="padding:12px;font-weight:bold;color:#555;">Time</td>
            <td style="padding:12px;color:#111;">${escapeHtml(timestamp)}</td>
          </tr>
          <tr>
            <td style="padding:12px;font-weight:bold;color:#555;">GPS Location</td>
            <td style="padding:12px;font-family:monospace;color:#111;">${lat.toFixed(6)}, ${lng.toFixed(6)}</td>
          </tr>
        </table>
        <a href="${mapsUrl}" style="display:block;text-align:center;background:#dc2626;color:#fff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:bold;font-size:16px;margin-bottom:12px;">
          📍 View Live Location on Google Maps
        </a>
        <a href="${evidenceUrl}" style="display:block;text-align:center;background:#111;color:#fff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:bold;font-size:16px;margin-bottom:20px;">
          🎙️ Listen to Recorded Audio Evidence
        </a>
        <p style="color:#666;font-size:13px;line-height:1.5;margin:0;">
          Audio recording starts automatically during an SOS. If no audio appears yet, refresh the evidence page in 10–30 seconds.
          Please call emergency services or reach out to ${safeUser} immediately.
        </p>
      </div>
      <div style="background:#f9fafb;padding:12px 24px;text-align:center;color:#888;font-size:11px;">
        Sent automatically by Silent Signal
      </div>
    </div>`;

  return { smsBody, emailSubject, emailText, emailHtml };
}

function getActiveShareSession(userId: number): { share_token: string; share_expires_at: string | null } | null {
  const row = db
    .prepare(
      `SELECT share_token, share_expires_at FROM sos_logs
       WHERE user_id = ? AND share_token IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(userId) as { share_token: string; share_expires_at: string | null } | undefined;
  if (!row) return null;
  if (isEvidenceExpired(row.share_expires_at)) return null;
  return row;
}

function getActiveShareToken(userId: number): string | null {
  return getActiveShareSession(userId)?.share_token ?? null;
}

async function dispatchAlerts(
  contacts: any[],
  lat: number,
  lng: number,
  username: string,
  triggerMethod: string,
  evidenceUrl: string,
  panicMessage?: string
) {
  const { smsBody, emailSubject, emailText, emailHtml } = buildAlertContent(
    username,
    lat,
    lng,
    triggerMethod,
    evidenceUrl,
    panicMessage
  );

  const twilioClient = getTwilioClient();
  const mailer = getMailTransporter();
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const results: string[] = [];

  // Log alert configuration on SOS trigger
  if (!twilioClient) {
    console.warn("[⚠️  SMS] Twilio not configured - SMS alerts disabled");
  }
  if (!resendApiKey && !mailer) {
    console.warn("[⚠️  EMAIL] Email delivery not configured (neither Resend API nor SMTP) - Email alerts disabled");
  }

  for (const contact of contacts) {
    // ─── SMS Alert ─────────────────────────────────────────────────────────
    if (contact.phone) {
      if (!twilioClient) {
        console.log(`[SMS SKIP] No Twilio config for ${contact.name}`);
        results.push(`SMS SKIP → ${contact.name} (no Twilio config)`);
      } else {
        try {
          await twilioClient.messages.create({
            body: smsBody,
            from: process.env.TWILIO_PHONE_NUMBER!,
            to: contact.phone,
          });
          results.push(`SMS ✓ → ${contact.name} (${contact.phone})`);
          console.log(`[SMS ✓] Sent to ${contact.name} (${contact.phone})`);
        } catch (err: any) {
          results.push(`SMS ✗ → ${contact.name}: ${err.message}`);
          console.error(`[SMS ✗] Failed to send to ${contact.name} (${contact.phone}): ${err.message}`);
        }
      }
    } else {
      console.log(`[SMS SKIP] No phone number for ${contact.name}`);
      results.push(`SMS SKIP → ${contact.name} (no phone)`);
    }

    // ─── Email Alert ────────────────────────────────────────────────────────
    if (contact.email) {
      if (resendApiKey) {
        try {
          console.log(`[EMAIL ATTEMPT] Sending TO: ${contact.email} via Resend HTTP API`);
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: process.env.SMTP_FROM || "onboarding@resend.dev",
              to: contact.email,
              subject: emailSubject,
              text: emailText,
              html: emailHtml,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP ${response.status}`);
          }

          results.push(`EMAIL ✓ → ${contact.name} (${contact.email})`);
          console.log(`[EMAIL ✓] Successfully sent via Resend to ${contact.name} (${contact.email})`);
        } catch (err: any) {
          results.push(`EMAIL ✗ → ${contact.name}: ${err.message}`);
          console.error(`[EMAIL ✗] Failed to send via Resend to ${contact.name} (${contact.email}): ${err.message}`);
        }
      } else if (mailer) {
        try {
          console.log(`[EMAIL ATTEMPT] Sending TO: ${contact.email} FROM: ${process.env.SMTP_FROM || process.env.SMTP_USER}`);
          await mailer.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: contact.email,
            subject: emailSubject,
            text: emailText,
            html: emailHtml,
          });
          results.push(`EMAIL ✓ → ${contact.name} (${contact.email})`);
          console.log(`[EMAIL ✓] Successfully sent to ${contact.name} (${contact.email})`);
        } catch (err: any) {
          results.push(`EMAIL ✗ → ${contact.name}: ${err.message}`);
          console.error(`[EMAIL ✗] Failed to send to ${contact.name} (${contact.email}): ${err.message}`);
        }
      } else {
        console.log(`[EMAIL SKIP] No email configuration for ${contact.name}`);
        results.push(`EMAIL SKIP → ${contact.name} (no email config)`);
      }
    } else {
      console.log(`[EMAIL SKIP] No email address for ${contact.name}`);
      results.push(`EMAIL SKIP → ${contact.name} (no email)`);
    }
  }

  return results;
}

// ─── DB Schema ────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    duress_pin TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    phone TEXT,
    email TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS sos_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    encrypted_coords TEXT,
    audio_url TEXT,
    status TEXT DEFAULT 'ACTIVE',
    trigger_method TEXT DEFAULT 'DURESS_PIN',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

try {
  db.exec(`ALTER TABLE sos_logs ADD COLUMN share_token TEXT`);
} catch {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE sos_logs ADD COLUMN share_expires_at TEXT`);
} catch {
  // Column already exists
}

// ─── Server ───────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Middleware — skip JSON parsing for audio uploads so express.raw() can handle them
  app.use((req, res, next) => {
    if (req.path === "/api/sos/audio") return next();
    express.json({ limit: "10mb" })(req, res, next);
  });
  app.use(cors({
    origin: process.env.CORS_ORIGIN || process.env.APP_URL || "*",
    credentials: true,
  }));
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many login attempts. Try again in a minute." },
  });


  const sosLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String((req as any).userId || ipKeyGenerator(req.ip || "")),
    message: { error: "SOS rate limit exceeded. Please wait before retrying." },
  });

  // ─── Authentication Middleware ──────────────────────────────────────────
  function authenticateToken(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (bearer) {
      try {
        const decoded = jwt.verify(bearer, JWT_SECRET) as { userId: number };
        const user = db.prepare("SELECT id FROM users WHERE id = ?").get(decoded.userId);
        if (!user) return res.status(403).json({ error: "Forbidden: User not found" });
        (req as any).userId = decoded.userId;
        return next();
      } catch {
        return res.status(401).json({ error: "Invalid or expired token" });
      }
    }

    return res.status(401).json({ error: "Unauthorized: Bearer token required" });
  }

  // ─── Registration Endpoint ──────────────────────────────────────────────
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { username, password, duressPin } = req.body;

      // Validation
      if (!validateUsername(username)) {
        return res.status(400).json({ error: "Username must be 3-50 characters" });
      }
      if (!validatePassword(password)) {
        return res.status(400).json({ error: "Password must be exactly 4 digits" });
      }
      if (!validatePassword(duressPin)) {
        return res.status(400).json({ error: "Duress PIN must be exactly 4 digits" });
      }

      // Hash passwords
      const hashedPassword = await bcrypt.hash(password, 10);
      const hashedDuressPin = await bcrypt.hash(duressPin, 10);

      const info = db.prepare(
        "INSERT INTO users (username, password, duress_pin) VALUES (?, ?, ?)"
      ).run(username, hashedPassword, hashedDuressPin);

      const userId = Number(info.lastInsertRowid);
      await seedUserNotes(db, userId, username);

      const token = signToken(userId, username);
      console.log(`[✓ REGISTER] User ${username} registered successfully`);
      res.json({ id: userId, username, token });
    } catch (err: any) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "Username already exists" });
      }
      console.error("Registration error:", err);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // ─── Login Endpoint ─────────────────────────────────────────────────────
  app.post("/api/auth/login", loginLimiter, async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }

      const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Check normal password
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (passwordMatch) {
        console.log(`[✓ LOGIN] User ${username} logged in normally`);
        const token = signToken(user.id, user.username);
        return res.json({ id: user.id, username: user.username, mode: "NORMAL", token });
      }

      // Check duress PIN
      const duressMatch = await bcrypt.compare(password, user.duress_pin);
      if (duressMatch) {
        console.log(`[🚨 DURESS] ${username} logged in with DURESS PIN — SOS ACTIVE`);
        const token = signToken(user.id, user.username);
        return res.json({ id: user.id, username: user.username, mode: "DURESS", token });
      }

      res.status(401).json({ error: "Invalid credentials" });
    } catch (err: any) {
      console.error("Login error:", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // ─── Gesture Login (Covert activation from Login screen) ────────────────
  app.post("/api/auth/gesture-login", async (req: Request, res: Response) => {
    try {
      const { username } = req.body;
      let user;

      if (username) {
        user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
      }
      if (!user) {
        // Fallback: get the most recently registered user
        user = db.prepare("SELECT * FROM users ORDER BY id DESC LIMIT 1").get() as any;
      }
      if (!user) {
        return res.status(404).json({ error: "No user profiles found on this device" });
      }

      console.log(`[🚨 GESTURE LOGIN] Auto-logging in user ${user.username} under duress...`);
      const token = signToken(user.id, user.username);
      res.json({ id: user.id, username: user.username, mode: "DURESS", token });
    } catch (err: any) {
      console.error("Gesture login error:", err);
      res.status(500).json({ error: "Gesture login bypass failed" });
    }
  });

  // ─── Get Contacts ──────────────────────────────────────────────────────
  app.get("/api/contacts", authenticateToken, (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const contacts = db.prepare("SELECT * FROM contacts WHERE user_id = ?").all(userId);
      res.json(contacts);
    } catch (err: any) {
      console.error("Get contacts error:", err);
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  // ─── Add Contact ───────────────────────────────────────────────────────
  app.post("/api/contacts", authenticateToken, (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { name, phone, email } = req.body;

      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "Name is required" });
      }
      if (!phone || !validatePhone(phone)) {
        return res.status(400).json({ error: "Valid phone number is required" });
      }
      if (email && !validateEmail(email)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      const info = db.prepare(
        "INSERT INTO contacts (user_id, name, phone, email) VALUES (?, ?, ?, ?)"
      ).run(userId, name, phone, email || null);

      console.log(`[✓ CONTACT] Added contact: name=${name}, phone=${phone}, email=${email || "NOT PROVIDED"} for user ${userId}`);
      res.json({ id: info.lastInsertRowid });
    } catch (err: any) {
      console.error("Add contact error:", err);
      res.status(500).json({ error: "Failed to add contact" });
    }
  });

  // ─── Delete Contact ────────────────────────────────────────────────────
  app.delete("/api/contacts/:id", authenticateToken, (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const contactId = Number(req.params.id);

      if (isNaN(contactId)) {
        return res.status(400).json({ error: "Invalid contact ID" });
      }

      // Verify ownership
      const contact = db.prepare("SELECT user_id FROM contacts WHERE id = ?").get(contactId) as any;
      if (!contact) {
        return res.status(404).json({ error: "Contact not found" });
      }
      if (contact.user_id !== userId) {
        return res.status(403).json({ error: "Forbidden: Cannot delete other user's contacts" });
      }

      db.prepare("DELETE FROM contacts WHERE id = ?").run(contactId);
      console.log(`[✓ DELETE] Deleted contact ${contactId} for user ${userId}`);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete contact error:", err);
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  // ─── SOS Trigger Endpoint ──────────────────────────────────────────────
  app.post("/api/sos/trigger", authenticateToken, sosLimiter, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { latitude, longitude, triggerMethod, panicMessage } = req.body;

      // Validate coordinates
      if (typeof latitude !== "number" || typeof longitude !== "number") {
        return res.status(400).json({ error: "Valid latitude and longitude required" });
      }
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return res.status(400).json({ error: "Invalid coordinates" });
      }

      const encryptedCoords = encryptCoords(latitude, longitude);
      const method = triggerMethod || "MANUAL";
      const isNewSession = method !== "INTERVAL" && method !== "BATCH";
      const existingSession = getActiveShareSession(userId);
      const shareToken = isNewSession
        ? crypto.randomBytes(24).toString("hex")
        : existingSession?.share_token || crypto.randomBytes(24).toString("hex");
      const shareExpiresAt = isNewSession
        ? evidenceExpiresAt()
        : existingSession?.share_expires_at || evidenceExpiresAt();

      const info = db
        .prepare(
          `INSERT INTO sos_logs (user_id, encrypted_coords, status, trigger_method, share_token, share_expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(userId, encryptedCoords, "ACTIVE", method, shareToken, shareExpiresAt);

      const contacts = db.prepare("SELECT * FROM contacts WHERE user_id = ?").all(userId) as any[];
      const user = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as any;
      const username = user?.username || `User_${userId}`;
      const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
      const evidenceUrl = `${appUrl}/evidence/${shareToken}`;

      console.log(
        `[🚨 SOS] ${username} | method=${method} | ${contacts.length} contacts | coords=${latitude.toFixed(6)},${longitude.toFixed(6)}`
      );
      
      // Log each contact's details
      contacts.forEach((c, idx) => {
        console.log(`  Contact ${idx + 1}: name=${c.name}, phone=${c.phone}, email=${c.email}`);
      });

      // Only alert trusted contacts on initial SOS — not on 30s location pings
      if (isNewSession) {
        dispatchAlerts(
          contacts,
          latitude,
          longitude,
          username,
          method,
          evidenceUrl,
          panicMessage
        )
          .then((results) => {
            console.log(`[✓ ALERTS DISPATCHED] ${results.length} attempts`);
            results.forEach((r) => console.log(`  ${r}`));
          })
          .catch((err: any) => {
            console.error(`[❌ ALERT DISPATCH ERROR]`, err.message || err);
          });
      }

      res.json({ success: true, logId: info.lastInsertRowid });
    } catch (err: any) {
      console.error("SOS trigger error:", err);
      res.status(500).json({ error: "Failed to trigger SOS" });
    }
  });

  // ─── Batch SOS (offline queue flush) ───────────────────────────────────
  app.post("/api/sos/trigger-batch", authenticateToken, sosLimiter, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { pings } = req.body as {
        pings: { latitude: number; longitude: number; triggerMethod?: string; timestamp?: number }[];
      };

      if (!Array.isArray(pings) || pings.length === 0) {
        return res.status(400).json({ error: "pings array required" });
      }
      if (pings.length > 20) {
        return res.status(400).json({ error: "Maximum 20 pings per batch" });
      }

      const existingSession = getActiveShareSession(userId);
      const shareToken = existingSession?.share_token || crypto.randomBytes(24).toString("hex");
      const shareExpiresAt = existingSession?.share_expires_at || evidenceExpiresAt();

      const insert = db.prepare(
        `INSERT INTO sos_logs (user_id, encrypted_coords, status, trigger_method, share_token, share_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

      for (const ping of pings) {
        if (
          typeof ping.latitude !== "number" ||
          typeof ping.longitude !== "number" ||
          ping.latitude < -90 ||
          ping.latitude > 90 ||
          ping.longitude < -180 ||
          ping.longitude > 180
        ) {
          continue;
        }
        insert.run(
          userId,
          encryptCoords(ping.latitude, ping.longitude),
          "ACTIVE",
          ping.triggerMethod || "BATCH",
          shareToken,
          shareExpiresAt
        );
      }

      res.json({ success: true, processed: pings.length });
    } catch (err: any) {
      console.error("Batch SOS error:", err);
      res.status(500).json({ error: "Failed to process batch" });
    }
  });

  // ─── Get Notes ─────────────────────────────────────────────────────────
  app.get("/api/notes", authenticateToken, (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const notes = db.prepare("SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC").all(userId);
      res.json(notes);
    } catch (err: any) {
      console.error("Get notes error:", err);
      res.status(500).json({ error: "Failed to fetch notes" });
    }
  });

  // ─── Add Note ──────────────────────────────────────────────────────────
  app.post("/api/notes", authenticateToken, (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { title, content } = req.body;

      if (!title || typeof title !== "string" || title.trim().length === 0) {
        return res.status(400).json({ error: "Title is required" });
      }
      if (!content || typeof content !== "string" || content.trim().length === 0) {
        return res.status(400).json({ error: "Content is required" });
      }

      const info = db.prepare("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)").run(userId, title, content);
      console.log(`[✓ NOTE] Added note for user ${userId}`);
      res.json({ id: info.lastInsertRowid });
    } catch (err: any) {
      console.error("Add note error:", err);
      res.status(500).json({ error: "Failed to save note" });
    }
  });

  // ─── Delete Note ───────────────────────────────────────────────────────
  app.delete("/api/notes/:id", authenticateToken, (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const noteId = Number(req.params.id);

      if (isNaN(noteId)) {
        return res.status(400).json({ error: "Invalid note ID" });
      }

      // Verify ownership
      const note = db.prepare("SELECT user_id FROM notes WHERE id = ?").get(noteId) as any;
      if (!note) {
        return res.status(404).json({ error: "Note not found" });
      }
      if (note.user_id !== userId) {
        return res.status(403).json({ error: "Forbidden: Cannot delete other user's notes" });
      }

      db.prepare("DELETE FROM notes WHERE id = ?").run(noteId);
      console.log(`[✓ DELETE] Deleted note ${noteId} for user ${userId}`);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete note error:", err);
      res.status(500).json({ error: "Failed to delete note" });
    }
  });

  // ─── Audio Upload ──────────────────────────────────────────────────────
  app.post(
    "/api/sos/audio",
    authenticateToken,
    express.raw({ type: ["audio/webm", "audio/*", "application/octet-stream"], limit: "15mb" }),
    (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const bodyBuf = req.body as Buffer;
        console.log(`[AUDIO] Received upload for user ${userId}, content-type=${req.headers["content-type"]}, size=${bodyBuf?.length ?? 0} bytes`);

        if (!bodyBuf || bodyBuf.length === 0) {
          console.warn(`[AUDIO] Empty body received for user ${userId}`);
          return res.status(400).json({ error: "Empty audio body" });
        }

        const session = getActiveShareSession(userId);
        const shareToken = session?.share_token ?? null;
        const shareExpiresAt = session?.share_expires_at ?? null;
        const filename = `${userId}-${Date.now()}-${crypto.randomUUID()}.webm`;
        const absolutePath = path.join(uploadDir, filename);
        fs.writeFileSync(absolutePath, bodyBuf);
        const audioUrl = `/uploads/evidence/${filename}`;

        db.prepare(
          `INSERT INTO sos_logs (user_id, audio_url, status, trigger_method, share_token, share_expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(userId, audioUrl, "AUDIO_CHUNK", "RECORDING", shareToken, shareExpiresAt);

        console.log(`[AUDIO ✓] Saved ${filename} (${bodyBuf.length} bytes) for user ${userId}`);
        res.json({ success: true, url: audioUrl });
      } catch (err: any) {
        console.error("Audio upload error:", err);
        res.status(500).json({ error: "Failed to save audio" });
      }
    }
  );

  // ─── Get SOS Logs ──────────────────────────────────────────────────────
  app.get("/api/sos/logs", authenticateToken, (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      console.log(`[Fetching SOS logs for user ${userId}]`);
      
      const logs = db
        .prepare(
          `SELECT id, user_id, encrypted_coords, audio_url, status, trigger_method, share_token, share_expires_at,
           strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at
           FROM sos_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
        )
        .all(userId) as any[];

      console.log(`[Found ${logs.length} SOS logs for user ${userId}]`);

      const decryptedLogs = logs.map((log) => {
        if (log.encrypted_coords) {
          const coords = decryptCoords(log.encrypted_coords);
          if (!coords) {
            console.warn(`[⚠️  Decryption failed for log ${log.id}]`);
          }
          return {
            ...log,
            latitude: coords?.lat ?? null,
            longitude: coords?.lng ?? null,
            encrypted_coords: undefined,
          };
        }
        return log;
      });

      res.json(decryptedLogs);
    } catch (err: any) {
      console.error("Get logs error:", err);
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });

  // ─── Public Evidence API (for trusted contacts via email link) ─────────
  app.get("/api/sos/evidence/:token", (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const sessionRow = db
        .prepare(
          `SELECT l.user_id, l.share_token, l.share_expires_at, u.username
           FROM sos_logs l
           JOIN users u ON u.id = l.user_id
           WHERE l.share_token = ?
           ORDER BY l.created_at DESC LIMIT 1`
        )
        .get(token) as {
          user_id: number;
          share_token: string;
          share_expires_at: string | null;
          username: string;
        } | undefined;

      if (!sessionRow) {
        return res.status(404).json({ error: "Evidence not found or link expired" });
      }

      if (isEvidenceExpired(sessionRow.share_expires_at)) {
        return res.status(410).json({ error: "Evidence link has expired" });
      }

      const logs = db
        .prepare(
          `SELECT encrypted_coords, audio_url, status, trigger_method,
           strftime('%Y-%m-%dT%H:%M:%SZ', created_at) as created_at
           FROM sos_logs WHERE share_token = ? ORDER BY created_at ASC`
        )
        .all(token) as any[];

      const locations: { latitude: number; longitude: number; time: string; triggerMethod: string }[] = [];
      const audioChunks: { url: string; time: string }[] = [];
      let primaryTrigger = "DURESS_PIN";

      for (const log of logs) {
        if (log.encrypted_coords) {
          const coords = decryptCoords(log.encrypted_coords);
          if (coords) {
            locations.push({
              latitude: coords.lat,
              longitude: coords.lng,
              time: log.created_at,
              triggerMethod: log.trigger_method,
            });
            if (log.trigger_method !== "INTERVAL") {
              primaryTrigger = log.trigger_method;
            }
          }
        }
        if (log.status === "AUDIO_CHUNK" && log.audio_url) {
          audioChunks.push({ url: log.audio_url, time: log.created_at });
        }
      }

      const latest = locations[locations.length - 1];

      res.json({
        username: sessionRow.username,
        triggerMethod: primaryTrigger,
        triggerLabel: formatTriggerMethod(primaryTrigger),
        latestLocation: latest ?? null,
        locations,
        audioChunks,
        mapsUrl: latest
          ? `https://maps.google.com/?q=${latest.latitude},${latest.longitude}`
          : null,
        expiresAt: sessionRow.share_expires_at,
      });
    } catch (err: any) {
      console.error("Evidence fetch error:", err);
      res.status(500).json({ error: "Failed to load evidence" });
    }
  });

  // ─── Public Evidence Page (linked from emergency emails) ───────────────
  app.get("/evidence/:token", (req: Request, res: Response) => {
    const { token } = req.params;
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Silent Signal — Emergency Evidence</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; background: #0f0f0f; color: #fff; margin: 0; padding: 20px; }
    .container { max-width: 640px; margin: 0 auto; }
    .alert-banner { background: #dc2626; padding: 20px; border-radius: 12px; margin-bottom: 20px; }
    .alert-banner h1 { margin: 0 0 8px; font-size: 22px; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .card h2 { margin: 0 0 12px; font-size: 16px; color: #f87171; text-transform: uppercase; letter-spacing: 1px; }
    .value { font-size: 18px; font-weight: bold; }
    .mono { font-family: monospace; font-size: 14px; color: #ccc; }
    .btn { display: block; text-align: center; background: #dc2626; color: #fff; text-decoration: none; padding: 14px; border-radius: 8px; font-weight: bold; margin-top: 12px; }
    audio { width: 100%; margin-top: 8px; }
    .audio-item { background: #111; border-radius: 8px; padding: 12px; margin-top: 10px; }
    .time { font-size: 12px; color: #888; margin-bottom: 6px; }
    .loading { text-align: center; color: #888; padding: 40px; }
    .refresh-note { font-size: 12px; color: #666; text-align: center; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="alert-banner">
      <h1>🚨 Emergency Evidence</h1>
      <p style="margin:0;opacity:0.9;">Silent Signal — Live SOS data for trusted contacts</p>
    </div>
    <div id="content" class="loading">Loading evidence...</div>
    <p class="refresh-note">Page auto-refreshes every 15 seconds for new audio and location updates.</p>
  </div>
  <script>
    const token = ${JSON.stringify(token)};
    function formatTime(iso) {
      try { return new Date(iso).toLocaleString(); } catch { return iso; }
    }
    async function loadEvidence() {
      const el = document.getElementById("content");
      try {
        const res = await fetch("/api/sos/evidence/" + token);
        if (!res.ok) { el.innerHTML = "<div class=\\"card\\"><p>Evidence not found. The link may be invalid.</p></div>"; return; }
        const data = await res.json();
        let html = "";
        html += "<div class=\\"card\\"><h2>Person in danger</h2><div class=\\"value\\">" + data.username + "</div></div>";
        html += "<div class=\\"card\\"><h2>How it was triggered</h2><div class=\\"value\\">" + data.triggerLabel + "</div></div>";
        if (data.latestLocation) {
          const loc = data.latestLocation;
          html += "<div class=\\"card\\"><h2>Latest location</h2>";
          html += "<div class=\\"mono\\">" + loc.latitude.toFixed(6) + ", " + loc.longitude.toFixed(6) + "</div>";
          html += "<div class=\\"time\\">Updated: " + formatTime(loc.time) + "</div>";
          if (data.mapsUrl) html += "<a class=\\"btn\\" href=\\"" + data.mapsUrl + "\\" target=\\"_blank\\">📍 Open in Google Maps</a>";
          html += "</div>";
        }
        html += "<div class=\\"card\\"><h2>Recorded audio (" + data.audioChunks.length + ")</h2>";
        if (data.audioChunks.length === 0) {
          html += "<p style=\\"color:#888\\">No audio yet. Recording starts automatically — check back in 10–30 seconds.</p>";
        } else {
          data.audioChunks.forEach(function(chunk, i) {
            html += "<div class=\\"audio-item\\"><div class=\\"time\\">Recording " + (i + 1) + " — " + formatTime(chunk.time) + "</div>";
            html += "<audio controls src=\\"" + chunk.url + "\\"></audio></div>";
          });
        }
        html += "</div>";
        el.innerHTML = html;
      } catch (e) {
        el.innerHTML = "<div class=\\"card\\"><p>Failed to load evidence. Please try again.</p></div>";
      }
    }
    loadEvidence();
    setInterval(loadEvidence, 15000);
  </script>
</body>
</html>`);
  });

  // ─── AI: evaluate multi-signal (suggest-only, never auto-fire) ─────────
  app.post("/api/ai/evaluate", authenticateToken, async (req: Request, res: Response) => {
    try {
      const { signals } = req.body as { signals: { type: string; confidence: number }[] };
      if (!Array.isArray(signals)) {
        return res.status(400).json({ error: "signals array required" });
      }
      const result = await evaluateAiSignals(signals);
      res.json(result);
    } catch (err: any) {
      console.error("AI evaluate error:", err);
      res.status(500).json({ error: "AI evaluation failed" });
    }
  });

  // ─── AI: incident report for evidence token ────────────────────────────
  app.get("/api/ai/incident-report/:token", authenticateToken, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      const { token } = req.params;

      const sessionRow = db
        .prepare(
          `SELECT user_id, share_expires_at FROM sos_logs WHERE share_token = ? AND user_id = ? LIMIT 1`
        )
        .get(token, userId) as { user_id: number; share_expires_at: string | null } | undefined;

      if (!sessionRow) {
        return res.status(404).json({ error: "Session not found" });
      }

      const user = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as any;
      const logs = db
        .prepare(
          `SELECT encrypted_coords, audio_url, status, trigger_method, created_at
           FROM sos_logs WHERE share_token = ? ORDER BY created_at ASC`
        )
        .all(token) as any[];

      const locations: { latitude: number; longitude: number; time: string }[] = [];
      let audioCount = 0;
      let primaryTrigger = "DURESS_PIN";

      for (const log of logs) {
        if (log.encrypted_coords) {
          const coords = decryptCoords(log.encrypted_coords);
          if (coords) {
            locations.push({
              latitude: coords.lat,
              longitude: coords.lng,
              time: log.created_at,
            });
            if (log.trigger_method !== "INTERVAL" && log.trigger_method !== "BATCH") {
              primaryTrigger = log.trigger_method;
            }
          }
        }
        if (log.status === "AUDIO_CHUNK") audioCount++;
      }

      const report = await generateIncidentReport({
        username: user?.username || `User_${userId}`,
        triggerLabel: formatTriggerMethod(primaryTrigger),
        locations,
        audioCount,
      });

      res.json({ report: report || "AI report unavailable — configure GEMINI_API_KEY" });
    } catch (err: any) {
      console.error("Incident report error:", err);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  // ─── Alert Config Status ───────────────────────────────────────────────
  app.get("/api/alerts/status", (_req: Request, res: Response) => {
    res.json({
      sms: Boolean(getTwilioClient()),
      email: Boolean(process.env.RESEND_API_KEY?.trim()) || Boolean(getMailTransporter()),
    });
  });

  // ─── Serve Frontend ────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req: Request, res: Response) =>
      res.sendFile(path.join(__dirname, "dist", "index.html"))
    );
  }

  // ─── Start Server ──────────────────────────────────────────────────────
  app.listen(Number(PORT), "0.0.0.0", async () => {
    console.log(`✅ Silent Signal running on http://localhost:${PORT}`);
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || "development"}`);

    // Warn about missing external services
    if (
      !process.env.TWILIO_ACCOUNT_SID ||
      process.env.TWILIO_ACCOUNT_SID === "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    ) {
      console.warn("⚠️  Twilio not configured — SMS alerts will be skipped");
    }

    const resendApiKey = process.env.RESEND_API_KEY?.trim();
    const mailer = getMailTransporter();
    if (resendApiKey) {
      console.log("✉️  Resend Email API configured — emails will send via HTTP API");
    } else if (!mailer) {
      console.warn("⚠️  Email delivery not configured — email alerts will be skipped");
      console.warn("   To enable emails, set RESEND_API_KEY (for Render/production) or SMTP credentials (for local)");
      console.warn("   Gmail users need an App Password: https://myaccount.google.com/apppasswords");
    } else {
      try {
        await mailer.verify();
        console.log(`✉️  SMTP ready — emails will send from ${process.env.SMTP_FROM || process.env.SMTP_USER}`);
      } catch (err: any) {
        console.error(`❌ SMTP verification failed: ${err.message}`);
        console.error("   Check SMTP_USER, SMTP_PASS, and SMTP_HOST in your .env file");
      }
    }

    if (!process.env.ENCRYPTION_KEY) {
      console.warn(
        "⚠️  ENCRYPTION_KEY not set — encrypted data cannot be decrypted after restart"
      );
    }
  });
}

startServer().catch(console.error);







