import { defaultAutoScroll } from "@components/TranscriptAutoScroll";
import { createComponentLogger } from "@services/DebugLogger";
import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "@features/tts/TtsEnergyBar";

interface Turn {
  text: string;
  author: "user" | "model";
}

const log = createComponentLogger("ChatView");

@customElement("chat-view")
export class ChatView extends LitElement {
  @property({ type: Array })
  transcript: Turn[] = [];

  @property({ type: Boolean })
  visible: boolean = true;

  @state()
  private inputValue = "";

  @state()
  private newMessageCount = 0;

  @state()
  private isChatActive = false;

  private lastSeenMessageCount = 0;
  private textareaRef: HTMLTextAreaElement | null = null;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      width: 100%;
      min-width: 300px;
      box-sizing: border-box;
      padding: 12px;
      gap: 12px;
      color: var(--cp-text);
      opacity: 1;
      visibility: visible;
      transition: opacity 0.3s ease, visibility 0.3s ease;
    }

    :host([hidden]) {
      opacity: 0;
      visibility: hidden;
    }

    .transcript {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scrollbar-width: thin;
      scrollbar-color: var(--cp-surface-strong) var(--cp-surface);
      -webkit-overflow-scrolling: touch;
    }

    /* Custom scrollbar styles for Webkit browsers */
    .transcript::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    .transcript::-webkit-scrollbar-track {
      background-color: var(--cp-surface);
      border-radius: 4px;
    }

    .transcript::-webkit-scrollbar-thumb {
      background-color: var(--cp-surface-strong);
      border-radius: 4px;
      border: 1px solid transparent;
      background-clip: content-box;
    }

    .transcript::-webkit-scrollbar-thumb:hover {
      background-color: var(--cp-cyan);
      box-shadow: var(--cp-glow-cyan);
    }

    .turn {
      padding: 8px 12px;
      border-radius: 10px;
      max-width: 80%;
      font: 16px/1.4 system-ui;
      white-space: pre-wrap;
      border: 1px solid var(--cp-surface-border);
      background: var(--cp-surface);
    }

    .turn.user {
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.18), rgba(124, 77, 255, 0.18));
      border-color: rgba(0, 229, 255, 0.35);
      box-shadow: var(--cp-glow-cyan);
      color: var(--cp-text);
      align-self: flex-end;
    }

    .turn.model {
      background: linear-gradient(135deg, rgba(255, 0, 229, 0.16), rgba(124, 77, 255, 0.16));
      border-color: rgba(255, 0, 229, 0.3);
      box-shadow: var(--cp-glow-magenta);
      color: var(--cp-text);
      align-self: flex-start;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--cp-surface);
      border-radius: 10px;
      border: 1px solid var(--cp-surface-border);
      box-shadow: var(--cp-glow-cyan);
      color: var(--cp-text);
      font: 14px/1.4 system-ui;
      font-weight: 500;
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .message-icon {
      width: 16px;
      height: 16px;
    }

    .reset-button {
      outline: none;
      border: 1px solid var(--cp-surface-border);
      color: var(--cp-text);
      border-radius: 8px;
      background: var(--cp-surface);
      width: 32px;
      height: 32px;
      cursor: pointer;
      font-size: 16px;
      padding: 0;
      margin: 0;
      box-shadow: var(--cp-glow-cyan);
      backdrop-filter: blur(4px);
    }
    .reset-button:hover {
      background: var(--cp-surface-strong);
    }

    .input-area {
      display: flex;
      gap: 12px;
    }

    textarea {
      flex: 1;
      padding: 8px 12px;
      border-radius: 10px;
      border: 1px solid var(--cp-surface-border);
      background: var(--cp-surface);
      color: var(--cp-text);
      font: 16px/1.4 system-ui;
      resize: none;
      outline: none;
      min-height: 56px;
      max-height: 200px;
      height: auto;
      overflow-y: auto;
      box-sizing: border-box;
      box-shadow: var(--cp-glow-purple);
      transition: height 0.1s ease;
      scrollbar-width: thin;
      scrollbar-color: var(--cp-surface-strong) transparent;
    }

    textarea::-webkit-scrollbar {
      width: 6px;
    }

    textarea::-webkit-scrollbar-track {
      background: transparent;
    }

    textarea::-webkit-scrollbar-thumb {
      background-color: var(--cp-surface-strong);
      border-radius: 3px;
    }

    textarea::-webkit-scrollbar-thumb:hover {
      background-color: var(--cp-cyan);
    }

    button {
      outline: none;
      border: 1px solid var(--cp-surface-border);
      color: var(--cp-text);
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(0,229,255,0.15), rgba(124,77,255,0.15));
      width: 56px;
      height: 56px;
      cursor: pointer;
      font-size: 24px;
      padding: 0;
      margin: 0;
      box-shadow: var(--cp-glow-cyan);
      backdrop-filter: blur(4px);
      transition: transform 0.15s ease, background 0.15s ease;
    }

    button:hover {
      background: linear-gradient(135deg, rgba(0,229,255,0.22), rgba(124,77,255,0.22));
      transform: translateY(-1px);
    }

    .scroll-to-bottom {
      position: absolute;
      bottom: 80px;
      right: 20px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(0,229,255,0.9), rgba(124,77,255,0.9));
      border: 2px solid rgba(255, 255, 255, 0.3);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(8px);
      transition: all 0.3s ease;
      z-index: 10;
      opacity: 0;
      transform: translateY(10px);
      pointer-events: none;
    }

    .scroll-to-bottom.visible {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }

    .scroll-to-bottom:hover {
      transform: scale(1.08);
    }

    .scroll-to-bottom .badge {
      position: absolute;
      top: -8px;
      right: -8px;
      background: rgba(255, 100, 100, 0.9);
      color: white;
      border-radius: 50%;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
      border: 2px solid rgba(255, 255, 255, 0.8);
    }

    .transcript-container {
      position: relative;
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--cp-muted);
      font: 16px/1.4 system-ui;
      text-align: center;
      gap: 8px;
    }

    .chat-icon {
      width: 48px;
      height: 48px;
      opacity: 0.5;
    }
  `;

  private _handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    this.inputValue = target.value;

    // Auto-resize textarea
    this._resizeTextarea(target);

    log.debug("Input value changed");
  }

  private _handleFocus() {
    this.isChatActive = true;
    this._dispatchChatActiveChanged();
  }

  private _handleBlur() {
    this.isChatActive = false;
    this._dispatchChatActiveChanged();
  }

  private _dispatchChatActiveChanged() {
    const detail = { isChatActive: this.isChatActive };
    log.debug("Chat active changed", detail);
    this.dispatchEvent(
      new CustomEvent("chat-active-changed", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _resizeTextarea(textarea: HTMLTextAreaElement) {
    // Reset height to recalculate
    textarea.style.height = "auto";

    // Calculate new height based on scroll height
    const scrollHeight = textarea.scrollHeight;
    const minHeight = 56;
    const maxHeight = 200;

    // Clamp the height between min and max
    const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${newHeight}px`;
  }

  private _sendMessage() {
    if (!this.inputValue.trim()) return;

    log.debug("Sending message", { message: this.inputValue });
    this.dispatchEvent(
      new CustomEvent("send-message", { detail: this.inputValue }),
    );
    this.inputValue = "";

    // Reset textarea height after sending
    if (this.textareaRef) {
      this.textareaRef.style.height = "56px";
    }
  }

  private _resetText() {
    log.debug("Resetting conversation");
    this.dispatchEvent(
      new CustomEvent("reset-text", { bubbles: true, composed: true }),
    );
  }

  firstUpdated() {
    log.debug("Component first updated");
    // Add scroll event listener to update scroll-to-bottom button visibility
    const transcriptEl = this.shadowRoot?.querySelector(".transcript");
    if (transcriptEl) {
      transcriptEl.addEventListener("scroll", () => {
        const isAtBottom = defaultAutoScroll.handleScrollEvent(transcriptEl);
        if (isAtBottom) {
          this.lastSeenMessageCount = this.transcript.length;
        }
        this._updateScrollToBottomState();
      });
    }

    // Store reference to textarea for height management
    this.textareaRef = this.shadowRoot?.querySelector(
      "textarea",
    ) as HTMLTextAreaElement;
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has("transcript")) {
      // Use generic auto-scroll utility
      const transcriptEl = this.shadowRoot?.querySelector(".transcript");
      if (transcriptEl) {
        const oldTranscript =
          (changedProperties.get("transcript") as Turn[]) || [];
        log.debug("Transcript updated", {
          oldLength: oldTranscript.length,
          newLength: this.transcript.length,
        });
        defaultAutoScroll.handleTranscriptUpdate(
          transcriptEl,
          oldTranscript.length,
          this.transcript.length,
        );

        // Update scroll-to-bottom button state
        this._updateScrollToBottomState();
      }
    }

    if (changedProperties.has("visible")) {
      log.debug(`Visibility changed to ${this.visible}`);
      if (this.visible) {
        this.removeAttribute("hidden");

        // Use generic auto-scroll utility for visibility changes
        const transcriptEl = this.shadowRoot?.querySelector(".transcript");
        if (transcriptEl) {
          defaultAutoScroll.handleVisibilityChange(
            transcriptEl,
            this.visible,
            this.transcript.length > 0,
          );
        }
      } else {
        this.setAttribute("hidden", "");
      }
    }
  }

  private _updateScrollToBottomState() {
    const transcriptEl = this.shadowRoot?.querySelector(".transcript");
    if (transcriptEl) {
      const state = defaultAutoScroll.getScrollToBottomState(
        transcriptEl,
        this.transcript.length,
        this.lastSeenMessageCount,
      );
      this.newMessageCount = state.newMessageCount;
      log.debug("Scroll to bottom state updated", {
        showButton: state.showButton,
        newMessageCount: state.newMessageCount,
      });

      // Dispatch event to notify parent component of scroll state changes
      const detail = {
        showButton: state.showButton,
        newMessageCount: state.newMessageCount,
      };
      log.debug("Scroll state changed", detail);
      this.dispatchEvent(
        new CustomEvent("scroll-state-changed", {
          detail,
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private _scrollToBottom() {
    log.debug("Scrolling to bottom");
    const transcriptEl = this.shadowRoot?.querySelector(".transcript");
    if (transcriptEl) {
      defaultAutoScroll.scrollToBottom(transcriptEl, true);
      this.lastSeenMessageCount = this.transcript.length;
    }
  }

  render() {
    return html`
      <div class="header">
        <div class="header-title">
          <svg class="message-icon" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor">
            <path d="M240-400h320v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Z"/>
          </svg>
          <span>Chat</span>
        </div>
        <div class="header-actions">
          <tts-energy-bar></tts-energy-bar>
          <button class="reset-button" @click=${this._resetText} title="Clear conversation">
            <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor">
              <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="transcript-container">
        <div class="transcript">
          ${
            this.transcript.length === 0
              ? html`
                  <div class="empty-state">
                    <svg
                      class="chat-icon"
                      xmlns="http://www.w3.org/2000/svg"
                      height="48px"
                      viewBox="0 -960 960 960"
                      width="48px"
                      fill="currentColor"
                    >
                      <path
                        d="M240-400h320v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Z"
                      />
                    </svg>
                    <div>No messages yet</div>
                  </div>
                `
              : this.transcript.map(
                  (turn) => html`
                    <div class="turn ${turn.author}">${turn.text}</div>
                  `,
                )
          }
        </div>
      </div>
      <div class="input-area">
        <textarea
          .value=${this.inputValue}
          @input=${this._handleInput}
          @focus=${this._handleFocus}
          @blur=${this._handleBlur}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              this._sendMessage();
            }
          }} 
          placeholder="Type a message..."
          rows="1"
        ></textarea>
        <button @click=${this._sendMessage}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#ffffff"><path d="M120-160v-240l320-80-320-80v-240l760 320-760 320Z"/></svg>
        </button>
      </div>
    `;
  }
}
