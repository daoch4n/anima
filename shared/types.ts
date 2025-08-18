export interface Turn {
  speaker: "user" | "model";
  text: string;
}

export interface Message {
  id: string;
  sender: "user" | "model";
  text: string;
  timestamp: Date;
}

export interface CallHistoryItem {
  id: string;
  timestamp: string;
  summary: string;
}

export interface CallSummary {
  id: string;
  summaryText: string;
  timestamp: Date;
  originalTranscript: Message[];
}
