import OpenAI from "openai";

const apiKey =
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
  process.env.TRAVEL_TV_OPEN_AI_KEY ||
  process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error(
    "OpenAI API key is missing. Set one of: AI_INTEGRATIONS_OPENAI_API_KEY, TRAVEL_TV_OPEN_AI_KEY, or OPENAI_API_KEY.",
  );
}

const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

export const openai = new OpenAI({
  apiKey,
  ...(baseURL ? { baseURL } : {}),
});
