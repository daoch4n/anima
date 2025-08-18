# Implementation Plan: Unified Interaction Model

This document breaks down the implementation of the Unified Interaction Model into actionable coding tasks.

## 1. Foundational Services

- [ ] 1.1. **Create `BaseSessionManager` Abstract Class**
  - Create a new file `services/BaseSessionManager.ts`.
  - Implement the common session management logic, including session resumption, reconnection, and `GoAway` message handling.
  - Ref: Design section "Components and Interfaces", Requirement 2.3.1

- [ ] 1.2. **Implement `TextSessionManager`**
  - Create a new file `services/TextSessionManager.ts` that extends `BaseSessionManager`.
  - Implement the `sendMessage` method for handling text-based interactions with the Gemini API.
  - Ref: Design section "Components and Interfaces", Requirement 2.1.1

- [ ] 1.3. **Implement `CallSessionManager`**
  - Create a new file `services/CallSessionManager.ts` that extends `BaseSessionManager`.
  - Implement the `sendAudio` method for handling real-time audio streaming.
  - Ref: Design section "Components and Interfaces", Requirement 2.1.2

- [ ] 1.4. **Implement `EnergyBarService`**
  - Create the `services/EnergyBarService.ts` file if it doesn't exist, or update the existing one.
  - Implement the logic for managing and downgrading energy levels for both TTS and STS modes.
  - It should emit an `energy-level-changed` event when a level is updated.
  - Ref: Design section "Components and Interfaces", Requirement 2.2

- [ ] 1.5. **Implement `SummarizationService`**
  - Create the `features/summarization/SummarizationService.ts` file.
  - Implement the `summarize` method to call the Gemini API with a transcript and return a summary.
  - Ref: Design section "Components and Interfaces", Requirement 2.1.5

## 2. Core Logic Orchestration

- [ ] 2.1. **Implement `InteractionManager`**
  - Create a new file `services/InteractionManager.ts`.
  - Implement the core logic for managing session lifecycles and coordinating between the session managers, `EnergyBarService`, and `SummarizationService`.
  - Implement the `handleEvent` method to process UI events.
  - Ref: Design section "Components and Interfaces"

## 3. State Management and UI Integration

- [ ] 3.1. **Update `gdm-live-audio` State**
  - In `app/main.tsx`, add the new state properties to the `GdmLiveAudio` component: `activeMode`, `callState`, `textTranscript`, `callTranscript`, and `callHistory`.
  - Ref: Design section "Components and Interfaces"

- [ ] 3.2. **Instantiate and Coordinate Services in `gdm-live-audio`**
  - In the `gdm-live-audio` component, instantiate the `InteractionManager`, `EnergyBarService`, and `SummarizationService`.
  - Set up event listeners to handle events from the services and update the component's state accordingly.
  - Ref: Design section "Architecture"

- [ ] 3.3. **Implement Dynamic UI Layout**
  - Update the `gdm-live-audio` component's render method to dynamically show/hide the chat and call transcript views based on the `activeMode`.
  - Use CSS classes to handle the fade-in/fade-out animations.
  - Ref: Requirement 2.1.4

- [ ] 3.4. **Integrate Energy Indicators**
  - Create or update the UI components for the energy indicators.
  - Pass the `ttsEnergy` and `stsEnergy` state properties from `gdm-live-audio` to the indicators.
  - Ref: Requirement 2.2.5

- [ ] 3.5. **Implement Persona-Driven Prompts**
  - In the `InteractionManager` or a dedicated persona manager, implement the logic to select and display persona-driven prompts based on the current energy level.
  - Ref: Requirement 2.2.6

## 4. Testing

- [ ] 4.1. **Unit Tests for Services**
  - Create unit tests for `EnergyBarService`, `InteractionManager`, and `SummarizationService`.
  - Mock all external dependencies.
  - Ref: Design section "Testing Strategy"

- [ ] 4.2. **Integration Tests**
  - Create integration tests to verify the flow from `gdm-live-audio` to the `InteractionManager` and session managers.
  - Test the rate-limiting and energy downgrade flow.
  - Ref: Design section "Testing Strategy"

- [ ] 4.3. **End-to-End Tests**
  - Create an E2E test to simulate a full user journey, including starting a call, encountering a rate limit, and verifying the call summary.
  - Ref: Design section "Testing Strategy"