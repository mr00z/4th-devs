/**
 * Native tool: understand_image
 * 
 * Analyzes images using OpenAI Vision API.
 * This is a native tool (not MCP) that allows the agent to ask questions about images.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, extname, basename } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { vision } from "./vision.js";
import log from "../helpers/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");
const IMAGE_SIGNATURES = {
  "image/png": [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  "image/jpeg": [Buffer.from([0xff, 0xd8, 0xff])],
  "image/gif": [Buffer.from("GIF87a", "ascii"), Buffer.from("GIF89a", "ascii")],
  "image/webp": [Buffer.from("RIFF", "ascii")]
};

/**
 * MIME type mapping for common image formats.
 */
const getMimeType = (filepath) => {
  const ext = extname(filepath).toLowerCase();
  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp"
  };
  return mimeTypes[ext] || "image/jpeg";
};

const hasSignature = (buffer, signature) =>
  buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);

const isValidImageBuffer = (buffer, mimeType) => {
  const signatures = IMAGE_SIGNATURES[mimeType] || [];

  if (mimeType === "image/webp") {
    return buffer.length >= 12
      && hasSignature(buffer, Buffer.from("RIFF", "ascii"))
      && buffer.subarray(8, 12).equals(Buffer.from("WEBP", "ascii"));
  }

  return signatures.some((signature) => hasSignature(buffer, signature));
};

/**
 * Native tool definitions in OpenAI function format.
 */
export const nativeTools = [
  {
    type: "function",
    name: "understand_image",
    description: "Analyze an image and answer questions about it. Use this to identify people, objects, scenes, or any visual content in images.",
    parameters: {
      type: "object",
      properties: {
        image_path: {
          type: "string",
          description: "Path to the image file relative to the project root (e.g., 'images/photo.jpg')"
        },
        question: {
          type: "string",
          description: "Question to ask about the image (e.g., 'Who is in this image?', 'Describe the person's appearance')"
        }
      },
      required: ["image_path", "question"],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "fetch_attachment",
    description: "Fetch an attachment from main instruction file",
    parameters: {
      type: "object",
      properties: {
        attachment_name: {
          type: "string",
          description: "Name of the attachment to fetch. Example: 'zalacznik-G.md' or 'trasy-wylaczone.png'"
        }
      },
      required: ["attachment_name"],
      additionalProperties: false
    },
    strict: true

  }
];

/**
 * Native tool handlers.
 */
export const nativeHandlers = {
  async understand_image({ image_path, question }) {
    const normalizedPath = image_path.replace(/^\/+/, "");

    log.vision(image_path, question);

    try {
      const resolvedPath = normalizedPath;
      const fullPath = join(PROJECT_ROOT, resolvedPath);
      const imageBuffer = await readFile(fullPath);

      const mimeType = getMimeType(resolvedPath);
      if (!isValidImageBuffer(imageBuffer, mimeType)) {
        throw new Error(`Resolved file is not a valid ${mimeType}: ${resolvedPath}`);
      }

      log.debug("understand_image", `resolved ${image_path} -> ${resolvedPath}, bytes=${imageBuffer.byteLength}, mime=${mimeType}`);
      const imageBase64 = imageBuffer.toString("base64");

      const answer = await vision({
        imageBase64,
        mimeType,
        question
      });

      log.visionResult(answer);
      return { answer, image_path };
    } catch (error) {
      log.error("Vision error", error.message);
      return { error: error.message, image_path };
    }
  },

  async fetch_attachment({ attachment_name }) {
    try {
      log.start(`Fetching attachment: ${attachment_name}`);

      const response = await fetch(`https://hub.ag3nts.org/dane/doc/${attachment_name}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      log.info(`Content-Type: ${contentType}`);

      // Define the images folder path
      const imagesFolder = join(PROJECT_ROOT, "images");

      // Get extension from content-type
      const getExtensionFromMime = (mime) => {
        const mimeToExt = {
          "image/png": ".png",
          "image/jpeg": ".jpg",
          "image/jpg": ".jpg",
          "image/gif": ".gif",
          "image/webp": ".webp"
        };
        return mimeToExt[mime] || ".jpg";
      };

      // Ensure images folder exists
      if (!existsSync(imagesFolder)) {
        await mkdir(imagesFolder, { recursive: true });
        log.debug("fetch_attachment", `created images folder: ${imagesFolder}`);
      }

      if (contentType.startsWith("image/")) {
        log.debug("fetch_attachment", `reading binary body for ${attachment_name}`);
        const buffer = await response.arrayBuffer();
        log.debug("fetch_attachment", `binary bytes=${buffer.byteLength}`);

        // Generate proper filename: use attachment_name or create one with correct extension
        let filename = attachment_name;
        const ext = getExtensionFromMime(contentType);

        // Check if attachment_name already has an extension
        const originalExt = extname(attachment_name).toLowerCase();
        const validExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

        if (!validExtensions.includes(originalExt)) {
          // No valid extension, add the one from content-type
          const baseName = basename(attachment_name, originalExt);
          filename = `${baseName}${ext}`;
        }

        const filePath = join(imagesFolder, filename);
        await writeFile(filePath, Buffer.from(buffer));

        log.success(`Fetched and saved image attachment to ${filePath} (${Math.round(buffer.byteLength / 1024)}KB)`);
        return {
          type: "image",
          mimeType: contentType,
          attachment_name,
          size_bytes: buffer.byteLength,
          file_path: filePath,
          hint: `Image saved to ${filePath}. Use 'understand_image' to analyze it.`
        };
      } else {
        log.debug("fetch_attachment", `reading text body for ${attachment_name}`);
        const text = await response.text();
        log.debug("fetch_attachment", `text chars=${text.length}`);

        // Define attachments folder for text files
        const attachmentsFolder = join(PROJECT_ROOT, "knowledge/attachments");
        if (!existsSync(attachmentsFolder)) {
          await mkdir(attachmentsFolder, { recursive: true });
          log.debug("fetch_attachment", `created attachments folder: ${attachmentsFolder}`);
        }

        // Ensure text file has .txt extension if no valid extension present
        let filename = attachment_name;
        const originalExt = extname(attachment_name).toLowerCase();
        const validTextExtensions = [".txt", ".md", ".json", ".xml", ".html", ".css", ".js", ".ts"];

        if (!validTextExtensions.includes(originalExt)) {
          filename = `${attachment_name}.txt`;
        }

        const filePath = join(attachmentsFolder, filename);
        await writeFile(filePath, text, "utf-8");

        log.success(`Fetched and saved text attachment to ${filePath} (${text.length} chars)`);
        return {
          type: "text",
          text,
          attachment_name,
          file_path: filePath,
          hint: `Text saved to ${filePath}. Use 'fs_read_file' to read it.`
        };
      }
    } catch (error) {
      log.error("Fetch attachment error", error.message);
      return { error: error.message, attachment_name };
    }
  }
};

/**
 * Check if a tool is native (not MCP).
 */
export const isNativeTool = (name) => name in nativeHandlers;

/**
 * Execute a native tool.
 */
export const executeNativeTool = async (name, args) => {
  const handler = nativeHandlers[name];
  if (!handler) throw new Error(`Unknown native tool: ${name}`);
  return handler(args);
};
