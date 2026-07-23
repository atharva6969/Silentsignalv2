import { useState, FormEvent, useRef } from "react";
import { User } from "../types";
import { Shield, Lock, User as UserIcon, Eye, EyeOff, ArrowRight, Grid3X3 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import GestureDetector from "./GestureDetector";

interface LoginProps {
  onLogin: (user: User) => void;
  onTriggerSOS: () => void;
}

export default function Login({ onLogin, onTriggerSOS }: LoginProps) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [duressPin, setDuressPin] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPattern, setShowPattern] = useState(false);
  const [pattern, setPattern] = useState<number[]>([]);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

  const handleLongPressStart = () => {
    longPressTimer.current = setTimeout(() => {
      setShowPattern(true);
      if ("vibrate" in navigator) navigator.vibrate(50);
    }, 1000);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const handlePatternDot = (index: number) => {
    if (pattern.includes(index)) return;
    const newPattern = [...pattern, index];
    setPattern(newPattern);
    
    // Example SOS pattern: 0-1-2 (top row)
    if (newPattern.join("-") === "0-1-2") {
      onTriggerSOS();
      setShowPattern(false);
      setPattern([]);
    } else if (newPattern.length >= 4) {
      setPattern([]);
      setTimeout(() => setShowPattern(false), 500);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const endpoint = isRegistering ? "/api/auth/register" : "/api/auth/login";
    const body = isRegistering 
      ? { username, password, duressPin } 
      : { username, password };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      if (isRegistering) {
        setIsRegistering(false);
        setError("Registration successful! Please login.");
      } else {
        onLogin(data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen bg-zinc-950 flex items-center justify-center p-6 font-sans overflow-hidden relative"
      onMouseDown={handleLongPressStart}
      onMouseUp={handleLongPressEnd}
      onTouchStart={handleLongPressStart}
      onTouchEnd={handleLongPressEnd}
    >
      <GestureDetector onTrigger={onTriggerSOS} />

      {/* Hidden Pattern Grid */}
      <AnimatePresence>
        {showPattern && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/80 backdrop-blur-md"
          >
            <div className="bg-zinc-900 p-8 rounded-[40px] border border-zinc-800 shadow-2xl">
              <div className="text-center mb-6">
                <div className="w-12 h-12 bg-red-500/20 text-red-500 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Grid3X3 size={24} />
                </div>
                <h3 className="text-white font-bold">Emergency Override</h3>
                <p className="text-zinc-500 text-xs mt-1">Draw the secret pattern</p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <button
                    key={i}
                    onMouseEnter={() => pattern.length > 0 && handlePatternDot(i)}
                    onMouseDown={() => handlePatternDot(i)}
                    className={`w-16 h-16 rounded-full border-2 transition-all ${
                      pattern.includes(i) 
                        ? "bg-red-500 border-red-400 scale-90" 
                        : "bg-zinc-800 border-zinc-700 hover:border-zinc-500"
                    }`}
                  />
                ))}
              </div>
              <button 
                onClick={() => { setShowPattern(false); setPattern([]); }}
                className="w-full mt-8 py-3 text-zinc-500 text-sm font-bold hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Background Decorative Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-emerald-500/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-emerald-500/10 rounded-full blur-[120px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-[1000px] grid grid-cols-1 lg:grid-cols-2 bg-zinc-900 rounded-[32px] overflow-hidden shadow-2xl border border-zinc-800 relative z-10"
      >
        {/* Left Side: Branding/Info */}
        <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-emerald-600 to-emerald-800 text-white relative overflow-hidden">
          <div className="relative z-10">
            <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center mb-8">
              <Shield size={24} />
            </div>
            <h1 className="text-5xl font-bold tracking-tighter mb-4 leading-tight">
              Silence is your <br />
              <span className="text-emerald-200">strongest signal.</span>
            </h1>
            <p className="text-emerald-100/80 text-lg max-w-xs leading-relaxed">
              A stealth emergency system designed for high-risk situations where every second counts.
            </p>
          </div>
          
          <div className="relative z-10">
            <div className="flex gap-4 mb-8">
              <div className="flex -space-x-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="w-8 h-8 rounded-full border-2 border-emerald-700 bg-zinc-800 flex items-center justify-center overflow-hidden">
                    <img src={`https://picsum.photos/seed/user${i}/32/32`} alt="user" referrerPolicy="no-referrer" />
                  </div>
                ))}
              </div>
              <p className="text-sm text-emerald-100/60 flex items-center">
                Trusted by 2,000+ users worldwide
              </p>
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-emerald-300/50">
              National Hackathon 2026 • Team Ingenious
            </div>
          </div>

          {/* Abstract Pattern */}
          <div className="absolute top-0 right-0 w-full h-full opacity-10 pointer-events-none">
            <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                  <path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" strokeWidth="0.5"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          </div>
        </div>

        {/* Right Side: Form */}
        <div className="p-8 lg:p-12 flex flex-col justify-center bg-zinc-900">
          <div className="mb-8 lg:hidden flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
              <Shield size={20} />
            </div>
            <h2 className="text-xl font-bold text-white">Silent Signal</h2>
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-bold text-white mb-2">
              {isRegistering ? "Create Account" : "Welcome Back"}
            </h2>
            <p className="text-zinc-400">
              {isRegistering ? "Join the network of silent safety." : "Sign in to access your secure vault."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Username</label>
              <div className="relative group">
                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-emerald-500 transition-colors" size={18} />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-zinc-800/50 border border-zinc-700 rounded-2xl text-white placeholder:text-zinc-600 focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all outline-none"
                  placeholder="Your unique ID"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Security Key</label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-emerald-500 transition-colors" size={18} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-4 bg-zinc-800/50 border border-zinc-700 rounded-2xl text-white placeholder:text-zinc-600 focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all outline-none"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {isRegistering && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2 overflow-hidden"
                >
                  <label className="text-xs font-bold text-red-400 uppercase tracking-widest ml-1">Duress Trigger PIN</label>
                  <div className="relative group">
                    <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-red-500/50 group-focus-within:text-red-500 transition-colors" size={18} />
                    <input
                      type="text"
                      value={duressPin}
                      onChange={(e) => setDuressPin(e.target.value)}
                      className="w-full pl-12 pr-4 py-4 bg-red-500/5 border border-red-500/20 rounded-2xl text-white placeholder:text-zinc-600 focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-all outline-none"
                      placeholder="Secret SOS PIN"
                      required={isRegistering}
                    />
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1 ml-1 leading-relaxed">
                    <span className="text-red-400 font-bold">CRITICAL:</span> Entering this PIN instead of your password will trigger a silent SOS.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-4 rounded-2xl text-sm font-medium ${error.includes("successful") ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}
              >
                {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-bold transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 group disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {isRegistering ? "Create Secure Account" : "Access Secure Vault"}
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center">
            <button
              onClick={() => setIsRegistering(!isRegistering)}
              className="text-sm text-zinc-500 hover:text-emerald-400 transition-colors font-medium"
            >
              {isRegistering ? "Already protected? Sign in here" : "New to Silent Signal? Create an account"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
