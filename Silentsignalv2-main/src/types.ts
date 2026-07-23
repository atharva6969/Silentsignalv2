export interface User {
  id: number;
  username: string;
  mode: "NORMAL" | "DURESS";
}

export interface Contact {
  id: number;
  name: string;
  phone: string;
  email: string;
}

export interface Note {
  id: number;
  title: string;
  content: string;
  created_at: string;
}
