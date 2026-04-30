export interface User {
  id: string;
  username: string;
  email: string;
  preferred_name?: string | null;
  onboarding_done?: boolean;
  role: 'ADMIN' | 'COUNSELOR' | 'STUDENT';
  avatar?: string;
}

export interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  type: 'text' | 'image' | 'file' | 'voice' | 'video';
  fileUrl?: string;
  fileName?: string;
}

export interface Conversation {
  id: string;
  title: string;
  lastMessage: string;
  updatedAt: Date;
  messageCount: number;
  pinned?: boolean;
}
