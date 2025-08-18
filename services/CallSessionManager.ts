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
 * Manages voice-based (STS) sessions, including handling real-time audio streaming,
 * bidirectional transcription, and call-specific API configurations.
 */
export class CallSessionManager extends BaseSessionManager {
  private session: Session | null = null;
  private callTranscript: Array<{ speaker: string; text: string }> = [];

  constructor(
    private client: GoogleGenAI,
    private updateCallTranscript: (
      text: string,
      speaker: "user" | "model",
    ) => void,
    private personaManager: PersonaManager,
  ) {
    super("CallSessionManager");
  }

  /**
   * Send audio data to the STS session for real-time streaming
   * @param chunk Audio data as ArrayBuffer
   */
  async sendAudio(chunk: ArrayBuffer): Promise<void> {
    if (!this.session) {
      // For STS, we always start with the highest energy tier
      // ignoring any previous session tokens
      const config: SessionConfig = {
        model: this.getModel(),
        enableResumption: false, // Ignore previous tokens for new calls
      };

      await this.startSession(config);
    }

    if (!this.session) {
      throw new Error("No active session available");
    }

    try {
      // Send the audio chunk to the session
      this.session.sendRealtimeInput({ media: chunk as any });
    } catch (error) {
      this.logger.error("Failed to send audio chunk", error);
      throw error;
    }
  }

  /**
   * Create a new STS session
   */
  protected async createNewSession(config: SessionConfig): Promise<void> {
    this.logger.info("Creating new STS session");

    const sessionConfig = this.getConfig();

    this.session = await this.client.live.connect({
      model: config.model,
      config: sessionConfig,
      callbacks: this.getCallbacks(),
    });

    if (this.session) {
      this.sessionState = {
        sessionId: `sts-session-${Date.now()}`, // Sessions don't have IDs in the new API, so we create one
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
    this.logger.info("Resuming STS session", { token });

    // In the new API, resumption works differently
    // We would need to implement this based on the actual API
    await this.createNewSession(config);
  }

  /**
   * Reconnect to an existing session
   */
  protected async reconnectSession(): Promise<void> {
    this.logger.info("Reconnecting STS session");
    // Clean up existing session
    this.performSessionCleanup();

    // Create a new session
    if (this.sessionState) {
      await this.createNewSession({ model: this.sessionState.currentModel });
    }
  }

  /**
   * Perform cleanup specific to STS sessions
   */
  protected performSessionCleanup(): void {
    this.logger.info("Cleaning up STS session");
    if (this.session) {
      try {
        this.session.close();
      } catch (error) {
        this.logger.warn("Error closing session", error);
      }
      this.session = null;
    }

    // Clear transcript when session is cleaned up
    this.callTranscript = [];
  }

  /**
   * Get the current model based on energy levels
   * For STS, we always start with the highest energy tier (level 3)
   */
  private getModel(): string {
    const model = energyBarService.getCurrentModel("sts");
    if (!model) {
      throw new Error("Energy exhausted: no model available for STS session");
    }
    return model;
  }

  /**
   * Get the session configuration for STS
   */
  private getConfig(): Record<string, unknown> {
    return {
      responseModalities: [Modality.AUDIO],
      contextWindowCompression: { slidingWindow: {} },
      outputAudioTranscription: {}, // Enable output transcription
      inputAudioTranscription: {}, // Enable input transcription
      systemInstruction: this.personaManager.getActivePersona().systemPrompt,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
      // Enable affective dialog based on energy level
      ...(energyBarService.isAffectiveDialogEnabled() && {
        enableAffectiveDialog: true,
      }),
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

        // Handle transcriptions
        if (message.serverContent?.outputTranscription?.text) {
          // Add to internal transcript
          this.callTranscript.push({
            speaker: "model",
            text: message.serverContent.outputTranscription.text,
          });

          this.updateCallTranscript(
            message.serverContent.outputTranscription.text,
            "model",
          );
        }

        if (message.serverContent?.inputTranscription?.text) {
          // Add to internal transcript
          this.callTranscript.push({
            speaker: "user",
            text: message.serverContent.inputTranscription.text,
          });

          this.updateCallTranscript(
            message.serverContent.inputTranscription.text,
            "user",
          );
        }

        // Emit message received event
        this.emitEvent({
          type: "message-received",
          message: {
            id: Date.now().toString(),
            sender: "model",
            text:
              message.serverContent?.modelTurn?.parts?.[0]?.text ||
              message.serverContent?.outputTranscription?.text ||
              "",
            timestamp: new Date(),
          },
        });
      },
      onerror: (error: Error) => {
        this.handleNetworkError(error);
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
   * Get the current session instance
   */
  getSession(): Session | null {
    return this.session;
  }

  /**
   * Get the current call transcript
   */
  getCallTranscript(): Array<{ speaker: string; text: string }> {
    return [...this.callTranscript];
  }
}
