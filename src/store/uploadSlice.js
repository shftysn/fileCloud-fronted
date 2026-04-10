import { createSlice } from '@reduxjs/toolkit';

const initialState = {
    tasks: [],
    uploadingAll: false,
};

const uploadSlice = createSlice({
    name: 'upload',
    initialState,
    reducers: {
        addTasks(state, action) {
            const incoming = Array.isArray(action.payload) ? action.payload : [];
            const existingIds = new Set(state.tasks.map((task) => task.id));
            const prepared = incoming.filter((task) => task && !existingIds.has(task.id));
            state.tasks.push(...prepared);
        },
        patchTask(state, action) {
            const { taskId, patch } = action.payload || {};
            state.tasks = state.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
        },
        removeTaskById(state, action) {
            const taskId = action.payload;
            state.tasks = state.tasks.filter((task) => task.id !== taskId);
        },
        clearDoneTasks(state) {
            state.tasks = state.tasks.filter((task) => task.status !== 'done');
        },
        setUploadingAll(state, action) {
            state.uploadingAll = Boolean(action.payload);
        },
    },
});

export const { addTasks, patchTask, removeTaskById, clearDoneTasks, setUploadingAll } = uploadSlice.actions;
export default uploadSlice.reducer;
