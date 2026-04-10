import request from '../utils/request';
import axios from 'axios';

// 登录
export const login = (data) => request.post('/auth/login', data);

// 注册
export const register = (data) => request.post('/auth/register', data);

// 发送邮箱验证码
export const sendEmailCode = (data) => request.post('/auth/email-code/send', data);

// 邮箱验证码重置密码
export const resetPasswordByEmailCode = (data) => request.post('/auth/password/reset', data);

// 刷新 token
export const refreshToken = () => axios.post('/api/auth/refresh', null, { withCredentials: true });

// 当前登录用户信息
export const getCurrentUser = () => request.get('/auth/me');

// 登出
export const logout = () => request.post('/auth/logout');

// GitHub OAuth 发起地址
export const githubAuthorizeUrl = '/api/auth/oauth/github/authorize';

// GitHub OAuth ticket 兑换
export const exchangeGithubTicket = (ticket) => request.post('/auth/oauth/github/exchange', { ticket });

// 管理员：用户列表
export const listUsers = () => request.get('/auth/admin/users');

// 管理员：更新用户状态 1启用 0禁用
export const updateUserStatus = (userId, payload) =>
	request.put(`/auth/admin/users/${userId}/status`, payload);
