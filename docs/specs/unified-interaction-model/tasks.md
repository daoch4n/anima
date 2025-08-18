# Implementation Plan: Unified Interaction Model (v2)

This document breaks down the implementation of the Unified Interaction Model into actionable coding tasks, updated to reflect the latest approved specifications.

## 1. Foundational Services

- [ ] 1.1. **Create `BaseSessionManager` Abstract Class**
  - **File:** `services/BaseSessionManager.ts`
  - **Details:** Implement common session logic: in-memory resumption token storage, reconnection logic for network errors, and handling of `GoAway` messages.
  - **Ref:** Design section "Components and Interfaces", Requirement 2.3.1

- [ ] 1.2. **Implement `TextSessionManager`**
  - **File:** `services/TextSessionManager.ts` (extends `BaseSessionManager`)
  - **Details:** Implement the `sendMessage` method. This manager will handle non-persistent, in-session chat history.
  - **Ref:** Design section "Components and Interfaces", Requirements 2.1.1, 2.1.3

- [ ] 1.3. **Implement `CallSessionManager`**
  - **File:** `services/CallSessionManager.ts` (extends `BaseSessionManager`)
  - **Details:** Implement `sendAudio` for real-time streaming. Ensure it ignores any previous session tokens on new calls to always start with the highest energy tier.
  - **Ref:** Design section "Components and Interfaces", Requirements 2.1.2, 2.3.3

- [ ] 1.4. **Implement `EnergyBarService`**
  - **File:** `services/EnergyBarService.ts`
  - **Details:** Implement state management for TTS (2,1,0) and STS (3,2,1,0) energy levels. It must emit an `energy-level-changed` event on state changes.
  - **Ref:** Design section "Components and Interfaces", Requirement 2.2.1, 2.2.2

- [ ] 1.5. **Implement `SummarizationService`**
  - **File:** `features/summarization/SummarizationService.ts`
  - **Details:** Implement the `summarize` method using the `gemini-flash-lite` model. Include error handling for when summarization fails.
  - **Ref:** Design section "Components and Interfaces", Requirement 2.1.5

## 2. Core Logic Orchestration

- [ ] 2.1. **Implement `InteractionManager`**
  - **File:** `services/InteractionManager.ts`
  - **Details:** Orchestrate lifecycles of session managers. Handle UI events (`start-call`, `send-message`, `clear-chat`). Coordinate with `EnergyBarService` on rate limits and `SummarizationService` on call completion.
  - **Ref:** Design section "Components and Interfaces", Requirement 2.1

## 3. State Management and UI Integration

- [ ] 3.1. **Update `gdm-live-audio` State and Logic**
  - **File:** `app/main.tsx` (`GdmLiveAudio` component)
  - **Details:** Add state properties: `activeMode`, `callState`, `textTranscript`, `callTranscript`, `callHistory`. Ensure `textTranscript` is cleared on page reload to meet the non-persistence requirement.
  - **Ref:** Design section "Components and Interfaces", Requirement 2.1.3

- [ ] 3.2. **Instantiate and Coordinate Services in `gdm-live-audio`**
  - **File:** `app/main.tsx`
  - **Details:** Instantiate `InteractionManager`, `EnergyBarService`, `SummarizationService`. Set up listeners for service events (`energy-level-changed`) to update component state.
  - **Ref:** Design section "Architecture"

- [ ] 3.3. **Implement Dynamic UI Layout and Call History**
  - **Files:** `app/main.tsx`, `components/chat-view.ts`, `components/call-transcript.ts`, `components/call-history-view.ts`
  - **Details:**
    - [ ] 3.3.1. Implement the fade-in/out logic for the left and right panels based on `activeMode`.
    - [ ] 3.3.2. Add a "Clear Chat" button to the chat interface.
    - [ ] 3.3.3. Wire the "Clear Chat" button to an event handled by `InteractionManager` to clear the transcript and reset TTS energy.
    - [ ] 3.3.4. Create a new `CallHistoryView` component to display summaries.
    - [ ] 3.3.5. Add a "Play" button to each summary in `CallHistoryView` that, when clicked, dispatches an event to have the summary text read via TTS.
  - **Ref:** Requirement 2.1.4, 2.2.4, 2.1.5

- [ ] 3.4. **Integrate Energy Indicators**
  - **Files:** `components/energy-indicator.ts` (or similar)
  - **Details:** Create or update UI components to display separate energy levels for TTS and STS modes. Ensure they are only visible in the correct context (chat vs. call).
  - **Ref:** Requirement 2.2.5

- [ ] 3.5. **Implement Persona-Driven Prompts**
  - **File:** `services/InteractionManager.ts` (or a new `PersonaService.ts`)
  - **Details:** Implement logic to fetch and inject persona-specific prompts into the chat or UI based on energy levels (e.g., welcome messages, degradation warnings).
  - **Ref:** Requirement 2.2.6

## 4. Testing

- [ ] 4.1. **Unit Tests for Services**
  - **Details:** Create unit tests for `EnergyBarService` (state transitions), `InteractionManager` (orchestration logic), and `SummarizationService` (API calls with mock data).
  - **Ref:** Design section "Testing Strategy"

- [ ] 4.2. **Integration Tests**
  - **Details:** Create integration tests verifying the flow from a UI event in `gdm-live-audio` through `InteractionManager` to the session managers (with a mocked API). Test the rate-limit -> energy downgrade flow.
  - **Ref:** Design section "Testing Strategy"

- [ ] 4.3. **End-to-End Tests**
  - **Details:** Create an E2E test simulating a full user journey: sending a text, clearing the chat, starting a call, hitting a rate limit, ending the call, and verifying the summary in the call history.
  - **Ref:** Design section "Testing Strategy"