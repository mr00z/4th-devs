import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const cropPng = async ({ inputPath, outputPath, crop }) => {
    const { left, top, width, height } = crop;

    await mkdir(path.dirname(outputPath), { recursive: true });

    await sharp(inputPath)
        .extract({ left, top, width, height })
        .png()
        .toFile(outputPath);

    return {
        outputPath,
        width,
        height
    };
};
