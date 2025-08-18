import type { PersonaManager } from "@features/persona/PersonaManager";
import {
  type GoogleGenAI,
  type LiveServerMessage,
  Modality,
  type Session,
} from "@google/genai";
import { BaseSessionManager, type SessionConfig } from "./BaseSessionManager";
import { energyBarService } from "./EnergyBarService";

/**
 * Manages text-based (TTS) sessions for non-persistent, in-session chat history.
 * Handles lazy initialization of the TTS session on the first message sent.
 */
export class TextSessionManager extends BaseSessionManager {
  private session: Session | null = null;
  private messages: Array<{ role: string; parts: Array<{ text: string }> }> =
    [];

  constructor(
    private client: GoogleGenAI,
    private updateTranscript: (text: string) => void,
    private personaManager: PersonaManager,
  ) {
    super("TextSessionManager");
  }

  /**
   * Send a message to the TTS session
   * @param message The text message to send
   * @returns Promise that resolves to the model's response text
   */
  async sendMessage(message: string): Promise<string> {
    // Lazy initialization of TTS session on first message
    if (!this.session) {
      const config: SessionConfig = {
        model: this.getModel(),
      };

      await this.startSession(config);
    }

    // Add user message to local history
    this.messages.push({
      role: "user",
      parts: [{ text: message }],
    });

    return new Promise((resolve, reject) => {
      if (!this.session) {
        reject(new Error("No active session available"));
        return;
      }

      try {
        // Send the message to the session
        this.session.sendClientContent({
          turns: [{ role: "user", parts: [{ text: message }] }],
        });

        // For text sessions, we need to handle the response through the onmessage callback
        // We'll store the resolver so the callback can resolve the promise
        (this as any)._currentResolver = resolve;
        (this as any)._currentRejecter = reject;
        (this as any)._responseText = "";
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Create a new text session
   */
  protected async createNewSession(config: SessionConfig): Promise<void> {
    this.logger.info("Creating new text session");

    const sessionConfig = this.getConfig();

    this.session = await this.client.live.connect({
      model: config.model,
      config: sessionConfig,
      callbacks: this.getCallbacks(),
    });

    if (this.session) {
      this.sessionState = {
        sessionId: `text-session-${Date.now()}`, // Sessions don't have IDs in the new API, so we create one
        resumptionToken: null,
        currentModel: config.model,
        isActive: true,
        connectionAttempts: 0,
      };
    }
  }

  /**
   * Resume an existing session using a resumption token
   */
  protected async resumeSession(
    config: SessionConfig,
    token: string,
  ): Promise<void> {
    this.logger.info("Resuming text session", { token });

    // In the new API, resumption works differently
    // We would need to implement this based on the actual API
    await this.createNewSession(config);
  }

  /**
   * Reconnect to an existing session
   */
  protected async reconnectSession(): Promise<void> {
    this.logger.info("Reconnecting text session");
    // Clean up existing session
    this.performSessionCleanup();

    // Create a new session
    if (this.sessionState) {
      await this.createNewSession({ model: this.sessionState.currentModel });
    }
  }

  /**
   * Perform cleanup specific to text sessions
   */
  protected performSessionCleanup(): void {
    this.logger.info("Cleaning up text session");
    if (this.session) {
      try {
        this.session.close();
      } catch (error) {
        this.logger.warn("Error closing session", error);
      }
      this.session = null;
    }

    // Clear messages when session is cleaned up
    this.messages = [];
  }

  /**
   * Get the current model based on energy levels
   */
  private getModel(): string {
    const model = energyBarService.getCurrentModel("tts");
    if (!model) {
      throw new Error("Energy exhausted: no model available for text session");
    }
    return model;
  }

  /**
   * Get the session configuration
   */
  private getConfig(): Record<string, unknown> {
    return {
      responseModalities: [Modality.AUDIO],
      contextWindowCompression: { slidingWindow: {} },
      systemInstruction: this.personaManager.getActivePersona().systemPrompt,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
    };
  }

  /**
   * Get callbacks for session events
   */
  private getCallbacks(): any {
    return {
      onmessage: (message: LiveServerMessage) => {
        // Handle resumption tokens
        const msga = message as any;
        const resumptionUpdate =
          msga.sessionResumptionUpdate ||
          msga.serverContent?.sessionResumptionUpdate;
        if (resumptionUpdate?.resumable && resumptionUpdate?.newHandle) {
          this.setResumptionToken(resumptionUpdate.newHandle as string);
        }

        // Handle GoAway messages
        const goAway = msga.goAway || msga.serverContent?.goAway;
        if (goAway && typeof goAway.timeLeft === "number") {
          this.handleGoAwayMessage(goAway.timeLeft as number);
        }

        // Handle rate limit errors - checking for error in the message
        const errorMessage = msga.serverContent?.error;
        if (errorMessage && errorMessage.message?.includes("rate limit")) {
          this.handleRateLimitError(new Error(errorMessage.message));
        }

        // Handle text response for transcript
        const modelTurn = message.serverContent?.modelTurn;
        if (modelTurn) {
          const lastPart = modelTurn.parts?.[modelTurn.parts.length - 1];
          const text = lastPart?.text;
          if (text) {
            this.updateTranscript(text);
            // Store the response text for promise resolution
            if ((this as any)._responseText !== undefined) {
              (this as any)._responseText += text;
            }
          }
        }

        // Check if generation is complete
        const genComplete = msga.serverContent?.generationComplete;
        if (genComplete && (this as any)._currentResolver) {
          // Add model response to local history
          const responseText = (this as any)._responseText || "";
          this.messages.push({
            role: "model",
            parts: [{ text: responseText }],
          });

          // Resolve the promise
          (this as any)._currentResolver(responseText);
          delete (this as any)._currentResolver;
          delete (this as any)._currentRejecter;
          delete (this as any)._responseText;
        }

        // Emit message received event
        this.emitEvent({
          type: "message-received",
          message: {
            id: Date.now().toString(),
            sender: "model",
            text: message.serverContent?.modelTurn?.parts?.[0]?.text || "",
            timestamp: new Date(),
          },
        });
      },
      onerror: (error: Error) => {
        this.handleNetworkError(error);
        // Reject any pending promise
        if ((this as any)._currentRejecter) {
          (this as any)._currentRejecter(error);
          delete (this as any)._currentResolver;
          delete (this as any)._currentRejecter;
          delete (this as any)._responseText;
        }
      },
      onclose: () => {
        if (this.sessionState) {
          this.sessionState.isActive = false;
        }
      },
      onopen: () => {
        if (this.sessionState) {
          this.sessionState.isActive = true;
        }
      },
    };
  }

  /**
   * Get the current session messages
   */
  getMessages(): Array<{ role: string; parts: Array<{ text: string }> }> {
    return [...this.messages];
  }

  /**
   * Clear the session messages
   */
  clearMessages(): void {
    this.messages = [];
  }

  /**
   * Get the current session instance
   */
  getSession(): Session | null {
    return this.session;
  }
}
