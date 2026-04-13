import React, { lazy } from 'react';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { PrivateRoute, AdminRoute, UserRoute, HomeRedirect } from './guards';

const LoginPage = lazy(() => import('../pages/LoginPage'));
const RegisterPage = lazy(() => import('../pages/RegisterPage'));
const ResetPasswordPage = lazy(() => import('../pages/ResetPasswordPage'));
const OAuthCallbackPage = lazy(() => import('../pages/OAuthCallbackPage'));
const FilesPage = lazy(() => import('../pages/FilesPage'));
const UploadPage = lazy(() => import('../pages/UploadPage'));
const NoticeCenterPage = lazy(() => import('../pages/NoticeCenterPage'));
const AdminPage = lazy(() => import('../pages/AdminPage'));
const AdminNoticePage = lazy(() => import('../pages/AdminNoticePage'));
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
                element: <HomeRedirect />,
            },
            {
                path: 'files/*',
                element: (
                    <UserRoute>
                        <FilesPage />
                    </UserRoute>
                ),
            },
            {
                path: 'upload',
                element: (
                    <UserRoute>
                        <UploadPage />
                    </UserRoute>
                ),
            },
            {
                path: 'notices',
                element: <NoticeCenterPage />,
            },
            {
                path: 'admin',
                element: <Navigate to="/admin/users" replace />,
            },
            {
                path: 'admin/users',
                element: (
                    <AdminRoute>
                        <AdminPage />
                    </AdminRoute>
                ),
            },
            {
                path: 'admin/notices',
                element: (
                    <AdminRoute>
                        <AdminNoticePage />
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
