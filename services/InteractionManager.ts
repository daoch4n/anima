import { PersonaManager } from "@features/persona/PersonaManager";
import { SummarizationService } from "@features/summarization/SummarizationService";
import type { GoogleGenAI } from "@google/genai";
import type { Message } from "@shared/types";
import { CallSessionManager } from "./CallSessionManager";
import { createComponentLogger } from "./DebugLogger";
import {
  type EnergyMode,
  EnergyBarService,
  type EnergyResetReason,
} from "./EnergyBarService";
import { TextSessionManager } from "./TextSessionManager";

/**
 * InteractionManager orchestrates the core interaction logic between UI events,
 * session managers, and system services.
 *
 * Responsibilities:
 * - Managing lifecycles of TextSessionManager and CallSessionManager
 * - Handling UI events (start-call, send-message, clear-chat)
 * - Coordinating with EnergyBarService on rate limits
 * - Coordinating with SummarizationService on call completion
 */
export class InteractionManager {
  private logger = createComponentLogger("InteractionManager");
  private client: GoogleGenAI;
  private personaManager: PersonaManager;

  constructor(
    private textSessionManager: TextSessionManager,
    private callSessionManager: CallSessionManager,
    private summarizationService: SummarizationService,
    private energyBarService: EnergyBarService,
    client: GoogleGenAI,
    personaManager: PersonaManager,
  ) {
    this.client = client;
    this.personaManager = personaManager;

    // Listen for energy level changes
    energyBarService.addEventListener("energy-level-changed", (e) => {
      const detail = (e as CustomEvent).detail;
      this.logger.debug("Energy level changed", detail);

      // Handle rate limit errors by downgrading session if needed
      if (detail.reason === "rate-limit-exceeded") {
        this.onRateLimitError(detail.mode);
      }

      // Display persona-driven prompts for energy changes
      const persona = this.personaManager.getActivePersona();
      const prompt = this.personaManager.getPromptForEnergyLevel(
        detail.level,
        persona.name,
        detail.mode,
      );

      if (prompt) {
        // Dispatch event for UI to display the prompt
        document.dispatchEvent(
          new CustomEvent("display-prompt", {
            detail: { prompt },
          }),
        );
      }
    });
  }

  /**
   * Handle UI events
   * @param event An object containing the event type and details
   */
  handleEvent(event: {
    type: string;
    detail?: Record<string, unknown>;
  }): void {
    const { type, detail } = event;

    this.logger.debug("Handling event", { type, detail });

    switch (type) {
      case "start-call":
        this.startCallSession().catch((error) => {
          this.logger.error("Failed to start call session", error);
          // Dispatch error event for UI to handle
          document.dispatchEvent(
            new CustomEvent("call-error", {
              detail: { error: error.message },
            }),
          );
        });
        break;

      case "send-message":
        if (detail?.message) {
          this.sendTextMessage(detail.message as string).catch((error) => {
            this.logger.error("Failed to send text message", error);
            // Dispatch error event for UI to handle
            document.dispatchEvent(
              new CustomEvent("message-error", {
                detail: { error: error.message },
              }),
            );
          });
        }
        break;

      case "clear-chat":
        this.clearTextSession();
        break;

      default:
        this.logger.warn("Unknown event type", { type });
    }
  }

  /**
   * Handle rate limit errors by downgrading energy levels
   * @param mode The mode that hit a rate limit ("tts" or "sts")
   */
  onRateLimitError(mode: EnergyMode): void {
    this.logger.info("Handling rate limit error for mode", { mode });

    // Let the EnergyBarService handle the actual energy level decrement
    // We just need to react to the change if needed

    // For STS sessions, we might need to restart with a lower tier model
    if (mode === "sts" && this.callSessionManager?.isSessionActive()) {
      this.logger.info("Restarting STS session with lower tier model");
      // End current session and let UI start a new one when ready
      this.endCallSession();
    }

    // For TTS sessions, the model will be automatically selected on next message
    if (mode === "tts" && this.textSessionManager?.isSessionActive()) {
      this.logger.info("Will use lower tier model for next TTS message");
      // No need to end session, next message will use updated energy level
    }
  }

  /**
   * Start a new call session (STS)
   */
  private async startCallSession(): Promise<void> {
    this.logger.info("Starting call session");

    // End any existing call session
    if (this.callSessionManager) {
      this.endCallSession();
    }

    // Create new call session manager
    // TODO: Refactor to avoid direct instantiation here

    try {
      // Send audio will automatically start the session
      this.logger.info("Call session manager created");

      // Dispatch event for UI to know session is ready
      document.dispatchEvent(new CustomEvent("call-session-ready"));
    } catch (error) {
      this.logger.error("Failed to start call session", error);
      throw error;
    }
  }

  /**
   * End the current call session
   */
  private endCallSession(): void {
    this.logger.info("Ending call session");

    if (this.callSessionManager) {
      this.callSessionManager.endSession();
      this.callSessionManager = null;
    }
  }

  /**
   * Send audio data to the current call session
   * @param chunk Audio data as ArrayBuffer
   */
  async sendAudio(chunk: ArrayBuffer): Promise<void> {
    if (!this.callSessionManager) {
      throw new Error("No active call session");
    }

    try {
      await this.callSessionManager.sendAudio(chunk);
    } catch (error) {
      this.logger.error("Failed to send audio", error);
      throw error;
    }
  }

  /**
   * Send a text message (TTS)
   * @param message The text message to send
   */
  private async sendTextMessage(message: string): Promise<void> {
    this.logger.debug("Sending text message", { message });

    // Lazy initialize text session manager if needed
    // TODO: Refactor to avoid direct instantiation here

    try {
      await this.textSessionManager.sendMessage(message);
    } catch (error) {
      this.logger.error("Failed to send text message", error);
      throw error;
    }
  }

  /**
   * Clear the text session (for chat reset)
   */
  private clearTextSession(): void {
    this.logger.info("Clearing text session");
    if (this.textSessionManager) {
      this.textSessionManager.endSession();
      // Dispatch event for UI to clear chat
      document.dispatchEvent(new CustomEvent("chat-cleared"));
    }
    // Also reset TTS energy
    this.energyBarService.resetEnergyLevel("manual", "tts");
  }

  /**
   * Get messages from the text session
   */
  getTextMessages(): Array<{ role: string; parts: Array<{ text: string }> }> {
    if (this.textSessionManager) {
      return this.textSessionManager.getMessages();
    }
    return [];
  }

  /**
   * Update text transcript callback
   * @param text The text to add to the transcript
   */
  private updateTextTranscript(text: string): void {
    // Dispatch event for UI to update transcript
    document.dispatchEvent(
      new CustomEvent("text-transcript-update", {
        detail: { text },
      }),
    );
  }

  /**
   * Update call transcript callback
   * @param text The text to add to the transcript
   * @param speaker The speaker of the text
   */
  private updateCallTranscript(text: string, speaker: "user" | "model"): void {
    // Dispatch event for UI to update call transcript
    document.dispatchEvent(
      new CustomEvent("call-transcript-update", {
        detail: { text, speaker },
      }),
    );
  }

  /**
   * Get the current call transcript
   */
  getCallTranscript(): Array<{ speaker: string; text: string }> {
    if (this.callSessionManager) {
      return this.callSessionManager.getCallTranscript();
    }
    return [];
  }

  /**
   * End the current session and generate a summary
   */
  async endSessionAndSummarize(): Promise<string> {
    this.logger.info("Ending session and generating summary");

    // End the call session first
    this.endCallSession();

    // Get the call transcript for summarization
    const callTranscript = this.getCallTranscript();

    // Convert to Message format for summarization
    const transcript: Message[] = callTranscript.map((turn, index) => ({
      id: `turn-${index}`,
      sender: turn.speaker as "user" | "model",
      text: turn.text,
      timestamp: new Date(),
    }));

    // Generate summary if summarization service is available
    if (this.summarizationService && transcript.length > 0) {
      try {
        const summary = await this.summarizationService.summarize(transcript);
        this.logger.info("Summary generated", { summary });

        // Dispatch event with summary for UI to handle
        document.dispatchEvent(
          new CustomEvent("call-summary", {
            detail: { summary, transcript },
          }),
        );

        return summary;
      } catch (error) {
        this.logger.error("Failed to generate summary", error);
        throw error;
      }
    }

    return "";
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.logger.info("Destroying InteractionManager");

    if (this.textSessionManager) {
      this.textSessionManager.endSession();
      this.textSessionManager = null;
    }

    if (this.callSessionManager) {
      this.callSessionManager.endSession();
      this.callSessionManager = null;
    }
  }
}
