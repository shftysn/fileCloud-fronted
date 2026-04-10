import React, { lazy } from 'react';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { PrivateRoute, AdminRoute } from './guards';

const LoginPage = lazy(() => import('../pages/LoginPage'));
const RegisterPage = lazy(() => import('../pages/RegisterPage'));
const ResetPasswordPage = lazy(() => import('../pages/ResetPasswordPage'));
const OAuthCallbackPage = lazy(() => import('../pages/OAuthCallbackPage'));
const FilesPage = lazy(() => import('../pages/FilesPage'));
const UploadPage = lazy(() => import('../pages/UploadPage'));
const AdminPage = lazy(() => import('../pages/AdminPage'));
const MainLayout = lazy(() => import('../layouts/MainLayout'));
const ErrorPage = lazy(() => import('../pages/ErrorPage'));

export const router = createBrowserRouter([
    {
        path: '/login',
        element: <LoginPage />,
        errorElement: <ErrorPage />,
    },
    {
        path: '/register',
        element: <RegisterPage />,
        errorElement: <ErrorPage />,
    },
    {
        path: '/reset-password',
        element: <ResetPasswordPage />,
        errorElement: <ErrorPage />,
    },
    {
        path: '/oauth/callback',
        element: <OAuthCallbackPage />,
        errorElement: <ErrorPage />,
    },
    {
        path: '/',
        element: (
            <PrivateRoute>
                <MainLayout />
            </PrivateRoute>
        ),
        errorElement: <ErrorPage />,
        children: [
            {
                index: true,
                element: <Navigate to="/files" replace />,
            },
            {
                path: 'files',
                element: <FilesPage />,
            },
            {
                path: 'files/favorites',
                element: <FilesPage />,
            },
            {
                path: 'files/recycle',
                element: <FilesPage />,
            },
            {
                path: 'files/shares',
                element: <FilesPage />,
            },
            {
                path: 'upload',
                element: <UploadPage />,
            },
            {
                path: 'admin',
                element: (
                    <AdminRoute>
                        <AdminPage />
                    </AdminRoute>
                ),
            },
        ],
    },
    {
        path: '*',
        element: <Navigate to="/" replace />,
    },
]);

export default function AppRoutes() {
    return <RouterProvider router={router} />;
}
