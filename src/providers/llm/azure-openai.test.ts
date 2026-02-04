import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "../../lib/errors";
import { AzureOpenAIProvider, createAzureOpenAIProvider } from "./azure-openai";

describe("Azure OpenAI Provider", () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("createAzureOpenAIProvider", () => {
    it("creates provider with required config", () => {
      const provider = createAzureOpenAIProvider({
        apiKey: "azure-key",
        endpoint: "https://example.openai.azure.com",
      });
      expect(provider).toBeInstanceOf(AzureOpenAIProvider);
    });

    it("creates provider with resource name", () => {
      const provider = createAzureOpenAIProvider({
        apiKey: "azure-key",
        resourceName: "example",
      });
      expect(provider).toBeInstanceOf(AzureOpenAIProvider);
    });
  });

  describe("complete", () => {
    it("sends correct request to Azure OpenAI API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "chatcmpl-123",
          choices: [{ message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createAzureOpenAIProvider({
        apiKey: "azure-key",
        endpoint: "https://example.openai.azure.com/",
        deployment: "chat-deploy",
        apiVersion: "2024-02-01",
      });

      await provider.complete({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const [url, options] = call;

      expect(url).toBe(
        "https://example.openai.azure.com/openai/deployments/chat-deploy/chat/completions?api-version=2024-02-01"
      );
      expect(options.method).toBe("POST");
      expect(options.headers).toMatchObject({
        "Content-Type": "application/json",
        "api-key": "azure-key",
      });

      const body = JSON.parse(options.body as string);
      expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(1024);
      expect(body.model).toBeUndefined();
    });

    it("uses params.model to override deployment", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "chatcmpl-123",
          choices: [{ message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const provider = createAzureOpenAIProvider({
        apiKey: "azure-key",
        endpoint: "https://example.openai.azure.com",
        deployment: "default-deploy",
      });

      await provider.complete({
        model: "override-deploy",
        messages: [{ role: "user", content: "Hi" }],
      });

      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toContain("/openai/deployments/override-deploy/chat/completions");
    });

    it("throws PROVIDER_ERROR on API failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Invalid API key",
      });

      const provider = createAzureOpenAIProvider({
        apiKey: "azure-key",
        endpoint: "https://example.openai.azure.com",
      });

      await expect(provider.complete({ messages: [{ role: "user", content: "Test" }] })).rejects.toMatchObject({
        code: ErrorCode.PROVIDER_ERROR,
      });
    });
  });
});
