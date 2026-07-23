export type AiSignalType = "SHAKE" | "VOICE_DISTRESS" | "RAPID_MOTION" | "GESTURE";

export interface AiSignal {
  type: AiSignalType;
  timestamp: number;
  confidence: number;
}

export interface AiSuspicionLog {
  id: string;
  signals: AiSignal[];
  suppressed: boolean;
  reason?: string;
  timestamp: number;
}

const SIGNAL_WINDOW_MS = 30_000;
const AI_COOLDOWN_MS = 5 * 60_000;
const MIN_SIGNALS = 2;
const MIN_CONFIDENCE = 0.6;
const LOG_KEY = "ss_ai_suspicions";

let recentSignals: AiSignal[] = [];
let lastCountdownAt = 0;

function loadLogs(): AiSuspicionLog[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLog(entry: AiSuspicionLog): void {
  const logs = loadLogs().slice(-49);
  logs.push(entry);
  localStorage.setItem(LOG_KEY, JSON.stringify(logs));
}

export function getAiSuspicionLogs(): AiSuspicionLog[] {
  return loadLogs();
}

export function isContextSuppressed(): boolean {
  if (document.visibilityState === "hidden") return true;
  const media = document.querySelector("audio, video") as HTMLMediaElement | null;
  if (media && !media.paused && !media.muted) return true;
  const recentUnlock = sessionStorage.getItem("ss_recent_unlock");
  if (recentUnlock && Date.now() - Number(recentUnlock) < 15_000) return true;
  return false;
}

export function markRecentUnlock(): void {
  sessionStorage.setItem("ss_recent_unlock", String(Date.now()));
}

export function recordSignal(signal: AiSignal): {
  shouldStartCountdown: boolean;
  logOnly: boolean;
  reason?: string;
} {
  const now = Date.now();
  recentSignals = recentSignals.filter((s) => now - s.timestamp < SIGNAL_WINDOW_MS);
  recentSignals.push(signal);

  const suppressed = isContextSuppressed();
  const strongSignals = recentSignals.filter((s) => s.confidence >= MIN_CONFIDENCE);
  const uniqueTypes = new Set(strongSignals.map((s) => s.type));

  if (suppressed) {
    saveLog({
      id: crypto.randomUUID(),
      signals: [...recentSignals],
      suppressed: true,
      reason: "Normal context (media playing or recent unlock)",
      timestamp: now,
    });
    return { shouldStartCountdown: false, logOnly: true, reason: "context_suppressed" };
  }

  if (uniqueTypes.size < MIN_SIGNALS) {
    if (strongSignals.length === 1) {
      saveLog({
        id: crypto.randomUUID(),
        signals: [...recentSignals],
        suppressed: false,
        reason: "Single signal — logged, not alerting",
        timestamp: now,
      });
    }
    return { shouldStartCountdown: false, logOnly: true, reason: "insufficient_signals" };
  }

  if (now - lastCountdownAt < AI_COOLDOWN_MS) {
    saveLog({
      id: crypto.randomUUID(),
      signals: [...recentSignals],
      suppressed: true,
      reason: "AI countdown rate-limited",
      timestamp: now,
    });
    return { shouldStartCountdown: false, logOnly: true, reason: "rate_limited" };
  }

  lastCountdownAt = now;
  recentSignals = [];
  return { shouldStartCountdown: true, logOnly: false };
}

export function resetAiCooldown(): void {
  lastCountdownAt = 0;
}
