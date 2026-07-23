export interface User {
  id: number;
  username: string;
  mode: "NORMAL" | "DURESS";
}

export interface AuthResponse extends User {
  token: string;
}

export interface Contact {
  id: number;
  name: string;
  phone: string;
  email: string | null;
}

export interface Note {
  id: number;
  title: string;
  content: string;
  created_at: string;
}

export interface SosLog {
  id: number;
  status: string;
  trigger_method: string;
  created_at: string;
  latitude?: number | null;
  longitude?: number | null;
  audio_url?: string | null;
  share_token?: string | null;
  share_expires_at?: string | null;
}
