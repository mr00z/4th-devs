import { api } from "../config.js";
import {
  AI_API_KEY,
  EXTRA_API_HEADERS,
  RESPONSES_API_ENDPOINT
} from "../../../../config.js";
import { extractResponseText } from "../helpers/response.js";
import { recordUsage } from "../helpers/stats.js";
import log from "../helpers/logger.js";

export const vision = async ({ imageBase64, mimeType, question }) => {
  log.debug("vision.request", `model=${api.visionModel}, mime=${mimeType}, imageBase64Chars=${imageBase64.length}, questionChars=${question.length}`);
  const response = await fetch(RESPONSES_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS
    },
    body: JSON.stringify({
      model: api.visionModel,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: question },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${imageBase64}`,
              detail: "high"
            }
          ]
        }
      ]
    })
  });

  const rawText = await response.text();
  log.debug("vision.response", `status=${response.status}, ok=${response.ok}, bodyChars=${rawText.length}`);

  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    log.debug("vision.response", `json parse failed: ${error.message}`);
    throw new Error(`Vision response was not valid JSON (${response.status})`);
  }

  if (!response.ok || data.error) {
    log.debugJson("vision.error", data?.error ?? data);
    throw new Error(data?.error?.message || `Vision request failed (${response.status})`);
  }

  log.debugJson("vision.outputPreview", data?.output?.slice?.(0, 2) ?? data?.output_text ?? data);

  recordUsage(data.usage);
  return extractResponseText(data) || "No response";
};
