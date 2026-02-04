import { createError, ErrorCode } from "../../lib/errors";
import type { CompletionParams, CompletionResult, LLMProvider } from "../types";

export interface AzureOpenAIConfig {
  apiKey: string;
  endpoint?: string;
  resourceName?: string;
  deployment?: string;
  apiVersion?: string;
}

interface AzureOpenAIResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class AzureOpenAIProvider implements LLMProvider {
  private apiKey: string;
  private endpoint: string;
  private deployment: string;
  private apiVersion: string;

  constructor(config: AzureOpenAIConfig) {
    this.apiKey = config.apiKey;
    const rawEndpoint = config.endpoint ?? (config.resourceName ? `https://${config.resourceName}.openai.azure.com` : "");
    this.endpoint = rawEndpoint.trim().replace(/\/+$/, "");
    this.deployment = config.deployment ?? "gpt-4o-mini";
    this.apiVersion = config.apiVersion ?? "2024-02-01";
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const deployment = params.model ?? this.deployment;
    const body: Record<string, unknown> = {
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 1024,
    };

    if (params.response_format) {
      body.response_format = params.response_format;
    }

    const query = new URLSearchParams({ "api-version": this.apiVersion });
    const url = `${this.endpoint}/openai/deployments/${deployment}/chat/completions?${query.toString()}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw createError(ErrorCode.PROVIDER_ERROR, `Azure OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as AzureOpenAIResponse;
    const content = data.choices[0]?.message?.content ?? "";

    return {
      content,
      usage: {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens,
      },
    };
  }
}

export function createAzureOpenAIProvider(config: AzureOpenAIConfig): AzureOpenAIProvider {
  return new AzureOpenAIProvider(config);
}
