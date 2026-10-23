/** Helper to extract all files from a DataTransfer, recursively traversing dropped folders. */

async function readDirectoryEntry(entry: FileSystemDirectoryEntry): Promise<File[]> {
  const reader = entry.createReader();
  const files: File[] = [];

  const readEntries = (): Promise<FileSystemEntry[]> => {
    return new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
  };

  let batch = await readEntries();
  while (batch.length > 0) {
    for (const child of batch) {
      if (child.isFile) {
        const file = await new Promise<File>((resolve, reject) => {
          (child as FileSystemFileEntry).file(resolve, reject);
        });
        files.push(file);
      } else if (child.isDirectory) {
        const subFiles = await readDirectoryEntry(child as FileSystemDirectoryEntry);
        files.push(...subFiles);
      }
    }
    batch = await readEntries();
  }

  return files;
}

export async function getFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = dataTransfer.items;
  if (items && items.length > 0) {
    const files: File[] = [];
    const promises: Promise<void>[] = [];

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.kind !== "file") continue;

      const entry =
        typeof item.webkitGetAsEntry === "function"
          ? (item.webkitGetAsEntry() as FileSystemEntry | null)
          : null;

      if (entry) {
        if (entry.isFile) {
          promises.push(
            new Promise<void>((resolve, reject) => {
              (entry as FileSystemFileEntry).file((file) => {
                files.push(file);
                resolve();
              }, reject);
            }),
          );
        } else if (entry.isDirectory) {
          promises.push(
            readDirectoryEntry(entry as FileSystemDirectoryEntry).then((dirFiles) => {
              files.push(...dirFiles);
            }),
          );
        }
      } else {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
    if (files.length > 0) {
      return files;
    }
  }

  return Array.from(dataTransfer.files || []);
}
