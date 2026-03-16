const { json, readBody, requirePost, fetchJson } = require("./shared");

function extractOutputText(response) {
  const chunks = [];
  for (const item of response?.output || []) {
    if (item?.type !== "message") continue;
    for (const part of item.content || []) {
      if (part?.type === "output_text" && part.text) chunks.push(part.text);
    }
  }
  return chunks.join("\n\n").trim();
}

exports.handler = async (event) => {
  const gate = requirePost(event);
  if (gate) return gate;

  try {
    const body = readBody(event);
    const apiKey = String(body.apiKey || process.env.OPENAI_API_KEY || "").trim();
    const model = String(body.model || process.env.OPENAI_MODEL || "gpt-5.4").trim();
    const question = String(body.question || "").trim();
    const context = body.context || {};

    if (!apiKey) {
      return json(400, { error: "OpenAI API key missing." });
    }
    if (!question) {
      return json(400, { error: "Question missing." });
    }

    const system = [
      "You are the deploy assistant inside SkyShip Command.",
      "The user drops one ZIP and wants blunt, useful help.",
      "Focus on deploy-root selection, lane order, likely failures, and practical next actions.",
      "Be direct. Keep answers readable and concrete.",
    ].join(" ");

    const prompt = [
      "Question:",
      question,
      "",
      "Current context:",
      JSON.stringify(context, null, 2),
    ].join("\n");

    const response = await fetchJson("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });

    const answer = extractOutputText(response);
    return json(200, {
      ok: true,
      answer: answer || "No text answer was returned.",
      model: response.model || model,
      id: response.id || null,
    });
  } catch (error) {
    return json(500, { error: error.message || "OpenAI request failed." });
  }
};
