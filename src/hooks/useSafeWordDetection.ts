import { useEffect, useRef } from "react";

interface SafeWordOptions {
  safeWord: string;
  onDetected: () => void;
  enabled?: boolean;
}

export function useSafeWordDetection({ safeWord, onDetected, enabled = false }: SafeWordOptions) {
  const recognitionRef = useRef<any>(null);
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

    recognition.onresult = (event: any) => {
      const now = Date.now();
      if (now - cooldownRef.current < 5000) return;

      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript.toLowerCase();
      }

      if (transcript.includes(safeWord.toLowerCase().trim())) {
        cooldownRef.current = now;
        onDetected();
      }
    };

    recognition.onerror = () => {
      setTimeout(() => {
        try { recognition.start(); } catch { }
      }, 2000);
    };

    recognition.onend = () => {
      try { recognition.start(); } catch { }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (error) {
      console.warn("[SafeWord] Could not start speech recognition", error);
    }

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [safeWord, onDetected, enabled]);
}
