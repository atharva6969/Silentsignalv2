import express, { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import twilio from "twilio";
import nodemailer from "nodemailer";
import bcrypt from "bcrypt";
import cors from "cors";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("silent_signal.db");

// ─── Validation Utilities ─────────────────────────────────────────────────
function validateUsername(username: string): boolean {
  return typeof username === "string" && username.length >= 3 && username.length <= 50;
}

function validatePassword(password: string): boolean {
  return typeof password === "string" && password.length >= 4;
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
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function dispatchAlerts(
  contacts: any[],
  lat: number,
  lng: number,
  username: string,
  triggerMethod: string,
  panicMessage?: string
) {
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
  const headline = panicMessage || `EMERGENCY — ${username} triggered SOS via ${triggerMethod}`;

  const smsBody =
    `🚨 SILENT SIGNAL ALERT\n` +
    `${headline}\nTime: ${timestamp}\n` +
    `📍 ${mapsUrl}\nCoords: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  const twilioClient = getTwilioClient();
  const mailer = getMailTransporter();
  const results: string[] = [];

  // Log alert configuration on SOS trigger
  if (!twilioClient) {
    console.warn("[⚠️  SMS] Twilio not configured - SMS alerts disabled");
  }
  if (!mailer) {
    console.warn("[⚠️  EMAIL] SMTP not configured - Email alerts disabled");
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
      if (!mailer) {
        console.log(`[EMAIL SKIP] No SMTP config for ${contact.name}`);
        results.push(`EMAIL SKIP → ${contact.name} (no SMTP config)`);
      } else {
        try {
          console.log(`[EMAIL ATTEMPT] Sending TO: ${contact.email} FROM: ${process.env.SMTP_FROM || process.env.SMTP_USER}`);
          await mailer.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: contact.email,
            subject: `🚨 EMERGENCY — ${username} needs help NOW`,
            text: smsBody,
            html: `
              <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;background:#fff;border-radius:12px;border:2px solid #ef4444;">
                <h1 style="color:#ef4444;margin-top:0;">🚨 Emergency Alert</h1>
                <p style="font-size:16px;"><strong>${headline}</strong></p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                  <tr><td style="padding:8px;color:#555;font-weight:bold;">User</td><td style="padding:8px;">${username}</td></tr>
                  <tr style="background:#f9f9f9;"><td style="padding:8px;color:#555;font-weight:bold;">Triggered Via</td><td style="padding:8px;">${triggerMethod}</td></tr>
                  <tr><td style="padding:8px;color:#555;font-weight:bold;">Time</td><td style="padding:8px;">${timestamp}</td></tr>
                  <tr style="background:#f9f9f9;"><td style="padding:8px;color:#555;font-weight:bold;">Coordinates</td><td style="padding:8px;font-family:monospace;">${lat.toFixed(6)}, ${lng.toFixed(6)}</td></tr>
                </table>
                <a href="${mapsUrl}" style="display:inline-block;background:#ef4444;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;">
                  📍 Open Live Location on Google Maps
                </a>
                <p style="color:#888;font-size:12px;margin-top:24px;">Sent automatically by Silent Signal.</p>
              </div>`,
          });
          results.push(`EMAIL ✓ → ${contact.name} (${contact.email})`);
          console.log(`[EMAIL ✓] Successfully sent to ${contact.name} (${contact.email})`);
        } catch (err: any) {
          results.push(`EMAIL ✗ → ${contact.name}: ${err.message}`);
          console.error(`[EMAIL ✗] Failed to send to ${contact.name} (${contact.email}): ${err.message}`);
        }
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

// ─── Server ───────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Middleware
  app.use(express.json({ limit: "10mb" }));
  app.use(cors({
    origin: process.env.CORS_ORIGIN || process.env.APP_URL || "*",
    credentials: true,
  }));

  // ─── Authentication Middleware ──────────────────────────────────────────
  function authenticateToken(req: Request, res: Response, next: NextFunction) {
    // For development, use userId from body/query; in production use JWT tokens
    const userId = (req.body?.userId || req.query?.userId || req.params?.userId) as string;
    
    if (!userId || isNaN(Number(userId))) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing userId" });
    }

    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(Number(userId));
    if (!user) {
      return res.status(403).json({ error: "Forbidden: User not found" });
    }

    (req as any).userId = Number(userId);
    next();
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
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      if (!validatePassword(duressPin)) {
        return res.status(400).json({ error: "Duress PIN must be at least 8 characters" });
      }

      // Hash passwords
      const hashedPassword = await bcrypt.hash(password, 10);
      const hashedDuressPin = await bcrypt.hash(duressPin, 10);

      const info = db.prepare(
        "INSERT INTO users (username, password, duress_pin) VALUES (?, ?, ?)"
      ).run(username, hashedPassword, hashedDuressPin);

      console.log(`[✓ REGISTER] User ${username} registered successfully`);
      res.json({ id: info.lastInsertRowid, username });
    } catch (err: any) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "Username already exists" });
      }
      console.error("Registration error:", err);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // ─── Login Endpoint ─────────────────────────────────────────────────────
  app.post("/api/auth/login", async (req: Request, res: Response) => {
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
        return res.json({ id: user.id, username: user.username, mode: "NORMAL" });
      }

      // Check duress PIN
      const duressMatch = await bcrypt.compare(password, user.duress_pin);
      if (duressMatch) {
        console.log(`[🚨 DURESS] ${username} logged in with DURESS PIN — SOS ACTIVE`);
        return res.json({ id: user.id, username: user.username, mode: "DURESS" });
      }

      res.status(401).json({ error: "Invalid credentials" });
    } catch (err: any) {
      console.error("Login error:", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // ─── Get Contacts ──────────────────────────────────────────────────────
  app.get("/api/contacts/:userId", authenticateToken, (req: Request, res: Response) => {
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
  app.post("/api/sos/trigger", authenticateToken, async (req: Request, res: Response) => {
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
      const info = db
        .prepare(
          "INSERT INTO sos_logs (user_id, encrypted_coords, status, trigger_method) VALUES (?, ?, ?, ?)"
        )
        .run(userId, encryptedCoords, "ACTIVE", triggerMethod || "MANUAL");

      const contacts = db.prepare("SELECT * FROM contacts WHERE user_id = ?").all(userId) as any[];
      const user = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as any;
      const username = user?.username || `User_${userId}`;

      console.log(
        `[🚨 SOS] ${username} | method=${triggerMethod} | ${contacts.length} contacts | coords=${latitude.toFixed(6)},${longitude.toFixed(6)}`
      );
      
      // Log each contact's details
      contacts.forEach((c, idx) => {
        console.log(`  Contact ${idx + 1}: name=${c.name}, phone=${c.phone}, email=${c.email}`);
      });

      // Dispatch alerts to contacts (background task, don't block response)
      dispatchAlerts(
        contacts,
        latitude,
        longitude,
        username,
        triggerMethod || "MANUAL",
        panicMessage
      )
        .then((results) => {
          console.log(`[✓ ALERTS DISPATCHED] ${results.length} attempts`);
          results.forEach((r) => console.log(`  ${r}`));
        })
        .catch((err: any) => {
          console.error(`[❌ ALERT DISPATCH ERROR]`, err.message || err);
        });

      res.json({ success: true, logId: info.lastInsertRowid });
    } catch (err: any) {
      console.error("SOS trigger error:", err);
      res.status(500).json({ error: "Failed to trigger SOS" });
    }
  });

  // ─── Get Notes ─────────────────────────────────────────────────────────
  app.get("/api/notes/:userId", authenticateToken, (req: Request, res: Response) => {
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
  app.post("/api/sos/audio", express.raw({ type: "audio/webm", limit: "10mb" }), (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;

      if (!userId || isNaN(Number(userId))) {
        return res.status(400).json({ error: "Valid userId is required" });
      }

      const user = db.prepare("SELECT id FROM users WHERE id = ?").get(Number(userId));
      if (!user) {
        return res.status(403).json({ error: "User not found" });
      }

      const audioBase64 = (req.body as Buffer).toString("base64");
      db.prepare(
        "INSERT INTO sos_logs (user_id, audio_url, status, trigger_method) VALUES (?, ?, ?, ?)"
      ).run(Number(userId), `data:audio/webm;base64,${audioBase64}`, "AUDIO_CHUNK", "RECORDING");

      console.log(`[✓ AUDIO] Received audio chunk for user ${userId}`);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Audio upload error:", err);
      res.status(500).json({ error: "Failed to save audio" });
    }
  });

  // ─── Get SOS Logs ──────────────────────────────────────────────────────
  app.get("/api/sos/logs/:userId", authenticateToken, (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      console.log(`[Fetching SOS logs for user ${userId}]`);
      
      const logs = db
        .prepare(
          `SELECT id, user_id, encrypted_coords, audio_url, status, trigger_method,
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
  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`✅ Silent Signal running on http://localhost:${PORT}`);
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || "development"}`);
    
    // Warn about missing external services
    if (
      !process.env.TWILIO_ACCOUNT_SID ||
      process.env.TWILIO_ACCOUNT_SID === "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    ) {
      console.warn("⚠️  Twilio not configured — SMS alerts will be skipped");
    }
    if (!process.env.SMTP_USER) {
      console.warn("⚠️  SMTP not configured — email alerts will be skipped");
    }
    if (!process.env.ENCRYPTION_KEY) {
      console.warn(
        "⚠️  ENCRYPTION_KEY not set — encrypted data cannot be decrypted after restart"
      );
    }
  });
}

startServer().catch(console.error);
