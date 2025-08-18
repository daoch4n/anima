import type { GoogleGenAI } from "@google/genai";
import { expect } from "chai";
import sinon from "sinon";
import { energyBarService } from "../EnergyBarService";
import { InteractionManager } from "../InteractionManager";

describe("InteractionManager", () => {
  let interactionManager: InteractionManager;
  let mockClient: GoogleGenAI;
  let dispatchEventStub: sinon.SinonStub;

  beforeEach(() => {
    // Create a mock GoogleGenAI client
    mockClient = {} as GoogleGenAI;

    // Create interaction manager instance
    interactionManager = new InteractionManager(mockClient);

    // Stub document.dispatchEvent to capture events
    dispatchEventStub = sinon.stub(document, "dispatchEvent");
  });

  afterEach(() => {
    // Restore stubs
    sinon.restore();

    // Clean up interaction manager
    interactionManager.destroy();
  });

  describe("handleEvent", () => {
    it("should handle start-call event", () => {
      const event = new CustomEvent("start-call");

      interactionManager.handleEvent(event);

      // Should dispatch call-session-ready event
      expect(dispatchEventStub.calledOnce).to.be.true;
      expect(dispatchEventStub.firstCall.args[0].type).to.equal(
        "call-session-ready",
      );
    });

    it("should handle send-message event", async () => {
      const event = new CustomEvent("send-message", {
        detail: { message: "Hello, world!" },
      });

      // Since we don't have a real session, this should fail
      // but we're mainly testing that it tries to handle the event
      try {
        interactionManager.handleEvent(event);
      } catch (error) {
        // Expected since we don't have a real session
      }

      // Should not dispatch any events for successful text message
      // (that would happen in the session manager)
    });

    it("should handle clear-chat event", () => {
      const event = new CustomEvent("clear-chat");

      interactionManager.handleEvent(event);

      // Should dispatch chat-cleared event
      expect(dispatchEventStub.calledOnce).to.be.true;
      expect(dispatchEventStub.firstCall.args[0].type).to.equal("chat-cleared");
    });

    it("should handle unknown events gracefully", () => {
      const event = new CustomEvent("unknown-event");

      interactionManager.handleEvent(event);

      // Should not dispatch any events
      expect(dispatchEventStub.notCalled).to.be.true;
    });
  });

  describe("onRateLimitError", () => {
    it("should handle STS rate limit error", () => {
      // This is mainly testing that the method exists and doesn't throw
      interactionManager.onRateLimitError("sts");
    });

    it("should handle TTS rate limit error", () => {
      // This is mainly testing that the method exists and doesn't throw
      interactionManager.onRateLimitError("tts");
    });
  });

  describe("getTextMessages", () => {
    it("should return empty array when no text session exists", () => {
      const messages = interactionManager.getTextMessages();
      expect(messages).to.be.an("array").that.is.empty;
    });
  });

  describe("getCallTranscript", () => {
    it("should return empty array when no call session exists", () => {
      const transcript = interactionManager.getCallTranscript();
      expect(transcript).to.be.an("array").that.is.empty;
    });
  });
});
