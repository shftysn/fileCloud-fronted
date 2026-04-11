import axios from 'axios';
import store from '../store';
import { clearAuth, setAccessToken } from '../store/authSlice';

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 60000,
  withCredentials: true,
});

// 请求拦截：自动注入 token
request.interceptors.request.use((config) => {
  const token = store.getState().auth.accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
//整体目标：在 access token 过期后，尽量自动恢复请求，减少用户感知
// 响应拦截：401 自动刷新 token
let isRefreshing = false;
let pendingQueue = [];

const redirectToLogin = () => {
  store.dispatch(clearAuth());
  const path = window.location.pathname;
  if (path !== '/login' && path !== '/register' && path !== '/reset-password' && path !== '/oauth/callback') {
    window.location.href = '/login';
  }
};

request.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config;
    const reqUrl = originalRequest?.url || '';
    // 这些接口本身与登录/刷新流程相关，出现 401 时不应再次触发 refresh，避免死循环。
    const shouldSkipRefresh = reqUrl.includes('/auth/login')
      || reqUrl.includes('/auth/email-code/send')
      || reqUrl.includes('/auth/register')
      || reqUrl.includes('/auth/password/reset')
      || reqUrl.includes('/auth/refresh')
      || reqUrl.includes('/auth/oauth/github/authorize')
      || reqUrl.includes('/auth/oauth/github/callback')
      || reqUrl.includes('/auth/oauth/github/exchange');

    // 仅当普通业务请求 401 且该请求还未重试过时，才进入自动刷新流程。
    if (error.response?.status === 401 && !originalRequest._retry && !shouldSkipRefresh) {
      // 已有刷新请求在进行时，后续 401 请求进入队列等待新 token，刷新后统一重放。
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingQueue.push((newToken) => {
            if (!newToken) {
              reject(error);
              return;
            }
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            resolve(request(originalRequest));
          });
        });
      }

      // 标记当前请求只允许自动重试一次，防止重复 401 导致无限重试。
      originalRequest._retry = true;
      isRefreshing = true;
      try {
        // 刷新请求使用原始 axios，绕开当前实例拦截器，避免拦截器递归触发。
        const { data } = await axios.post('/api/auth/refresh', null, {
          withCredentials: true,
          timeout: 60000,
        });
        if (data?.code === 200 && data?.data?.accessToken) {
          // 刷新成功：更新全局 token，唤醒队列并重放当前失败请求。
          store.dispatch(setAccessToken(data.data.accessToken));
          pendingQueue.forEach((cb) => cb(data.data.accessToken));
          pendingQueue = [];
          originalRequest.headers.Authorization = `Bearer ${data.data.accessToken}`;
          return request(originalRequest);
        }
        throw new Error(data?.message || 'refresh token failed');
      } catch {
        // 刷新失败：让队列请求统一失败，清空登录态并回到登录页。
        pendingQueue.forEach((cb) => cb(null));
        pendingQueue = [];
        redirectToLogin();
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

export default request;
