import { useState, useEffect, FormEvent } from "react";
import { User, Note, Contact } from "../types";
import { 
  Plus, Search, Trash2, UserPlus, Phone, Mail, Shield, 
  Settings as SettingsIcon, StickyNote, AlertCircle, 
  History, MapPin, Mic, Menu, X, ChevronRight, 
  MoreVertical, Clock, CheckCircle2, RefreshCw
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface DashboardProps {
  user: User;
  isSOSActive: boolean;
  onStopSOS: () => void;
}

export default function Dashboard({ user, isSOSActive, onStopSOS }: DashboardProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sosLogs, setSosLogs] = useState<any[]>([]);
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

  useEffect(() => {
    fetchNotes();
    fetchContacts();
  }, [user]);

  useEffect(() => {
    if (activeTab === "logs") {
      console.log("[Switching to logs tab, fetching...");
      fetchLogs();
    }
  }, [activeTab, user.id]);

  const fetchNotes = async () => {
    try {
      const res = await fetch(`/api/notes/${user.id}`);
      if (!res.ok) {
        console.error("Failed to fetch notes", res.status, res.statusText);
        setNotes([]);
        return;
      }
      const data = await res.json();
      setNotes(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to fetch notes", e);
      setNotes([]);
    }
  };

  const fetchContacts = async () => {
    try {
      const res = await fetch(`/api/contacts/${user.id}`);
      if (!res.ok) {
        console.error("Failed to fetch contacts", res.status, res.statusText);
        setContacts([]);
        return;
      }
      const data = await res.json();
      setContacts(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to fetch contacts", e);
      setContacts([]);
    }
  };

  const fetchLogs = async () => {
    try {
      console.log("[Fetching logs for user", user.id);
      const res = await fetch(`/api/sos/logs/${user.id}`);
      console.log("[Logs response status]", res.status, res.statusText);
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error("[Logs fetch failed]", res.status, errorData);
        setSosLogs([]);
        return;
      }
      
      const data = await res.json();
      console.log("[Logs fetched]", data.length, "logs");
      setSosLogs(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("[Logs fetch error]", e);
      setSosLogs([]);
    }
  };

  const handleAddNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!newNoteTitle || !newNoteContent) return;
    setLoading(true);
    try {
      await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, title: newNoteTitle, content: newNoteContent }),
      });
      setNewNoteTitle("");
      setNewNoteContent("");
      await fetchNotes();
    } catch (e) {
      console.error("Failed to add note", e);
    }
    setLoading(false);
  };

  const handleAddContact = async (e: FormEvent) => {
    e.preventDefault();
    if (!newContactName || !newContactPhone) return;
    setLoading(true);
    try {
      await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, name: newContactName, phone: newContactPhone, email: newContactEmail }),
      });
      setNewContactName("");
      setNewContactPhone("");
      setNewContactEmail("");
      await fetchContacts();
    } catch (e) {
      console.error("Failed to add contact", e);
    }
    setLoading(false);
  };

  const handleDeleteContact = async (contactId: number) => {
    const confirmed = window.confirm("Are you sure you want to delete this contact?");
    if (!confirmed) return;
    
    setLoading(true);
    try {
      await fetch(`/api/contacts/${contactId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      await fetchContacts();
    } catch (e) {
      console.error("Failed to delete contact", e);
    }
    setLoading(false);
  };

  const handleDeleteNote = async (noteId: number) => {
    const confirmed = window.confirm("Are you sure you want to delete this note?");
    if (!confirmed) return;
    
    setLoading(true);
    try {
      await fetch(`/api/notes/${noteId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      await fetchNotes();
    } catch (e) {
      console.error("Failed to delete note", e);
    }
    setLoading(false);
  };

  const filteredNotes = notes.filter(n => 
    n.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    n.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-zinc-50">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 280 : 80 }}
        className="bg-white border-r border-zinc-200 flex flex-col z-20"
      >
        <div className="p-4 flex items-center justify-between">
          {isSidebarOpen && <span className="font-bold text-zinc-400 text-[10px] uppercase tracking-widest">Workspace</span>}
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-zinc-100 rounded-lg text-zinc-500 transition-colors"
          >
            {isSidebarOpen ? <Menu size={20} /> : <ChevronRight size={20} />}
          </button>
        </div>

        <nav className="flex-1 px-2 space-y-1">
          <SidebarItem 
            icon={<StickyNote size={20} />} 
            label="All Notes" 
            active={activeTab === "notes"} 
            onClick={() => setActiveTab("notes")}
            isOpen={isSidebarOpen}
          />
          <SidebarItem 
            icon={<SettingsIcon size={20} />} 
            label="Vault Settings" 
            active={activeTab === "settings"} 
            onClick={() => setActiveTab("settings")}
            isOpen={isSidebarOpen}
          />
          <SidebarItem 
            icon={<History size={20} />} 
            label="Security Logs" 
            active={activeTab === "logs"} 
            onClick={() => setActiveTab("logs")}
            isOpen={isSidebarOpen}
            count={sosLogs.length > 0 ? sosLogs.length : undefined}
          />
        </nav>

        <div className="p-4 border-t border-zinc-100">
          <div className={`flex items-center gap-3 ${isSidebarOpen ? "" : "justify-center"}`}>
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
              {user.username[0].toUpperCase()}
            </div>
            {isSidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-zinc-900 truncate">{user.username}</p>
                <p className="text-[10px] text-zinc-400 uppercase tracking-tighter">Pro Member</p>
              </div>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto relative">
        {/* Subtle SOS Indicator (Syncing look) */}
        {isSOSActive && (
          <div className="absolute top-4 right-4 z-30 flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-100 rounded-full shadow-sm">
            <RefreshCw size={12} className="text-emerald-500 animate-spin" />
            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Syncing to Cloud</span>
          </div>
        )}

        <div className="max-w-5xl mx-auto p-8">
          <AnimatePresence mode="wait">
            {activeTab === "notes" ? (
              <motion.div
                key="notes"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h2 className="text-4xl font-serif font-bold text-zinc-900">My Notes</h2>
                  <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-emerald-500 transition-colors" size={18} />
                    <input 
                      type="text" 
                      placeholder="Search notes..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 pr-4 py-2 bg-white border border-zinc-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all w-full md:w-64"
                    />
                  </div>
                </div>

                {/* New Note Input */}
                <form onSubmit={handleAddNote} className="bg-white rounded-[24px] border border-zinc-200 shadow-sm overflow-hidden focus-within:shadow-md transition-shadow">
                  <div className="p-6 space-y-4">
                    <input
                      type="text"
                      value={newNoteTitle}
                      onChange={(e) => setNewNoteTitle(e.target.value)}
                      placeholder="Untitled Note"
                      className="w-full text-2xl font-serif font-bold bg-transparent border-none outline-none placeholder:text-zinc-300"
                    />
                    <textarea
                      value={newNoteContent}
                      onChange={(e) => setNewNoteContent(e.target.value)}
                      placeholder="Start typing your thoughts..."
                      className="w-full min-h-[120px] bg-transparent border-none outline-none resize-none placeholder:text-zinc-300 text-zinc-600 leading-relaxed"
                    />
                  </div>
                  <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex justify-between items-center">
                    <div className="flex gap-2">
                      <div className="w-2 h-2 rounded-full bg-zinc-200" />
                      <div className="w-2 h-2 rounded-full bg-zinc-200" />
                      <div className="w-2 h-2 rounded-full bg-zinc-200" />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-zinc-900 text-white px-6 py-2 rounded-xl font-bold hover:bg-zinc-800 transition-all flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-zinc-900/10"
                    >
                      <Plus size={18} />
                      Save Note
                    </button>
                  </div>
                </form>

                {/* Notes Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredNotes.map((note) => (
                    <motion.div 
                      layout
                      key={note.id} 
                      className="bg-white p-6 rounded-[24px] border border-zinc-200 shadow-sm hover:shadow-md transition-all group relative overflow-hidden"
                    >
                      <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="flex justify-between items-start mb-3">
                        <h3 className="font-serif font-bold text-lg text-zinc-900 leading-tight">{note.title}</h3>
                        <button 
                          onClick={() => handleDeleteNote(note.id)}
                          className="text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                          disabled={loading}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <p className="text-zinc-500 text-sm line-clamp-4 leading-relaxed mb-6">{note.content}</p>
                      <div className="flex items-center justify-between pt-4 border-t border-zinc-50">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                          <Clock size={12} />
                          {new Date(note.created_at).toLocaleDateString()}
                        </div>
                        <CheckCircle2 size={14} className="text-emerald-500" />
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            ) : activeTab === "settings" ? (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-3xl space-y-12"
              >
                <div className="space-y-2">
                  <h2 className="text-4xl font-serif font-bold text-zinc-900">Vault Settings</h2>
                  <p className="text-zinc-500">Manage your secure contacts and stealth triggers.</p>
                </div>

                <section className="space-y-6">
                  <div className="flex items-center gap-3 text-zinc-900 font-bold text-xl">
                    <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
                      <UserPlus size={20} />
                    </div>
                    Trusted Contacts
                  </div>
                  
                  <form onSubmit={handleAddContact} className="flex flex-col gap-3">
                    <div className="flex flex-col md:flex-row gap-3">
                    <input
                      type="text"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      placeholder="Contact Name"
                      className="flex-1 bg-white border border-zinc-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      required
                    />
                    <input
                      type="tel"
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value)}
                      placeholder="Phone Number (for SMS)"
                      className="flex-1 bg-white border border-zinc-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      required
                    />
                    </div>
                    <div className="flex flex-col md:flex-row gap-3">
                    <input
                      type="email"
                      value={newContactEmail}
                      onChange={(e) => setNewContactEmail(e.target.value)}
                      placeholder="Email Address (for email alert)"
                      className="flex-1 bg-white border border-zinc-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-zinc-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-zinc-800 transition-all disabled:opacity-50 whitespace-nowrap"
                    >
                      Add Contact
                    </button>
                    </div>
                  </form>

                  <div className="bg-white rounded-[24px] border border-zinc-200 overflow-hidden shadow-sm">
                    {contacts.length === 0 ? (
                      <div className="p-12 text-center text-zinc-400 italic">
                        No trusted contacts added yet.
                      </div>
                    ) : (
                      <div className="divide-y divide-zinc-100">
                        {contacts.map((contact) => (
                          <div key={contact.id} className="p-4 flex items-center justify-between hover:bg-zinc-50 transition-colors">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center font-bold text-zinc-500">
                                {contact.name[0]}
                              </div>
                              <div>
                                <p className="font-bold text-zinc-900">{contact.name}</p>
                                <p className="text-xs text-zinc-500">{contact.phone}{contact.email ? ` · ${contact.email}` : ""}</p>
                              </div>
                            </div>
                            <button 
                              onClick={() => handleDeleteContact(contact.id)}
                              className="p-2 text-zinc-300 hover:text-red-500 transition-colors disabled:opacity-50"
                              disabled={loading}
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                <section className="bg-zinc-900 p-8 rounded-[32px] text-white relative overflow-hidden">
                  <div className="relative z-10 space-y-4">
                    <div className="flex items-center gap-3 text-emerald-400 font-bold text-lg">
                      <Shield size={24} />
                      Stealth Protocol Active
                    </div>
                    <p className="text-zinc-400 leading-relaxed">
                      Your Duress PIN is your silent lifeline. Logging in with it activates background GPS tracking and audio recording while showing the normal notes interface.
                    </p>
                    <div className="pt-4 flex gap-4">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
                        <CheckCircle2 size={14} className="text-emerald-500" />
                        AES-256 Encrypted
                      </div>
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
                        <CheckCircle2 size={14} className="text-emerald-500" />
                        Zero-Knowledge
                      </div>
                    </div>
                  </div>
                  <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[80px] -mr-32 -mt-32" />
                </section>
              </motion.div>
            ) : (
              <motion.div
                key="logs"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-2">
                <h2 className="text-4xl font-serif font-bold text-zinc-900">Security Logs</h2>
                <p className="text-zinc-500">Encrypted evidence captured during SOS events.</p>
              </div>
              {isSOSActive && (
                <button
                  onClick={() => setShowStopConfirm(true)}
                  className="px-6 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-600/20 flex items-center gap-2"
                >
                  <Shield size={18} />
                  Stop SOS Protocol
                </button>
              )}
            </div>

            {/* Stop Confirmation Modal */}
            <AnimatePresence>
              {showStopConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/50 backdrop-blur-sm">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="bg-white p-8 rounded-[32px] max-w-md w-full shadow-2xl border border-zinc-200"
                  >
                    <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-6">
                      <AlertCircle size={32} />
                    </div>
                    <h3 className="text-2xl font-bold text-zinc-900 mb-2">Deactivate SOS?</h3>
                    <p className="text-zinc-500 mb-8 leading-relaxed">
                      This will stop all location tracking and audio recording. Ensure you are in a safe environment before deactivating.
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowStopConfirm(false)}
                        className="flex-1 py-3 bg-zinc-100 text-zinc-600 rounded-xl font-bold hover:bg-zinc-200 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          onStopSOS();
                          setShowStopConfirm(false);
                        }}
                        className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
                      >
                        Stop Protocol
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

                <div className="grid grid-cols-1 gap-4">
                  {sosLogs.length === 0 ? (
                    <div className="bg-white p-20 rounded-[32px] border border-zinc-200 text-center space-y-4">
                      <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto text-zinc-300">
                        <History size={32} />
                      </div>
                      <p className="text-zinc-400 italic">No security logs recorded.</p>
                    </div>
                  ) : (
                    sosLogs.map((log) => (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        key={log.id} 
                        className="bg-white p-6 rounded-[24px] border border-zinc-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6"
                      >
                        <div className="flex items-center gap-4">
                          {log.status === "AUDIO_CHUNK" ? (
                            <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-red-50 text-red-600">
                              <Mic size={24} />
                            </div>
                          ) : (
                            <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-blue-50 text-blue-600">
                              <MapPin size={24} />
                            </div>
                          )}
                          <div>
                            <div className="font-bold text-zinc-900 text-lg">
                              {log.status === "AUDIO_CHUNK" ? "Voice Evidence Captured" : "Location Ping Recorded"}
                            </div>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <div className="flex items-center gap-1 text-xs font-bold text-zinc-400 uppercase tracking-widest">
                                <Clock size={12} />
                                {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(log.created_at))}
                              </div>
                              {log.trigger_method && log.trigger_method !== "RECORDING" && (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                  log.trigger_method === "POWER_BUTTON_5X" ? "bg-orange-100 text-orange-600" :
                                  log.trigger_method === "PANIC_TIMER" ? "bg-purple-100 text-purple-600" :
                                  log.trigger_method === "DURESS_PIN" ? "bg-red-100 text-red-600" :
                                  log.trigger_method === "GESTURE" ? "bg-blue-100 text-blue-600" :
                                  "bg-zinc-100 text-zinc-500"
                                }`}>
                                  {log.trigger_method.replace(/_/g, " ")}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-4">
                          {log.status === "AUDIO_CHUNK" ? (
                            <div className="bg-zinc-50 p-2 rounded-xl border border-zinc-100 shadow-inner">
                              <audio controls src={log.audio_url} className="h-8 w-48" />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 bg-zinc-50 px-4 py-2 rounded-xl border border-zinc-100">
                              <MapPin size={14} className="text-blue-500" />
                              <span className="text-sm font-mono font-bold text-zinc-600">
                                {log.latitude !== null && log.longitude !== null 
                                  ? `${log.latitude.toFixed(6)}, ${log.longitude.toFixed(6)}`
                                  : "Location unavailable"}
                              </span>
                            </div>
                          )}
                          <button className="p-2 text-zinc-300 hover:text-zinc-900 transition-colors">
                            <MoreVertical size={20} />
                          </button>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick, isOpen, count }: any) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all relative group ${
        active 
          ? "bg-emerald-50 text-emerald-700 font-bold" 
          : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
      }`}
    >
      <div className={`${active ? "text-emerald-600" : "text-zinc-400 group-hover:text-zinc-600"} transition-colors`}>
        {icon}
      </div>
      {isOpen && <span className="text-sm flex-1 text-left">{label}</span>}
      {isOpen && count !== undefined && (
        <span className="bg-red-100 text-red-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      )}
      {active && (
        <motion.div 
          layoutId="sidebar-active"
          className="absolute left-0 w-1 h-6 bg-emerald-500 rounded-r-full" 
        />
      )}
    </button>
  );
}
