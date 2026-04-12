import axios from 'axios';
import store from '../store';
import { clearAuth, setAccessToken } from '../store/authSlice';
//VITE_API_BASE_URL=https://api.huakaiwuqu.me/api
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';


// 解析 API URL，支持绝对 URL 和相对 URL（基于 API_BASE_URL 或当前 origin）
export const resolveApiUrl = (url) => {
  // 如果 URL 为空或非字符串，直接返回原值，避免后续处理出错。
  if (!url) return url;

  // 检测 URL 是否以 http 或 https 开头
  if (/^https?:\/\//i.test(url)) return url;

  // 处理 API_BASE_URL，确保它是一个字符串，并去除首尾空白。
  const raw = String(API_BASE_URL || '/api').trim();

  // 绝对 URL 直接拼接路径部分，确保正确处理 basePath 和 url 的斜杠。
  if (/^https?:\/\//i.test(raw)) {

    // 解析出 basePath，确保在拼接时不会出现重复斜杠。
    const parsed = new URL(raw);

    // 处理 basePath，去除末尾斜杠，确保拼接时路径正确。
    const basePath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '';
    
    //以/api开头的直接添加到origin后面，不以/api开头的在VITE_API_BASE_URL后面添加url，最后返回完整的URL
    if (url.startsWith('/api/')) {
      return `${parsed.origin}${url}`;
    }
    if (url === '/api') {
      return `${parsed.origin}/api`;
    }
    if (url.startsWith('/')) {
      return `${parsed.origin}${basePath}${url}`;
    }
    return `${parsed.origin}${basePath}/${url}`;
  }

  const normalizedBase = raw.startsWith('/') ? raw : `/${raw}`;

  // 处理 basePath，去除末尾斜杠，确保拼接时路径正确。
  const basePath = normalizedBase.replace(/\/+$/, '');
  if (url.startsWith('/api/')) {
    //window.location.origin:当前页面的“源”（协议 + 域名 + 端口）
    return `${window.location.origin}${url}`;
  }
  if (url === '/api') {
    return `${window.location.origin}/api`;
  }
  if (url.startsWith('/')) {
    return `${window.location.origin}${basePath}${url}`;
  }
  return `${window.location.origin}${basePath}/${url}`;
};

const request = axios.create({
  baseURL: API_BASE_URL,
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
        const { data } = await axios.post(resolveApiUrl('/auth/refresh'), null, {
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
