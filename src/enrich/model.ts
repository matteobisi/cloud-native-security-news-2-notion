import type { PipelineConfig } from "../types";

function extractJson(content: string): unknown {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("model response contained no JSON array");
  }
  return JSON.parse(content.slice(start, end + 1));
}

export async function callJsonModel(
  model: PipelineConfig["model"],
  prompt: string,
): Promise<unknown> {
  const res = await fetch(`${model.baseUrl}/chat/completions`, {
    signal: AbortSignal.timeout(120_000),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.name,
      temperature: model.temperature,
      max_tokens: model.maxTokens,
      messages: [
        {
          role: "system",
          content:
            "You are a cloud-native security news editor. Respond with a JSON array only. Never invent facts or URLs.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`model runner responded ${res.status}`);
  }

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content ?? "";
  return extractJson(content);
}
