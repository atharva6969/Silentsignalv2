import { motion, AnimatePresence } from "motion/react";
import { RefreshCw } from "lucide-react";

interface ConfirmCountdownProps {
  active: boolean;
  secondsLeft: number;
  totalSeconds: number;
  onCancel: () => void;
}

/** Disguised as a cloud sync — not an obvious SOS countdown */
export default function ConfirmCountdown({
  active,
  secondsLeft,
  totalSeconds,
  onCancel,
}: ConfirmCountdownProps) {
  const progress = ((totalSeconds - secondsLeft) / totalSeconds) * 100;

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9998] flex items-end justify-center pb-8 pointer-events-none"
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            className="bg-white/95 backdrop-blur-md border border-zinc-200 rounded-2xl shadow-xl px-5 py-4 mx-4 max-w-sm w-full pointer-events-auto"
          >
            <div className="flex items-center gap-3">
              <RefreshCw size={18} className="text-zinc-400 animate-spin" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-800 truncate">Syncing notes…</p>
                <p className="text-xs text-zinc-400">Uploading changes to cloud</p>
              </div>
            </div>
            <div className="mt-3 h-1 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-zinc-400 rounded-full transition-all duration-1000"
                style={{ width: `${progress}%` }}
              />
            </div>
            {/* Hidden cancel — long-press bottom-right corner */}
            <button
              type="button"
              aria-label="Cancel sync"
              onClick={onCancel}
              className="absolute bottom-0 right-0 w-12 h-12 opacity-0"
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
