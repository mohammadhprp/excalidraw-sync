/**
 * Binary-image READ — IndexedDB `files-db` / `files-store`.
 *
 * Excalidraw keeps embedded images outside localStorage: each image element
 * carries a `fileId` and the bytes live in IndexedDB keyed by that id. A READ
 * that skips this silently drops every image, so `readScene` always resolves
 * referenced ids through here.
 *
 * Best-effort: if the DB/store is missing (fresh profile) or a read fails, the
 * caller gets the files that did resolve (possibly none) rather than an error.
 */

const DB_NAME = "files-db";
const STORE_NAME = "files-store";

export function readFilesFromIndexedDb(
  ids: string[],
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined" || ids.length === 0) {
      resolve({});
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME);
    } catch {
      resolve({});
      return;
    }

    request.onerror = () => resolve({});
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.close();
        resolve({});
        return;
      }

      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE_NAME, "readonly");
      } catch {
        db.close();
        resolve({});
        return;
      }

      const store = tx.objectStore(STORE_NAME);
      const out: Record<string, unknown> = {};
      let remaining = ids.length;
      let settled = false;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        db.close();
        resolve(out);
      };
      tx.onabort = finish;
      tx.onerror = finish;

      const settle = (): void => {
        remaining -= 1;
        if (remaining <= 0) finish();
      };

      for (const id of ids) {
        const getRequest = store.get(id);
        getRequest.onsuccess = () => {
          if (getRequest.result !== undefined) out[id] = getRequest.result;
          settle();
        };
        getRequest.onerror = () => settle();
      }
    };
  });
}
