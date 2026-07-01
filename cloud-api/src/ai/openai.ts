import { env } from "../config/env.js";

export async function callOpenAiChat(requestBody: {
  model: string;
  temperature: number;
  messages: Array<{ role: string; content: string }>;
}) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  });

  let json: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message = json?.error?.message || `OpenAI request failed with status ${response.status}`;
    throw new Error(message);
  }

  return json || {};
}
