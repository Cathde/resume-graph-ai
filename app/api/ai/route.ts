type AiRequest = {
  apiKey?: string;
  model?: string;
  prompt?: string;
  mode?: "test" | "analyze";
};

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as AiRequest;
    const apiKey = payload.apiKey?.trim() ?? "";
    const model = payload.model?.trim() ?? "";
    const mode = payload.mode === "test" ? "test" : "analyze";
    const prompt = payload.prompt?.trim() ?? "";

    if (!apiKey || apiKey.length > 512) return Response.json({ error: "请填写有效的 DeepSeek API Key" }, { status: 400 });
    if (!model || !/^[A-Za-z0-9._-]{2,80}$/.test(model)) return Response.json({ error: "模型名称格式无效" }, { status: 400 });
    if (mode === "analyze" && (!prompt || prompt.length > 200_000)) return Response.json({ error: "分析内容为空或过长" }, { status: 400 });

    const response = await fetch(DEEPSEEK_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: mode === "test"
          ? [{ role: "system", content: "请只返回 JSON。" }, { role: "user", content: "返回 {\"ok\":true}，用于测试 API 连接。" }]
          : [{ role: "system", content: "你是严谨的求职简历分析助手。必须返回 JSON，不得虚构用户经历。" }, { role: "user", content: prompt }],
        response_format: { type: "json_object" },
        stream: false,
        temperature: 0.2,
        max_tokens: mode === "test" ? 64 : 8192,
      }),
      signal: AbortSignal.timeout(mode === "test" ? 30_000 : 120_000),
    });

    const data = await response.json() as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      model?: string;
    };
    if (!response.ok) return Response.json({ error: data.error?.message || `DeepSeek 请求失败（${response.status}）` }, { status: response.status });
    const content = data.choices?.[0]?.message?.content;
    if (!content) return Response.json({ error: "DeepSeek 没有返回可用内容，请重试" }, { status: 502 });
    return Response.json({ content, model: data.model ?? model, usage: data.usage ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "DeepSeek 响应超时，请稍后重试"
      : error instanceof Error ? error.message : "AI 请求失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
