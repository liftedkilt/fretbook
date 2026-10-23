import { describe, expect, it } from "vitest";
import { getFilesFromDataTransfer } from "./drop";

describe("drop: getFilesFromDataTransfer", () => {
  it("returns dataTransfer.files when items is null or empty", async () => {
    const f1 = new File(["test"], "file1.txt");
    const dt = {
      files: [f1],
      items: [],
    } as unknown as DataTransfer;

    const files = await getFilesFromDataTransfer(dt);
    expect(files).toEqual([f1]);

    const dtEmpty = {} as unknown as DataTransfer;
    const filesEmpty = await getFilesFromDataTransfer(dtEmpty);
    expect(filesEmpty).toEqual([]);
  });

  it("extracts files using getAsFile when webkitGetAsEntry is unavailable", async () => {
    const f1 = new File(["test1"], "file1.txt");
    const dt = {
      items: [
        {
          kind: "file",
          getAsFile: () => f1,
        },
        {
          kind: "string", // Should be ignored
          getAsFile: () => null,
        },
      ],
    } as unknown as DataTransfer;

    const files = await getFilesFromDataTransfer(dt);
    expect(files).toEqual([f1]);
  });

  it("extracts entries with recursive directory traversal", async () => {
    const f1 = new File(["f1"], "file1.gp5");
    const f2 = new File(["f2"], "subfile.musicxml");

    const subDirEntry = {
      isFile: false,
      isDirectory: true,
      createReader: () => {
        let called = false;
        return {
          readEntries: (success: (entries: unknown[]) => void) => {
            if (!called) {
              called = true;
              success([
                {
                  isFile: true,
                  isDirectory: false,
                  file: (resolve: (f: File) => void) => resolve(f2),
                },
              ]);
            } else {
              success([]);
            }
          },
        };
      },
    };

    const mainDirEntry = {
      isFile: false,
      isDirectory: true,
      createReader: () => {
        let called = false;
        return {
          readEntries: (success: (entries: unknown[]) => void) => {
            if (!called) {
              called = true;
              success([
                {
                  isFile: true,
                  isDirectory: false,
                  file: (resolve: (f: File) => void) => resolve(f1),
                },
                subDirEntry,
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
          kind: "file",
          webkitGetAsEntry: () => mainDirEntry,
        },
      ],
    } as unknown as DataTransfer;

    const files = await getFilesFromDataTransfer(dt);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.name)).toEqual(["file1.gp5", "subfile.musicxml"]);
  });

  it("handles top-level file entries", async () => {
    const f1 = new File(["top"], "top.gp");
    const fileEntry = {
      isFile: true,
      isDirectory: false,
      file: (resolve: (f: File) => void) => resolve(f1),
    };

    const dt = {
      items: [
        {
          kind: "file",
          webkitGetAsEntry: () => fileEntry,
        },
      ],
    } as unknown as DataTransfer;

    const files = await getFilesFromDataTransfer(dt);
    expect(files).toEqual([f1]);
  });
});
