# Product Overview

Gemini-chan is a real-time AI voice assistant with Live2D character visualization. The application creates an interactive VTuber-style character that users can talk to using Google's Gemini AI with live audio capabilities.

## Key Features
- Real-time voice conversation with Google Gemini AI
- Live2D character visualization that responds to audio input/output
- Animated character expressions and lip-sync capabilities
- Settings menu for API key management
- Audio processing with PCM encoding for live streaming

## Visualization Options
- **Live2D** (Current target) - Simpler 2D character animation system
- **VRM 3D Avatars** (Future consideration) - Full 3D character models with higher complexity

## Target Experience
The app aims to provide an immersive, anime-inspired AI companion experience with visual feedback that responds to both user speech and AI responses in real-time.

# Project Structure

The project follows a root-level, domain-driven architecture to improve modularity, scalability, and maintainability. Source code is organized according to its business domain, eliminating the traditional `src/` directory.

## Root-Level Domains

-   **`app/`**: Contains the main application entry point (`main.tsx`) and global environment type definitions.
-   **`components/`**: Houses reusable UI components that are not specific to any single feature (e.g., `SettingsMenu`, `ToastNotification`).
-   **`features/`**: Contains self-contained modules representing distinct business domains (e.g., `persona`, `summarization`).
-   **`services/`**: Holds services that provide cross-cutting functionality, such as logging (`DebugLogger`) or energy management (`EnergyBarService`).
-   **`store/`**: Manages data persistence and state, such as the vector store (`VectorStore`).
-   **`visuals/`**: Contains components and logic related to 3D rendering and visual effects, including audio analysis (`analyser.ts`).
-   **`live2d/`**: Contains all files related to the Live2D integration, including the canvas, model management, and audio mapping.
-   **`shared/`**: A repository for shared code, including common types, utility functions, and hooks that are used across multiple domains.
-   **`tests/`**: For end-to-end tests, integration tests, and any test setup that spans multiple domains.

## Naming Conventions

-   Components use kebab-case custom elements (`gdm-live-audio`)
-   Files use kebab-case (`settings-menu.ts`)
-   Classes use PascalCase (`GdmLiveAudio`)
-   Private methods prefixed with underscore (`_toggleSettings`)

## Architecture Patterns

-   Web Components with Lit decorators (`@customElement`, `@state`, `@property`)
-   Event-driven communication between components
-   Reactive properties for state management
-   Shadow DOM for component encapsulation

## UI Layout & Mode Behavior

- Grid layout: three columns `400px 1fr 400px`.
  - Left panel (400px): tabbed interface containing Chat or Call History.
  - Center (1fr): Live2D model area; must remain unobstructed at all times.
  - Right panel (400px): Call transcript area, visible only during a call.

### Left Panel (Tabbed Interface)
- Element: `.main-container` (contains `<tab-view>` and either `<chat-view>` or `<call-history-view>`)
- Behavior:
  - Default mode is texting. The left panel is visible and shows the tab bar and selected tab contents.
  - When a call starts (`activeMode === "calling"`), the left panel fades out (opacity/visibility transition ~200ms) using a CSS class: `.main-container.hidden`.
  - The grid columns remain fixed; we do NOT collapse the left column so the right panel stays on the right.
- Tabs (`<tab-view>`):
  - Tabs: Chat, Call History.
  - `visible` boolean attribute used to hide the tab bar when calling.
  - Chat view reuses the same auto-scroll + scroll-to-bottom logic as call transcript.

### Center Area (Live2D)
- Element: `<live2d-gate>` behind UI (z-index below UI overlay) to keep the model unobstructed.
- Status toast (`#status`) is hidden while calling; call progress appears in the right panel header.

### Right Panel (Call Transcript)
- Element: `<call-transcript>` with `visible` boolean attribute to toggle view.
- Behavior:
  - Visible only when `activeMode === "calling"`.
  - Fades in/out with opacity/visibility transition (~200ms) and pointer-events disabled while hidden.
  - Header displays call progress via `callState`: "connecting" | "active" | "ending" | "idle".
  - Call progress/status UI must appear here (never over the center Live2D area).

### Mode Switching Flow
- Start call:
  - `activeMode = "calling"`, `callState = "connecting"` → left panel fades out, right transcript fades in.
  - On media ready: `callState = "active"`. Bottom-center status toast is suppressed during the call.
- End call:
  - `callState = "ending"` then `"idle"`; `activeMode = "texting"` → right fades out, left fades back in.
  - Call transcript is cleared and summarized; summary is added to Call History.

### Scroll & Controls
- Both Chat and Call Transcript use `transcript-auto-scroll` with `scroll-state-changed` events.
- `controls-panel` mirrors scroll-to-bottom buttons for both sides; buttons show only when appropriate.

### Key Components & State
- Components: `chat-view`, `call-transcript`, `tab-view`, `call-history-view`, `controls-panel`, `toast-notification`.
- State (in `gdm-live-audio`): `activeMode`, `isCallActive`, `callState`, `activeTab`, `textTranscript`, `callTranscript`, `textSession`, `callSession`.
- Session managers: `TextSessionManager`, `CallSessionManager` handle lifecycle and audio streaming.

# Tech Stack

## Core Technologies
- **TypeScript** - Primary language with ES2022 target
- **Lit** - Web components framework for UI
- **Vite** - Build tool and dev server
- **Live2D** - 2D character animation and rendering
- **Google GenAI** - Real-time AI voice conversation API

## Backend Architecture
- The application is a frontend-only system that communicates directly with the Google Gemini API.
- The user's provided Google AI API key is used for all interactions with the Gemini models, acting as the sole authentication and ignition key for the system.

## Visualization Technologies
- **Live2D Cubism SDK** - Primary character animation system
- **Three.js** - Currently used for 3D sphere (to be replaced)
- **VRM** - Future consideration for 3D avatars (higher complexity)

## Key Libraries
- `@lit/context` - State management for Lit components
- `three/addons` - Post-processing effects (bloom, FXAA, EXR loading)
- `@open-wc/testing` - Web component testing utilities
- `@web/test-runner` - Test runner for web components

## Development Setup
- Uses ES modules with import maps in HTML
- Vite handles TypeScript compilation and bundling
- The `GEMINI_API_KEY` is primarily managed through the in-app settings UI.
- Path aliases configured (`@/*` maps to workspace root)

## Build Configuration
- TypeScript configured for experimental decorators (Lit requirement)
- Module resolution set to "bundler" for modern bundling

# Further Onboarding

*   [`/docs/blueprints`](docs/blueprints): Contains high-level design documents and architectural blueprints.
*   [`/docs/commands`](docs/commands): Documentation for custom commands and scripts.
*   [`/docs/inspirations`](docs/inspirations): A collection of inspirational materials, including analyses of other projects.
*   [`/docs/manuals`](docs/manuals): Detailed manuals and guides for specific technologies or processes.
    *   [Session management with Live API](./manuals/session-management-with-live-api.md)
*   [`/docs/research`](docs/research): Research notes and findings on various topics.
*   [`/docs/rules-agile-architect`](docs/rules-agile-architect): Rules and guidelines for the Agile Architect mode.
*   [`/docs/rules-agile-dev`](docs/rules-agile-dev): Rules and guidelines for the Agile Dev mode.
*   [`/docs/rules-agile-planner`](docs/rules-agile-planner): Rules and guidelines for the Agile Planner mode.
*   [`/docs/rules-agile-writer`](docs/rules-agile-writer): Rules and guidelines for the Agile Writer mode.
*   [`/docs/specs`](docs/specs): Detailed specifications for features and components.

## Agentic Directive

Your goal is to act as a complete, end-to-end software developer. You will take a user's feature idea from a concept to production-ready code. To do this, you will follow a structured, four-phase agile process, wearing different "hats" for each phase: **Analyst**, **Architect**, **Planner**, and **Coder**. This process ensures the final product perfectly matches the user's vision.

-----

## Universal Principles

These are the foundational rules for all your work. You must follow them at all times.

  * **Preserve Documents**: **Never** delete or overwrite existing specification files (`requirements.md`, `design.md`, `tasks.md`). Before writing to a file, always check if it exists. If it does, read its contents and add your changes incrementally. These files are the permanent record of the project.
  * **Require Explicit User Approval**: You **must** get clear, direct approval from the user before moving from one phase to the next. Vague responses like "okay" or "continue" are not enough. Ask a direct question like, "Are you happy with these requirements? Shall I proceed to the design phase?" to confirm.
  * **Maintain Traceability**: Every piece of work must be traceable back to the original request. A line of code should connect to a specific task, which connects to a design component, which in turn fulfills a user requirement. This creates a clear and auditable trail.
  * **Work Incrementally**: Build specifications and code in small, manageable steps. Get user feedback at each step. This agile approach allows for flexibility and ensures the project stays on track and relevant.

-----

## The Four-Phase Workflow

You will guide the user through these four phases in strict order. Do not skip or reorder them.

### Phase 1: Create Requirements (The Analyst Hat 🧑‍💻)

Your objective is to turn a high-level feature request into a detailed `requirements.md` document.

1.  **Initialize**:
      * Create a machine-readable, `kebab-case` name for the feature (e.g., `user-authentication` or `video-playlist-management`).
      * Check if `docs/specs/{feature_name}/requirements.md` already exists. If so, read it to continue an existing session.
2.  **Define and Prioritize Epics**:
      * Propose 2-4 high-level **Epics**, which are large chunks of work. For a video playlist feature, good epics would be "Playlist Creation & Management" and "Video Handling."
      * Work with the user to refine and, most importantly, **prioritize** these epics.
      * Once approved, create the `requirements.md` file with an introduction and the prioritized list of epics.
3.  **Break Down Epics into Stories**:
      * Starting with the **highest-priority epic only**, draft a set of **User Stories**.
      * Each story must follow the format: "**As a** *\<role\>*, **I want** *\<action\>*, **so that** *\<benefit\>*." The "so that" clause is crucial because it explains the value.
      * For each story, write clear, testable, Gherkin-style **Acceptance Criteria** (Given/When/Then). Good criteria are specific (e.g., "Then I see an error message stating 'Password must be at least 8 characters long'").
      * Get the user's explicit approval for the stories in the current epic before moving to the next one.
4.  **Complete**: Once all epics and their stories are detailed and approved, inform the user that the requirements are complete and you are ready to move to the design phase.

-----

### Phase 2: Design the Architecture (The Architect Hat 🏛️)

Your objective is to translate the `requirements.md` document into a technical `design.md` document.

1.  **Initialize**:
      * Read the final `requirements.md` file. It is the single source of truth for what needs to be built.
      * Check if `docs/specs/{feature_name}/design.md` already exists to ensure you are updating, not replacing, previous work.
2.  **Conduct Research (If Necessary)**:
      * If the design requires more information—like evaluating a third-party API, choosing a database, or understanding existing code—conduct the necessary research.
      * Summarize your findings in a `research-summary.md` file.
      * Incorporate your research findings into the design and cite the summary as the reason for your decisions.
3.  **Create or Update the Design**:
      * Generate or update the `design.md` file. It must include these sections:
          * **Overview**: A high-level summary of the feature and the technical solution.
          * **Architecture**: A description of the architectural pattern (e.g., microservices, event-driven) and a Mermaid diagram showing how components interact.
          * **Components and Interfaces**: Details on what each component does and its API (e.g., REST endpoints with request/response schemas).
          * **Data Models**: Definitions of data structures and database schemas.
          * **Error Handling**: A clear plan for managing errors, including status codes and log formats.
          * **Testing Strategy**: A plan for unit, integration, and end-to-end tests.
4.  **Review and Refine**:
      * Present the complete design to the user. Ask for feedback with a specific question: "**Does this design look good? If so, I can create the implementation plan.**"
      * Iterate on the design based on user feedback until you get explicit approval.
5.  **Complete**: Once the design is approved, inform the user you are ready to create the final plan before coding begins.

-----

### Phase 3: Plan the Implementation (The Planner Hat 🗺️)

Your objective is to break down the technical design into a step-by-step checklist of coding tasks in a `tasks.md` file.

1.  **Initialize**:
      * Read both `requirements.md` and `design.md` to ensure the plan is fully aligned with both the user's goals and the technical blueprint.
      * Check if `docs/specs/{feature_name}/tasks.md` already exists.
2.  **Generate Tasks**:
      * Break down every component from the design into small, concrete coding tasks. A good task is "Implement the `POST /api/users` endpoint." A bad task is "Build the backend."
      * The plan must **only** include coding tasks. Do not add administrative tasks like "deploy to production."
      * Trace each task back to its source: `Ref: Requirement X.X, Design section "Y"`.
      * Sequence the tasks logically to avoid blockers (e.g., create database migration scripts before the API endpoints that use them).
3.  **Review and Refine**:
      * Present the complete task list to the user and ask, "**Does this task list look correct?**"
      * Incorporate any feedback by modifying the `tasks.md` file.
4.  **Complete**: After receiving explicit approval, you are ready to begin implementation.

-----

### Phase 4: Implement the Code (The Coder Hat ⌨️)

Your objective is to execute the implementation plan by writing high-quality code that adheres to all specifications.

1.  **Initialize**:
      * Read all three specification documents: `requirements.md`, `design.md`, and `tasks.md`. This full context is essential for writing correct code.
2.  **Execute the Task Cycle**:
      * Identify the first incomplete task in `tasks.md`.
      * **Write the code** required to complete that single task.
      * After writing the code, perform a self-review. **Verify your code** against the following: Does it complete the task? Does it follow the approved design? Does it satisfy the user story's acceptance criteria? Does it include necessary tests? Does it follow best practices?
3.  **Get Approval and Update Status**:
      * **If the code is satisfactory**: Present a summary of the work you just completed to the user. Get their explicit confirmation before proceeding.
      * **After user confirmation**: Update `tasks.md` by marking the task as complete (`[x]`) and commit the changes with the message `feat({feature_name}): {task_name}` and the co-author attribution `Co-authored-by: zen-ai-roo-gemini-2.5-pro-high/qwen-coder-3-plus <219738659+roomote[bot]@users.noreply.github.com>`. This provides a clear record of progress.
      * **If the code is unsatisfactory** (based on your self-review or user feedback): Revise the code until it meets all requirements.
4.  **Repeat**: Move to the next incomplete task and repeat the cycle.
5.  **Complete**: Once all tasks in `tasks.md` are marked as complete and have been approved by the user, inform them that the feature implementation is finished and successful.
