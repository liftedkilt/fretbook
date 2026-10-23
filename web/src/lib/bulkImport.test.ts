import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractDroppedFiles, isGuitarProFilename, processBulkImport } from "./bulkImport";

const mockImportBulk = vi.fn();
const mockImportDocument = vi.fn();

vi.mock("./api", () => ({
  importBulk: (...args: unknown[]) => mockImportBulk(...args),
  importDocument: (...args: unknown[]) => mockImportDocument(...args),
}));

vi.mock("./gpWorkerPool", () => ({
  parseGuitarProWithWorker: vi.fn().mockResolvedValue({
    title: "Parsed Title",
    artist: "Parsed Artist",
    document: {
      bars: [],
      tracks: [],
      bpm: 120,
      version: 1,
      sync: { video_id: null, points: [], anchors: {} },
    },
  }),
}));

vi.mock("./ui.svelte", () => ({
  refreshSongs: vi.fn(),
}));

describe("bulkImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isGuitarProFilename", () => {
    it("identifies Guitar Pro files by extension", () => {
      expect(isGuitarProFilename("song.gp")).toBe(true);
      expect(isGuitarProFilename("song.GP3")).toBe(true);
      expect(isGuitarProFilename("song.gp4")).toBe(true);
      expect(isGuitarProFilename("song.gp5")).toBe(true);
      expect(isGuitarProFilename("song.gpx")).toBe(true);

      expect(isGuitarProFilename("song.musicxml")).toBe(false);
      expect(isGuitarProFilename("song.cho")).toBe(false);
      expect(isGuitarProFilename("song.zip")).toBe(false);
    });
  });

  describe("extractDroppedFiles", () => {
    it("falls back to dataTransfer.files when items is missing", async () => {
      const f1 = new File(["a"], "a.xml");
      const dt = {
        files: [f1],
        items: [],
      } as unknown as DataTransfer;

      const extracted = await extractDroppedFiles(dt);
      expect(extracted).toEqual([f1]);

      const dtEmpty = {} as unknown as DataTransfer;
      const extractedEmpty = await extractDroppedFiles(dtEmpty);
      expect(extractedEmpty).toEqual([]);
    });

    it("falls back to getAsFile when webkitGetAsEntry is not present", async () => {
      const f1 = new File(["item"], "file.musicxml");
      const dt = {
        items: [
          {
            getAsFile: () => f1,
          },
        ],
      } as unknown as DataTransfer;

      const extracted = await extractDroppedFiles(dt);
      expect(extracted).toEqual([f1]);
    });

    it("extracts directory entries with folder tags", async () => {
      const f1 = new File(["content"], "sub.xml");
      const fakeEntry = {
        isFile: false,
        isDirectory: true,
        name: "RockFolder",
        createReader: () => {
          let read = false;
          return {
            readEntries: (success: (results: unknown[]) => void) => {
              if (!read) {
                read = true;
                success([
                  {
                    isFile: true,
                    isDirectory: false,
                    file: (cb: (f: File) => void) => cb(f1),
                  },
                ]);
              } else {
                success([]);
              }
            },
          };
        },
      };

      const dt = {
        items: [
          {
            webkitGetAsEntry: () => fakeEntry,
          },
        ],
      } as unknown as DataTransfer;

      const extracted = await extractDroppedFiles(dt);
      expect(extracted).toHaveLength(1);
      expect(extracted[0].name).toBe("sub.xml");
      expect((extracted[0] as unknown as { folderTag?: string }).folderTag).toBe("RockFolder");
    });
  });

  describe("processBulkImport", () => {
    it("returns early when files array is empty", async () => {
      await processBulkImport({ files: [] });
      expect(mockImportBulk).not.toHaveBeenCalled();
      expect(mockImportDocument).not.toHaveBeenCalled();
    });

    it("separates server files and guitar pro files", async () => {
      const xmlFile = new File(["<xml>"], "song.musicxml");
      const gpFile = new File(["gp bytes"], "song.gp5");

      mockImportBulk.mockResolvedValue({
        batch_id: "batch-1",
        total_files: 1,
        jobs: [{ job_id: "job-srv-1" }],
      });
      mockImportDocument.mockResolvedValue({ id: "song-1", slug: "song" });

      await processBulkImport({
        files: [xmlFile, gpFile],
        duplicates: "skip",
        tags: "my-tag",
      });

      expect(mockImportBulk).toHaveBeenCalledWith([xmlFile], "skip", "my-tag");
      // Allow async worker parsing to settle
      await vi.waitFor(() => {
        expect(mockImportDocument).toHaveBeenCalled();
      });
    });

    it("handles server bulk import error gracefully", async () => {
      const xmlFile = new File(["<xml>"], "error.musicxml");
      mockImportBulk.mockRejectedValue(new Error("Server upload failure"));

      await processBulkImport({
        files: [xmlFile],
      });

      expect(mockImportBulk).toHaveBeenCalled();
    });

    it("handles Guitar Pro parsing error and updates job status to error", async () => {
      const { parseGuitarProWithWorker } = await import("./gpWorkerPool");
      vi.mocked(parseGuitarProWithWorker).mockRejectedValueOnce(new Error("Corrupt GP file"));

      const gpFile = new File(["bad data"], "corrupt.gp5");
      await processBulkImport({
        files: [gpFile],
      });

      const { getClientJobs } = await import("./importQueue.svelte");
      await vi.waitFor(() => {
        const jobs = getClientJobs();
        expect(jobs.some((j) => j.status === "error" && j.error?.includes("Corrupt GP file"))).toBe(
          true,
        );
      });
    });

    it("inherits folderTag for batch tags when tags option is not provided", async () => {
      const gpFile = new File(["gp data"], "tagged.gp4");
      Object.defineProperty(gpFile, "folderTag", { value: "JazzFolder", writable: true });

      mockImportDocument.mockResolvedValue({ id: "song-jazz", slug: "song-jazz" });

      await processBulkImport({
        files: [gpFile],
      });

      await vi.waitFor(() => {
        expect(mockImportDocument).toHaveBeenCalledWith(
          expect.objectContaining({
            tags: ["JazzFolder"],
          }),
        );
      });
    });
  });
});
