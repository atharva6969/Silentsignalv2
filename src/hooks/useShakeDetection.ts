import { useEffect, useRef } from "react";

const SHAKE_THRESHOLD = 18;
const SHAKE_COOLDOWN_MS = 3000;

export function useShakeDetection(onShake: () => void, enabled = true) {
  const lastShake = useRef(0);
  const lastAccel = useRef<{ x: number; y: number; z: number } | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const handleMotion = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc || acc.x == null || acc.y == null || acc.z == null) return;

      const now = Date.now();
      if (now - lastShake.current < SHAKE_COOLDOWN_MS) return;

      if (lastAccel.current) {
        const dx = acc.x! - lastAccel.current.x;
        const dy = acc.y! - lastAccel.current.y;
        const dz = acc.z! - lastAccel.current.z;
        const delta = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (delta > SHAKE_THRESHOLD) {
          lastShake.current = now;
          onShake();
        }
      }
      lastAccel.current = { x: acc.x!, y: acc.y!, z: acc.z! };
    };

    window.addEventListener("devicemotion", handleMotion);
    return () => window.removeEventListener("devicemotion", handleMotion);
  }, [onShake, enabled]);
}
