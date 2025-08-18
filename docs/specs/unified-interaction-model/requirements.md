# Feature: Unified Interaction Model

## 1. Introduction
This document outlines the requirements for a unified interaction model that combines a dual-input system (text and voice), dynamic AI resource management, and resilient session handling. The goal is to create a seamless, realistic, and robust conversational experience. Users can interact via persistent text messaging (TTS) or ephemeral voice calls (STS), while the system intelligently manages AI model tiers and session state to handle API rate limits and network interruptions gracefully.

## 2. Epics

### 2.1. Epic: Dual-Input Interaction Core
This epic establishes the foundational UI and UX for switching between text (TTS) and voice (STS) conversations, ensuring each mode has the appropriate context and interface.

#### 2.1.1. User Story: Text-Based Conversation (TTS)
- **Priority**: High
- **As a** user,
- **I want** to send messages by typing in a chat interface,
- **so that** I can have text-based conversations with Gemini-chan that feel like messaging.

##### Acceptance Criteria
```gherkin
Scenario: Initial state of the chat interface
  Given the application loads
  Then the chat window is visible on the left side
  And no TTS session is initialized.

Scenario: Lazy initialization of TTS session
  Given the application is loaded
  When I type a message and click "Send" for the first time
  Then a TTS session is initiated with the 'gemini-2.5-flash-live-preview' model.

Scenario: Sending subsequent messages
  Given a TTS session already exists
  When I type a message and click "Send"
  Then the message is sent to the existing TTS session.

Scenario: Transcript updates
  When I send a message in TTS mode
  Then my message appears in the chat transcript
  And the model's audio response is streamed back
  And the chat transcript is updated with the model's response text.
```

#### 2.1.2. User Story: Voice-Based Conversation (STS)
- **Priority**: High
- **As a** user,
- **I want** to start a voice call by clicking a "Call" button,
- **so that** I can talk to Gemini-chan like calling a real person.

##### Acceptance Criteria
```gherkin
Scenario: Initiating a voice call
  Given the application has loaded
  When I click the "Call" button
  Then an STS session is initiated with the 'gemini-2.5-flash-exp-native-audio-thinking-dialog' model
  And audio recording starts immediately.

Scenario: Handling rate limits during a call
  Given a call is active
  When a request is rate-limited
  Then a toast appears explaining the rate limit
  And no new audio is queued.
```

#### 2.1.3. User Story: Context and Transcript Management
- **Priority**: High
- **As a** user,
- **I want** my text conversations to be preserved during my session, independently from voice calls,
- **so that** I can switch between texting and fresh voice calls without losing my current chat history.

##### Acceptance Criteria
```gherkin
Scenario: Context separation between modes
  Given I have an active text conversation
  When I switch from texting to calling
  Then the texting context is preserved but not shared with the calling session.

Scenario: Ephemeral call context
  When I end a call
  Then the call's context is discarded and not preserved.

Scenario: Starting a new call
  When I start a new call
  Then the call begins with a fresh, empty context and a completely empty transcript display.

Scenario: Returning to text chat
  When I return to the text messaging view after a call
  Then the previous text conversation history is restored.

Scenario: Chat history is not persisted across page reloads
  Given I have an active text conversation
  When I reload the application
  Then the chat window is empty.
```

#### 2.1.4. User Story: Dynamic UI and Layout
- **Priority**: High
- **As a** user,
- **I want** the interface to dynamically adapt to my current interaction mode,
- **so that** I have a clear and uncluttered view of the relevant conversation.

##### Acceptance Criteria
```gherkin
Scenario: UI state in text mode
  Given no call is active
  Then the tabbed interface on the left (containing the chat window) is visible
  And the call transcript window on the right is hidden.

Scenario: UI state during a call
  Given a call becomes active
  Then the entire tabbed interface on the left is hidden
  And the call transcript window appears on the right.

Scenario: UI state after a call
  Given a call ends
  Then the call transcript window is hidden
  And the tabbed interface on the left reappears.

Scenario: Consistent layout
  When a call is active
  Then the call transcript window has the same width as the chat window (400px)
  And the Live2D model area remains unobstructed.
```

#### 2.1.5. User Story: Call Summarization, History, and Interaction
- **Priority**: Medium
- **As a** user,
- **I want** my voice calls to be automatically summarized, stored in a history, and interactive,
- **so that** I can easily review past conversations and reuse their content.

##### Acceptance Criteria
```gherkin
Scenario: Successful summary generation
  Given a call has ended and the transcript is available
  When I hang up
  Then the system generates a concise summary of the conversation using the `gemini-2.5-flash-lite` model.

Scenario: Viewing call history
  Given the "Call History" tab is selected
  Then a list of past call summaries is displayed.

Scenario: Starting a new chat from a summary
  Given I am viewing the "Call History" tab
  When I click on a call summary
  Then the summary content is used to start a new TTS session in the "Chat" tab.

Scenario: Replaying a summary via TTS
  Given I am viewing the "Call History" tab
  When I click the "Play" button on a summary
  Then the summary text is read aloud using a TTS service.
```

### 2.2. Epic: Dynamic Resource Management
This epic defines the "energy bar" system for managing different AI model tiers independently for TTS and STS modes, providing clear visual feedback to the user.

#### 2.2.1. User Story: Track Independent Energy Levels
- **Priority**: High
- **As a** system,
- **I want** to maintain separate energy level states for STS (3, 2, 1, 0) and TTS (2, 1, 0) modes,
- **so that** energy depletion in one mode does not affect the other.

##### Acceptance Criteria
```gherkin
Scenario: Initialize at full energy
  Given the application starts
  When the Energy Bar System is initialized
  Then the energy level for STS is set to 3
  And the energy level for TTS is set to 2.
```

#### 2.2.2. User Story: Downgrade Energy on Rate Limit
- **Priority**: High
- **As a** system,
- **I want** to decrement the energy level for the specific mode (STS or TTS) where a rate limit error is detected,
- **so that** the application can switch to the next model tier for that mode only.

##### Acceptance Criteria
```gherkin
Scenario: Downgrade STS energy on call rate limit
  Given the current STS energy level is 3 and TTS is 2
  And a rate limit error is detected during an STS call
  When the system processes the error
  Then the STS energy level is set to 2
  And the TTS energy level remains 2.

Scenario: Downgrade TTS energy on chat rate limit
  Given the current STS energy level is 3 and TTS is 2
  And a rate limit error is detected during a TTS chat session
  When the system processes the error
  Then the TTS energy level is set to 1
  And the STS energy level remains 3.
```

#### 2.2.3. User Story: Reset STS Energy on New Call
- **Priority**: High
- **As a** system,
- **I want** to reset the STS energy level to the highest tier at the start of every new call,
- **so that** each call starts with the best possible model.

##### Acceptance Criteria
```gherkin
Scenario: Start a new call after exhaustion
  Given the STS energy level was 0 at the end of the last call
  When a new STS session is connected
  Then the STS energy level is reset to 3.
```

#### 2.2.4. User Story: Reset TTS Energy on New Chat
- **Priority**: High
- **As a** system,
- **I want** to reset the TTS energy level to the highest tier when I manually start a new chat,
- **so that** I can begin a fresh conversation with the best possible model.

##### Acceptance Criteria
```gherkin
Scenario: Resetting chat after energy exhaustion
  Given the TTS energy level was 0 at the end of the last chat
  When I click the "Clear Chat" button to start a new conversation
  Then the TTS energy level is reset to 2.
```

#### 2.2.5. User Story: Display Mode-Specific Energy Indicators
- **Priority**: High
- **As a** user,
- **I want** to see separate energy indicators for the chat and call interfaces,
- **so that** I am aware of the AI's current capacity in each mode.

##### Acceptance Criteria
```gherkin
Scenario: STS energy indicator visibility
  Given I am in an active call
  Then an STS energy indicator is visible in the call interface.
  Given I am not in an active call
  Then no STS energy indicator is visible.

Scenario: TTS energy indicator visibility
  Given I am viewing the chat interface
  Then a TTS energy indicator is visible in the chat header area.

Scenario: Independent indicator updates
  Given both STS and TTS energy indicators are visible
  When the STS energy level drops
  Then only the STS indicator updates.
```

#### 2.2.6. User Story: Deliver Persona-Driven Prompts Based on Energy Level
- **Priority**: High
- **As a** user,
- **I want** Gemini-chan's conversational prompts to change based on her energy level and persona,
- **so that** the experience feels immersive and I understand the reason for any change in conversational depth.

##### Acceptance Criteria
```gherkin
Scenario: Degraded STS energy prompt for VTuber persona
  Given the STS energy level is 2
  And the selected persona is 'VTuber'
  When the system needs to display a prompt during a call
  Then a message like "I'm getting a little sleepy... " is used.

Scenario: Degraded TTS energy prompt injected into chat
  Given the TTS energy level is 1
  And any persona is selected
  When the energy level changes
  Then a persona-specific degraded energy message is injected directly into the chat window as a model message.

Scenario: Welcome greeting at full TTS energy
  Given the TTS energy level is 2
  When the chat window is displayed
  Then a persona-specific welcome greeting is injected into the chat.
```

### 2.3. Epic: Resilient Session Handling
This epic covers session resumption, context summarization, and fallback logic when model tiers change due to resource limits, ensuring a stable connection.

#### 2.3.1. User Story: Seamless Session Resumption
- **Priority**: High
- **As a** user,
- **I want** my session to be automatically re-established if the connection is reset,
- **so that** I can continue my conversation without interruption.

##### Acceptance Criteria
```gherkin
Scenario: Server provides a resumption token
  Given I have an active session with the Gemini Live API
  When the server provides a session resumption token
  Then the token is stored in memory for the current application session.

Scenario: Successfully resume a session within the same application session
  Given I have a valid session resumption token stored in memory
  And my connection is interrupted and re-established
  When I establish a new connection and provide the in-memory token
  Then the server restores the previous session.

Scenario: Handle invalid or expired token
  Given I have an invalid session resumption token in memory
  When I try to resume a session
  Then the server rejects the connection and a new session is started.

Scenario: Token is not persisted across application reloads
  Given I have a valid session resumption token stored in memory
  When I close and reopen the application
  Then the session resumption token is gone
  And a new session is started on the first interaction.
```

#### 2.3.2. User Story: Fallback to Non-Resumable Models
- **Priority**: High
- **As a** user,
- **I want** to be gracefully transitioned to a lower-tier model when I hit a rate limit,
- **so that** my conversation can continue without a hard failure.

##### Acceptance Criteria
```gherkin
Scenario: Transparent fallback on rate limit
  Given I am in a session with a high-tier model
  And I encounter a rate limit error
  When the system handles the error
  Then a persona-specific immersive prompt is displayed (e.g., "Feeling a bit tired...")
  And the session transparently reconnects to the next available lower-tier model
  And a summary of the recent conversation is injected as context into the new session.
```

#### 2.3.3. User Story: Opportunistically Use Highest-Quality Model on New Call
- **Priority**: High
- **As a** user,
- **I want** every new call to start with the best possible AI model,
- **so that** I always have the highest quality conversation, while still preserving context from my previous call if available.

##### Acceptance Criteria
```gherkin
Scenario: Starting a new call always attempts the highest tier model
  Given my previous call ended on a lower-tier model (e.g., STS energy level 1)
  And a session resumption token for that lower tier was stored in memory
  When I start a new call
  Then the system ignores the lower-tier token and initiates the call at the highest energy level (STS level 3).
  And if a summary from the most recent call exists, it is injected as context for the new, high-quality session.

Scenario: Starting a new call with no previous session
  Given I have not had a call in this session
  When I start a new call
  Then the session is initiated at the highest energy level (STS level 3).