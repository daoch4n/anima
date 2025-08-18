import type { CallSummary } from "@shared/types";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("call-history-view")
export class CallHistoryView extends LitElement {
  @property({ type: Array }) callHistory: CallSummary[] = [];

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    
    .history-list {
      list-style: none;
      padding: 12px;
      margin: 0;
      flex: 1;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--cp-surface-strong) var(--cp-surface);
    }
    
    .history-list::-webkit-scrollbar {
      width: 8px;
    }
    
    .history-list::-webkit-scrollbar-track {
      background-color: var(--cp-surface);
      border-radius: 4px;
    }
    
    .history-list::-webkit-scrollbar-thumb {
      background-color: var(--cp-surface-strong);
      border-radius: 4px;
    }
    
    .history-list::-webkit-scrollbar-thumb:hover {
      background-color: var(--cp-cyan);
      box-shadow: var(--cp-glow-cyan);
    }
    
    .history-item {
      padding: 10px 12px;
      margin-bottom: 8px;
      border: 1px solid var(--cp-surface-border);
      border-radius: 10px;
      cursor: pointer;
      color: var(--cp-text);
      background: var(--cp-surface);
      transition: background 0.15s ease, transform 0.15s ease;
      box-shadow: var(--cp-glow-purple);
    }
    
    .history-item:hover {
      background: var(--cp-surface-strong);
      transform: translateY(-1px);
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
      padding: 20px;
    }
    
    .history-icon {
      width: 48px;
      height: 48px;
      opacity: 0.5;
    }
  `;

  _startTts(summary: CallSummary) {
    this.dispatchEvent(
      new CustomEvent("start-tts-from-summary", {
        detail: { summary },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      ${
        this.callHistory.length === 0
          ? html`
            <div class="empty-state">
              <svg
                class="history-icon"
                xmlns="http://www.w3.org/2000/svg"
                height="48px"
                viewBox="0 -960 960 960"
                width="48px"
                fill="currentColor"
              >
                <path
                  d="M480-80q-75 0-140.5-28.5t-114-77q-48.5-48.5-77-114T120-440h80q0 117 81.5 198.5T480-160q117 0 198.5-81.5T760-440q0-117-81.5-198.5T480-720h-6l62 62-56 58-160-160 160-160 56 58-62 62h6q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-440q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-80Z"
                />
              </svg>
              <div>No call history yet</div>
            </div>
          `
          : html`
            <ul class="history-list">
              ${this.callHistory.map(
                (call) => html`
                  <li class="history-item" @click=${() => this._startTts(call)}>
                    <div>${call.timestamp.toLocaleString()}</div>
                    <div>${call.summaryText}</div>
                  </li>
                `,
              )}
            </ul>
          `
      }
    `;
  }
}
