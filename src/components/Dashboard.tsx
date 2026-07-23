import { FormEvent, useEffect, useMemo, useState } from "react";
import { Contact, Note, SosLog, User } from "../types";
import { Plus, Search, Trash2, Shield, Settings as SettingsIcon, StickyNote, AlertCircle, History, MapPin, Mic, Menu, ChevronRight, Clock, CheckCircle2, RefreshCw, Copy, Sparkles, Wifi, WifiOff } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { apiJson } from "../lib/api";

interface DashboardProps {
  user: User;
  isSOSActive: boolean;
  onStopSOS: () => void;
  safeWord: string;
  onSafeWordChange: (value: string) => void;
  aiEnabled: boolean;
  onAiEnabledChange: (value: boolean) => void;
  isOnline: boolean;
  latestLocation: { lat: number; lng: number } | null;
}

interface AlertStatus { sms: boolean; email: boolean; }

export default function Dashboard({ user, isSOSActive, onStopSOS, safeWord, onSafeWordChange, aiEnabled, onAiEnabledChange, isOnline, latestLocation }: DashboardProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sosLogs, setSosLogs] = useState<SosLog[]>([]);
  const [activeTab, setActiveTab] = useState<"notes" | "settings" | "logs">("notes");
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteContent, setNewNoteContent] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [alertStatus, setAlertStatus] = useState<AlertStatus | null>(null);
  const [report, setReport] = useState("");
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => { void Promise.all([fetchNotes(), fetchContacts(), fetchAlertStatus()]); }, [user.id]);
  useEffect(() => { if (activeTab === "logs") void fetchLogs(); }, [activeTab, user.id]);

  const fetchNotes = async () => setNotes(await apiJson<Note[]>("/api/notes").catch(() => []));
  const fetchContacts = async () => setContacts(await apiJson<Contact[]>("/api/contacts").catch(() => []));
  const fetchLogs = async () => setSosLogs(await apiJson<SosLog[]>("/api/sos/logs").catch(() => []));
  const fetchAlertStatus = async () => setAlertStatus(await apiJson<AlertStatus>("/api/alerts/status").catch(() => null));

  const filteredNotes = notes.filter((note) => `${note.title} ${note.content}`.toLowerCase().includes(searchQuery.toLowerCase()));
  const latestShare = useMemo(() => sosLogs.find((log) => Boolean(log.share_token)), [sosLogs]);

  const addNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!newNoteTitle.trim() || !newNoteContent.trim()) return;
    setLoading(true);
    await apiJson("/api/notes", { method: "POST", body: JSON.stringify({ title: newNoteTitle, content: newNoteContent }) }).catch(console.error);
    setNewNoteTitle(""); setNewNoteContent(""); setLoading(false); await fetchNotes();
  };

  const addContact = async (event: FormEvent) => {
    event.preventDefault();
    if (!newContactName.trim() || !newContactPhone.trim()) return;
    setLoading(true);
    try {
      await apiJson("/api/contacts", { method: "POST", body: JSON.stringify({ name: newContactName, phone: newContactPhone, email: newContactEmail || null }) });
      setNewContactName(""); setNewContactPhone(""); setNewContactEmail(""); await fetchContacts();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to add contact");
    } finally { setLoading(false); }
  };

  const deleteNote = async (id: number) => { if (!window.confirm("Delete this note?")) return; await apiJson(`/api/notes/${id}`, { method: "DELETE" }).catch(console.error); await fetchNotes(); };
  const deleteContact = async (id: number) => { if (!window.confirm("Delete this contact?")) return; await apiJson(`/api/contacts/${id}`, { method: "DELETE" }).catch(console.error); await fetchContacts(); };
  const copyEvidenceLink = async () => latestShare?.share_token && navigator.clipboard.writeText(`${window.location.origin}/evidence/${latestShare.share_token}`);
  const generateIncidentReport = async () => {
    if (!latestShare?.share_token) return;
    setReportLoading(true);
    const data = await apiJson<{ report: string }>(`/api/ai/incident-report/${latestShare.share_token}`).catch((error) => ({ report: error instanceof Error ? error.message : "Failed" }));
    setReport(data.report); setReportLoading(false);
  };

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-zinc-50">
      <motion.aside initial={false} animate={{ width: isSidebarOpen ? 280 : 80 }} className="bg-white border-r border-zinc-200 flex flex-col z-20">
        <div className="p-4 flex items-center justify-between">
          {isSidebarOpen && <span className="font-bold text-zinc-400 text-[10px] uppercase tracking-widest">Workspace</span>}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-zinc-100 rounded-lg text-zinc-500 transition-colors">{isSidebarOpen ? <Menu size={20} /> : <ChevronRight size={20} />}</button>
        </div>
        <nav className="flex-1 px-2 space-y-1">
          <SidebarItem icon={<StickyNote size={20} />} label="All Notes" active={activeTab === "notes"} onClick={() => setActiveTab("notes")} isOpen={isSidebarOpen} />
          <SidebarItem icon={<SettingsIcon size={20} />} label="Vault Settings" active={activeTab === "settings"} onClick={() => setActiveTab("settings")} isOpen={isSidebarOpen} />
          <SidebarItem icon={<History size={20} />} label="Security Logs" active={activeTab === "logs"} onClick={() => setActiveTab("logs")} isOpen={isSidebarOpen} count={sosLogs.length || undefined} />
        </nav>
        <div className="p-4 border-t border-zinc-100">
          <div className={`flex items-center gap-3 ${isSidebarOpen ? "" : "justify-center"}`}>
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">{user.username[0].toUpperCase()}</div>
            {isSidebarOpen && <div><p className="text-sm font-bold text-zinc-900">{user.username}</p><p className="text-[10px] text-zinc-400 uppercase tracking-tighter flex items-center gap-1">{isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}{isOnline ? "Realtime Sync" : "Offline Queue"}</p></div>}
          </div>
        </div>
      </motion.aside>

      <main className="flex-1 overflow-y-auto relative">
        {isSOSActive && <div className="absolute top-4 right-4 z-30 flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-100 rounded-full shadow-sm"><RefreshCw size={12} className="text-emerald-500 animate-spin" /><span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">{isOnline ? "Syncing to Cloud" : "Queued Securely"}</span></div>}
        <div className="max-w-6xl mx-auto p-8">
          <AnimatePresence mode="wait">
            {activeTab === "notes" && <motion.div key="notes" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4"><div><h2 className="text-4xl font-serif font-bold text-zinc-900">My Notes</h2><p className="text-zinc-500 mt-2">A normal-looking, lived-in workspace that still loads instantly.</p></div><div className="relative group"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-emerald-500 transition-colors" size={18} /><input type="text" placeholder="Search notes..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 pr-4 py-2 bg-white border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all w-full md:w-72" /></div></div>
              <div className="grid grid-cols-1 xl:grid-cols-[1.4fr,0.8fr] gap-6">
                <form onSubmit={addNote} className="bg-white rounded-[24px] border border-zinc-200 shadow-sm overflow-hidden"><div className="p-6 space-y-4"><input type="text" value={newNoteTitle} onChange={(e) => setNewNoteTitle(e.target.value)} placeholder="Wednesday errand list" className="w-full text-2xl font-serif font-bold bg-transparent border-none outline-none placeholder:text-zinc-300" /><textarea value={newNoteContent} onChange={(e) => setNewNoteContent(e.target.value)} placeholder="Pick up dry cleaning at 6, confirm dinner reservation, send revised slide deck." className="w-full min-h-[140px] bg-transparent border-none outline-none resize-none placeholder:text-zinc-300 text-zinc-600 leading-relaxed" /></div><div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex justify-between items-center"><div className="flex gap-2"><div className="w-2 h-2 rounded-full bg-rose-200" /><div className="w-2 h-2 rounded-full bg-amber-200" /><div className="w-2 h-2 rounded-full bg-emerald-200" /></div><button type="submit" disabled={loading} className="bg-zinc-900 text-white px-6 py-2 rounded-xl font-bold hover:bg-zinc-800 transition-all flex items-center gap-2 disabled:opacity-50"><Plus size={18} />Save Note</button></div></form>
                <div className="bg-gradient-to-br from-stone-900 via-zinc-900 to-emerald-950 text-white rounded-[24px] p-6 border border-zinc-800 shadow-sm"><p className="text-[10px] uppercase tracking-[0.3em] text-emerald-300/60 mb-3">Workspace Snapshot</p><h3 className="text-2xl font-serif font-bold">Quietly believable</h3><p className="text-sm text-zinc-300 mt-3 leading-relaxed">The decoy UI now keeps realistic content, stronger caching, and offline-safe syncing.</p><div className="mt-6 grid grid-cols-2 gap-3 text-sm"><StatusPill label="Notes" value={String(notes.length)} /><StatusPill label="Contacts" value={String(contacts.length)} /></div></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">{filteredNotes.map((note) => <motion.div layout key={note.id} className="bg-white p-6 rounded-[24px] border border-zinc-200 shadow-sm hover:shadow-md transition-all group relative overflow-hidden"><div className="absolute top-0 left-0 w-1 h-full bg-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" /><div className="flex justify-between items-start mb-3 gap-3"><h3 className="font-serif font-bold text-lg text-zinc-900">{note.title}</h3><button onClick={() => deleteNote(note.id)} className="text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={16} /></button></div><p className="text-zinc-500 text-sm line-clamp-4 leading-relaxed mb-6">{note.content}</p><div className="flex items-center justify-between pt-4 border-t border-zinc-50"><div className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest"><Clock size={12} />{new Date(note.created_at).toLocaleDateString()}</div><CheckCircle2 size={14} className="text-emerald-500" /></div></motion.div>)}</div>
            </motion.div>}
            {activeTab === "settings" && <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-4xl space-y-8"><div><h2 className="text-4xl font-serif font-bold text-zinc-900">Vault Settings</h2><p className="text-zinc-500 mt-2">Manage contacts, whispered trigger phrases, and precision-first AI rules.</p></div><div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><div className="bg-white rounded-[24px] border border-zinc-200 p-6 shadow-sm space-y-4"><h3 className="font-bold text-xl text-zinc-900">Trusted Contacts</h3><form onSubmit={addContact} className="space-y-3"><input value={newContactName} onChange={(e) => setNewContactName(e.target.value)} placeholder="Contact name" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 outline-none" required /><input value={newContactPhone} onChange={(e) => setNewContactPhone(e.target.value)} placeholder="Phone number" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 outline-none" required /><input value={newContactEmail} onChange={(e) => setNewContactEmail(e.target.value)} placeholder="Email address (optional)" className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 outline-none" /><button type="submit" disabled={loading} className="w-full bg-zinc-900 text-white px-8 py-3 rounded-xl font-bold disabled:opacity-50">Add Contact</button></form><div className="divide-y divide-zinc-100 rounded-2xl border border-zinc-100 overflow-hidden">{contacts.length === 0 ? <div className="p-8 text-center text-zinc-400 italic">No trusted contacts yet.</div> : contacts.map((contact) => <div key={contact.id} className="p-4 flex items-center justify-between"><div><p className="font-bold text-zinc-900">{contact.name}</p><p className="text-xs text-zinc-500">{contact.phone}{contact.email ? ` • ${contact.email}` : ""}</p></div><button onClick={() => deleteContact(contact.id)} className="p-2 text-zinc-300 hover:text-red-500"><Trash2 size={18} /></button></div>)}</div></div><div className="space-y-6"><div className="bg-white rounded-[24px] border border-zinc-200 p-6 shadow-sm space-y-4"><h3 className="font-bold text-xl text-zinc-900">Trigger Controls</h3><div><label className="text-xs font-bold uppercase tracking-widest text-zinc-400">Whispered safe word</label><input value={safeWord} onChange={(e) => onSafeWordChange(e.target.value)} placeholder="Example: help me now" className="mt-2 w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 outline-none" /><p className="text-xs text-zinc-500 mt-2">Exact-match speech detection stays local and starts the disguised countdown.</p></div><label className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200 p-4 bg-zinc-50"><div><p className="font-bold text-zinc-900">Precision-first AI suggestions</p><p className="text-sm text-zinc-500">Only suggests countdowns after multiple signals agree. Never auto-fires SOS.</p></div><button type="button" onClick={() => onAiEnabledChange(!aiEnabled)} className={`w-14 h-8 rounded-full transition-colors ${aiEnabled ? "bg-emerald-500" : "bg-zinc-300"}`}><span className={`block w-6 h-6 bg-white rounded-full transition-transform ${aiEnabled ? "translate-x-7" : "translate-x-1"}`} /></button></label></div><div className="bg-zinc-900 p-6 rounded-[24px] text-white"><h3 className="font-bold text-lg text-emerald-400">Delivery Status</h3><div className="grid grid-cols-2 gap-3 mt-4 text-sm"><StatusPill label="SMS" value={alertStatus?.sms ? "Ready" : "Off"} /><StatusPill label="Email" value={alertStatus?.email ? "Ready" : "Off"} /><StatusPill label="Network" value={isOnline ? "Online" : "Queued"} /><StatusPill label="GPS" value={latestLocation ? "Tracking" : "Waiting"} /></div></div></div></div></motion.div>}
            {activeTab === "logs" && <motion.div key="logs" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8"><div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4"><div><h2 className="text-4xl font-serif font-bold text-zinc-900">Security Logs</h2><p className="text-zinc-500 mt-2">Encrypted evidence sessions, offline-replayed GPS points, and rolling audio chunks.</p></div>{isSOSActive && <button onClick={() => setShowStopConfirm(true)} className="px-6 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all flex items-center gap-2"><Shield size={18} />Stop SOS Protocol</button>}</div><AnimatePresence>{showStopConfirm && <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/50 backdrop-blur-sm"><motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="bg-white p-8 rounded-[32px] max-w-md w-full shadow-2xl border border-zinc-200"><div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-6"><AlertCircle size={32} /></div><h3 className="text-2xl font-bold text-zinc-900 mb-2">Deactivate SOS?</h3><p className="text-zinc-500 mb-8 leading-relaxed">This stops live tracking, chunked audio recording, and queued sync retries.</p><div className="flex gap-3"><button onClick={() => setShowStopConfirm(false)} className="flex-1 py-3 bg-zinc-100 text-zinc-600 rounded-xl font-bold">Cancel</button><button onClick={() => { onStopSOS(); setShowStopConfirm(false); }} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold">Stop Protocol</button></div></motion.div></div>}</AnimatePresence><div className="grid grid-cols-1 xl:grid-cols-[1.2fr,0.8fr] gap-6"><div className="space-y-4">{sosLogs.length === 0 ? <div className="bg-white p-20 rounded-[32px] border border-zinc-200 text-center space-y-4"><div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto text-zinc-300"><History size={32} /></div><p className="text-zinc-400 italic">No security logs recorded.</p></div> : sosLogs.map((log) => <motion.div key={log.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="bg-white p-6 rounded-[24px] border border-zinc-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-6"><div className="flex items-center gap-4">{log.status === "AUDIO_CHUNK" ? <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-red-50 text-red-600"><Mic size={24} /></div> : <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-blue-50 text-blue-600"><MapPin size={24} /></div>}<div><div className="font-bold text-zinc-900 text-lg">{log.status === "AUDIO_CHUNK" ? "Voice Evidence Captured" : "Location Ping Recorded"}</div><div className="flex items-center gap-2 mt-1 flex-wrap"><div className="flex items-center gap-1 text-xs font-bold text-zinc-400 uppercase tracking-widest"><Clock size={12} />{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(log.created_at))}</div>{log.trigger_method && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-zinc-100 text-zinc-500">{log.trigger_method.replace(/_/g, " ")}</span>}</div></div></div><div className="flex items-center gap-4 min-w-0">{log.status === "AUDIO_CHUNK" && log.audio_url ? <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-100 min-w-[240px] max-w-[360px]"><audio controls src={log.audio_url} className="w-full" /></div> : <div className="flex items-center gap-2 bg-zinc-50 px-4 py-2 rounded-xl border border-zinc-100"><MapPin size={14} className="text-blue-500" /><span className="text-sm font-mono font-bold text-zinc-600">{log.latitude != null && log.longitude != null ? `${log.latitude.toFixed(5)}, ${log.longitude.toFixed(5)}` : "Location unavailable"}</span></div>}</div></motion.div>)}</div><div className="space-y-6"><div className="bg-white rounded-[24px] border border-zinc-200 p-6 shadow-sm space-y-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-zinc-400 font-bold">Trusted contact link</p><h3 className="text-xl font-bold text-zinc-900 mt-1">Auto-expiring evidence</h3></div><button onClick={copyEvidenceLink} disabled={!latestShare?.share_token} className="p-3 rounded-xl bg-zinc-900 text-white disabled:bg-zinc-200"><Copy size={16} /></button></div><div className="rounded-2xl bg-zinc-50 border border-zinc-100 px-4 py-3 text-sm font-mono text-zinc-600 break-all">{latestShare?.share_token ? `${window.location.origin}/evidence/${latestShare.share_token}` : "No active evidence session yet."}</div>{latestShare?.share_expires_at && <p className="text-xs text-zinc-500">Expires {new Date(latestShare.share_expires_at).toLocaleString()}</p>}</div><div className="bg-white rounded-[24px] border border-zinc-200 p-6 shadow-sm space-y-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-zinc-400 font-bold">AI report</p><h3 className="text-xl font-bold text-zinc-900 mt-1">Incident summary draft</h3></div><button onClick={generateIncidentReport} disabled={!latestShare?.share_token || reportLoading} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-50"><Sparkles size={16} />{reportLoading ? "Working..." : "Generate"}</button></div><div className="rounded-2xl bg-zinc-50 border border-zinc-100 p-4 text-sm text-zinc-600 whitespace-pre-wrap min-h-40">{report || "Generate a factual plain-English incident summary from the evidence timeline."}</div></div></div></div></motion.div>}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick, isOpen, count }: any) { return <button onClick={onClick} className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all relative group ${active ? "bg-emerald-50 text-emerald-700 font-bold" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"}`}><div className={`${active ? "text-emerald-600" : "text-zinc-400 group-hover:text-zinc-600"} transition-colors`}>{icon}</div>{isOpen && <span className="text-sm flex-1 text-left">{label}</span>}{isOpen && count !== undefined && <span className="bg-red-100 text-red-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{count}</span>}{active && <motion.div layoutId="sidebar-active" className="absolute left-0 w-1 h-6 bg-emerald-500 rounded-r-full" />}</button>; }
function StatusPill({ label, value }: { label: string; value: string }) { return <div className="bg-white/5 rounded-2xl p-4 border border-white/10"><p className="text-zinc-400 text-xs">{label}</p><p className="text-base font-bold mt-1 text-emerald-300">{value}</p></div>; }

