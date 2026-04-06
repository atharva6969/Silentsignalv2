import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Shield, AlertCircle } from "lucide-react";

interface GestureDetectorProps {
  onTrigger: () => void;
}

export default function GestureDetector({ onTrigger }: GestureDetectorProps) {
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Triple Tap Detection
  const handleTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTapCount((prev) => prev + 1);
    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    
    tapTimeoutRef.current = setTimeout(() => {
      if (tapCount + 1 >= 3) {
        console.log("[Gesture] Triple tap detected");
        onTrigger();
      }
      setTapCount(0);
    }, 400);
  };

  // Gesture Drawing Detection (Simplified Z-shape)
  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    setPoints([]);
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setPoints((prev) => [...prev, { x: clientX, y: clientY }]);
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    if (points.length < 10) return;

    // Basic "Z" or "S" detection logic
    const directions: string[] = [];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i-1].x;
      const dy = points[i].y - points[i-1].y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        if (Math.abs(dx) > Math.abs(dy)) {
          directions.push(dx > 0 ? "R" : "L");
        } else {
          directions.push(dy > 0 ? "D" : "U");
        }
      }
    }

    const path = directions.filter((d, i) => d !== directions[i-1]).join("");
    console.log("[Gesture] Path detected:", path);

    if (path.includes("RDL") || path.includes("RDR") || path.includes("LDR")) {
      console.log("[Gesture] SOS Gesture detected");
      onTrigger();
    }
    
    setPoints([]);
  };

  return (
    <div 
      className="absolute inset-0 z-0 overflow-hidden touch-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchStart={handleMouseDown}
      onTouchMove={handleMouseMove}
      onTouchEnd={handleMouseUp}
    >
      {/* Hidden Tap Area (Logo/Shield) */}
      <div 
        className="absolute top-12 left-12 w-16 h-16 cursor-pointer z-50 rounded-full"
        onClick={handleTap}
      />

      {/* Drawing Feedback (Very subtle) */}
      <svg className="absolute inset-0 pointer-events-none opacity-10">
        <polyline
          points={points.map(p => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
