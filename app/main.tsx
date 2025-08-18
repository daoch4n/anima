/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PersonaManager } from "@features/persona/PersonaManager";
import { SummarizationService } from "@features/summarization/SummarizationService";
import {
  GoogleGenAI,
  type LiveServerMessage,
  Modality,
  type Session,
} from "@google/genai";
import { createComponentLogger } from "@services/DebugLogger";
import { createBlob, decode, decodeAudioData } from "@shared/utils";
import { VectorStore } from "@store/VectorStore";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@live2d/zip-loader";
import "@live2d/live2d-gate";
import "@components/SettingsMenu";
import "@components/ChatView";
import "@components/CallTranscript";
import type { EnergyLevelChangedDetail } from "@services/EnergyBarService";
import { energyBarService } from "@services/EnergyBarService";
import "@components/ToastNotification";
import "@components/ControlsPanel";
import "@components/TabView";
import "@components/CallHistoryView";
import type { ToastNotification } from "@components/ToastNotification";
import type { CallSummary, Turn, Message } from "@shared/types";

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

// Session Manager Architecture Pattern
abstract class BaseSessionManager {
  // Resumption handle API
  public getResumptionHandle(): string | null {
    return this.currentHandle;
  }
  // Session state and reconnection management
  protected currentHandle: string | null = null;
  protected isConnected: boolean = false;
  protected lastMessageTimestamp: number = 0;
  private reconnecting: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: number | null = null;
  private intentionalClose: boolean = false;
  protected nextStartTime: number = 0;
  protected sources = new Set<AudioBufferSourceNode>();
  protected session: Session | null = null;

  constructor(
    protected outputAudioContext: AudioContext,
    protected outputNode: GainNode,
    protected client: GoogleGenAI,
    protected updateStatus: (msg: string) => void,
    protected updateError: (msg: string) => void,
    protected onRateLimit: (msg: string) => void = () => {},
  ) {}

  // Common audio processing logic
  protected async handleAudioMessage(audio: { data?: string }): Promise<void> {
    this.nextStartTime = Math.max(
      this.nextStartTime,
      this.outputAudioContext.currentTime,
    );

    if (!audio?.data) return;
    const audioBuffer = await decodeAudioData(
      decode(audio.data),
      this.outputAudioContext,
      24000,
      1,
    );
    const source = this.outputAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputNode);
    source.addEventListener("ended", () => this.sources.delete(source));

    source.start(this.nextStartTime);
    this.nextStartTime = this.nextStartTime + audioBuffer.duration;
    this.sources.add(source);
  }

  protected handleInterruption(): void {
    for (const source of this.sources.values()) {
      source.stop();
      this.sources.delete(source);
    }
    this.nextStartTime = 0;
  }

  protected getCallbacks() {
    return {
      onopen: () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.updateStatus(`${this.getSessionName()} opened`);
      },
      onmessage: async (message: LiveServerMessage) => {
        // Update last activity timestamp
        this.lastMessageTimestamp = Date.now();

        const msga = message as any;
        // Session resumption update handling
        const resumptionUpdate =
          msga.sessionResumptionUpdate ||
          msga.serverContent?.sessionResumptionUpdate;
        if (resumptionUpdate?.resumable && resumptionUpdate?.newHandle) {
          this.currentHandle = resumptionUpdate.newHandle as string;
          // Optionally persist the handle if needed by the app.
          try {
            localStorage.setItem("gdm:call-session-handle", this.currentHandle);
          } catch {}
          this.updateStatus(
            `${this.getSessionName()}: received resumption handle`,
          );
        }

        // GoAway handling (pre-termination notice)
        const goAway = msga.goAway || msga.serverContent?.goAway;
        if (goAway && typeof goAway.timeLeft === "number") {
          const timeLeftMs = goAway.timeLeft as number;
          // Schedule a reconnect slightly before the server aborts the connection
          const guard = 250; // ms safety margin
          const delay = Math.max(timeLeftMs - guard, 0);
          if (!this.reconnecting) {
            this.updateStatus(`${this.getSessionName()}: reconnecting soon...`);
            // Show a non-intrusive toast for reconnection
            try {
              const root =
                (this as any)?.hostElement ??
                (document.querySelector("gdm-live-audio") as any);
              const toast = root?.shadowRoot?.querySelector(
                "toast-notification#inline-toast",
              );
              if (
                toast &&
                root?.activeMode === "calling" &&
                !root?._callReconnectingNotified
              ) {
                root._callReconnectingNotified = true;
                toast.show("Reconnecting call…", "info", 2000, {
                  position: "bottom-right",
                  variant: "standard",
                });
              } else if (
                toast &&
                root?.activeMode === "texting" &&
                !root?._textReconnectingNotified
              ) {
                root._textReconnectingNotified = true;
                toast.show("Reconnecting chat…", "info", 2000, {
                  position: "bottom-center",
                  variant: "inline",
                });
              }
            } catch {}
            window.setTimeout(() => {
              this.reconnectSession();
            }, delay);
          }
        }

        // Generation complete acknowledgement
        const genComplete = msga.serverContent?.generationComplete;
        if (genComplete) {
          // Hook for post-turn actions; for now, surface a status update
          this.updateStatus(`${this.getSessionName()}: generation complete`);
        }

        // Audio handling
        const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData;
        if (audio) {
          await this.handleAudioMessage(audio);
        }

        // Interruption handling
        const interrupted = message.serverContent?.interrupted;
        if (interrupted) {
          this.handleInterruption();
        }
      },
      onerror: (e: ErrorEvent) => {
        const msg = e.message || "";
        const isRateLimited = /rate[- ]?limit|quota/i.test(msg);
        if (isRateLimited) {
          this.onRateLimit(msg);
        }
        this.updateError(`${this.getSessionName()} error: ${e.message}`);
      },
      onclose: (e: CloseEvent) => {
        const msg = e.reason || "";
        const isRateLimited = /rate[- ]?limit|quota/i.test(msg);
        if (isRateLimited) {
          this.onRateLimit(msg);
        }
        this.updateStatus(`${this.getSessionName()} closed: ${e.reason}`);
        this.session = null;
        this.isConnected = false;
        // If not an intentional close, attempt to reconnect when possible
        if (!this.intentionalClose) {
          this.reconnectSession();
        }
        // Reset the flag after handling
        this.intentionalClose = false;
      },
    };
  }

  // Abstract methods for mode-specific behavior
  protected abstract getModel(): string;
  protected abstract getConfig(): Record<string, unknown>;
  protected abstract getSessionName(): string;

  public async initSession(resumptionHandle?: string | null): Promise<boolean> {
    // Load persisted handle if none provided and none stored in memory
    if (resumptionHandle == null && this.currentHandle == null) {
      try {
        this.currentHandle = localStorage.getItem("gdm:call-session-handle");
      } catch {}
    }
    // Merge resumption handle preference: explicit arg > stored handle > null
    const handleToUse = resumptionHandle ?? this.currentHandle ?? null;

    // Guard to prevent auto-reconnect in onclose during intentional re-init
    this.intentionalClose = true;
    await this.closeSession();
    this.intentionalClose = false;

    try {
      const baseConfig = this.getConfig() || {};
      const configWithResumption: Record<string, unknown> = {
        ...baseConfig,
        // Pass the handle to resume an existing session, or null to start a new one.
        sessionResumption: { handle: handleToUse },
      } as any;

      this.updateStatus(
        handleToUse
          ? `${this.getSessionName()}: resuming session...`
          : `${this.getSessionName()}: starting session...`,
      );

      this.session = await this.client.live.connect({
        model: this.getModel(),
        callbacks: this.getCallbacks(),
        config: configWithResumption,
      });

      // If we started a brand new session, the server will send a new handle shortly;
      // if we resumed, the handle remains valid until a new update arrives.
      this.isConnected = true;
      return true;
    } catch (e) {
      logger.error(`Error initializing ${this.getSessionName()}:`, e);
      const msg = String((e as Error)?.message || e || "");
      this.updateError(`Failed to initialize ${this.getSessionName()}: ${msg}`);

      // If we attempted with a handle and it failed due to invalid/expired handle, clear and retry once
      const looksLikeInvalidHandle =
        /invalid|expired|resume|handle|resumption/i.test(msg);
      if (handleToUse && looksLikeInvalidHandle) {
        this.updateStatus(
          `${this.getSessionName()}: handle invalid — starting new session`,
        );
        this.currentHandle = null;
        try {
          this.session = await this.client.live.connect({
            model: this.getModel(),
            callbacks: this.getCallbacks(),
            config: {
              ...(this.getConfig() || {}),
              sessionResumption: { handle: null },
            } as any,
          });
          this.isConnected = true;
          return true;
        } catch (e2) {
          logger.error(
            `Retry without handle failed for ${this.getSessionName()}:`,
            e2,
          );
          const msg2 = String((e2 as Error)?.message || e2 || "");
          this.updateError(
            `Failed to start new ${this.getSessionName()}: ${msg2}`,
          );
        }
      }
      return false;
    }
  }

  /**
   * Attempt to reconnect the session using the latest resumption handle, with
   * exponential backoff and jitter. Ensures only a single reconnect loop runs.
   */
  public async reconnectSession(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;

    const maxDelay = 15000; // 15s cap
    const baseDelay = 300; // 300ms base

    const attemptReconnect = async () => {
      // If we already have a live session, end the loop
      if (this.session) {
        this.reconnecting = false;
        return;
      }

      const attempt = this.reconnectAttempts++;
      const backoff = Math.min(maxDelay, baseDelay * 2 ** attempt);
      const jitter = Math.random() * 0.2 + 0.9; // 0.9x - 1.1x
      const delay = Math.floor(backoff * jitter);

      this.updateStatus(
        `${this.getSessionName()}: reconnecting (attempt ${attempt + 1})...`,
      );

      const ok = await this.initSession(this.currentHandle);
      if (ok && this.session) {
        this.updateStatus(`${this.getSessionName()}: session resumed`);
        try {
          const root =
            (this as any)?.hostElement ??
            (document.querySelector("gdm-live-audio") as any);
          const toast = root?.shadowRoot?.querySelector(
            "toast-notification#inline-toast",
          );
          if (toast && root?.activeMode === "calling") {
            toast.show("Call reconnected", "success", 1200, {
              position: "bottom-right",
              variant: "standard",
            });
            root._callReconnectingNotified = false;
          } else if (toast && root?.activeMode === "texting") {
            toast.show("Chat reconnected", "success", 1200, {
              position: "bottom-center",
              variant: "inline",
            });
            root._textReconnectingNotified = false;
          }
        } catch {}
        this.reconnectAttempts = 0;
        this.reconnecting = false;
        return;
      }

      // Schedule next attempt
      this.reconnectTimer = window.setTimeout(
        attemptReconnect,
        delay,
      ) as unknown as number;
    };

    attemptReconnect();
  }

  public async closeSession(): Promise<void> {
    if (this.session) {
      try {
        this.intentionalClose = true;
        this.session.close();
      } catch (e) {
        logger.warn(`Error closing ${this.getSessionName()}:`, e);
      } finally {
        this.intentionalClose = false;
      }
      this.session = null;
    }
  }

  public sendMessage(message: string): void {
    if (this.session) {
      try {
        this.session.sendClientContent({ turns: message });
      } catch (error) {
        logger.error(
          `Error sending message to ${this.getSessionName()}:`,
          error,
        );
        this.updateError(`Failed to send message: ${error.message}`);
      }
    }
  }

  public sendRealtimeInput(input: {
    media: { data?: string; mimeType?: string };
  }): void {
    if (!this.session) return;
    try {
      this.session.sendRealtimeInput(input);
    } catch (e) {
      const msg = String((e as Error)?.message || e || "");
      this.updateError(`Failed to stream audio: ${msg}`);
    }
  }

  public get isActive(): boolean {
    return this.session !== null;
  }

  public get sessionInstance(): Session | null {
    return this.session;
  }

  /**
   * Clear any stored session resumption handle so the next init starts fresh.
   */
  public clearResumptionHandle(): void {
    this.currentHandle = null;
    try {
      localStorage.removeItem("gdm:call-session-handle");
    } catch {}
  }
}

class TextSessionManager extends BaseSessionManager {
  protected getResumptionStorageKey(): string | null {
    return "gdm:text-session-handle";
  }
  constructor(
    outputAudioContext: AudioContext,
    outputNode: GainNode,
    client: GoogleGenAI,
    updateStatus: (msg: string) => void,
    updateError: (msg: string) => void,
    onRateLimit: (msg: string) => void = () => {},
    private updateTranscript: (text: string) => void,
    private personaManager: PersonaManager,
  ) {
    super(
      outputAudioContext,
      outputNode,
      client,
      updateStatus,
      updateError,
      onRateLimit,
    );
  }

  protected getCallbacks() {
    const base = super.getCallbacks();
    return {
      ...base,
      onmessage: async (message: LiveServerMessage) => {
        // Always delegate to base to handle resumption/goAway/generationComplete/audio/interruption
        if (typeof base.onmessage === "function") {
          await base.onmessage(message);
        }

        // Handle text response for transcript (after base processing)
        const modelTurn = message.serverContent?.modelTurn;
        if (modelTurn) {
          const lastPart = modelTurn.parts[modelTurn.parts.length - 1];
          const text = lastPart.text;
          if (text) {
            this.updateTranscript(text);
          }
        }
      },
    };
  }

  protected getModel(): string {
    // Align text session with energy levels (TTS); if exhausted (level 0), refuse to provide a model
    const model = energyBarService.getCurrentModel("tts");
    if (!model)
      throw new Error("Energy exhausted: no model available for text session");
    return model;
  }

  protected getConfig(): Record<string, unknown> {
    return {
      responseModalities: [Modality.AUDIO],
      contextWindowCompression: { slidingWindow: {} },
      systemInstruction: this.personaManager.getActivePersona().systemPrompt,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
    };
  }

  protected getSessionName(): string {
    return "Text session";
  }
}

class CallSessionManager extends BaseSessionManager {
  protected getResumptionStorageKey(): string | null {
    return "gdm:call-session-handle";
  }
  constructor(
    outputAudioContext: AudioContext,
    outputNode: GainNode,
    client: GoogleGenAI,
    updateStatus: (msg: string) => void,
    updateError: (msg: string) => void,
    onRateLimit: (msg: string) => void = () => {},
    private updateCallTranscript: (
      text: string,
      speaker: "user" | "model",
    ) => void,
    private personaManager: PersonaManager,
  ) {
    super(
      outputAudioContext,
      outputNode,
      client,
      updateStatus,
      updateError,
      onRateLimit,
    );
  }

  protected getModel(): string {
    // Choose model based on current energy level for STS; if exhausted (0), refuse to start a call
    const model = energyBarService.getCurrentModel("sts");
    if (!model)
      throw new Error("Energy exhausted: no model available for call session");
    return model;
  }

  protected getConfig(): Record<string, unknown> {
    const config = {
      responseModalities: [Modality.AUDIO],
      contextWindowCompression: { slidingWindow: {} },
      outputAudioTranscription: {}, // Enable transcription of model's audio output
      inputAudioTranscription: {}, // Enable transcription of user's audio input
      systemInstruction: this.personaManager.getActivePersona().systemPrompt,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
      // Conditionally enable affective dialog based on STS energy level
      ...(energyBarService.isAffectiveDialogEnabled() && {
        enableAffectiveDialog: true,
      }),
    };

    return config;
  }

  protected getCallbacks() {
    const base = super.getCallbacks();
    return {
      ...base,
      onmessage: async (message: LiveServerMessage) => {
        // Always delegate to base to handle resumption/goAway/generationComplete/audio/interruption
        if (typeof base.onmessage === "function") {
          await base.onmessage(message);
        }

        // Handle audio transcription for call transcript (model responses)
        if (message.serverContent?.outputTranscription?.text) {
          this.updateCallTranscript(
            message.serverContent.outputTranscription.text,
            "model",
          );
        }

        // Handle input transcription for call transcript (user speech)
        if (message.serverContent?.inputTranscription?.text) {
          this.updateCallTranscript(
            message.serverContent.inputTranscription.text,
            "user",
          );
        }
      },
    };
  }

  protected getSessionName(): string {
    return "Call session";
  }
}

type ActiveMode = "texting" | "calling" | null;

const logger = createComponentLogger("GdmLiveAudio");

@customElement("gdm-live-audio")
export class GdmLiveAudio extends LitElement {
  @state() isCallActive = false;
  @state() status = "";
  @state() error = "";
  @state() private _toastVisible = false;
  private _statusHideTimer: ReturnType<typeof setTimeout> | undefined =
    undefined;
  private _statusClearTimer: ReturnType<typeof setTimeout> | undefined =
    undefined;
  @state() showSettings = false;
  @state() toastMessage = "";

  // Track pending user action for API key validation flow
  private pendingAction: (() => void) | null = null;

  // Track current API key for smart change detection
  private currentApiKey: string = "";

  // Dual-context state management
  @state() activeMode: ActiveMode = null;
  @state() textTranscript: Message[] = [];
  @state() callTranscript: Message[] = [];
  @state() textSession: Session | null = null;
  @state() callSession: Session | null = null;
  @state() activeTab: "chat" | "call-history" = "chat";
  @state() callHistory: CallSummary[] = [];

  // Session managers
  private textSessionManager: TextSessionManager;
  private callSessionManager: CallSessionManager;
  private summarizationService: SummarizationService;
  private personaManager: PersonaManager;
  private vectorStore: VectorStore;

  private client: GoogleGenAI;
  private inputAudioContext = new (
    window.AudioContext || window.webkitAudioContext
  )({ sampleRate: 16000 });
  private outputAudioContext = new (
    window.AudioContext || window.webkitAudioContext
  )({ sampleRate: 24000 });
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();

  // Rate-limit UX state for calls
  private _callRateLimitNotified = false;
  // Reconnection toast state to avoid spamming
  private _callReconnectingNotified = false;
  private _textReconnectingNotified = false;

  // Scroll-to-bottom state for call transcript
  @state() private showCallScrollToBottom = false;
  @state() private callNewMessageCount = 0;

  // Scroll-to-bottom state for chat view
  @state() private showChatScrollToBottom = false;
  @state() callState: "idle" | "connecting" | "active" | "ending" = "idle";
  @state() private chatNewMessageCount = 0;
  @state() private isChatActive = false;

  // Audio nodes for each session type
  private textOutputNode = this.outputAudioContext.createGain();
  private callOutputNode = this.outputAudioContext.createGain();

  private mediaStream: MediaStream;
  private sourceNode: MediaStreamAudioSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;

  static styles = css`
    :host {
      display: block;
      position: relative;
      height: 100vh;
      overflow: hidden;
      color: var(--cp-text);
    }

    .live2d-container {
      position: absolute;
      inset: 0;
      z-index: 0;
    }

    .ui-grid {
      display: grid;
      grid-template-columns: 400px 1fr 400px;
      height: 100%;
      position: relative;
      z-index: 1;
    }



    .main-container {
      z-index: 1;
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      opacity: 1;
      visibility: visible;
      transition: opacity 200ms ease, visibility 200ms ease;
    }

    .main-container.hidden {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }

    #status {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 24px;
      z-index: 10;
      display: flex;
      justify-content: center;
      pointer-events: none;
    }
    #status .toast {
      display: inline-block;
      background: var(--cp-surface);
      color: var(--cp-text);
      padding: 8px 12px;
      border-radius: 10px;
      border: 1px solid var(--cp-surface-border);
      font: 17px/1.2 system-ui;
      box-shadow: var(--cp-glow-cyan);
      opacity: 1;
      transform: translateY(0);
      transition: opacity 300ms ease, transform 300ms ease;
      backdrop-filter: blur(6px);
    }
    #status .toast.hide {
      opacity: 0;
      transform: translateY(10px);
    }


  `;

  constructor() {
    super();
    this.personaManager = new PersonaManager();
    this.vectorStore = new VectorStore(
      this.personaManager.getActivePersona().id,
    );
    this.initClient();

    // Debug: Check initial TTS energy state
    logger.debug("Initial TTS energy state", {
      level: energyBarService.getCurrentEnergyLevel("tts"),
      model: energyBarService.getCurrentModel("tts"),
    });

    // Initial TTS greeting is now triggered in firstUpdated
  }

  private _triggerInitialTTSGreeting() {
    const ttsLevel = energyBarService.getCurrentEnergyLevel("tts");
    const personaName = this.personaManager.getActivePersona().name;

    logger.debug("Triggering initial TTS greeting", { ttsLevel, personaName });

    if (ttsLevel === 2) {
      const prompt = this.personaManager.getPromptForEnergyLevel(
        2,
        personaName,
        "tts",
      );

      logger.debug("Generated initial TTS greeting", { prompt });

      if (prompt) {
        this._appendTextMessage(prompt, "model");
        logger.debug("Injected initial greeting into chat");
      }
    }
  }

  private initSessionManagers() {
    // Initialize session managers after client is ready
    if (this.client) {
      this.textSessionManager = new TextSessionManager(
        this.outputAudioContext,
        this.textOutputNode,
        this.client,
        this.updateStatus.bind(this),
        this.updateError.bind(this),
        this._handleTextRateLimit.bind(this),
        this.updateTextTranscript.bind(this),
        this.personaManager,
      );
      this.callSessionManager = new CallSessionManager(
        this.outputAudioContext,
        this.callOutputNode,
        this.client,
        this.updateStatus.bind(this),
        this.updateError.bind(this),
        this._handleCallRateLimit.bind(this),
        this.updateCallTranscript.bind(this),
        this.personaManager,
      );
      this.summarizationService = new SummarizationService(this.client);
    }
  }

  private initAudio() {
    // Audio initialization is now handled by individual session managers
    // Each session manager maintains its own isolated audio timeline
  }

  private async initClient() {
    this.initAudio();

    // Always initialize with texting mode by default (main UI)
    this.activeMode = "texting";

    // Connect both session output nodes to the main audio destination
    this.textOutputNode.connect(this.outputAudioContext.destination);
    this.callOutputNode.connect(this.outputAudioContext.destination);
    this._updateActiveOutputNode();

    const apiKey = localStorage.getItem("gemini-api-key");
    if (!apiKey) {
      // Don't show settings menu on startup - just clear any error/status
      this.error = "";
      this.status = "";
      this.currentApiKey = ""; // Track empty API key
      // Main UI will be shown by default, API key check will happen when user tries to interact
      return;
    }

    // Initialize Google GenAI client if API key exists
    this.client = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    // Track the current API key for smart change detection
    this.currentApiKey = apiKey;

    // Initialize session managers after client is ready
    this.initSessionManagers();

    // Sessions will be created lazily when user actually interacts
  }

  private _updateActiveOutputNode() {
    // Update the main outputNode to point to the active session's output node
    if (this.activeMode === "texting") {
      this.outputNode = this.textOutputNode;
    } else if (this.activeMode === "calling") {
      this.outputNode = this.callOutputNode;
    }
    // Trigger a re-render to pass the updated outputNode to live2d-gate
    this.requestUpdate();
  }

  private async _initTextSession() {
    const ok = await this.textSessionManager.initSession();
    this.textSession = this.textSessionManager.sessionInstance;
    return ok;
  }

  private async _initCallSession() {
    logger.debug("Initializing new call session.");
    const ok = await this.callSessionManager.initSession();
    this.callSession = this.callSessionManager.sessionInstance;
    return ok;
  }

  private updateStatus(msg: string) {
    this.status = msg;
    // Reset timers and show toast
    if (this._statusHideTimer) clearTimeout(this._statusHideTimer);
    if (this._statusClearTimer) clearTimeout(this._statusClearTimer);
    this._toastVisible = true;

    // Show for 3s, then fade out 300ms, then clear text
    if (!this.error && msg && msg !== " ") {
      this._statusHideTimer = setTimeout(() => {
        this._toastVisible = false; // triggers fade-out via CSS transition
        this._statusClearTimer = setTimeout(() => {
          this.status = "";
        }, 300);
      }, 3000);
    }
  }

  private updateError(msg: string) {
    this.error = msg;
    // Non-silent failure during calls on rate limit
    const isRateLimited = /rate[- ]?limit|quota/i.test(msg || "");
    if (isRateLimited && this.isCallActive) {
      this._handleCallRateLimit(msg);
    }
  }

  private updateTextTranscript(text: string) {
    const lastTurn = this.textTranscript[this.textTranscript.length - 1];
    if (lastTurn?.sender === "model") {
      lastTurn.text += text;
      this.requestUpdate("textTranscript");
    } else {
      this.textTranscript = [
        ...this.textTranscript,
        {
          text,
          sender: "model",
          id: Date.now().toString(),
          timestamp: new Date(),
        },
      ];
    }
  }

  private updateCallTranscript(text: string, sender: "user" | "model") {
    logger.debug(`Received ${sender} text:`, text);

    // For audio transcription, we get incremental chunks that should be appended
    const lastTurn = this.callTranscript[this.callTranscript.length - 1];

    if (lastTurn?.sender === sender) {
      // Append to the existing turn by creating a new array
      // This ensures Lit detects the change
      const updatedTranscript = [...this.callTranscript];
      updatedTranscript[updatedTranscript.length - 1] = {
        ...lastTurn,
        text: lastTurn.text + text,
      };
      this.callTranscript = updatedTranscript;
    } else {
      // Create a new turn for this author
      this.callTranscript = [
        ...this.callTranscript,
        {
          text,
          sender,
          id: Date.now().toString(),
          timestamp: new Date(),
        },
      ];
    }
  }

  private _appendCallNotice(text: string) {
    // Append a system-style notice to the call transcript to avoid silent failures
    const notice: Message & { isSystemMessage?: boolean } = {
      text,
      sender: "model" as const,
      id: Date.now().toString(),
      timestamp: new Date(),
      isSystemMessage: true,
    };
    this.callTranscript = [...this.callTranscript, notice];
  }

  private _appendTextMessage(text: string, sender: "user" | "model") {
    // Append a message directly to the text transcript
    logger.debug("Appending text message", {
      text,
      sender,
      currentLength: this.textTranscript.length,
    });

    this.textTranscript = [
      ...this.textTranscript,
      { text, sender, id: Date.now().toString(), timestamp: new Date() },
    ];

    logger.debug("Text message appended", {
      newLength: this.textTranscript.length,
      lastMessage: this.textTranscript[this.textTranscript.length - 1],
    });

    // Force a re-render to ensure the UI updates
    this.requestUpdate("textTranscript");
  }

  private _handleCallRateLimit(_msg?: string) {
    // Degrade only STS energy and notify UI
    energyBarService.handleRateLimitError("sts");
    if (this._callRateLimitNotified) return;
    this._callRateLimitNotified = true;

    // Also surface the banner in the call transcript
    const callT = this.shadowRoot?.querySelector(
      "call-transcript",
    ) as HTMLElement & { rateLimited?: boolean };
    if (callT) {
      callT.rateLimited = true;
    }
  }

  private _handleTextRateLimit(_msg?: string) {
    // Degrade only TTS energy on text rate-limit
    energyBarService.handleRateLimitError("tts");
    const toast = this.shadowRoot?.querySelector(
      "toast-notification",
    ) as ToastNotification;
    toast?.show("Rate limit reached. Please wait a moment.", "warning", 3000);
  }

  private async _handleCallStart() {
    // On new call session, reset STS energy
    energyBarService.resetEnergyLevel("session-reset", "sts");
    if (this.isCallActive) return;

    // Check API key presence before proceeding
    if (!this._checkApiKeyExists()) {
      this._showApiKeyPrompt(() => this._handleCallStart());
      return;
    }

    logger.debug("Call start. Existing callSession:", this.callSession);
    // Switch to calling mode
    this.activeMode = "calling";
    this.callState = "connecting";
    this._updateActiveOutputNode();

    // First attempt to resume an existing call session using stored handle
    const persistedHandle = localStorage.getItem("gdm:call-session-handle");
    let resumed = false;
    if (persistedHandle) {
      // Resume path: try to restore previous call transcript from the last call summary if available
      try {
        const lastSummary = this.callHistory?.[0];
        if (lastSummary?.transcript?.length) {
          this.callTranscript = [...lastSummary.transcript];
        }
      } catch {}

      const toast = this.shadowRoot?.querySelector(
        "toast-notification#inline-toast",
      ) as ToastNotification;
      toast?.show("Resuming previous call session…", "info", 2000, {
        position: "bottom-right",
        variant: "standard",
      });
      const okResume =
        await this.callSessionManager.initSession(persistedHandle);
      if (okResume && this.callSessionManager.sessionInstance) {
        resumed = true;
      }
    }

    // If not resumed, create a new session
    if (!resumed) {
      // New session path: clear UI transcript to reflect a fresh call
      this.callTranscript = [];
      const ok = await this._initCallSession();
      if (!ok || !this.callSession) {
        // If energy is exhausted, reflect a different UX than rate limit
        const exhausted = energyBarService.getCurrentEnergyLevel() === 0;
        if (exhausted) {
          this.updateStatus("Energy exhausted — please try again later.");
        } else {
          this._handleCallRateLimit("Call session init failed");
          this.updateStatus(
            "Unable to start call (rate limited or network error)",
          );
        }
        return;
      }
      const toast = this.shadowRoot?.querySelector(
        "toast-notification#inline-toast",
      ) as ToastNotification;
      toast?.show("Started a new call session", "success", 1500, {
        position: "bottom-right",
        variant: "standard",
      });
    } else {
      const toast = this.shadowRoot?.querySelector(
        "toast-notification#inline-toast",
      ) as ToastNotification;
      toast?.show("Resumed previous call session", "success", 1200, {
        position: "bottom-right",
        variant: "standard",
      });
    }

    this.inputAudioContext.resume();
    this.updateStatus("Starting call...");

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus("");
      this.callState = "active";

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 1024;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isCallActive) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);
        // Send audio to the active call session using session manager
        if (this.activeMode === "calling" && this.callSession) {
          try {
            this.callSessionManager.sendRealtimeInput({
              media: createBlob(pcmData),
            });
          } catch (e) {
            const msg = String((e as Error)?.message || e || "");
            this.updateError(`Failed to stream audio: ${msg}`);
          }
        }
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isCallActive = true;

      // Dispatch call-start event
      this.dispatchEvent(
        new CustomEvent("call-start", {
          bubbles: true,
          composed: true,
        }),
      );

      this.updateStatus("📞 Call active");
    } catch (err) {
      console.error("Error starting call:", err);
      this.updateStatus(`Error: ${err.message}`);
      this._handleCallEnd();
    }
  }

  private async _handleCallEnd() {
    if (!this.isCallActive && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus("");
    this.callState = "ending";

    this.isCallActive = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    // Switch back to texting mode
    this.activeMode = "texting";
    this._updateActiveOutputNode();

    // Summarize the call
    const transcriptToSummarize = [...this.callTranscript];
    this.callTranscript = [];
    const summary = await this.summarizationService.summarize(
      transcriptToSummarize,
    );
    if (summary) {
      this._handleSummarizationComplete(summary, transcriptToSummarize);
    }

    // Text session will be lazily initialized when user sends first message

    // Dispatch call-end event
    this.dispatchEvent(
      new CustomEvent("call-end", {
        bubbles: true,
        composed: true,
      }),
    );

    this.updateStatus("");
    this.callState = "idle";
    logger.debug("Call ended. callSession preserved:", this.callSession);
  }

  private _resetTextContext() {
    // Close existing text session using session manager
    if (this.textSessionManager) {
      this.textSessionManager.closeSession();
      this.textSession = null;
    }

    // Clear text transcript
    this.textTranscript = [];

    // Text session will be lazily initialized when user sends next message
    this.updateStatus("Text conversation cleared.");
  }

  private _resetCallContext() {
    // Also clear the persisted resumption handle so the next call starts fresh
    try {
      this.callSessionManager?.clearResumptionHandle();
    } catch {}
    // Reset reconnection toast guard
    this._callReconnectingNotified = false;
    logger.debug("Resetting call context. Closing session.");
    // Close existing call session using session manager
    if (this.callSessionManager) {
      this.callSessionManager.closeSession();
      this.callSession = null;
    }

    // Clear call transcript and reset rate-limit states
    this.callTranscript = [];
    this._callRateLimitNotified = false;
    const callT = this.shadowRoot?.querySelector(
      "call-transcript",
    ) as HTMLElement & { rateLimited?: boolean };
    if (callT) {
      callT.rateLimited = false;
    }

    // Reinitialize call session if we're currently in a call
    if (this.isCallActive) {
      this._initCallSession();
    }
    this.updateStatus("Call conversation cleared.");
    // Reuse the existing call-start toasts when the next call starts (resume-first flow).
    // No additional toast here to avoid redundancy.
  }

  private _toggleSettings() {
    this.showSettings = !this.showSettings;
  }

  private _checkApiKeyExists(): boolean {
    const apiKey = localStorage.getItem("gemini-api-key");
    return apiKey !== null && apiKey.trim() !== "";
  }

  private _getApiKeyPrompt(): string {
    const activePersona = this.personaManager.getActivePersona();
    if (activePersona.name === "Assistant") {
      return "Please provide your API key from AI Studio to proceed with the task.";
    } else if (activePersona.name === "VTuber") {
      return "P-please tell me ur API key from AI Studio 👉🏻👈🏻";
    } else {
      // Generic prompt for custom personas
      return "Please provide your API key from AI Studio to continue.";
    }
  }

  private _showApiKeyPrompt(pendingAction?: () => void) {
    // Store the pending action to execute after API key is saved
    this.pendingAction = pendingAction || null;

    // Open settings menu and show toast prompting for API key
    this.showSettings = true;
    const globalToast = this.shadowRoot?.querySelector(
      "#global-toast",
    ) as ToastNotification;
    globalToast?.show(this._getApiKeyPrompt(), "info", 4000, {
      position: "top-right",
    });
  }

  private async _handleApiKeySaved() {
    // Show success toast for API key saved
    const globalToast = this.shadowRoot?.querySelector(
      "#global-toast",
    ) as ToastNotification;
    globalToast?.show("API key saved successfully! ✨", "success", 2500, {
      position: "top-right",
    });

    logger.info("API key saved, reinitializing client");

    // Reinitialize the client with the new API key
    await this.initClient();

    // Close settings menu and toast when API key is saved
    this.showSettings = false;

    // Execute the pending action if there is one
    if (this.pendingAction) {
      const action = this.pendingAction;
      this.pendingAction = null; // Clear the pending action

      // Execute the action now that the client is initialized
      action();
    }
  }

  private _handleApiKeyChanged() {
    // Get the new API key from localStorage
    const newApiKey = localStorage.getItem("gemini-api-key") || "";

    // Smart change detection - avoid unnecessary reinitialization
    if (newApiKey === this.currentApiKey) {
      logger.debug(
        "API key unchanged, skipping reinitialization:",
        newApiKey ? `***${newApiKey.slice(-4)}` : "empty",
      );
      return; // Silently skip - no toast needed
    }

    // Show toast notification for API key change
    const toast = this.shadowRoot?.querySelector(
      "toast-notification",
    ) as ToastNotification;
    if (toast) {
      if (newApiKey) {
        toast.show("API key updated successfully! ✨", "info", 3000);
      } else {
        toast.show("API key cleared", "info", 3000);
      }
    }

    logger.info("API key changed, reinitializing client");

    // Reinitialize the client with the new API key
    this.initClient();
  }

  private _handleModelUrlChanged() {
    // This method is now handled by persona changes
    // Live2D model URL changes are managed through the PersonaManager
    logger.debug("Model URL change handled via persona system");

    // Trigger a re-render to update the Live2D component with the new persona's model URL
    this.requestUpdate();
  }

  private _handleLive2dLoaded() {
    logger.info("Live2D Success] Model loaded successfully");

    // Show success toast notification
    const toast = this.shadowRoot?.querySelector(
      "toast-notification",
    ) as ToastNotification;
    if (toast) {
      toast.show("Live2D model loaded successfully! ✨", "success", 3000);
    }
  }

  private _handleModelUrlError(e: CustomEvent) {
    const errorMessage = e.detail?.error || "Live2D URL validation failed";
    logger.error("[Model URL Error]", errorMessage);

    // Show error toast notification
    const toast = this.shadowRoot?.querySelector(
      "toast-notification",
    ) as ToastNotification;
    if (toast) {
      toast.show(errorMessage, "error", 4000);
    }
  }

  private _handleLive2dError(e: CustomEvent) {
    const errorMessage = e.detail?.error || "Failed to load Live2D model";
    logger.error("[Live2D Error]", errorMessage);

    // Show error toast notification
    const toast = this.shadowRoot?.querySelector(
      "toast-notification",
    ) as ToastNotification;
    if (toast) {
      toast.show(`Live2D model failed to load: ${errorMessage}`, "error", 5000);
    }
  }

  private async _handlePersonaChanged() {
    const activePersona = this.personaManager.getActivePersona();
    if (activePersona) {
      await this.vectorStore.switchPersona(activePersona.id);

      // Disconnect the active TextSessionManager to apply the new system prompt
      if (this.textSessionManager) {
        this.textSessionManager.closeSession();
        this.textSession = null;
      }
      this.textTranscript = [];

      const toast = this.shadowRoot?.querySelector(
        "toast-notification",
      ) as ToastNotification;
      if (toast) {
        toast.show(
          `Switched to ${activePersona.name}. Loading model...`,
          "info",
          4000,
        );
      }

      // Trigger a re-render to update the Live2D component with the new persona's model URL
      this.requestUpdate();
    }
  }

  private _handleTabSwitch(e: CustomEvent) {
    this.activeTab = e.detail.tab;
  }

  private _handleSummarizationComplete(summary: string, transcript: Message[]) {
    const newSummary: CallSummary = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      summary,
      transcript: transcript,
    };
    this.callHistory = [newSummary, ...this.callHistory];
  }

  private async _startTtsFromSummary(e: CustomEvent) {
    const summary = e.detail.summary as CallSummary;
    const message = `Tell me more about our call regarding "${summary.summary}"`;

    // Check API key presence before proceeding. If the key is missing, this
    // method will be re-invoked after the key is provided via the pendingAction
    // mechanism.
    if (!this._checkApiKeyExists()) {
      const action = () => this._startTtsFromSummary(e);
      this._showApiKeyPrompt(action);
      return;
    }

    // Immediately switch to the chat tab to provide user feedback
    this.activeTab = "chat";

    // Clear the previous text chat context. This clears the transcript and
    // ensures we start with a fresh session.
    this._resetTextContext();

    // Add the summary prompt as the first "user" message in the new conversation
    this.textTranscript = [
      ...this.textTranscript,
      {
        text: message,
        sender: "user",
        id: Date.now().toString(),
        timestamp: new Date(),
      },
    ];

    // A new session must be initialized. Show status while this happens.
    this.updateStatus("Initializing text session...");
    const ok = await this._initTextSession();

    // If session initialization fails, show an error and abort.
    if (!ok) {
      this.updateError(
        "Unable to start text session (rate limited or network error)",
      );
      return;
    }

    // With an active session, send the message to start the TTS flow.
    this.textSessionManager.sendMessage(message);
  }

  private _scrollCallTranscriptToBottom() {
    // Find the call transcript component and scroll it to bottom
    const callTranscript = this.shadowRoot?.querySelector("call-transcript") as
      | (HTMLElement & { scrollToBottom?: () => void })
      | null;
    if (callTranscript?.scrollToBottom) {
      callTranscript.scrollToBottom();
      // Reset the scroll state
      this.showCallScrollToBottom = false;
      this.callNewMessageCount = 0;
    }
  }

  private _scrollChatToBottom() {
    const chatView = this.shadowRoot?.querySelector("chat-view") as
      | (HTMLElement & { _scrollToBottom?: () => void })
      | null;
    if (chatView?._scrollToBottom) {
      chatView._scrollToBottom();
      this.showChatScrollToBottom = false;
      this.chatNewMessageCount = 0;
    }
  }

  private _handleCallScrollStateChanged(e: CustomEvent) {
    // Update the main component's scroll state based on call transcript scroll state
    const { showButton, newMessageCount } = e.detail;
    this.showCallScrollToBottom = showButton;
    this.callNewMessageCount = newMessageCount;
  }

  private _handleChatScrollStateChanged(e: CustomEvent) {
    const { showButton, newMessageCount } = e.detail;
    this.showChatScrollToBottom = showButton;
    this.chatNewMessageCount = newMessageCount;
  }

  private _handleChatActiveChanged(e: CustomEvent) {
    this.isChatActive = e.detail.isChatActive;
  }

  private async _handleSendMessage(e: CustomEvent) {
    const message = e.detail;
    if (!message || !message.trim()) {
      return;
    }

    // Check API key presence before proceeding
    if (!this._checkApiKeyExists()) {
      this._showApiKeyPrompt(() => this._handleSendMessage(e));
      return;
    }

    // Add message to text transcript
    this.textTranscript = [
      ...this.textTranscript,
      {
        text: message,
        sender: "user",
        id: Date.now().toString(),
        timestamp: new Date(),
      },
    ];

    // Ensure we have an active text session
    if (!this.textSession) {
      this.updateStatus("Initializing text session...");
      const ok = await this._initTextSession();
      if (!ok || !this.textSession) {
        this.updateError(
          "Unable to start text session (rate limited or network error)",
        );
        return;
      }
    }

    // Send message to text session using session manager
    if (this.textSession) {
      try {
        this.textSessionManager.sendMessage(message);
      } catch (error) {
        logger.error("Error sending message to text session:", error);
        const msg = String((error as Error)?.message || error || "");
        this.updateError(`Failed to send message: ${msg}`);

        // Try to reinitialize the session and abort if still failing
        const ok = await this._initTextSession();
        if (!ok) {
          return;
        }
      }
    } else {
      this.updateError("Text session not available");
    }
  }

  connectedCallback() {
    // Subscribe to energy level changes to surface persona-specific prompts
    energyBarService.addEventListener(
      "energy-level-changed",
      this._onEnergyLevelChanged as EventListener,
    );
    super.connectedCallback();
    window.addEventListener(
      "persona-changed",
      this._handlePersonaChanged.bind(this),
    );
  }

  disconnectedCallback() {
    energyBarService.removeEventListener(
      "energy-level-changed",
      this._onEnergyLevelChanged as EventListener,
    );
    super.disconnectedCallback();
    window.removeEventListener(
      "persona-changed",
      this._handlePersonaChanged.bind(this),
    );
  }

  protected firstUpdated() {
    // Trigger initial TTS greeting once the UI is ready
    this._triggerInitialTTSGreeting();
  }

  private _onEnergyLevelChanged = (e: Event) => {
    const { level, reason, mode } = (e as CustomEvent<EnergyLevelChangedDetail>)
      .detail;

    // Debug logging
    logger.debug(`Energy level changed`, { mode, level, reason });

    if (level < 3) {
      const personaName = this.personaManager.getActivePersona().name;
      // STS: show immersive prompts as directed; TTS: inject into chat or show as toast
      const prompt = this.personaManager.getPromptForEnergyLevel(
        level as 0 | 1 | 2 | 3,
        personaName,
        mode,
      );

      logger.debug(`Generated prompt for energy level`, {
        mode,
        level,
        personaName,
        prompt,
      });

      if (prompt && mode === "sts") {
        this._appendCallNotice(prompt);
        logger.debug(`Appended STS call notice`, { prompt });
      } else if (prompt && mode === "tts" && level < 2) {
        // Only inject prompts for degraded/exhausted states.
        this._appendTextMessage(prompt, "model");
        logger.debug(`Appended TTS text message`, { prompt });
      }
    }

    // If we are in an active call and rate-limited, reconnect with the downgraded model
    if (
      this.activeMode === "calling" &&
      this.isCallActive &&
      reason === "rate-limit-exceeded" &&
      mode === "sts"
    ) {
      this.updateStatus("Rate limited — switching to a lower tier...");
      // Re-initialize the call session to apply the downgraded model
      this._initCallSession();
    }
  };

  render() {
    return html`
      <div class="live2d-container">
        <live2d-gate
          .modelUrl=${this.personaManager.getActivePersona().live2dModelUrl || ""}
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}
          @live2d-loaded=${this._handleLive2dLoaded}
          @live2d-error=${this._handleLive2dError}
        ></live2d-gate>
      </div>
      <div class="ui-grid">

        <div class="main-container ${this.activeMode === "calling" ? "hidden" : ""}">
          <tab-view
            .activeTab=${this.activeTab}
            .visible=${this.activeMode !== "calling"}
            @tab-switch=${this._handleTabSwitch}
          ></tab-view>
          ${
            this.activeTab === "chat"
              ? html`
                  <chat-view
                    .transcript=${this.textTranscript}
                    .visible=${this.activeMode !== "calling"}
                    @send-message=${this._handleSendMessage}
                    @reset-text=${this._resetTextContext}
                    @scroll-state-changed=${this._handleChatScrollStateChanged}
                    @chat-active-changed=${this._handleChatActiveChanged}
                  >
                  </chat-view>
                `
              : html`
                  <call-history-view
                    .callHistory=${this.callHistory}
                    @start-tts-from-summary=${this._startTtsFromSummary}
                  >
                  </call-history-view>
                `
          }
        </div>

        <div>
          ${
            this.showSettings
              ? html`<settings-menu
                  .apiKey=${localStorage.getItem("gemini-api-key") || ""}
                  @close=${() => {
                    this.showSettings = false;
                  }}
                  @api-key-saved=${this._handleApiKeySaved}
                  @api-key-changed=${this._handleApiKeyChanged}
                  @model-url-changed=${this._handleModelUrlChanged}
                  @model-url-error=${this._handleModelUrlError}
                  @persona-changed=${this._handlePersonaChanged}
                ></settings-menu>`
              : ""
          }
          <controls-panel
            .isCallActive=${this.isCallActive}
            .isChatActive=${this.isChatActive}
            .showCallScrollToBottom=${this.showCallScrollToBottom}
            .callNewMessageCount=${this.callNewMessageCount}
            .showChatScrollToBottom=${this.showChatScrollToBottom}
            .chatNewMessageCount=${this.chatNewMessageCount}
            @toggle-settings=${this._toggleSettings}
            @scroll-call-to-bottom=${this._scrollCallTranscriptToBottom}
            @scroll-chat-to-bottom=${this._scrollChatToBottom}
            @call-start=${this._handleCallStart}
            @call-end=${this._handleCallEnd}
          >
          </controls-panel>

          <toast-notification id="inline-toast" position="bottom-center" variant="inline"></toast-notification>
          <toast-notification id="global-toast" position="top-right"></toast-notification>
        </div>

        <call-transcript
          .transcript=${this.callTranscript}
          .visible=${this.activeMode === "calling"}
          .activePersonaName=${this.personaManager.getActivePersona().name}
          .callState=${this.callState}
          @reset-call=${this._resetCallContext}
          @scroll-state-changed=${this._handleCallScrollStateChanged}
        ></call-transcript>
      </div>
    `;
  }
}
