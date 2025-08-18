import { GdmLiveAudio } from "@app/main";
import { expect } from "chai";

// Mock the Google GenAI client
class MockSession {
  private callbacks: Record<string, (...args: unknown[]) => void> = {};

  async connect(options: {
    callbacks: Record<string, (...args: unknown[]) => void>;
  }) {
    this.callbacks = options.callbacks;
    (this as unknown as { isOpen: boolean }).isOpen = true;
    if (this.callbacks.onopen) {
      setTimeout(() => this.callbacks.onopen(), 10);
    }
    return this;
  }

  sendClientContent(content: { turns: { parts: { text: string }[] }[] }) {
    // Simulate model response
    setTimeout(() => {
      if (this.callbacks.onmessage) {
        this.callbacks.onmessage({
          serverContent: {
            modelTurn: {
              parts: [
                { text: `Mock response to: ${content.turns[0].parts[0].text}` },
              ],
            },
          },
        });
      }
    }, 50);
  }

  sendRealtimeInput(_input: unknown) {
    // Simulate real-time audio response
    setTimeout(() => {
      if (this.callbacks.onmessage) {
        this.callbacks.onmessage({
          serverContent: {
            modelTurn: {
              parts: [{ text: "Mock audio response" }],
            },
          },
        });
      }
    }, 50);
  }

  close() {
    (this as unknown as { isOpen: boolean }).isOpen = false;
    if (this.callbacks.onclose) {
      setTimeout(() => this.callbacks.onclose({ reason: "Manual close" }), 10);
    }
  }
}

class MockGoogleGenAI {
  live = {
    connect: async (options: {
      callbacks: Record<string, (...args: unknown[]) => void>;
    }) => {
      return new MockSession().connect(options);
    },
  };
}

describe("Dual-Context System", () => {
  let element: GdmLiveAudio;

  beforeEach(() => {
    // Mock localStorage
    localStorage.setItem("gemini-api-key", `AIzaSy${"a".repeat(33)}`);

    // Mock GoogleGenAI
    (window as unknown as { GoogleGenAI: unknown }).GoogleGenAI =
      MockGoogleGenAI;

    // Mock getUserMedia
    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getUserMedia: () =>
          Promise.resolve({
            getTracks: () => [{ stop: () => {} }],
          }),
      },
    });

    // Mock AudioContext
    (window as unknown as { AudioContext: unknown }).AudioContext =
      class MockAudioContext {
        currentTime = 0;
        sampleRate = 16000;
        destination = { connect: () => {} };

        createGain() {
          return {
            connect: () => {},
            disconnect: () => {},
          };
        }

        createMediaStreamSource() {
          return {
            connect: () => {},
            disconnect: () => {},
          };
        }

        createScriptProcessor() {
          return {
            connect: () => {},
            disconnect: () => {},
            onaudioprocess: null,
          };
        }

        createBufferSource() {
          return {
            buffer: null,
            connect: () => {},
            start: () => {},
            stop: () => {},
            addEventListener: () => {},
          };
        }

        resume() {
          return Promise.resolve();
        }

        decodeAudioData() {
          return Promise.resolve({
            duration: 1.0,
          });
        }
      };

    // Create element instance directly for unit testing
    element = new GdmLiveAudio();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("State Management", () => {
    it("should initialize with texting mode as default", async () => {
      expect(element.activeMode).to.equal("texting");
      expect(element.textTranscript).to.be.an("array").that.is.empty;
      expect(element.callTranscript).to.be.an("array").that.is.empty;
    });

    it("should maintain separate transcript arrays for text and call modes", async () => {
      // Add message to text transcript
      const textMessage = {
        text: "Hello text",
        sender: "user" as const,
        id: "1",
        timestamp: new Date(),
      };
      element.textTranscript = [textMessage];
      await element.updateComplete;

      // Switch to calling mode and add call transcript
      element.activeMode = "calling";
      const callMessage = {
        text: "Hello call",
        sender: "user" as const,
        id: "2",
        timestamp: new Date(),
      };
      element.callTranscript = [callMessage];
      await element.updateComplete;

      // Verify both transcripts are preserved independently
      expect(element.textTranscript).to.have.lengthOf(1);
      expect(element.textTranscript[0].text).to.equal("Hello text");
      expect(element.callTranscript).to.have.lengthOf(1);
      expect(element.callTranscript[0].text).to.equal("Hello call");
    });

    it("should switch active mode correctly", async () => {
      expect(element.activeMode).to.equal("texting");

      element.activeMode = "calling";
      await element.updateComplete;
      expect(element.activeMode).to.equal("calling");

      element.activeMode = "texting";
      await element.updateComplete;
      expect(element.activeMode).to.equal("texting");
    });

    it("should preserve context when switching between modes", async () => {
      // Add content to text mode
      element.textTranscript = [
        {
          text: "Text message 1",
          sender: "user",
          id: "1",
          timestamp: new Date(),
        },
      ];
      await element.updateComplete;

      // Switch to calling mode
      element.activeMode = "calling";
      element.callTranscript = [
        {
          text: "Call message 1",
          sender: "user",
          id: "2",
          timestamp: new Date(),
        },
      ];
      await element.updateComplete;

      // Switch back to texting mode
      element.activeMode = "texting";
      await element.updateComplete;

      // Verify text context is preserved
      expect(element.textTranscript).to.have.lengthOf(1);
      expect(element.textTranscript[0].text).to.equal("Text message 1");
      expect(element.callTranscript).to.have.lengthOf(1);
      expect(element.callTranscript[0].text).to.equal("Call message 1");
    });
  });

  describe("Session Management", () => {
    it("should initialize text session when in texting mode", async () => {
      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(element.textSession).to.not.be.null;
    });

    it("should maintain separate sessions for TTS and STS", async () => {
      // Wait for text session initialization
      await new Promise((resolve) => setTimeout(resolve, 100));
      const textSession = element.textSession;

      // Simulate call start to initialize call session
      element.activeMode = "calling";
      await element.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(element.textSession).to.equal(textSession);
      expect(element.callSession).to.not.be.null;
      expect(element.textSession).to.not.equal(element.callSession);
    });
  });

  describe("Audio Node Management", () => {
    it("should update outputNode based on active mode", async () => {
      // Initially in texting mode
      const initialOutputNode = element.outputNode;

      // Switch to calling mode
      element.activeMode = "calling";
      await element.updateComplete;

      // OutputNode should change for calling mode
      expect(element.outputNode).to.not.equal(initialOutputNode);

      // Switch back to texting mode
      element.activeMode = "texting";
      await element.updateComplete;

      // OutputNode should revert to text mode
      expect(element.outputNode).to.equal(initialOutputNode);
    });
  });

  describe("Reset Functionality", () => {
    it("should have separate reset methods for text and call contexts", () => {
      // Verify the methods exist
      expect(typeof (element as any)._resetTextContext).to.equal("function");
      expect(typeof (element as any)._resetCallContext).to.equal("function");
    });

    it("should reset only text context when _resetTextContext is called", () => {
      // Add content to both transcripts
      element.textTranscript = [
        {
          text: "Text message",
          sender: "user",
          id: "1",
          timestamp: new Date(),
        },
      ];
      element.callTranscript = [
        {
          text: "Call message",
          sender: "user",
          id: "2",
          timestamp: new Date(),
        },
      ];

      // Call the text reset method directly
      (element as any)._resetTextContext();

      // Only text transcript should be cleared
      expect(element.textTranscript).to.be.empty;
      expect(element.callTranscript).to.have.lengthOf(1);
    });

    it("should reset only call context when _resetCallContext is called", () => {
      // Add content to both transcripts
      element.textTranscript = [
        {
          text: "Text message",
          sender: "user",
          id: "1",
          timestamp: new Date(),
        },
      ];
      element.callTranscript = [
        {
          text: "Call message",
          sender: "user",
          id: "2",
          timestamp: new Date(),
        },
      ];

      // Call the call reset method directly
      (element as any)._resetCallContext();

      // Only call transcript should be cleared
      expect(element.textTranscript).to.have.lengthOf(1);
      expect(element.callTranscript).to.be.empty;
    });
  });
});
