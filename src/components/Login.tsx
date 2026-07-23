import React, { ReactNode, useState, FormEvent } from "react";
import { AuthResponse } from "../types";
import { Shield, Lock, User as UserIcon, Eye, EyeOff, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import GestureDetector from "./GestureDetector";

interface LoginProps {
  onLogin: (user: AuthResponse) => void;
  onTriggerSOS: () => void;
}

export default function Login({ onLogin, onTriggerSOS }: LoginProps) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [duressPin, setDuressPin] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    const endpoint = isRegistering ? "/api/auth/register" : "/api/auth/login";
    const payload = isRegistering ? { username, password, duressPin } : { username, password };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      if (isRegistering) {
        setIsRegistering(false);
        setPassword("");
        setDuressPin("");
        setMessage("Profile created. Sign in with your 4-digit code or duress PIN.");
      } else {
        onLogin(data as AuthResponse);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b1111] text-white">
      <GestureDetector onTrigger={onTriggerSOS} />

      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.14),transparent_30%),linear-gradient(180deg,#0d1515_0%,#091010_100%)]" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="pointer-events-auto w-full max-w-md rounded-[32px] border border-white/10 bg-[#0c1216]/92 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl"
        >
          <div className="mb-8">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-200 ring-1 ring-white/10">
              <Shield size={22} />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-emerald-200/70">Silent Signal</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">
              {isRegistering ? "Create your access codes" : "Sign in quietly"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              {isRegistering
                ? "Set one 4-digit code for normal access and one 4-digit duress PIN for silent emergency activation."
                : "Use your 4-digit code to enter the notes workspace without making this screen feel suspicious."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <Field label="Username" icon={<UserIcon size={18} className="text-zinc-500" />}>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="h-14 w-full bg-transparent text-white outline-none placeholder:text-zinc-600"
                placeholder="Your private ID"
                required
              />
            </Field>

            <Field
              label={isRegistering ? "4-digit passcode" : "Passcode"}
              icon={<Lock size={18} className="text-zinc-500" />}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-zinc-500 transition-colors hover:text-zinc-200"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              }
            >
              <input
                type={showPassword ? "text" : "password"}
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                value={password}
                onChange={(event) => setPassword(event.target.value.replace(/\D/g, "").slice(0, 4))}
                className="h-14 w-full bg-transparent text-white tracking-[0.4em] outline-none placeholder:text-zinc-600"
                placeholder="0000"
                required
              />
            </Field>

            <AnimatePresence>
              {isRegistering && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-5 overflow-hidden"
                >
                  <Field label="4-digit duress PIN" icon={<Shield size={18} className="text-red-300/70" />}>
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]{4}"
                      maxLength={4}
                      value={duressPin}
                      onChange={(event) => setDuressPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                      className="h-14 w-full bg-transparent text-white tracking-[0.4em] outline-none placeholder:text-zinc-600"
                      placeholder="1111"
                      required={isRegistering}
                    />
                  </Field>
                  <div className="rounded-2xl border border-red-500/15 bg-red-500/8 px-4 py-3 text-sm leading-6 text-zinc-300">
                    The duress PIN opens the normal-looking workspace while silently starting SOS capture in the background.
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {message && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  message.includes("Profile")
                    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                    : "border-red-400/20 bg-red-500/10 text-red-200"
                }`}
              >
                {message}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#1f9d7a] text-base font-bold text-white transition-all hover:bg-[#28b18a] disabled:opacity-60"
            >
              {loading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white" />
              ) : (
                <>
                  {isRegistering ? "Create profile" : "Open notes"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <div className="mt-7 flex items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-zinc-400">
            <div>
              <p className="font-medium text-zinc-200">{isRegistering ? "Already set up?" : "Need a new profile?"}</p>
              <p className="mt-1 text-xs text-zinc-500">Switch modes without leaving the page.</p>
            </div>
            <button
              onClick={() => setIsRegistering(!isRegistering)}
              className="rounded-2xl border border-white/12 px-4 py-2 font-semibold text-white transition-colors hover:bg-white/8"
            >
              {isRegistering ? "Sign in" : "Register"}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  trailing,
  children,
}: {
  label: string;
  icon: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-zinc-500">{label}</span>
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 shadow-inner shadow-black/10 transition-colors focus-within:border-emerald-400/30 focus-within:bg-white/[0.06]">
        {icon}
        <div className="flex-1">{children}</div>
        {trailing}
      </div>
    </label>
  );
}
