import React, { useRef, useCallback } from "react";

interface GestureDetectorProps {
  onTrigger: () => void;
}

/**
 * Invisible overlay that detects a "Z" gesture drawn anywhere on screen.
 * Works by checking the X-coordinate profile over time for a Z shape:
 * 1. Goes right (X increases)
 * 2. Goes diagonal down-left (X decreases and Y increases)
 * 3. Goes right (X increases)
 */
export default function GestureDetector({ onTrigger }: GestureDetectorProps) {
  const pointsRef = useRef<{ x: number; y: number }[]>([]);
  const drawingRef = useRef(false);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Triple Tap (top-left area) ─────────────────────────
  const handleTap = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      if (e.cancelable) {
        e.preventDefault();
      }
      tapCountRef.current += 1;
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);

      tapTimerRef.current = setTimeout(() => {
        if (tapCountRef.current >= 3) {
          console.log("[Gesture] Triple tap detected → SOS");
          onTrigger();
        }
        tapCountRef.current = 0;
      }, 500);
    },
    [onTrigger]
  );

  // ── Helper ───────────────────────────────────────────────────
  const clientCoords = (e: React.MouseEvent | React.TouchEvent) => {
    if ("touches" in e && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY };
  };

  const detectZ = (pts: { x: number; y: number }[]) => {
    if (pts.length < 9) return false;

    const N = pts.length;
    const p0 = pts[0];
    const p1 = pts[Math.floor(N / 3)];
    const p2 = pts[Math.floor((2 * N) / 3)];
    const p3 = pts[N - 1];

    const dx1 = p1.x - p0.x; // First segment (top stroke): should go right
    const dx2 = p2.x - p1.x; // Second segment (diagonal): should go left
    const dy2 = p2.y - p1.y; // Second segment (diagonal): should go down
    const dx3 = p3.x - p2.x; // Third segment (bottom stroke): should go right

    console.log(`[Gesture Simple] dx1=${dx1}, dx2=${dx2}, dy2=${dy2}, dx3=${dx3}`);

    // Validation:
    // 1. First segment moves right (dx1 > 25)
    // 2. Second segment moves left (dx2 < -15) and down (dy2 > 25)
    // 3. Third segment moves right (dx3 > 25)
    if (dx1 > 25 && dx2 < -15 && dy2 > 25 && dx3 > 25) {
      return true;
    }

    return false;
  };

  // ── Drawing Handlers ──────────────────────────────────────────
  const handleDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    drawingRef.current = true;
    pointsRef.current = [clientCoords(e)];
  }, []);

  const handleMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!drawingRef.current) return;
    e.stopPropagation();
    pointsRef.current.push(clientCoords(e));
  }, []);

  const handleUp = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      drawingRef.current = false;
      const pts = pointsRef.current;
      pointsRef.current = [];

      if (pts.length < 6) return;

      if (detectZ(pts)) {
        console.log("[Gesture] ✅ Z-gesture confirmed → SOS");
        onTrigger();
      }
    },
    [onTrigger]
  );

  return (
    <div
      className="absolute inset-0 z-[5] touch-none"
      style={{ pointerEvents: "auto" }}
      onMouseDown={handleDown}
      onMouseMove={handleMove}
      onMouseUp={handleUp}
      onTouchStart={handleDown}
      onTouchMove={handleMove}
      onTouchEnd={handleUp}
    >
      {/* Hidden Triple-Tap area (top-left corner) */}
      <div
        className="absolute top-8 left-8 w-20 h-20 z-50 rounded-full"
        onClick={handleTap}
        onTouchStart={handleTap}
      />
    </div>
  );
}
