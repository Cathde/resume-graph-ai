type AiRequest = {
  provider?: "deepseek" | "openai" | "custom";
  endpoint?: string;
  apiKey?: string;
  model?: string;
  prompt?: string;
  mode?: "test" | "analyze";
};

const PROVIDER_ENDPOINTS = {
  deepseek: "https://api.deepseek.com/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
} as const;

function resolveEndpoint(provider: AiRequest["provider"], input: string) {
  if (provider === "deepseek" || provider === "openai") return PROVIDER_ENDPOINTS[provider];
  if (provider !== "custom") throw new Error("AI 服务商无效");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("自定义 API 地址格式无效"); }
  const hostname = url.hostname.toLowerCase();
  const ipLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
  const unsafeHost = ipLiteral || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal") ||
    /^(?:127|10|0)\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname) || hostname === "::1" || hostname === "[::1]";
  if (url.protocol !== "https:" || url.username || url.password || unsafeHost) throw new Error("自定义 API 必须是可公开访问的 HTTPS 地址");
  if (url.port && url.port !== "443") throw new Error("自定义 API 仅支持标准 HTTPS 端口");
  return url.toString();
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as AiRequest;
    const provider = payload.provider ?? "deepseek";
    const apiKey = payload.apiKey?.trim() ?? "";
    const model = payload.model?.trim() ?? "";
    const mode = payload.mode === "test" ? "test" : "analyze";
    const prompt = payload.prompt?.trim() ?? "";

    if (!apiKey || apiKey.length > 512) return Response.json({ error: "请填写有效的 API Key" }, { status: 400 });
    if (!model || !/^[A-Za-z0-9._-]{2,80}$/.test(model)) return Response.json({ error: "模型名称格式无效" }, { status: 400 });
    if (mode === "analyze" && (!prompt || prompt.length > 200_000)) return Response.json({ error: "分析内容为空或过长" }, { status: 400 });

    let endpoint: string;
    try { endpoint = resolveEndpoint(provider, payload.endpoint?.trim() ?? ""); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "AI 接口地址无效" }, { status: 400 }); }

    const body: Record<string, unknown> = {
      model,
      messages: mode === "test"
        ? [{ role: "system", content: "请只返回 JSON。" }, { role: "user", content: "返回 {\"ok\":true}，用于测试 API 连接。" }]
        : [{ role: "system", content: "你是严谨的求职简历分析助手。必须返回 JSON，不得虚构用户经历。" }, { role: "user", content: prompt }],
      stream: false,
    };
    if (provider !== "custom") body.response_format = { type: "json_object" };

    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(mode === "test" ? 30_000 : 120_000),
    });

    const data = await response.json() as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      model?: string;
    };
    if (!response.ok) return Response.json({ error: data.error?.message || `AI 服务请求失败（${response.status}）` }, { status: response.status });
    const content = data.choices?.[0]?.message?.content;
    if (!content) return Response.json({ error: "AI 服务没有返回可用内容，请重试" }, { status: 502 });
    return Response.json({ content, model: data.model ?? model, provider, usage: data.usage ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "AI 服务响应超时，请稍后重试"
      : error instanceof Error ? error.message : "AI 请求失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
