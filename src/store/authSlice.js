import { createSlice } from '@reduxjs/toolkit';

const AUTH_STORAGE_KEY = 'drive_auth_state';

function loadPersistedAuth() {
    try {
        const raw = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) {
            return { accessToken: null, currentUser: null };
        }
        const parsed = JSON.parse(raw);
        return {
            accessToken: parsed?.accessToken || null,
            currentUser: parsed?.currentUser || null,
        };
    } catch {
        return { accessToken: null, currentUser: null };
    }
}

function savePersistedAuth(accessToken, currentUser) {
    try {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ accessToken, currentUser }));
    } catch {
        // ignore storage write errors
    }
}

function clearPersistedAuth() {
    try {
        //清理本地存储中的认证信息，在用户登出时调用。
        localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
        // ignore storage remove errors
    }
}

// 从本地存储加载持久化的认证状态，初始化 Redux 中的 auth slice。
const persisted = loadPersistedAuth();

const initialState = {
    accessToken: persisted.accessToken,
    currentUser: persisted.currentUser,
    initialized: false,
};

const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        setAccessToken(state, action) {
            state.accessToken = action.payload || null;
            savePersistedAuth(state.accessToken, state.currentUser);
        },
        setCurrentUser(state, action) {
            state.currentUser = action.payload || null;
            savePersistedAuth(state.accessToken, state.currentUser);
        },
        clearAuth(state) {
            state.accessToken = null;
            state.currentUser = null;
            clearPersistedAuth();
        },
        setInitialized(state, action) {
            state.initialized = Boolean(action.payload);
        },
    },
});

export const { setAccessToken, setCurrentUser, clearAuth, setInitialized } = authSlice.actions;
export default authSlice.reducer;
