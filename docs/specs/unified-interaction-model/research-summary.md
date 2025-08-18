# Research Summary: Unified Interaction Model Integration

## 1. Overview

This document summarizes the findings from analyzing the existing codebase to determine the best approach for integrating the new `InteractionManager` and `EnergyBarService`. The analysis focused on the main `gdm-live-audio` component, the `TextSessionManager`, the `CallSessionManager`, and the `EnergyBarService`.

## 2. Existing Architecture

The application follows a centralized architecture with the `gdm-live-audio` component acting as the primary controller. Key components and their responsibilities are outlined below:

### 2.1. `gdm-live-audio` Component

*   **Location:** [`app/main.tsx`](app/main.tsx:588)
*   **Responsibility:**
    *   Manages the overall application state, including `activeMode`, `callState`, transcripts, and call history.
    *   Initializes and coordinates the `TextSessionManager`, `CallSessionManager`, and `EnergyBarService`.
    *   Handles all UI events and orchestrates the interactions between the UI and the underlying services.
    *   Renders the main UI layout and passes state down to child components.

### 2.2. Session Managers

*   **`BaseSessionManager`:**
    *   **Location:** [`app/main.tsx`](app/main.tsx:40)
    *   **Responsibility:** Provides the core functionality for session management, including session resumption, reconnection logic, and handling of `GoAway` messages.
*   **`TextSessionManager`:**
    *   **Location:** [`app/main.tsx`](app/main.tsx:424)
    *   **Responsibility:** Manages text-based (TTS) sessions, including sending and receiving text messages and handling text-specific API configurations.
*   **`CallSessionManager`:**
    *   **Location:** [`app/main.tsx`](app/main.tsx:495)
    *   **Responsibility:** Manages voice-based (STS) sessions, including handling real-time audio streaming, bidirectional transcription, and call-specific API configurations.

### 2.3. `EnergyBarService`

*   **Location:** [`services/EnergyBarService.ts`](services/EnergyBarService.ts:40)
*   **Responsibility:**
    *   Manages the energy levels for both TTS and STS modes.
    *   Determines the appropriate Gemini model to use based on the current energy level.
    *   Emits an `energy-level-changed` event when the energy level is updated, allowing other components to react accordingly.

### 2.4. Shared Types

*   **Location:** [`shared/types.ts`](shared/types.ts)
*   **Responsibility:** Defines the shared data structures used throughout the application, including:
    *   **`Turn`:** Represents a single message in a transcript.
    *   **`CallSummary`:** Represents a summarized entry in the call history.

## 3. Integration Plan

Based on the analysis of the existing architecture, the following integration plan is recommended for the `InteractionManager`:

### 3.1. `InteractionManager` Instantiation

The `InteractionManager` should be instantiated within the `gdm-live-audio` component's constructor. This will allow it to access the existing services and manage the application's interaction logic from a central location.

### 3.2. Delegation of Responsibilities

The `gdm-live-audio` component should delegate the following responsibilities to the `InteractionManager`:

*   **Session Lifecycle Management:** The `InteractionManager` should be responsible for initializing, managing, and closing the `TextSessionManager` and `CallSessionManager`.
*   **UI Event Handling:** All user interaction events (e.g., `call-start`, `call-end`, `send-message`) should be routed to the `InteractionManager` for processing.
*   **Energy Management:** The `InteractionManager` will interact with the `EnergyBarService` to handle rate-limiting events and trigger model downgrades as needed.

### 3.3. State Management

The `gdm-live-audio` component will remain the single source of truth for the application's state. The `InteractionManager` will receive state updates from the `gdm-live-audio` component and will dispatch events to update the state as needed.

### 3.4. Event-Driven Communication

The `InteractionManager` will communicate with the `gdm-live-audio` component and other services through an event-driven model. This will ensure a loosely coupled architecture that is easy to maintain and extend.

## 4. Conclusion

The existing architecture is well-suited for the integration of the `InteractionManager` and `EnergyBarService`. By following the recommended integration plan, the new services can be seamlessly wired into the existing state management and event handling logic, creating a more robust and maintainable application.