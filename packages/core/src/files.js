import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

export async function writeJsonFile(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeTextFile(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

export async function readTextFile(filePath) {
  return fs.readFile(filePath, "utf8");
}

export async function statSafe(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

export async function listDirectoriesRecursive(rootPath) {
  const directories = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.shift();
    const stat = await statSafe(current);

    if (!stat || !stat.isDirectory()) {
      continue;
    }

    directories.push(current);
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push(path.join(current, entry.name));
      }
    }
  }

  return directories;
}

export async function listFilesRecursive(rootPath) {
  const files = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.shift();
    const stat = await statSafe(current);

    if (!stat) {
      continue;
    }

    if (stat.isFile()) {
      files.push(current);
      continue;
    }

    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      queue.push(path.join(current, entry.name));
    }
  }

  return files;
}
