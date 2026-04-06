import { useState, useEffect, useRef, useCallback } from "react";
import { User, Contact, Note } from "./types";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import { StickyNote, LogOut } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// ─── Panic Timer constants ─────────────────────────────────────────────────
const PANIC_TIMER_SECONDS = 10; // countdown before auto-firing SOS

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isSOSActive, setIsSOSActive] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // ─── Power Button (visibilitychange) 5x tracker ──────────────────────────
  const powerPressTimestamps = useRef<number[]>([]);
  const POWER_WINDOW_MS = 4000; // 5 presses within 4 seconds

  // ─── Panic Timer state ───────────────────────────────────────────────────
  const [panicTimerActive, setPanicTimerActive] = useState(false);
  const [panicSecondsLeft, setPanicSecondsLeft] = useState(PANIC_TIMER_SECONDS);
  const panicIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const panicDismissed = useRef(false);

  // ─── Power button detection via visibilitychange ─────────────────────────
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        const now = Date.now();
        powerPressTimestamps.current.push(now);
        // Prune old timestamps outside window
        powerPressTimestamps.current = powerPressTimestamps.current.filter(
          (t) => now - t < POWER_WINDOW_MS
        );
        if (powerPressTimestamps.current.length >= 5) {
          powerPressTimestamps.current = [];
          console.log("[🔴 POWER BUTTON] 5x press detected — arming panic timer");
          // Arm the panic timer (fires when screen comes back visible)
          panicDismissed.current = false;
          setPanicTimerActive(true);
          setPanicSecondsLeft(PANIC_TIMER_SECONDS);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // ─── Panic Timer countdown ───────────────────────────────────────────────
  useEffect(() => {
    if (!panicTimerActive) return;

    panicIntervalRef.current = setInterval(() => {
      setPanicSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(panicIntervalRef.current!);
          setPanicTimerActive(false);
          if (!panicDismissed.current) {
            console.log("[⏱ PANIC TIMER] Countdown elapsed — firing SOS");
            fireSOS("PANIC_TIMER");
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (panicIntervalRef.current) clearInterval(panicIntervalRef.current);
    };
  }, [panicTimerActive]);

  const dismissPanicTimer = () => {
    panicDismissed.current = true;
    setPanicTimerActive(false);
    if (panicIntervalRef.current) clearInterval(panicIntervalRef.current);
    console.log("[⏱ PANIC TIMER] Dismissed by user");
  };

  // ─── Core SOS fire function ───────────────────────────────────────────────
  const fireSOS = useCallback(
    (triggerMethod: string = "DURESS_PIN", targetUserOverride?: User) => {
      // If already active, just log another ping
      if (isSOSActive) return;

      let targetUser = targetUserOverride || user;
      if (!targetUser) {
        // Unauthenticated quick-SOS (power button outside login)
        targetUser = { id: 1, username: "Emergency_User", mode: "DURESS" };
        setUser(targetUser);
      }

      setIsSOSActive(true);

      if ("vibrate" in navigator) {
        navigator.vibrate(
          triggerMethod === "PANIC_TIMER"
            ? [200, 100, 200, 100, 200, 100, 200]
            : [100, 50, 100]
        );
      }

      console.log(`[🚨 SOS FIRED] trigger=${triggerMethod} user=${targetUser.username}`);
    },
    [isSOSActive, user]
  );

  // ─── Background SOS loop — GPS ping + audio recording ─────────────────────
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isSOSActive && user) {
      const sendLocation = async (triggerMethod = "INTERVAL") => {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const { latitude, longitude } = pos.coords;
            setLocation({ lat: latitude, lng: longitude });
            try {
              await fetch("/api/sos/trigger", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  userId: user.id,
                  latitude,
                  longitude,
                  triggerMethod,
                  panicMessage: triggerMethod === "POWER_BUTTON_5X"
                    ? `POWER BUTTON SOS — ${user.username} pressed power 5x`
                    : triggerMethod === "PANIC_TIMER"
                    ? `PANIC TIMER ELAPSED — ${user.username} did not dismiss countdown`
                    : undefined,
                }),
              });
            } catch (e) {
              console.error("Failed to send SOS update", e);
            }
          },
          (err) => console.error("Geolocation error", err),
          { enableHighAccuracy: true }
        );
      };

      // Determine what triggered this SOS for the first ping
      const trigger = user.mode === "DURESS" ? "DURESS_PIN" : "MANUAL";
      sendLocation(trigger);
      interval = setInterval(() => sendLocation("INTERVAL"), 30000);

      startRecording();
    }

    return () => {
      if (interval) clearInterval(interval);
      stopRecording();
    };
  }, [isSOSActive, user]);

  const startRecording = async () => {
    if (audioStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      audioRecorderRef.current = recorder;

      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && user) {
          try {
            await fetch(`/api/sos/audio?userId=${user.id}`, {
              method: "POST",
              headers: { "Content-Type": "audio/webm" },
              body: event.data,
            });
          } catch (e) {
            console.error("Audio upload failed", e);
          }
        }
      };

      recorder.start(10000); // 10s chunks
    } catch (e) {
      console.error("Failed to start audio recording", e);
    }
  };

  const stopRecording = () => {
    if (audioRecorderRef.current?.state !== "inactive") {
      audioRecorderRef.current?.stop();
      audioRecorderRef.current = null;
    }
    audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioStreamRef.current = null;
  };

  const stopSOS = () => {
    setIsSOSActive(false);
    stopRecording();
  };

  const handleLogin = (userData: User) => {
    setUser(userData);
    if (userData.mode === "DURESS") {
      // Pass userData directly to avoid race condition with state update
      fireSOS("DURESS_PIN", userData);
    }
  };

  const handleLogout = () => {
    stopSOS();
    setUser(null);
  };

  const triggerEmergencySOS = () => {
    fireSOS("GESTURE");
  };

  // ─── Panic Timer Overlay ─────────────────────────────────────────────────
  const PanicTimerOverlay = () => (
    <AnimatePresence>
      {panicTimerActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-950/80 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            className="bg-white rounded-[32px] p-10 max-w-sm w-full mx-4 text-center shadow-2xl border-2 border-red-200"
          >
            {/* Countdown ring */}
            <div className="relative w-28 h-28 mx-auto mb-6">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="44" fill="none" stroke="#fee2e2" strokeWidth="8" />
                <circle
                  cx="50" cy="50" r="44"
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="8"
                  strokeDasharray={`${2 * Math.PI * 44}`}
                  strokeDashoffset={`${2 * Math.PI * 44 * (1 - panicSecondsLeft / PANIC_TIMER_SECONDS)}`}
                  strokeLinecap="round"
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-4xl font-black text-red-600">{panicSecondsLeft}</span>
              </div>
            </div>

            <h2 className="text-2xl font-black text-zinc-900 mb-2">SOS Activating</h2>
            <p className="text-zinc-500 mb-8 leading-relaxed text-sm">
              Power button pressed 5× detected. Emergency alert will fire automatically unless dismissed.
            </p>

            <button
              onClick={dismissPanicTimer}
              className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-black text-lg hover:bg-zinc-800 transition-colors shadow-lg"
            >
              I'm Safe — Cancel
            </button>
            <button
              onClick={() => {
                dismissPanicTimer();
                fireSOS("POWER_BUTTON_5X");
              }}
              className="w-full mt-3 py-3 border-2 border-red-500 text-red-600 rounded-2xl font-bold hover:bg-red-50 transition-colors"
            >
              Send SOS Now
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (!user) {
    return (
      <>
        <PanicTimerOverlay />
        <Login onLogin={handleLogin} onTriggerSOS={triggerEmergencySOS} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900">
      {/* Panic Timer overlay (works from within app too) */}
      <PanicTimerOverlay />

      {/* Decoy Header */}
      <header className="h-16 border-b border-zinc-200 bg-white/80 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center text-white shadow-lg shadow-zinc-900/10">
            <StickyNote size={20} />
          </div>
          <div>
            <h1 className="font-serif font-bold text-xl tracking-tight leading-none">QuickNotes</h1>
            <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold mt-1">Personal Workspace</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Decoy sync indicator — never reveals SOS */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-zinc-100 rounded-full text-zinc-500 text-xs font-medium">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Cloud Synced
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 hover:bg-zinc-100 rounded-xl transition-all text-zinc-600 font-bold text-sm"
          >
            <LogOut size={18} />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      <Dashboard user={user} isSOSActive={isSOSActive} onStopSOS={stopSOS} />
    </div>
  );
}
