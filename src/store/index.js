import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';
import uploadReducer from './uploadSlice';

const store = configureStore({
    reducer: {
        auth: authReducer,
        upload: uploadReducer,
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: false,
        }),
});

export default store;
