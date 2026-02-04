import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../env.d";

describe("LLM Provider Factory", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("createLLMProvider", () => {
    describe("openai-raw provider", () => {
      it("creates OpenAI provider with API key", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: "test",
            choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const { createLLMProvider } = await import("./factory");
        const env = {
          OPENAI_API_KEY: "sk-test",
          LLM_PROVIDER: "openai-raw",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).not.toBeNull();
      });

      it("returns null when OPENAI_API_KEY is missing", async () => {
        const { createLLMProvider } = await import("./factory");
        const env = {
          LLM_PROVIDER: "openai-raw",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).toBeNull();
      });

      it("uses default model gpt-4o-mini", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: "test",
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const { createLLMProvider } = await import("./factory");
        const env = {
          OPENAI_API_KEY: "sk-test",
          LLM_PROVIDER: "openai-raw",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        await provider!.complete({ messages: [{ role: "user", content: "hi" }] });

        const call = fetchMock.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(call[1].body as string);
        expect(body.model).toBe("gpt-4o-mini");
      });

      it("uses LLM_MODEL when provided", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: "test",
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const { createLLMProvider } = await import("./factory");
        const env = {
          OPENAI_API_KEY: "sk-test",
          LLM_PROVIDER: "openai-raw",
          LLM_MODEL: "gpt-4o",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        await provider!.complete({ messages: [{ role: "user", content: "hi" }] });

        const call = fetchMock.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(call[1].body as string);
        expect(body.model).toBe("gpt-4o");
      });

      it("strips provider prefix from model name", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: "test",
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const { createLLMProvider } = await import("./factory");
        const env = {
          OPENAI_API_KEY: "sk-test",
          LLM_PROVIDER: "openai-raw",
          LLM_MODEL: "openai/gpt-4o",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        await provider!.complete({ messages: [{ role: "user", content: "hi" }] });

        const call = fetchMock.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(call[1].body as string);
        expect(body.model).toBe("gpt-4o");
      });

      it("uses OPENAI_BASE_URL for request URL", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: "test",
            choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const { createLLMProvider } = await import("./factory");
        const env = {
          OPENAI_API_KEY: "test",
          OPENAI_BASE_URL: "https://example.com/v1/",
          LLM_PROVIDER: "openai-raw",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).not.toBeNull();

        await provider!.complete({
          messages: [{ role: "user", content: "hi" }],
        });

        expect(fetchMock).toHaveBeenCalledWith("https://example.com/v1/chat/completions", expect.any(Object));
      });
    });

    describe("azure-openai provider", () => {
      it("creates Azure OpenAI provider with endpoint", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: "test",
            choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const { createLLMProvider } = await import("./factory");
        const env = {
          AZURE_API_KEY: "azure-test",
          AZURE_ENDPOINT: "https://example.openai.azure.com",
          LLM_PROVIDER: "azure-openai",
          LLM_MODEL: "chat-deploy",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).not.toBeNull();

        await provider!.complete({ messages: [{ role: "user", content: "hi" }] });
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("https://example.openai.azure.com/openai/deployments/chat-deploy/chat/completions"),
          expect.any(Object)
        );
      });

      it("uses AZURE_RESOURCE_NAME when endpoint is missing", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: "test",
            choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const { createLLMProvider } = await import("./factory");
        const env = {
          AZURE_API_KEY: "azure-test",
          AZURE_RESOURCE_NAME: "resource-name",
          LLM_PROVIDER: "azure-openai",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).not.toBeNull();

        await provider!.complete({ messages: [{ role: "user", content: "hi" }] });
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("https://resource-name.openai.azure.com/openai/deployments"),
          expect.any(Object)
        );
      });

      it("returns null when missing key or endpoint", async () => {
        const { createLLMProvider } = await import("./factory");
        const env = {
          LLM_PROVIDER: "azure-openai",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).toBeNull();
      });
    });

    describe("ai-sdk provider", () => {
      it("creates AI SDK provider with OpenAI key", async () => {
        const createOpenAIMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );
        const createAnthropicMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );
        const createGoogleMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );
        const createXaiMock = vi.fn(() => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>);
        const createDeepSeekMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );

        vi.doMock("@ai-sdk/openai", () => ({ createOpenAI: createOpenAIMock }));
        vi.doMock("@ai-sdk/anthropic", () => ({ createAnthropic: createAnthropicMock }));
        vi.doMock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: createGoogleMock }));
        vi.doMock("@ai-sdk/xai", () => ({ createXai: createXaiMock }));
        vi.doMock("@ai-sdk/deepseek", () => ({ createDeepSeek: createDeepSeekMock }));

        const { createLLMProvider } = await import("./factory");
        const env = {
          OPENAI_API_KEY: "sk-test",
          LLM_PROVIDER: "ai-sdk",
          LLM_MODEL: "openai/gpt-4o",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).not.toBeNull();
        expect(createOpenAIMock).toHaveBeenCalledWith({ apiKey: "sk-test" });
      });

      it("creates AI SDK provider with Anthropic key", async () => {
        const createOpenAIMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );
        const createAnthropicMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );
        const createGoogleMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );
        const createXaiMock = vi.fn(() => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>);
        const createDeepSeekMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );

        vi.doMock("@ai-sdk/openai", () => ({ createOpenAI: createOpenAIMock }));
        vi.doMock("@ai-sdk/anthropic", () => ({ createAnthropic: createAnthropicMock }));
        vi.doMock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: createGoogleMock }));
        vi.doMock("@ai-sdk/xai", () => ({ createXai: createXaiMock }));
        vi.doMock("@ai-sdk/deepseek", () => ({ createDeepSeek: createDeepSeekMock }));

        const { createLLMProvider } = await import("./factory");
        const env = {
          ANTHROPIC_API_KEY: "sk-ant-test",
          LLM_PROVIDER: "ai-sdk",
          LLM_MODEL: "anthropic/claude-sonnet-4",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).not.toBeNull();
        expect(createAnthropicMock).toHaveBeenCalledWith({ apiKey: "sk-ant-test" });
      });

      it("returns null when no API keys are set", async () => {
        const { createLLMProvider } = await import("./factory");
        const env = {
          LLM_PROVIDER: "ai-sdk",
          LLM_MODEL: "openai/gpt-4o",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).toBeNull();
      });

      it("returns null when model requires missing API key", async () => {
        const createOpenAIMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );
        vi.doMock("@ai-sdk/openai", () => ({ createOpenAI: createOpenAIMock }));

        const { createLLMProvider } = await import("./factory");
        const env = {
          OPENAI_API_KEY: "sk-test",
          LLM_PROVIDER: "ai-sdk",
          LLM_MODEL: "anthropic/claude-sonnet-4",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).toBeNull();
      });

      it("passes OPENAI_BASE_URL to @ai-sdk/openai createOpenAI", async () => {
        const createOpenAIMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );
        const createAnthropicMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );
        const createGoogleMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );
        const createXaiMock = vi.fn(() => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>);
        const createDeepSeekMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );

        vi.doMock("@ai-sdk/openai", () => ({ createOpenAI: createOpenAIMock }));
        vi.doMock("@ai-sdk/anthropic", () => ({ createAnthropic: createAnthropicMock }));
        vi.doMock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: createGoogleMock }));
        vi.doMock("@ai-sdk/xai", () => ({ createXai: createXaiMock }));
        vi.doMock("@ai-sdk/deepseek", () => ({ createDeepSeek: createDeepSeekMock }));

        const { createLLMProvider } = await import("./factory");
        const env = {
          OPENAI_API_KEY: "test",
          OPENAI_BASE_URL: "https://proxy.example/v1/",
          LLM_PROVIDER: "ai-sdk",
          LLM_MODEL: "openai/gpt-4o-mini",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).not.toBeNull();

        expect(createOpenAIMock).toHaveBeenCalledWith({
          apiKey: "test",
          baseURL: "https://proxy.example/v1",
        });
      });

      it("ignores whitespace OPENAI_BASE_URL", async () => {
        const createOpenAIMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );
        const createAnthropicMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );
        const createGoogleMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );
        const createXaiMock = vi.fn(() => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>);
        const createDeepSeekMock = vi.fn(
          () => ((modelId: string) => ({ modelId })) as unknown as ReturnType<typeof vi.fn>
        );

        vi.doMock("@ai-sdk/openai", () => ({ createOpenAI: createOpenAIMock }));
        vi.doMock("@ai-sdk/anthropic", () => ({ createAnthropic: createAnthropicMock }));
        vi.doMock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: createGoogleMock }));
        vi.doMock("@ai-sdk/xai", () => ({ createXai: createXaiMock }));
        vi.doMock("@ai-sdk/deepseek", () => ({ createDeepSeek: createDeepSeekMock }));

        const { createLLMProvider } = await import("./factory");
        const env = {
          OPENAI_API_KEY: "test",
          OPENAI_BASE_URL: "   ",
          LLM_PROVIDER: "ai-sdk",
          LLM_MODEL: "openai/gpt-4o-mini",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).not.toBeNull();

        expect(createOpenAIMock).toHaveBeenCalledWith({
          apiKey: "test",
        });
      });
    });

    describe("cloudflare-gateway provider", () => {
      it("creates Cloudflare Gateway provider with all credentials", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const { createLLMProvider } = await import("./factory");
        const env = {
          CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID: "acc-123",
          CLOUDFLARE_AI_GATEWAY_ID: "gw-456",
          CLOUDFLARE_AI_GATEWAY_TOKEN: "token-789",
          LLM_PROVIDER: "cloudflare-gateway",
          LLM_MODEL: "openai/gpt-4o",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).not.toBeNull();
      });

      it("returns null when credentials are missing", async () => {
        const { createLLMProvider } = await import("./factory");
        const env = {
          LLM_PROVIDER: "cloudflare-gateway",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).toBeNull();
      });

      it("returns null when only account ID is set", async () => {
        const { createLLMProvider } = await import("./factory");
        const env = {
          CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID: "acc-123",
          LLM_PROVIDER: "cloudflare-gateway",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).toBeNull();
      });
    });

    describe("default provider", () => {
      it("defaults to openai-raw when LLM_PROVIDER not set", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: "test",
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const { createLLMProvider } = await import("./factory");
        const env = {
          OPENAI_API_KEY: "sk-test",
        } as unknown as Env;

        const provider = createLLMProvider(env);
        expect(provider).not.toBeNull();

        await provider!.complete({ messages: [{ role: "user", content: "hi" }] });
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("api.openai.com"), expect.any(Object));
      });
    });
  });
});
