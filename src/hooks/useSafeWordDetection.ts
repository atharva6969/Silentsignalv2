import { useEffect, useRef } from "react";

interface SafeWordOptions {
  safeWord: string;
  onDetected: () => void;
  enabled?: boolean;
}
export function useSafeWordDetection({ safeWord, onDetected, enabled = false }: SafeWordOptions) {
  const cooldownRef = useRef(0);

  useEffect(() => {
    if (!enabled || !safeWord.trim()) return;

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      console.warn("[SafeWord] Web Speech API not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let isStarted = false;
    let shouldRun = true;

    const startSpeech = () => {
      if (!shouldRun || isStarted) return;
      try {
        recognition.start();
        isStarted = true;
      } catch (err) {
        // Already started or busy
      }
    };

    recognition.onstart = () => {
      isStarted = true;
      console.log("[SafeWord] Speech recognition active");
    };

    recognition.onresult = (event: any) => {
      const now = Date.now();
      if (now - cooldownRef.current < 5000) return;

      // 1. Build the full transcript from all results
      let fullTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        fullTranscript += event.results[i][0].transcript.toLowerCase();
      }

      // 2. Build the latest transcript for faster interim matches
      let latestTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        latestTranscript += event.results[i][0].transcript.toLowerCase();
      }

      const cleanSafeWord = safeWord.toLowerCase().trim();

      if (
        fullTranscript.includes(cleanSafeWord) ||
        latestTranscript.includes(cleanSafeWord)
      ) {
        console.log(`[SafeWord] ✅ Detected: "${cleanSafeWord}"`);
        cooldownRef.current = now;
        onDetected();
      }
    };

    recognition.onerror = (event: any) => {
      console.warn("[SafeWord] error:", event.error);
      if (event.error === "not-allowed") {
        shouldRun = false; // Stop restarting if permission denied
      }
    };

    recognition.onend = () => {
      isStarted = false;
      if (shouldRun) {
        // Delay restart to avoid infinite rapid loops on error
        setTimeout(() => {
          startSpeech();
        }, 400);
      }
    };

    try {
      recognition.start();
      isStarted = true;
    } catch (error) {
      console.warn("[SafeWord] Init failed:", error);
    }

    return () => {
      shouldRun = false;
      try {
        recognition.stop();
      } catch {
        // Ignore
      }
    };
  }, [safeWord, onDetected, enabled]);
}
