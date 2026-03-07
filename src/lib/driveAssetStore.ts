const DB_NAME = "skye-drive-assets";
const STORE_NAME = "files";
const DB_VERSION = 1;

export type StoredDriveAssetFile = {
  assetId: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  relativePath: string;
  blob: Blob;
  savedAt: string;
};

function openDriveDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "assetId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open drive asset store."));
  });
}

export async function saveDriveAssetFiles(records: StoredDriveAssetFile[]): Promise<void> {
  if (!records.length) return;
  const db = await openDriveDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const record of records) {
      store.put(record);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Unable to save drive asset files."));
    tx.onabort = () => reject(tx.error || new Error("Drive asset save aborted."));
  });

  db.close();
}