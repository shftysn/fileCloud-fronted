const DB_NAME = 'drive_upload_file_cache';
const DB_VERSION = 1;
const STORE_NAME = 'upload_files';

let dbPromise = null;

const openDb = () => {
    if (typeof window === 'undefined' || !window.indexedDB) {
        return Promise.resolve(null);
    }
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = new Promise((resolve) => {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            resolve(null);
        };
    });

    return dbPromise;
};

const withStore = async (mode, runner) => {
    const db = await openDb();
    if (!db) {
        return null;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        let settled = false;

        const done = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(value);
        };

        runner(store, done);

        tx.oncomplete = () => {
            done(null);
        };

        tx.onerror = () => {
            done(null);
        };

        tx.onabort = () => {
            done(null);
        };
    });
};

export const cacheUploadFile = async (taskId, file) => {
    if (!taskId || !(file instanceof File)) {
        return;
    }
    await withStore('readwrite', (store, done) => {
        const request = store.put({
            id: taskId,
            file,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            updatedAt: Date.now(),
        });
        request.onsuccess = () => done(true);
        request.onerror = () => done(null);
    });
};

export const getCachedUploadFile = async (taskId) => {
    if (!taskId) {
        return null;
    }

    const record = await withStore('readonly', (store, done) => {
        const request = store.get(taskId);
        request.onsuccess = () => done(request.result || null);
        request.onerror = () => done(null);
    });

    if (!record) {
        return null;
    }

    const file = record.file;
    if (!(file instanceof File) && !(file instanceof Blob)) {
        return null;
    }

    if (file instanceof File) {
        return file;
    }

    return new File([file], record.fileName || 'unknown.bin', {
        type: record.fileType || 'application/octet-stream',
        lastModified: record.updatedAt || Date.now(),
    });
};

export const removeCachedUploadFile = async (taskId) => {
    if (!taskId) {
        return;
    }
    await withStore('readwrite', (store, done) => {
        const request = store.delete(taskId);
        request.onsuccess = () => done(true);
        request.onerror = () => done(null);
    });
};

export const removeCachedUploadFiles = async (taskIds) => {
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
        return;
    }
    await Promise.all(taskIds.map((id) => removeCachedUploadFile(id)));
};
