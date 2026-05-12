import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveVaultPath } from './index';

const IMAGES_DIR = '.images';

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/**
 * Regex to extract image filenames from Markdown image references.
 * Matches patterns like: ![alt](.images/abc123.png)
 */
const IMAGE_REF_REGEX = /!\[[^\]]*\]\(\.images\/([^)]+)\)/g;

/**
 * Generates a unique filename with the correct extension based on MIME type.
 */
export function generateImageFilename(mimeType: string): string {
  const ext = MIME_TO_EXT[mimeType] ?? '.png';
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `${id}${ext}`;
}

/**
 * Saves image data to the .images/ subdirectory within the notebook.
 * Returns the relative path for use in Markdown references (e.g., ".images/abc123.png").
 */
export function saveImage(
  vaultPath: string,
  notebook: string,
  imageData: Buffer,
  mimeType: string
): string {
  const resolved = resolveVaultPath(vaultPath);
  const imagesDir = path.join(resolved, notebook, IMAGES_DIR);
  
  console.log(`[Electron images] Creating directory: ${imagesDir}`);
  fs.mkdirSync(imagesDir, { recursive: true });

  const filename = generateImageFilename(mimeType);
  const filePath = path.join(imagesDir, filename);
  
  console.log(`[Electron images] Writing image: ${filePath} (${imageData.length} bytes)`);
  fs.writeFileSync(filePath, imageData);
  console.log(`[Electron images] Image saved successfully: ${filename}`);

  // Return relative path for Markdown reference
  return `${IMAGES_DIR}/${filename}`;
}

/**
 * Resolves the full filesystem path for an image file.
 */
export function getImagePath(
  vaultPath: string,
  notebook: string,
  filename: string
): string {
  const resolved = resolveVaultPath(vaultPath);
  return path.join(resolved, notebook, IMAGES_DIR, filename);
}

/**
 * Extracts image filenames from Markdown content.
 * Finds all references matching ![alt](.images/filename) and returns the filenames.
 */
export function extractImageReferences(markdownContent: string): string[] {
  const filenames: string[] = [];
  let match: RegExpExecArray | null;
  // Reset regex state for each call
  const regex = new RegExp(IMAGE_REF_REGEX.source, IMAGE_REF_REGEX.flags);
  while ((match = regex.exec(markdownContent)) !== null) {
    filenames.push(match[1]);
  }
  return filenames;
}

/**
 * Moves image files from one notebook's .images/ directory to another.
 * Only moves the specified filenames. Creates the destination .images/ directory
 * if it doesn't exist. Skips files that don't exist in the source.
 *
 * Returns the list of filenames that were successfully moved.
 */
export function moveImages(
  vaultPath: string,
  sourceNotebook: string,
  targetNotebook: string,
  filenames: string[]
): string[] {
  if (filenames.length === 0) return [];

  const resolved = resolveVaultPath(vaultPath);
  const srcImagesDir = path.join(resolved, sourceNotebook, IMAGES_DIR);
  const destImagesDir = path.join(resolved, targetNotebook, IMAGES_DIR);

  // Create destination .images/ directory if needed
  if (filenames.length > 0) {
    fs.mkdirSync(destImagesDir, { recursive: true });
  }

  const moved: string[] = [];

  for (const filename of filenames) {
    const srcPath = path.join(srcImagesDir, filename);
    const destPath = path.join(destImagesDir, filename);

    try {
      if (fs.existsSync(srcPath)) {
        // If a file with the same name exists at destination, skip to avoid overwrite
        if (fs.existsSync(destPath)) {
          // File already exists at destination — no need to move
          moved.push(filename);
          continue;
        }
        fs.renameSync(srcPath, destPath);
        moved.push(filename);
      }
    } catch (err) {
      console.error(`Failed to move image ${filename}:`, err);
      // Continue with remaining files
    }
  }

  return moved;
}
