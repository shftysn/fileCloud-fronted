import React from 'react';
import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';

export function PrivateRoute({ children }) {
    const token = useSelector((state) => state.auth.accessToken);
    return token ? children : <Navigate to="/login" replace />;
}

export function HomeRedirect() {
    const token = useSelector((state) => state.auth.accessToken);
    const roles = useSelector((state) => state.auth.currentUser?.roles || []);
    const isAdmin = Array.isArray(roles) && roles.includes('ADMIN');

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    return <Navigate to={isAdmin ? "/admin/users" : "/files"} replace />;
}

export function AdminRoute({ children }) {
    const token = useSelector((state) => state.auth.accessToken);
    const roles = useSelector((state) => state.auth.currentUser?.roles || []);
    const isAdmin = Array.isArray(roles) && roles.includes('ADMIN');

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    return isAdmin ? children : <Navigate to="/files" replace />;
}

export function UserRoute({ children }) {
    const token = useSelector((state) => state.auth.accessToken);
    const roles = useSelector((state) => state.auth.currentUser?.roles || []);
    const isAdmin = Array.isArray(roles) && roles.includes('ADMIN');

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    return isAdmin ? <Navigate to="/admin/users" replace /> : children;
}
