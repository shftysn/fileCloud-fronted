import { createSlice } from '@reduxjs/toolkit';

const UPLOAD_STATE_STORAGE_KEY = 'drive_upload_state_v1';

const normalizeStatusAfterReload = (status) => {
    if (status === 'uploading' || status === 'merging') {
        return 'paused';
    }
    if (status === 'done' || status === 'error' || status === 'paused' || status === 'pending') {
        return status;
    }
    return 'pending';
};

const normalizeTaskForRuntime = (task) => {
    if (!task || !task.id) {
        return null;
    }
    const resumedFromRunning = task.status === 'uploading' || task.status === 'merging';
    const normalizedStatus = normalizeStatusAfterReload(task.status);
    const fallbackMessage = resumedFromRunning ? '页面刷新后任务已暂停，正在恢复本地缓存文件' : '';
    return {
        id: task.id,
        file: null,
        fileName: task.fileName || '未命名文件',
        fileSize: Number(task.fileSize) > 0 ? Number(task.fileSize) : 0,
        progress: Number(task.progress) > 0 ? Math.min(99, Number(task.progress)) : 0,
        status: normalizedStatus,
        errorMessage: task.errorMessage || fallbackMessage,
        uploadId: task.uploadId || null,
        objectKey: task.objectKey || null,
        uploadCheckpoint: task.uploadCheckpoint || null,
    };
};

const sanitizeTasksForStorage = (tasks) => {
    if (!Array.isArray(tasks)) {
        return [];
    }
    return tasks
        .map((task) => normalizeTaskForRuntime(task))
        .filter(Boolean)
        .filter((task) => task.status !== 'done');
};

const persistUploadState = (state) => {
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }
    try {
        const payload = {
            tasks: sanitizeTasksForStorage(state.tasks),
            uploadingAll: false,
        };
        window.localStorage.setItem(UPLOAD_STATE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // ignore localStorage write errors
    }
};

const loadInitialState = () => {
    if (typeof window === 'undefined' || !window.localStorage) {
        return {
            tasks: [],
            uploadingAll: false,
        };
    }

    try {
        const raw = window.localStorage.getItem(UPLOAD_STATE_STORAGE_KEY);
        if (!raw) {
            return {
                tasks: [],
                uploadingAll: false,
            };
        }
        const parsed = JSON.parse(raw);
        return {
            tasks: sanitizeTasksForStorage(parsed?.tasks),
            uploadingAll: false,
        };
    } catch {
        return {
            tasks: [],
            uploadingAll: false,
        };
    }
};

const initialState = loadInitialState();

const uploadSlice = createSlice({
    name: 'upload',
    initialState,
    reducers: {
        addTasks(state, action) {
            const incoming = Array.isArray(action.payload) ? action.payload : [];
            const existingIds = new Set(state.tasks.map((task) => task.id));
            const prepared = incoming.filter((task) => task && !existingIds.has(task.id));
            state.tasks.push(...prepared);
            persistUploadState(state);
        },
        patchTask(state, action) {
            const { taskId, patch } = action.payload || {};
            state.tasks = state.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
            persistUploadState(state);
        },
        patchTaskRuntime(state, action) {
            const { taskId, patch } = action.payload || {};
            state.tasks = state.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
        },
        removeTaskById(state, action) {
            const taskId = action.payload;
            state.tasks = state.tasks.filter((task) => task.id !== taskId);
            persistUploadState(state);
        },
        clearDoneTasks(state) {
            state.tasks = state.tasks.filter((task) => task.status !== 'done');
            persistUploadState(state);
        },
        setUploadingAll(state, action) {
            state.uploadingAll = Boolean(action.payload);
            persistUploadState(state);
        },
    },
});

export const { addTasks, patchTask, patchTaskRuntime, removeTaskById, clearDoneTasks, setUploadingAll } = uploadSlice.actions;
export default uploadSlice.reducer;
