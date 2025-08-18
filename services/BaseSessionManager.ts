import {
  type ComponentLogger,
  createComponentLogger,
  DebugLogger,
} from "./DebugLogger";

/**
 * Represents a message in the session
 */
export interface Message {
  id: string;
  sender: "user" | "model";
  text: string;
  timestamp: Date;
}

/**
 * Session state tracking
 */
export interface SessionState {
  sessionId: string;
  resumptionToken: string | null;
  currentModel: string;
  isActive: boolean;
  connectionAttempts: number;
}

/**
 * Configuration for session initialization
 */
export interface SessionConfig {
  model: string;
  context?: string;
  enableResumption?: boolean;
  maxReconnectAttempts?: number;
}

/**
 * Events that can be emitted by session managers
 */
export type SessionEvent =
  | { type: "session-started"; sessionId: string }
  | { type: "session-ended"; sessionId: string }
  | { type: "session-resumed"; sessionId: string; token: string }
  | { type: "go-away"; timeLeft: number }
  | { type: "rate-limit-error"; error: Error }
  | { type: "network-error"; error: Error; willRetry: boolean }
  | { type: "reconnecting"; attempt: number }
  | { type: "message-received"; message: Message };

/**
 * Abstract base class for session management
 * Provides common functionality for both TextSessionManager and CallSessionManager
 */
export abstract class BaseSessionManager {
  protected logger: ComponentLogger;
  protected sessionState: SessionState | null = null;
  protected eventListeners: Map<string, Set<(event: SessionEvent) => void>> =
    new Map();
  protected reconnectTimer: number | null = null;

  // Configuration
  protected readonly MAX_RECONNECT_ATTEMPTS = 3;
  protected readonly RECONNECT_DELAY_MS = 2000;
  protected readonly RESUMPTION_TOKEN_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours

  constructor(protected componentName: string) {
    this.logger = createComponentLogger(componentName);
  }

  /**
   * Start a new session or resume an existing one
   */
  async startSession(config: SessionConfig): Promise<void> {
    try {
      this.logger.info("Starting session", { config });

      // Check if we have a valid resumption token
      const resumptionToken = this.getValidResumptionToken();

      if (resumptionToken && config.enableResumption) {
        this.logger.info("Attempting to resume session", {
          token: resumptionToken,
        });
        await this.resumeSession(config, resumptionToken);
      } else {
        await this.createNewSession(config);
      }

      this.emitEvent({
        type: "session-started",
        sessionId: this.sessionState!.sessionId,
      });
    } catch (error) {
      this.logger.error("Failed to start session", error);
      throw error;
    }
  }

  /**
   * End the current session
   */
  endSession(): void {
    if (!this.sessionState) {
      this.logger.warn("No active session to end");
      return;
    }

    this.logger.info("Ending session", {
      sessionId: this.sessionState.sessionId,
    });

    // Clear any pending reconnection attempts
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const sessionId = this.sessionState.sessionId;

    // Perform cleanup specific to the session type
    this.performSessionCleanup();

    // Clear session state but keep resumption token in memory
    const resumptionToken = this.sessionState.resumptionToken;
    this.sessionState = null;

    // Store resumption token with timestamp for expiry checking
    if (resumptionToken) {
      this.storeResumptionToken(resumptionToken);
    }

    this.emitEvent({
      type: "session-ended",
      sessionId,
    });
  }

  /**
   * Set or update the resumption token for the current session
   */
  setResumptionToken(token: string): void {
    if (!this.sessionState) {
      this.logger.warn("Cannot set resumption token without active session");
      return;
    }

    this.logger.debug("Updating resumption token", { token });
    this.sessionState.resumptionToken = token;
    this.storeResumptionToken(token);
  }

  /**
   * Handle GoAway message from the server
   */
  protected handleGoAwayMessage(timeLeft: number): void {
    this.logger.warn("Received GoAway message", { timeLeft });

    this.emitEvent({
      type: "go-away",
      timeLeft,
    });

    // Prepare for reconnection if we have a resumption token
    if (this.sessionState?.resumptionToken) {
      this.scheduleReconnection(timeLeft);
    }
  }

  /**
   * Handle network errors with automatic reconnection
   */
  protected async handleNetworkError(error: Error): Promise<void> {
    if (!this.sessionState) {
      this.logger.error("Network error without active session", error);
      return;
    }

    this.sessionState.connectionAttempts++;
    const willRetry =
      this.sessionState.connectionAttempts < this.MAX_RECONNECT_ATTEMPTS &&
      !!this.sessionState.resumptionToken;

    this.logger.error("Network error occurred", {
      error: error.message,
      attempt: this.sessionState.connectionAttempts,
      willRetry,
    });

    this.emitEvent({
      type: "network-error",
      error,
      willRetry,
    });

    if (willRetry) {
      await this.attemptReconnection();
    } else {
      this.endSession();
    }
  }

  /**
   * Handle rate limit errors
   */
  protected handleRateLimitError(error: Error): void {
    this.logger.error("Rate limit error", { error: error.message });

    this.emitEvent({
      type: "rate-limit-error",
      error,
    });

    // Don't end the session on rate limit, let the InteractionManager handle it
  }

  /**
   * Attempt to reconnect using the stored resumption token
   */
  private async attemptReconnection(): Promise<void> {
    if (!this.sessionState?.resumptionToken) {
      this.logger.warn("Cannot reconnect without resumption token");
      return;
    }

    this.emitEvent({
      type: "reconnecting",
      attempt: this.sessionState.connectionAttempts,
    });

    // Wait before attempting reconnection
    await new Promise((resolve) =>
      setTimeout(resolve, this.RECONNECT_DELAY_MS),
    );

    try {
      await this.reconnectSession();

      // Reset connection attempts on successful reconnection
      this.sessionState.connectionAttempts = 0;

      this.emitEvent({
        type: "session-resumed",
        sessionId: this.sessionState.sessionId,
        token: this.sessionState.resumptionToken,
      });
    } catch (error) {
      this.logger.error("Reconnection failed", {
        error: (error as Error).message,
      });
      await this.handleNetworkError(error as Error);
    }
  }

  /**
   * Schedule a reconnection attempt before the connection is terminated
   */
  private scheduleReconnection(timeLeft: number): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Schedule reconnection 500ms before the connection is terminated
    const reconnectIn = Math.max(0, timeLeft - 500);

    this.logger.info("Scheduling reconnection", { reconnectIn });

    this.reconnectTimer = setTimeout(() => {
      this.attemptReconnection();
    }, reconnectIn) as unknown as number;
  }

  /**
   * Add an event listener
   */
  addEventListener(
    eventType: SessionEvent["type"],
    listener: (event: SessionEvent) => void,
  ): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(listener);
  }

  /**
   * Remove an event listener
   */
  removeEventListener(
    eventType: SessionEvent["type"],
    listener: (event: SessionEvent) => void,
  ): void {
    this.eventListeners.get(eventType)?.delete(listener);
  }

  /**
   * Emit an event to all registered listeners
   */
  protected emitEvent(event: SessionEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => listener(event));
    }
  }

  /**
   * Get the current session state
   */
  getSessionState(): SessionState | null {
    return this.sessionState;
  }

  /**
   * Check if a session is currently active
   */
  isSessionActive(): boolean {
    return this.sessionState?.isActive ?? false;
  }

  // In-memory storage for resumption tokens
  private static resumptionTokenStore: Map<
    string,
    { token: string; timestamp: number }
  > = new Map();

  /**
   * Store a resumption token with timestamp
   */
  private storeResumptionToken(token: string): void {
    BaseSessionManager.resumptionTokenStore.set(this.componentName, {
      token,
      timestamp: Date.now(),
    });
  }

  /**
   * Get a valid resumption token if one exists and hasn't expired
   */
  private getValidResumptionToken(): string | null {
    const stored = BaseSessionManager.resumptionTokenStore.get(
      this.componentName,
    );

    if (!stored) {
      return null;
    }

    const isExpired =
      Date.now() - stored.timestamp > this.RESUMPTION_TOKEN_EXPIRY_MS;

    if (isExpired) {
      this.logger.debug("Resumption token expired");
      BaseSessionManager.resumptionTokenStore.delete(this.componentName);
      return null;
    }

    return stored.token;
  }

  // Abstract methods to be implemented by subclasses

  /**
   * Create a new session with the given configuration
   */
  protected abstract createNewSession(config: SessionConfig): Promise<void>;

  /**
   * Resume an existing session using a resumption token
   */
  protected abstract resumeSession(
    config: SessionConfig,
    token: string,
  ): Promise<void>;

  /**
   * Reconnect to an existing session
   */
  protected abstract reconnectSession(): Promise<void>;

  /**
   * Perform cleanup specific to the session type
   */
  protected abstract performSessionCleanup(): void;
}
