import { GoogleGenAI } from "@google/genai";

const DEFAULT_NOTES = [
  { title: "Wednesday errand loop", content: "Pick up dry cleaning, return library book, grab oat milk on the way back." },
  { title: "Dinner prep", content: "Marinate paneer, set table linen out, chill sparkling water before 8pm." },
  { title: "Team check-in", content: "Review prototype notes, send recruiter follow-up, block Friday for portfolio polish." },
  { title: "Weekend list", content: "Call mom, rotate winter clothes, schedule bike service, restock detergent." },
  { title: "Tiny reminders", content: "Water basil plant, charge earbuds, renew domain, print courier label." },
];

export function getDefaultSeedNotes() {
  return DEFAULT_NOTES;
}

function getAiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

export async function generateSeedNotes(username: string): Promise<{ title: string; content: string }[]> {
  const ai = getAiClient();
  if (!ai) return DEFAULT_NOTES;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `Generate 5 realistic personal notes for a notes app user named "${username}".
Return ONLY a JSON array of objects with "title" and "content" keys.
Notes should look mundane and lived-in: errands, reminders, groceries, meeting prep, casual plans.
Keep titles under 60 chars and content under 120 chars.`,
    });
    const text = response.text?.trim() || "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(0, 5).map((note: any) => ({
          title: String(note.title || "Note").slice(0, 80),
          content: String(note.content || "").slice(0, 200),
        }));
      }
    }
  } catch (error) {
    console.warn("[AI] Seed notes generation failed, using defaults:", error);
  }
  return DEFAULT_NOTES;
}

export async function generateIncidentReport(evidence: {
  username: string;
  triggerLabel: string;
  locations: { latitude: number; longitude: number; time: string }[];
  audioCount: number;
}): Promise<string | null> {
  const ai = getAiClient();
  if (!ai) return null;

  try {
    const locSummary = evidence.locations.slice(-10).map((location, index) => `  ${index + 1}. ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} at ${location.time}`).join("\n");
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `Write a plain-English incident summary for trusted contacts and optionally law enforcement.
Person: ${evidence.username}
Trigger: ${evidence.triggerLabel}
GPS points captured: ${evidence.locations.length}
Audio segments: ${evidence.audioCount}
Recent locations:
${locSummary || "  None recorded"}

Rules: be factual, no speculation, no legal advice. Include timeline, location pattern, and evidence available.
Start with "INCIDENT SUMMARY" as heading. Under 300 words.`,
    });
    return response.text?.trim() || null;
  } catch (error) {
    console.error("[AI] Incident report failed:", error);
    return null;
  }
}

export async function evaluateAiSignals(signals: { type: string; confidence: number }[]): Promise<{ suggestCountdown: boolean; reason: string; }> {
  const ai = getAiClient();
  const strong = signals.filter((signal) => signal.confidence >= 0.6);
  const unique = new Set(strong.map((signal) => signal.type));

  if (unique.size < 2) {
    return { suggestCountdown: false, reason: "Fewer than 2 independent signals" };
  }

  if (!ai) {
    return { suggestCountdown: true, reason: "Multi-signal agreement (local conservative rules)" };
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `You are a safety assistant. Signals detected: ${JSON.stringify(signals)}.
Should a CONFIRMATION countdown start (NOT auto-SOS)? Reply JSON only: {"suggestCountdown": boolean, "reason": "short string"}
Be conservative and prefer false negatives. Never recommend auto-firing SOS.`,
    });
    const text = response.text?.trim() || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {
    // fall through
  }
  return { suggestCountdown: true, reason: "Multi-signal agreement" };
}
