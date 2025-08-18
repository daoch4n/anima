import type { GoogleGenAI } from "@google/genai";
import type { Message } from "@shared/types";

const MODEL_NAME = "gemini-2.5-flash-lite";

export class SummarizationService {
  private genAI: GoogleGenAI;

  constructor(client: GoogleGenAI) {
    this.genAI = client;
  }

  async summarize(transcript: Message[]): Promise<string> {
    if (!transcript || transcript.length === 0) {
      return "";
    }

    try {
      const prompt = this.createPrompt(transcript);
      const result = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      return result.text;
    } catch (error) {
      console.error("Error summarizing transcript:", error);
      return "Summary unavailable";
    }
  }

  private createPrompt(transcript: Message[]): string {
    const conversation = transcript
      .map((message) => `${message.sender}: ${message.text}`)
      .join("\n");
    return `Please provide a concise summary of the following conversation. 
The summary should capture the main topics discussed and any conclusions reached.
Format the summary as a single paragraph.

Conversation:
${conversation}`;
  }
}
