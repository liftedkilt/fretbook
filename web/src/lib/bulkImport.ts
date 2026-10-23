import { importBulk, importDocument } from "./api";
import { parseGuitarProWithWorker } from "./gpWorkerPool";
import { importQueue } from "./importQueue.svelte";
import { t } from "./i18n.svelte";
import type { DuplicateAction } from "./types";
import { refreshSongs } from "./ui.svelte";

export function isGuitarProFilename(name: string): boolean {
  return /\.(gp|gp3|gp4|gp5|gpx)$/i.test(name);
}

interface FileEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name?: string;
  file?: (success: (file: File) => void, error?: () => void) => void;
  createReader?: () => {
    readEntries: (success: (results: FileEntryLike[]) => void, error?: () => void) => void;
  };
}

/** Recursively read all files from a DataTransferItemList, handling directories. */
export async function extractDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const items = dataTransfer.items;
  if (!items || items.length === 0) {
    return Array.from(dataTransfer.files ?? []);
  }

  const files: File[] = [];
  const entries: FileEntryLike[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item.webkitGetAsEntry === "function") {
      const entry = item.webkitGetAsEntry() as FileEntryLike | null;
      if (entry) entries.push(entry);
    } else {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }

  if (entries.length === 0) {
    return files.length > 0 ? files : Array.from(dataTransfer.files ?? []);
  }

  async function traverseEntry(entry: FileEntryLike, folderTag?: string): Promise<void> {
    if (entry.isFile && entry.file) {
      await new Promise<void>((resolve) => {
        entry.file!(
          (file: File) => {
            if (folderTag) {
              Object.defineProperty(file, "folderTag", { value: folderTag, writable: true });
            }
            files.push(file);
            resolve();
          },
          () => resolve(),
        );
      });
    } else if (entry.isDirectory && entry.createReader) {
      const dirReader = entry.createReader();
      const currentFolder = folderTag || entry.name;
      const readBatch = async (): Promise<FileEntryLike[]> => {
        return new Promise((resolve) => {
          dirReader.readEntries(
            (results: FileEntryLike[]) => resolve(results),
            () => resolve([]),
          );
        });
      };
      let batch = await readBatch();
      while (batch.length > 0) {
        for (const child of batch) {
          await traverseEntry(child, currentFolder);
        }
        batch = await readBatch();
      }
    }
  }

  for (const entry of entries) {
    await traverseEntry(entry);
  }

  return files;
}

export interface BulkImportOptions {
  files: File[];
  duplicates?: DuplicateAction;
  tags?: string;
  family?: "bass" | "guitar" | null;
}

export async function processBulkImport(options: BulkImportOptions): Promise<void> {
  const { files, duplicates = "skip", tags, family = null } = options;
  if (!files || files.length === 0) return;

  const gpFiles: File[] = [];
  const serverFiles: File[] = [];

  for (const file of files) {
    if (isGuitarProFilename(file.name)) {
      gpFiles.push(file);
    } else {
      serverFiles.push(file);
    }
  }

  // 1. Enqueue server-side batch if any
  if (serverFiles.length > 0) {
    try {
      const res = await importBulk(serverFiles, duplicates, tags);
      if (res?.jobs?.length) {
        importQueue.trackJobIds(res.jobs.map((j) => j.job_id));
      } else {
        importQueue.notifyServerJobs();
      }
    } catch {
      importQueue.notifyServerJobs();
    }
  }

  // 2. Process Guitar Pro files client-side in worker with bounded concurrency
  for (const file of gpFiles) {
    const jobId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const folderTag = (file as unknown as { folderTag?: string }).folderTag;
    const batchTags = tags ? [tags] : folderTag ? [folderTag] : [];

    importQueue.addJob({
      id: jobId,
      isClient: true,
      kind: "import.guitarpro",
      status: "queued",
      label: file.name,
      result: null,
      error: null,
      error_key: "",
      error_params: {},
      progress: t("bulk.parsing"),
      progress_key: "bulk.parsing",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    void (async () => {
      try {
        importQueue.updateJob(jobId, { status: "running", progress: t("bulk.parsing") });
        const buffer = await file.arrayBuffer();
        const parsed = await parseGuitarProWithWorker(new Uint8Array(buffer), family);

        importQueue.updateJob(jobId, { progress: t("bulk.saving") });
        const saved = await importDocument({
          title: parsed.title,
          artist: parsed.artist,
          source_kind: "guitarpro",
          document: parsed.document,
          on_duplicate: duplicates,
          tags: batchTags,
        });

        importQueue.updateJob(jobId, {
          status: "done",
          result: {
            song_id: saved.id,
            slug: saved.slug,
          },
        });
        void refreshSongs();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        importQueue.updateJob(jobId, {
          status: "error",
          error: msg,
          error_key: "import.failed",
        });
      }
    })();
  }
}
