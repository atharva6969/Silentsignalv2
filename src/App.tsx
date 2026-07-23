import { useState, useEffect, useRef, useCallback } from "react";
import { User } from "./types";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import ConfirmCountdown from "./components/ConfirmCountdown";
import { StickyNote, LogOut } from "lucide-react";
import { apiJson, apiUploadAudio } from "./lib/api";
import { clearSession, loadSession, saveSession } from "./lib/session";
import { enqueuePing, getQueuedPings, clearQueuedPings, QueuedPing } from "./lib/offlineQueue";
import { useShakeDetection } from "./hooks/useShakeDetection";
import { useSafeWordDetection } from "./hooks/useSafeWordDetection";
import { markRecentUnlock, recordSignal } from "./lib/aiEngine";

const PANIC_TIMER_SECONDS = 10;
const POWER_WINDOW_MS = 4000;
const ACTIVE_POLL_MS = 30_000;
const STATIONARY_POLL_MS = 60_000;
const STATIONARY_THRESHOLD_METERS = 35;
const AUDIO_TIMESLICE_MS = 10_000;
const BATCH_FLUSH_MS = 45_000;
const MAX_BATCH_SIZE = 3;
const SAFE_WORD_KEY = "ss_safe_word";
const AI_ENABLED_KEY = "ss_ai_enabled";

type CountdownState = {
  triggerMethod: string;
  sourceLabel: string;
  reason?: string;
} | null;

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => loadSession());
  const [isSOSActive, setIsSOSActive] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [panicTimerActive, setPanicTimerActive] = useState(false);
  const [panicSecondsLeft, setPanicSecondsLeft] = useState(PANIC_TIMER_SECONDS);
  const [countdown, setCountdown] = useState<CountdownState>(null);
  const [safeWord, setSafeWord] = useState(() => localStorage.getItem(SAFE_WORD_KEY) || "help me now");
  const [aiEnabled, setAiEnabled] = useState(() => localStorage.getItem(AI_ENABLED_KEY) !== "false");
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [micError, setMicError] = useState<string | null>(null);
  const [watchConnected, setWatchConnected] = useState<"NONE" | "APPLE" | "SAMSUNG">(() => {
    return (localStorage.getItem("ss_watch_connected") as "NONE" | "APPLE" | "SAMSUNG") || "NONE";
  });

  const connectWatch = useCallback((type: "NONE" | "APPLE" | "SAMSUNG") => {
    setWatchConnected(type);
    localStorage.setItem("ss_watch_connected", type);
  }, []);

  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const powerPressTimestamps = useRef<number[]>([]);
  const panicIntervalRef = useRef<number | null>(null);
  const panicDismissed = useRef(false);
  const gpsTimeoutRef = useRef<number | null>(null);
  const batchFlushRef = useRef<number | null>(null);
  const pendingBatchRef = useRef<QueuedPing[]>([]);
  const lastCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const activeTriggerRef = useRef<{ triggerMethod: string; panicMessage?: string } | null>(null);
  const stationaryRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(SAFE_WORD_KEY, safeWord);
  }, [safeWord]);

  useEffect(() => {
    localStorage.setItem(AI_ENABLED_KEY, String(aiEnabled));
  }, [aiEnabled]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const flushOfflineQueue = useCallback(async () => {
    if (!navigator.onLine || !user) return;

    const queued = await getQueuedPings();
    if (!queued.length) return;

    try {
      for (let i = 0; i < queued.length; i += 20) {
        const chunk = queued.slice(i, i + 20).map(({ latitude, longitude, triggerMethod, timestamp, panicMessage }) => ({
          latitude,
          longitude,
          triggerMethod,
          timestamp,
          panicMessage,
        }));
        await apiJson("/api/sos/trigger-batch", {
          method: "POST",
          body: JSON.stringify({ pings: chunk }),
        });
      }
      await clearQueuedPings();
    } catch (error) {
      console.error("Failed to flush offline GPS queue", error);
    }
  }, [user]);

  const flushBufferedPings = useCallback(async () => {
    if (!pendingBatchRef.current.length || !user) return;

    const batch = [...pendingBatchRef.current];
    pendingBatchRef.current = [];

    if (!navigator.onLine) {
      await Promise.all(batch.map((ping) => enqueuePing(ping)));
      return;
    }

    try {
      await apiJson("/api/sos/trigger-batch", {
        method: "POST",
        body: JSON.stringify({
          pings: batch.map(({ latitude, longitude, triggerMethod, timestamp, panicMessage }) => ({
            latitude,
            longitude,
            triggerMethod,
            timestamp,
            panicMessage,
          })),
        }),
      });
    } catch (error) {
      console.error("Failed to flush buffered GPS pings", error);
      await Promise.all(batch.map((ping) => enqueuePing(ping)));
    }
  }, [user]);

  useEffect(() => {
    if (!isOnline) return;
    void flushBufferedPings();
    void flushOfflineQueue();
  }, [isOnline, flushBufferedPings, flushOfflineQueue]);

  const startConfirmationCountdown = useCallback(
    (triggerMethod: string, sourceLabel: string, reason?: string, duration: number = PANIC_TIMER_SECONDS) => {
      if (!user && triggerMethod !== "GESTURE" && triggerMethod !== "WATCH_STRESS") return;
      panicDismissed.current = false;
      setCountdown({ triggerMethod, sourceLabel, reason });
      setPanicSecondsLeft(duration);
      setPanicTimerActive(true);
    },
    [isSOSActive, panicTimerActive, user]
  );

  const simulateWatchStress = useCallback(() => {
    console.log(`[Watch] Simulating stress spike on connected device: ${watchConnected}`);
    startConfirmationCountdown(
      "WATCH_STRESS",
      watchConnected === "APPLE" ? "Apple Watch sensor" : "Galaxy Watch sensor",
      "Anxiety / stress sensor spike detected by wearable",
      5
    );
  }, [watchConnected, startConfirmationCountdown]);

  const dismissPanicTimer = useCallback(() => {
    panicDismissed.current = true;
    setPanicTimerActive(false);
    setCountdown(null);
    if (panicIntervalRef.current) {
      window.clearInterval(panicIntervalRef.current);
      panicIntervalRef.current = null;
    }
  }, []);

  const fireSOS = useCallback(
    (triggerMethod: string = "DURESS_PIN", targetUserOverride?: User, panicMessage?: string) => {
      if (isSOSActive) return;
      const targetUser = targetUserOverride || user;
      if (!targetUser) return;

      activeTriggerRef.current = { triggerMethod, panicMessage };
      setIsSOSActive(true);
      setPanicTimerActive(false);
      setCountdown(null);

      if ("vibrate" in navigator) {
        navigator.vibrate([100, 50, 100, 50, 250]);
      }
    },
    [isSOSActive, user]
  );

  useEffect(() => {
    if (!panicTimerActive || !countdown) return;

    panicIntervalRef.current = window.setInterval(() => {
      setPanicSecondsLeft((prev) => {
        if (prev <= 1) {
          if (panicIntervalRef.current) {
            window.clearInterval(panicIntervalRef.current);
            panicIntervalRef.current = null;
          }
          setPanicTimerActive(false);
          if (!panicDismissed.current) {
            fireSOS(countdown.triggerMethod, undefined, countdown.reason);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (panicIntervalRef.current) {
        window.clearInterval(panicIntervalRef.current);
        panicIntervalRef.current = null;
      }
    };
  }, [countdown, fireSOS, panicTimerActive]);

  const handleAiSignal = useCallback(
    (type: "SHAKE" | "VOICE_DISTRESS" | "RAPID_MOTION" | "GESTURE") => {
      if (!aiEnabled || !user || isSOSActive) return;

      const outcome = recordSignal({
        type,
        timestamp: Date.now(),
        confidence: type === "VOICE_DISTRESS" ? 0.92 : 0.76,
      });

      if (outcome.shouldStartCountdown) {
        startConfirmationCountdown("AI_SUGGESTED", "AI risk check", outcome.reason);
      }
    },
    [aiEnabled, isSOSActive, startConfirmationCountdown, user]
  );

  const handleShakeTrigger = useCallback(() => {
    handleAiSignal("SHAKE");
    startConfirmationCountdown("SHAKE", "Shake gesture");
  }, [handleAiSignal, startConfirmationCountdown]);

  const handleSafeWordTrigger = useCallback(() => {
    handleAiSignal("VOICE_DISTRESS");
    startConfirmationCountdown("SAFE_WORD", "Safe word match");
  }, [handleAiSignal, startConfirmationCountdown]);

  useShakeDetection(handleShakeTrigger, Boolean(user));
  useSafeWordDetection({
    safeWord,
    onDetected: handleSafeWordTrigger,
    enabled: Boolean(user && safeWord.trim()),
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!user || document.visibilityState !== "hidden") return;
      const now = Date.now();
      powerPressTimestamps.current.push(now);
      powerPressTimestamps.current = powerPressTimestamps.current.filter((time) => now - time < POWER_WINDOW_MS);
      if (powerPressTimestamps.current.length >= 5) {
        powerPressTimestamps.current = [];
        startConfirmationCountdown(
          "POWER_BUTTON_5X",
          "Power-button sequence",
          "Hardware-key style trigger pattern detected"
        );
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [startConfirmationCountdown, user]);

  const submitPing = useCallback(
    async (ping: QueuedPing, immediate: boolean) => {
      if (!user) return;

      if (immediate) {
        if (!navigator.onLine) {
          await enqueuePing(ping);
          return;
        }

        try {
          await apiJson("/api/sos/trigger", {
            method: "POST",
            body: JSON.stringify(ping),
          });
        } catch (error) {
          console.error("Failed to submit immediate SOS ping", error);
          await enqueuePing(ping);
        }
        return;
      }

      pendingBatchRef.current.push(ping);
      if (pendingBatchRef.current.length >= MAX_BATCH_SIZE) {
        await flushBufferedPings();
      }
    },
    [flushBufferedPings, user]
  );

  const captureLocation = useCallback(
    async (triggerMethod: string, immediate: boolean, panicMessage?: string) => {
      if (!user) return;

      return new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const nextCoords = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            };

            setLocation(nextCoords);
            if (lastCoordsRef.current) {
              stationaryRef.current =
                haversineMeters(lastCoordsRef.current, nextCoords) < STATIONARY_THRESHOLD_METERS;
            }
            lastCoordsRef.current = nextCoords;

            await submitPing(
              {
                latitude: nextCoords.lat,
                longitude: nextCoords.lng,
                triggerMethod,
                panicMessage,
                timestamp: Date.now(),
              },
              immediate
            );
            resolve();
          },
          (error) => {
            console.error("Geolocation error", error);
            resolve();
          },
          { enableHighAccuracy: true, maximumAge: immediate ? 0 : 15000, timeout: 12000 }
        );
      });
    },
    [submitPing, user]
  );

  useEffect(() => {
    if (!isSOSActive || !user) return;

    let cancelled = false;

    const poll = async (isInitial: boolean) => {
      const trigger = activeTriggerRef.current?.triggerMethod || (user.mode === "DURESS" ? "DURESS_PIN" : "MANUAL");
      const panicMessage = activeTriggerRef.current?.panicMessage;
      await captureLocation(isInitial ? trigger : "INTERVAL", isInitial, panicMessage);
      activeTriggerRef.current = null;

      if (!cancelled) {
        const delay = stationaryRef.current ? STATIONARY_POLL_MS : ACTIVE_POLL_MS;
        gpsTimeoutRef.current = window.setTimeout(() => {
          void poll(false);
        }, delay);
      }
    };

    void poll(true);
    void flushOfflineQueue();

    batchFlushRef.current = window.setInterval(() => {
      void flushBufferedPings();
      void flushOfflineQueue();
    }, BATCH_FLUSH_MS);

    return () => {
      cancelled = true;
      if (gpsTimeoutRef.current) {
        window.clearTimeout(gpsTimeoutRef.current);
        gpsTimeoutRef.current = null;
      }
      if (batchFlushRef.current) {
        window.clearInterval(batchFlushRef.current);
        batchFlushRef.current = null;
      }
      void flushBufferedPings();
    };
  }, [captureLocation, flushBufferedPings, flushOfflineQueue, isSOSActive, user]);

  // Audio recording — separate effect with stable deps so it doesn't
  // get torn down every time a GPS callback identity changes.
  useEffect(() => {
    if (!isSOSActive || !user) return;
    void startRecording();
    return () => { stopRecording(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSOSActive, user?.id]);

  const startRecording = async () => {
    if (audioStreamRef.current) {
      console.log("[Audio] Already recording, skipping");
      return;
    }

    try {
      console.log("[Audio] Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("[Audio] ✅ Microphone access granted, tracks:", stream.getAudioTracks().length);
      audioStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      console.log("[Audio] Using MIME type:", mimeType || "(default)");

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      audioRecorderRef.current = recorder;

      recorder.ondataavailable = async (event) => {
        console.log(`[Audio] ondataavailable fired, blob size: ${event.data.size} bytes`);
        if (event.data.size === 0 || !user) return;
        try {
          const response = await apiUploadAudio(event.data);
          console.log(`[Audio] Upload response: ${response.status} ${response.statusText}`);
          if (!response.ok) {
            const text = await response.text();
            throw new Error(`Audio upload failed with ${response.status}: ${text}`);
          }
        } catch (error) {
          console.error("[Audio] Upload failed:", error);
        }
      };

      recorder.onerror = (event) => {
        console.error("[Audio] MediaRecorder error:", event);
      };

      recorder.start(AUDIO_TIMESLICE_MS);
      console.log(`[Audio] ✅ Recording started, timeslice=${AUDIO_TIMESLICE_MS}ms, state=${recorder.state}`);
      setMicError(null);
    } catch (error: any) {
      console.error("[Audio] ❌ Failed to start recording:", error);
      setMicError(error.message || String(error));
    }
  };

  const stopRecording = () => {
    setMicError(null);
    if (audioRecorderRef.current) {
      if (audioRecorderRef.current.state !== "inactive") {
        audioRecorderRef.current.stop();
      }
      audioRecorderRef.current = null;
    }
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
  };

  const stopSOS = () => {
    setIsSOSActive(false);
    activeTriggerRef.current = null;
    void flushBufferedPings();
    stopRecording();
  };

  const handleLogin = (auth: import("./types").AuthResponse) => {
    const nextUser: User = { id: auth.id, username: auth.username, mode: auth.mode };
    saveSession(nextUser, auth.token);
    markRecentUnlock();
    localStorage.setItem("ss_last_username", auth.username);
    setUser(nextUser);

    if (auth.mode === "DURESS") {
      fireSOS("DURESS_PIN", nextUser, "Duress login triggered emergency flow");
    }
  };

  const handleLogout = () => {
    dismissPanicTimer();
    stopSOS();
    clearSession();
    setUser(null);
    setLocation(null);
    lastCoordsRef.current = null;
  };

  const triggerEmergencySOS = async () => {
    if (user) {
      handleAiSignal("GESTURE");
      startConfirmationCountdown("GESTURE", "Gesture override");
      return;
    }

    try {
      console.log("[Gesture] Triggered on login page! Attempting bypass login...");
      const lastUsername = localStorage.getItem("ss_last_username") || "";
      const response = await fetch("/api/auth/gesture-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: lastUsername }),
      });
      if (!response.ok) {
        throw new Error(`Gesture login failed with status ${response.status}`);
      }
      const auth = await response.json();
      console.log("[Gesture] Auto-login response received:", auth);
      handleLogin(auth);
    } catch (error) {
      console.error("[Gesture] Auto-login failed:", error);
    }
  };

  if (!user) {
    return (
      <>
        <ConfirmCountdown
          active={panicTimerActive}
          secondsLeft={panicSecondsLeft}
          totalSeconds={PANIC_TIMER_SECONDS}
          onCancel={dismissPanicTimer}
        />
        <Login onLogin={handleLogin} onTriggerSOS={triggerEmergencySOS} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900">
      <ConfirmCountdown
        active={panicTimerActive}
        secondsLeft={panicSecondsLeft}
        totalSeconds={PANIC_TIMER_SECONDS}
        onCancel={dismissPanicTimer}
      />

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
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-zinc-100 rounded-full text-zinc-500 text-xs font-medium">
            <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-amber-500"}`} />
            {isSOSActive ? (stationaryRef.current ? "Background Syncing" : "Live Sync Active") : isOnline ? "Cloud Synced" : "Offline Changes Saved"}
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

      <Dashboard
        user={user}
        isSOSActive={isSOSActive}
        onStopSOS={stopSOS}
        safeWord={safeWord}
        onSafeWordChange={setSafeWord}
        aiEnabled={aiEnabled}
        onAiEnabledChange={setAiEnabled}
        isOnline={isOnline}
        latestLocation={location}
        micError={micError}
        watchConnected={watchConnected}
        onConnectWatch={connectWatch}
        onSimulateWatchStress={simulateWatchStress}
      />
    </div>
  );
}

