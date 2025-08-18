import type { GoogleGenAI } from "@google/genai";
import { expect } from "chai";
import sinon from "sinon";
import { energyBarService } from "../EnergyBarService";
import { InteractionManager } from "../InteractionManager";

import { PersonaManager } from "@features/persona/PersonaManager";
import { SummarizationService } from "@features/summarization/SummarizationService";
import { CallSessionManager } from "../CallSessionManager";
import { TextSessionManager } from "../TextSessionManager";

describe("InteractionManager", () => {
  let interactionManager: InteractionManager;
  let mockTextSessionManager: sinon.SinonStubbedInstance<TextSessionManager>;
  let mockCallSessionManager: sinon.SinonStubbedInstance<CallSessionManager>;
  let mockSummarizationService: sinon.SinonStubbedInstance<SummarizationService>;
  let mockEnergyBarService: sinon.SinonStubbedInstance<typeof energyBarService>;
  let mockClient: GoogleGenAI;
  let mockPersonaManager: sinon.SinonStubbedInstance<PersonaManager>;
  let dispatchEventStub: sinon.SinonStub;

  beforeEach(() => {
    mockTextSessionManager = sinon.createStubInstance(TextSessionManager);
    mockCallSessionManager = sinon.createStubInstance(CallSessionManager);
    mockSummarizationService = sinon.createStubInstance(SummarizationService);
    mockEnergyBarService = sinon.stub(energyBarService);
    mockClient = {} as GoogleGenAI;
    mockPersonaManager = sinon.createStubInstance(PersonaManager);

    interactionManager = new InteractionManager(
      mockTextSessionManager,
      mockCallSessionManager,
      mockSummarizationService,
      mockEnergyBarService,
      mockClient,
      mockPersonaManager,
    );

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
      interactionManager.handleEvent({ type: "start-call" });
      expect(dispatchEventStub.calledOnce).to.be.true;
      expect(dispatchEventStub.firstCall.args[0].type).to.equal(
        "call-session-ready",
      );
    });

    it("should handle send-message event", async () => {
      interactionManager.handleEvent({
        type: "send-message",
        detail: { message: "Hello, world!" },
      });
      // Test that sendTextMessage is called
    });

    it("should handle clear-chat event", () => {
      interactionManager.handleEvent({ type: "clear-chat" });
      expect(dispatchEventStub.calledOnce).to.be.true;
      expect(dispatchEventStub.firstCall.args[0].type).to.equal("chat-cleared");
    });

    it("should handle unknown events gracefully", () => {
      interactionManager.handleEvent({ type: "unknown-event" });
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
