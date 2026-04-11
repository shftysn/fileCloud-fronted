import request from '../utils/request';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const getApiBaseInfo = () => {
  const raw = String(API_BASE_URL || '/api').trim();
  if (/^https?:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    const basePath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '';
    return { origin: parsed.origin, basePath };
  }

  const normalizedPath = raw.startsWith('/') ? raw : `/${raw}`;
  return {
    origin: window.location.origin,
    basePath: normalizedPath.replace(/\/+$/, ''),
  };
};

export const resolveApiUrl = (url) => {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;

  const { origin, basePath } = getApiBaseInfo();
  if (url.startsWith('/api/')) {
    return `${origin}${url}`;
  }
  if (url === '/api') {
    return `${origin}/api`;
  }
  if (url.startsWith('/')) {
    return `${origin}${basePath}${url}`;
  }

  return `${origin}${basePath}/${url}`;
};

// 初始化上传
export const initUpload = (data) => request.post('/file/upload/init', data);

// 上传单个分片
export const uploadChunk = (uploadId, chunkIndex, file, onProgress) => {
  const formData = new FormData();
  formData.append('file', file);
  return request.post(`/file/upload/chunk?uploadId=${uploadId}&chunkIndex=${chunkIndex}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
  });
};

// 合并分片
export const mergeChunks = (uploadId) => request.post(`/file/upload/merge?uploadId=${uploadId}`);

// 取消上传并清理分片
export const cancelUploadSession = (uploadId) => request.post(`/file/upload/cancel?uploadId=${uploadId}`);

// 文件列表
export const listFiles = (params) => request.get('/file/list', { params });

// 文件夹树
export const getFolderTree = () => request.get('/file/folders/tree');

// 下载（返回 URL，由浏览器直接请求）
export const getDownloadUrl = (fileId) => resolveApiUrl(`/api/file/download/${fileId}`);

// 删除文件
export const deleteFile = (fileId) => request.delete(`/file/${fileId}`);

// 回收站列表
export const listRecycleFiles = () => request.get('/file/recycle/list');

// 回收站恢复
export const restoreRecycleFile = (fileId) => request.put(`/file/recycle/restore/${fileId}`);

// 回收站彻底删除
export const purgeRecycleFile = (fileId) => request.delete(`/file/recycle/purge/${fileId}`);

// 新建文件夹
export const createFolder = (folderName, parentId) =>
  request.post('/file/folder', null, { params: { folderName, parentId } });

// 移动文件/文件夹
export const moveFile = (fileId, targetParentId) =>
  request.put(`/file/move/${fileId}`, null, { params: { targetParentId } });

// 创建分享链接
export const createShareLink = (fileId, expireHours = 24) =>
  request.post(`/file/share/${fileId}`, null, { params: { expireHours } });

// 我的分享列表
export const listMyShareLinks = () => request.get('/file/share/my');

// 取消分享
export const revokeShareLink = (shareId) => request.delete(`/file/share/${shareId}`);

// 分享下载URL（公开）
export const getPublicShareDownloadUrl = (token) => resolveApiUrl(`/api/file/share/public/download/${token}`);

// 生成预览票据
export const createPreviewTicket = (fileId) => request.post(`/file/preview-ticket/${fileId}`);

// 收藏列表
export const listFavoriteFiles = () => request.get('/file/favorites');

// 收藏/取消收藏
export const setFavoriteFile = (fileId, favorite) =>
  request.put(`/file/favorite/${fileId}`, null, { params: { favorite } });
