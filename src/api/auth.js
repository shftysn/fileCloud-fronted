import request, { resolveApiUrl } from '../utils/request';
import axios from 'axios';

export const login = (data) => request.post('/auth/login', data);

export const register = (data) => request.post('/auth/register', data);

export const sendEmailCode = (data) => request.post('/auth/email-code/send', data);

export const resetPasswordByEmailCode = (data) => request.post('/auth/password/reset', data);

export const refreshToken = () => axios.post(resolveApiUrl('/auth/refresh'), null, { withCredentials: true });

export const getCurrentUser = () => request.get('/auth/me');

export const logout = () => request.post('/auth/logout');

export const githubAuthorizeUrl = resolveApiUrl('/auth/oauth/github/authorize');

export const exchangeGithubTicket = (ticket) => request.post('/auth/oauth/github/exchange', { ticket });

export const listUsers = () => request.get('/auth/admin/users');

export const createAdminUser = (payload) => request.post('/auth/admin/users', payload);

export const updateUserStatus = (userId, payload) =>
  request.put(`/auth/admin/users/${userId}/status`, payload);

export const deleteAdminUser = (userId) => request.delete(`/auth/admin/users/${userId}`);

export const listAdminNotices = (params) => request.get('/auth/admin/notices', { params });

export const listUserNotices = (params) => request.get('/auth/notices', { params });

export const createAdminNotice = (payload) => request.post('/auth/admin/notices', payload);

export const deleteAdminNotice = (noticeId) => request.delete(`/auth/admin/notices/${noticeId}`);
