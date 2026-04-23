import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Table, Input, Button, Space, Popconfirm, Modal, message, Tag, TreeSelect, Breadcrumb, Tooltip, Typography, Progress, Card, Dropdown } from 'antd';
import { useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
    FolderOutlined,
    FileOutlined,
    DownloadOutlined,
    EyeOutlined,
    DeleteOutlined,
    FolderAddOutlined,
    SearchOutlined,
    ShareAltOutlined,
    DragOutlined,
    CopyOutlined,
    ArrowLeftOutlined,
    ReloadOutlined,
    StarOutlined,
    StarFilled,
    UndoOutlined,
    DeleteFilled,
    EditOutlined,
} from '@ant-design/icons';
import {
    listFiles,
    deleteFile,
    createFolder,
    getDownloadUrl,
    moveFile,
    createShareLink,
    getPublicShareDownloadUrl,
    getFolderTree,
    createPreviewTicket,
    resolveApiUrl,
    listFavoriteFiles,
    setFavoriteFile,
    renameFileEntry,
    getStorageSummary,
    listRecycleFiles,
    restoreRecycleFile,
    purgeRecycleFile,
    purgeAllRecycleFiles,
    getPurgeAllRecycleStatus,
    listMyShareLinks,
    revokeShareLink,
} from '../api/file';
import store from '../store';
import { clearAuth } from '../store/authSlice';

const VIEW_FILES = 'files';
const VIEW_FAVORITES = 'favorites';
const VIEW_RECYCLE = 'recycle';
const VIEW_SHARES = 'shares';
const PURGE_POLL_INTERVAL_MS = 1200;
const PURGE_POLL_MAX_ROUNDS = 180;
const FILE_TABLE_SCROLL_Y = 420;
const STORAGE_REFRESH_DEBOUNCE_MS = 350;

export default function FilesPage() {
    const location = useLocation();
    const accessToken = useSelector((state) => state.auth.accessToken);
    const currentUser = useSelector((state) => state.auth.currentUser);
    const [activeView, setActiveView] = useState(VIEW_FILES);
    const [files, setFiles] = useState([]);
    const [favoriteFiles, setFavoriteFiles] = useState([]);
    const [recycleFiles, setRecycleFiles] = useState([]);
    const [shareRecords, setShareRecords] = useState([]);
    const [loading, setLoading] = useState(false);
    const [keyword, setKeyword] = useState('');
    const [parentId, setParentId] = useState(null);
    const [pathStack, setPathStack] = useState([]);
    const [folderModalOpen, setFolderModalOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [moveModalOpen, setMoveModalOpen] = useState(false);
    const [movingRecord, setMovingRecord] = useState(null);
    const [targetParentId, setTargetParentId] = useState('__ROOT__');
    const [renameModalOpen, setRenameModalOpen] = useState(false);
    const [renamingRecord, setRenamingRecord] = useState(null);
    const [renamingValue, setRenamingValue] = useState('');
    const [folderTree, setFolderTree] = useState([]);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [shareInfo, setShareInfo] = useState(null);
    const [previewModalOpen, setPreviewModalOpen] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewRecord, setPreviewRecord] = useState(null);
    const [previewKind, setPreviewKind] = useState('');
    const [previewUrl, setPreviewUrl] = useState('');
    const [previewText, setPreviewText] = useState('');
    const [previewTruncated, setPreviewTruncated] = useState(false);
    const [storageSummary, setStorageSummary] = useState(null);
    const [selectedRowKeys, setSelectedRowKeys] = useState([]);
    const [visibleSelectionActionCount, setVisibleSelectionActionCount] = useState(0);
    const storageSummaryRefreshTimerRef = useRef(null);
    const toolbarLeftRef = useRef(null);
    const toolbarBaseRef = useRef(null);
    const selectionActionMeasureRef = useRef(null);
    const previewVideoRef = useRef(null);
    const previewTextAbortRef = useRef(null);

    const viewPathMap = {
        '/files': VIEW_FILES,
        '/files/favorites': VIEW_FAVORITES,
        '/files/recycle': VIEW_RECYCLE,
        '/files/shares': VIEW_SHARES,
    };

    const pathView = viewPathMap[location.pathname] || VIEW_FILES;

    const forceLogoutToLogin = () => {
        store.dispatch(clearAuth());
        if (window.location.pathname !== '/login') {
            window.location.href = '/login';
        }
    };

    const formatBytes = (bytes) => {
        if (!bytes || bytes <= 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(2)} MB`;
        return `${(bytes / 1073741824).toFixed(2)} GB`;
    };

    const parseDownloadFileName = (res, fallbackName) => {
        const disposition = res.headers.get('content-disposition') || '';
        const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match?.[1]) {
            try {
                return decodeURIComponent(utf8Match[1]);
            } catch {
                return utf8Match[1];
            }
        }
        const basicMatch = disposition.match(/filename="?([^";]+)"?/i);
        if (basicMatch?.[1]) {
            return basicMatch[1];
        }
        return fallbackName || 'download';
    };

    const sleep = (ms) => new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });

    const waitPurgeAllCompleted = async (taskId) => {
        for (let i = 0; i < PURGE_POLL_MAX_ROUNDS; i++) {
            const { data } = await getPurgeAllRecycleStatus(taskId);
            if (data.code !== 200) {
                throw new Error(data.message || '查询清空回收站状态失败');
            }

            const task = data.data || {};
            if (task.status === 'success') {
                return;
            }
            if (task.status === 'failed') {
                throw new Error(task.message || '清空回收站失败');
            }
            if (task.status === 'not_found') {
                throw new Error(task.message || '任务不存在或无权限');
            }
            await sleep(PURGE_POLL_INTERVAL_MS);
        }
        throw new Error('清空回收站超时，请稍后刷新再试');
    };

    //获取全部文件列表
    const fetchFiles = async (options = {}) => {

        // 列表接口支持 parentId 和 keyword 作为过滤参数，但在某些操作后我们不希望重置这些参数，因此通过 options.silent 来控制是否显示 loading 效果
        const silent = options.silent === true;
        if (!silent) {
            setLoading(true);
        }
        try {
            const { data } = await listFiles({ parentId, keyword: keyword || undefined });
            if (data.code === 200) {
                setFiles(data.data || []);
            }
        } catch (err) {
            message.error('获取文件列表失败');
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    };

    //获取收藏文件列表
    const fetchFavoriteFiles = async (options = {}) => {
        // 收藏列表不受 parentId 和 keyword 影响，单独接口获取
        const silent = options.silent === true;
        if (!silent) {
            setLoading(true);
        }
        try {
            const { data } = await listFavoriteFiles();
            if (data.code === 200) {
                setFavoriteFiles(data.data || []);
            }
        } catch {
            message.error('获取收藏列表失败');
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    };

    //获取回收站文件列表
    const fetchRecycleFiles = async (options = {}) => {
        const silent = options.silent === true;
        if (!silent) {
            setLoading(true);
        }
        try {
            const { data } = await listRecycleFiles();
            if (data.code === 200) {
                setRecycleFiles(data.data || []);
            }
        } catch {
            message.error('获取回收站失败');
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    };

    //获取分享记录列表
    const fetchShareRecords = async (options = {}) => {
        const silent = options.silent === true;
        if (!silent) {
            setLoading(true);
        }
        try {
            const { data } = await listMyShareLinks();
            if (data.code === 200) {
                setShareRecords(data.data || []);
            }
        } catch {
            message.error('获取分享管理列表失败');
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    };

    //获取存储使用情况
    const fetchStorageSummary = async () => {
        try {
            const { data } = await getStorageSummary();
            if (data.code === 200) {
                setStorageSummary(data.data || null);
            }
        } catch {
            // ignore storage summary errors
        }
    };

    const scheduleStorageSummaryRefresh = () => {
        if (storageSummaryRefreshTimerRef.current) {
            window.clearTimeout(storageSummaryRefreshTimerRef.current);
        }
        storageSummaryRefreshTimerRef.current = window.setTimeout(() => {
            storageSummaryRefreshTimerRef.current = null;
            fetchStorageSummary();
        }, STORAGE_REFRESH_DEBOUNCE_MS);
    };

    useEffect(() => () => {
        if (storageSummaryRefreshTimerRef.current) {
            window.clearTimeout(storageSummaryRefreshTimerRef.current);
        }
    }, []);

    const refreshCurrentView = async (options = {}) => {
        if (activeView === VIEW_FILES) {
            await fetchFiles(options);
            await fetchStorageSummary();
            return;
        }
        if (activeView === VIEW_FAVORITES) {
            await fetchFavoriteFiles(options);
            return;
        }
        if (activeView === VIEW_RECYCLE) {
            await fetchRecycleFiles(options);
            await fetchStorageSummary();
            return;
        }
        await fetchShareRecords(options);
    };

    useEffect(() => {
        refreshCurrentView();
    }, [activeView, parentId]);

    useEffect(() => {
        setSelectedRowKeys([]);
    }, [activeView, parentId]);

    useEffect(() => {
        setActiveView(pathView);
        if (pathView !== VIEW_FILES) {
            setParentId(null);
            setPathStack([]);
        }
    }, [pathView]);

    const handleSearch = () => {
        if (activeView === VIEW_FILES) {
            fetchFiles();
        }
        setSelectedRowKeys([]);
    };

    const handleEnterFolder = (record) => {
        setPathStack([...pathStack, { id: parentId, name: '...' }]);
        setParentId(record.id);
        setKeyword('');
        setSelectedRowKeys([]);
    };

    const handleGoBack = () => {
        if (pathStack.length === 0) return;
        const prev = pathStack[pathStack.length - 1];
        setPathStack(pathStack.slice(0, -1));
        setParentId(prev.id);
        setSelectedRowKeys([]);
    };

    const toIdSet = (rows) => new Set((rows || []).map((row) => String(row.id)));

    const removeRowsByIdSet = (list, idSet) => list.filter((item) => !idSet.has(String(item.id)));

    const pickBatchSuccessRows = (targets, results) => {
        const successRows = [];
        let failedCount = 0;
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value?.data?.code === 200) {
                successRows.push(targets[index]);
            } else {
                failedCount += 1;
            }
        });
        return { successRows, failedCount };
    };

    const syncSelectionAfterSuccess = (successRows) => {
        if (!successRows.length) {
            return;
        }
        const successIds = toIdSet(successRows);
        setSelectedRowKeys((prev) => prev.filter((key) => !successIds.has(String(key))));
    };

    const handleBatchDelete = async () => {
        if (!selectedFileRows.length) {
            message.warning('请先选择要删除的文件');
            return;
        }
        const targets = selectedFileRows;
        const results = await Promise.allSettled(targets.map((row) => deleteFile(row.id)));
        const { successRows, failedCount } = pickBatchSuccessRows(targets, results);
        if (!successRows.length) {
            message.error('删除失败');
            return;
        }

        const successIds = toIdSet(successRows);
        setFiles((prev) => removeRowsByIdSet(prev, successIds));
        setFavoriteFiles((prev) => removeRowsByIdSet(prev, successIds));
        syncSelectionAfterSuccess(successRows);
        scheduleStorageSummaryRefresh();

        if (failedCount > 0) {
            message.warning(`已移入回收站 ${successRows.length} 项，失败 ${failedCount} 项`);
            return;
        }
        message.success(`已移入回收站 ${successRows.length} 项`);
    };

    const openRenameModal = (record) => {
        if (!record) {
            return;
        }
        setRenamingRecord(record);
        setRenamingValue(record.fileName || '');
        setRenameModalOpen(true);
    };

    const handleRename = async () => {
        if (!renamingRecord) {
            return;
        }
        const nextName = renamingValue.trim();
        if (!nextName) {
            message.warning('请输入新名称');
            return;
        }
        try {
            const { data } = await renameFileEntry(renamingRecord.id, nextName);
            if (data.code !== 200) {
                message.error(data.message || '重命名失败');
                return;
            }
            const actualName = data.data?.fileName || nextName;
            const patchName = (list) => list.map((item) => (
                item.id === renamingRecord.id
                    ? { ...item, fileName: actualName }
                    : item
            ));
            setFiles((prev) => patchName(prev));
            setFavoriteFiles((prev) => patchName(prev));
            setRecycleFiles((prev) => patchName(prev));
            setRenameModalOpen(false);
            setRenamingRecord(null);
            setRenamingValue('');
            message.success(actualName === nextName ? '重命名成功' : `重命名成功，已自动调整为 ${actualName}`);
        } catch (err) {
            message.error(err.response?.data?.message || '重命名失败');
        }
    };

    const handleBatchRestore = async () => {
        if (!selectedFileRows.length) {
            message.warning('请先选择要恢复的文件');
            return;
        }
        const targets = selectedFileRows;
        const results = await Promise.allSettled(targets.map((row) => restoreRecycleFile(row.id)));
        const { successRows, failedCount } = pickBatchSuccessRows(targets, results);
        if (!successRows.length) {
            message.error('恢复失败');
            return;
        }

        const successIds = toIdSet(successRows);
        setRecycleFiles((prev) => removeRowsByIdSet(prev, successIds));
        syncSelectionAfterSuccess(successRows);
        scheduleStorageSummaryRefresh();

        if (failedCount > 0) {
            message.warning(`已恢复 ${successRows.length} 项，失败 ${failedCount} 项`);
            return;
        }
        message.success(`已恢复 ${successRows.length} 项`);
    };

    const handleBatchPurge = async () => {
        if (!selectedFileRows.length) {
            message.warning('请先选择要彻底删除的文件');
            return;
        }
        const targets = selectedFileRows;
        const results = await Promise.allSettled(targets.map((row) => purgeRecycleFile(row.id)));
        const { successRows, failedCount } = pickBatchSuccessRows(targets, results);
        if (!successRows.length) {
            message.error('彻底删除失败');
            return;
        }

        const successIds = toIdSet(successRows);
        setRecycleFiles((prev) => removeRowsByIdSet(prev, successIds));
        syncSelectionAfterSuccess(successRows);
        scheduleStorageSummaryRefresh();

        if (failedCount > 0) {
            message.warning(`已彻底删除 ${successRows.length} 项，失败 ${failedCount} 项`);
            return;
        }
        message.success(`已彻底删除 ${successRows.length} 项`);
    };

    const handlePurgeAllRecycle = async () => {
        try {
            const { data } = await purgeAllRecycleFiles();
            if (data.code === 200) {
                const taskId = data.data?.taskId;
                if (!taskId) {
                    throw new Error('未获取到清理任务ID');
                }
                message.info('已提交清空任务，正在后台处理');
                await waitPurgeAllCompleted(taskId);
                message.success('回收站已清空');
                setRecycleFiles([]);
                refreshCurrentView({ silent: true });
            } else {
                message.error(data.message || '清空回收站失败');
            }
        } catch (err) {
            message.error(err?.message || err.response?.data?.message || '清空回收站失败');
        }
    };

    const handleBatchFavorite = async (favorite) => {
        const targets = selectedNonDirRows.filter((row) => Boolean(row.isFavorite) !== favorite);
        if (!targets.length) {
            message.info(favorite ? '当前选择中没有可收藏项' : '当前选择中没有可取消收藏项');
            return;
        }

        const results = await Promise.allSettled(targets.map((row) => setFavoriteFile(row.id, favorite)));
        const { successRows, failedCount } = pickBatchSuccessRows(targets, results);
        if (!successRows.length) {
            message.error('操作失败');
            return;
        }

        const successIds = toIdSet(successRows);
        setFiles((prev) => prev.map((item) => (
            successIds.has(String(item.id))
                ? { ...item, isFavorite: favorite }
                : item
        )));
        if (!favorite) {
            setFavoriteFiles((prev) => removeRowsByIdSet(prev, successIds));
        }
        fetchFavoriteFiles({ silent: true });

        if (failedCount > 0) {
            message.warning(`${favorite ? '已收藏' : '已取消收藏'} ${successRows.length} 项，失败 ${failedCount} 项`);
            return;
        }
        message.success(`${favorite ? '已收藏' : '已取消收藏'} ${successRows.length} 项`);
    };

    const handleToolbarDownload = () => {
        if (!selectedDownloadableRows.length) {
            message.warning('请选择可下载的文件');
            return;
        }
        selectedDownloadableRows.forEach((record) => handleDownload(record));
        message.success(`已开始下载 ${selectedDownloadableRows.length} 项`);
    };

    const handleToolbarPreview = () => {
        if (!selectedSingleRow || !canPreview(selectedSingleRow)) {
            message.warning('请选择一个可预览的文件');
            return;
        }
        handlePreview(selectedSingleRow);
    };

    const handleToolbarMove = () => {
        if (!selectedSingleRow) {
            message.warning('请选择一个文件或文件夹进行移动');
            return;
        }
        openMoveModal(selectedSingleRow);
    };

    const handleToolbarRename = () => {
        if (!selectedSingleRow) {
            message.warning('请选择一个文件或文件夹重命名');
            return;
        }
        openRenameModal(selectedSingleRow);
    };

    const handleToolbarShare = () => {
        if (!selectedSingleRow || selectedSingleRow.isDir) {
            message.warning('请选择一个文件进行分享');
            return;
        }
        handleCreateShare(selectedSingleRow);
    };

    const handleDownload = (record) => {
        const fileId = record?.id;
        if (!fileId) return;
        const a = document.createElement('a');
        fetch(getDownloadUrl(fileId), {
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            credentials: 'include',
        })
            .then(async (res) => {
                if (res.status === 401) {
                    forceLogoutToLogin();
                    throw new Error('登录已过期');
                }
                if (!res.ok) {
                    throw new Error('下载失败');
                }
                const fileName = parseDownloadFileName(res, record.fileName);
                const blob = await res.blob();
                return { blob, fileName };
            })
            .then(({ blob, fileName }) => {
                const url = URL.createObjectURL(blob);
                a.href = url;
                a.download = fileName;
                a.click();
                URL.revokeObjectURL(url);
            })
            .catch(() => message.error('下载失败'));
    };

    const isTextPreviewable = (contentType) => {
        const type = String(contentType || '').toLowerCase();
        return type.startsWith('text/')
            || type === 'application/json'
            || type === 'application/xml'
            || type === 'application/javascript';
    };

    const isImagePreviewable = (contentType) => String(contentType || '').toLowerCase().startsWith('image/');

    const isVideoPreviewable = (contentType) => String(contentType || '').toLowerCase().startsWith('video/');

    const canPreview = (record) => {
        if (!record || record.isDir || record.processStatus !== 'DONE') {
            return false;
        }
        return isTextPreviewable(record.contentType)
            || isImagePreviewable(record.contentType)
            || isVideoPreviewable(record.contentType);
    };

    const closePreviewModal = () => {
        if (previewTextAbortRef.current) {
            previewTextAbortRef.current.abort();
            previewTextAbortRef.current = null;
        }
        if (previewVideoRef.current) {
            previewVideoRef.current.pause();
            previewVideoRef.current.removeAttribute('src');
            previewVideoRef.current.load();
        }
        setPreviewModalOpen(false);
        setPreviewLoading(false);
        setPreviewRecord(null);
        setPreviewKind('');
        setPreviewUrl('');
        setPreviewText('');
        setPreviewTruncated(false);
    };

    const handlePreview = async (record) => {
        if (!canPreview(record)) {
            message.warning('该文件类型暂不支持预览');
            return;
        }
        setPreviewModalOpen(true);
        setPreviewLoading(true);
        setPreviewRecord(record);
        setPreviewText('');
        setPreviewUrl('');
        setPreviewTruncated(false);
        try {
            const { data } = await createPreviewTicket(record.id);
            if (data.code !== 200 || !data.data?.previewUrl) {
                message.error(data.message || '生成预览票据失败');
                closePreviewModal();
                return;
            }

            const url = resolveApiUrl(data.data.previewUrl);
            if (isImagePreviewable(record.contentType)) {
                setPreviewKind('image');
                setPreviewUrl(url);
                setPreviewLoading(false);
                return;
            }

            if (isVideoPreviewable(record.contentType)) {
                setPreviewKind('video');
                setPreviewUrl(url);
                setPreviewLoading(false);
                return;
            }

            setPreviewKind('text');
            const abortController = new AbortController();
            previewTextAbortRef.current = abortController;
            const res = await fetch(url, { signal: abortController.signal });
            if (!res.ok) {
                throw new Error('预览内容读取失败');
            }
            const text = await res.text();
            previewTextAbortRef.current = null;
            const maxChars = 500000;
            if (text.length > maxChars) {
                setPreviewText(text.slice(0, maxChars));
                setPreviewTruncated(true);
            } else {
                setPreviewText(text);
            }
            setPreviewLoading(false);
        } catch (err) {
            if (err?.name === 'AbortError') {
                return;
            }
            message.error('预览失败，请稍后重试');
            closePreviewModal();
        }
    };

    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) {
            message.warning('请输入文件夹名称');
            return;
        }
        try {
            const { data } = await createFolder(newFolderName, parentId);
            if (data.code === 200) {
                message.success('文件夹创建成功');
                setFolderModalOpen(false);
                setNewFolderName('');
                fetchFiles();
            }
        } catch {
            message.error('创建失败');
        }
    };

    const openMoveModal = (record) => {
        setMovingRecord(record);
        setTargetParentId(parentId ?? '__ROOT__');
        setMoveModalOpen(true);
        fetchFolderTree();
    };

    const fetchFolderTree = async () => {
        try {
            const { data } = await getFolderTree();
            if (data.code === 200) {
                setFolderTree(data.data || []);
            }
        } catch {
            setFolderTree([]);
        }
    };

    const handleMove = async () => {
        if (!movingRecord) return;
        if (movingRecord?.isDir && String(targetParentId) === String(movingRecord.id)) {
            message.warning('不能移动到自身目录');
            return;
        }
        try {
            const target = targetParentId === '__ROOT__' ? null : targetParentId;
            const { data } = await moveFile(movingRecord.id, target);
            if (data.code === 200) {
                message.success('移动成功');
                setMoveModalOpen(false);
                setMovingRecord(null);
                fetchFiles();
            } else {
                message.error(data.message || '移动失败');
            }
        } catch (err) {
            message.error(err.response?.data?.message || '移动失败');
        }
    };

    const handleCreateShare = async (record) => {
        try {
            const { data } = await createShareLink(record.id, 24);
            if (data.code === 200) {
                const token = data.data?.shareToken;
                const url = getPublicShareDownloadUrl(token);
                setShareInfo({ token, url, expireTime: data.data?.expireTime });
                setShareModalOpen(true);
                fetchShareRecords();
            } else {
                message.error(data.message || '创建分享链接失败');
            }
        } catch (err) {
            message.error(err.response?.data?.message || '创建分享链接失败');
        }
    };

    const copyText = async (text, successText = '已复制') => {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            message.success(successText);
        } catch {
            message.warning('复制失败，请手动复制');
        }
    };

    const handleRevokeShare = async (shareId) => {
        try {
            const { data } = await revokeShareLink(shareId);
            if (data.code === 200) {
                message.success('分享已取消');
                fetchShareRecords();
            } else {
                message.error(data.message || '取消分享失败');
            }
        } catch (err) {
            message.error(err.response?.data?.message || '取消分享失败');
        }
    };

    const treeContains = (nodes, targetId) => {
        for (const node of nodes || []) {
            if (String(node.id) === String(targetId)) return true;
            if (treeContains(node.children || [], targetId)) return true;
        }
        return false;
    };

    const findNodeById = (nodes, id) => {
        for (const node of nodes || []) {
            if (String(node.id) === String(id)) return node;
            const found = findNodeById(node.children || [], id);
            if (found) return found;
        }
        return null;
    };

    const removeSelfSubtree = (nodes, selfId) => {
        return (nodes || [])
            .filter((n) => String(n.id) !== String(selfId))
            .map((n) => ({
                ...n,
                children: removeSelfSubtree(n.children || [], selfId),
            }));
    };

    const moveTreeData = [
        { title: '根目录', value: '__ROOT__', id: '__ROOT__', children: [] },
        ...(movingRecord?.isDir ? removeSelfSubtree(folderTree, movingRecord.id) : folderTree),
    ];

    useEffect(() => {
        if (!movingRecord?.isDir) return;
        if (targetParentId === '__ROOT__') return;
        const selfNode = findNodeById(folderTree || [], movingRecord.id);
        if (selfNode && treeContains(selfNode.children || [], targetParentId)) {
            setTargetParentId('__ROOT__');
            message.warning('不能移动到子目录');
        }
    }, [targetParentId, movingRecord, folderTree]);

    const normalizedKeyword = keyword.trim().toLowerCase();

    const filteredFiles = useMemo(() => {
        if (!normalizedKeyword) return files;
        return files.filter((item) => String(item.fileName || '').toLowerCase().includes(normalizedKeyword));
    }, [files, normalizedKeyword]);

    const filteredFavoriteFiles = useMemo(() => {
        if (!normalizedKeyword) return favoriteFiles;
        return favoriteFiles.filter((item) => String(item.fileName || '').toLowerCase().includes(normalizedKeyword));
    }, [favoriteFiles, normalizedKeyword]);

    const filteredRecycleFiles = useMemo(() => {
        if (!normalizedKeyword) return recycleFiles;
        return recycleFiles.filter((item) => String(item.fileName || '').toLowerCase().includes(normalizedKeyword));
    }, [recycleFiles, normalizedKeyword]);

    const filteredShares = useMemo(() => {
        if (!normalizedKeyword) return shareRecords;
        return shareRecords.filter((item) => {
            const fileName = String(item.fileName || '').toLowerCase();
            const token = String(item.shareToken || '').toLowerCase();
            return fileName.includes(normalizedKeyword) || token.includes(normalizedKeyword);
        });
    }, [shareRecords, normalizedKeyword]);

    const fileRows = activeView === VIEW_FILES
        ? filteredFiles
        : activeView === VIEW_FAVORITES
            ? filteredFavoriteFiles
            : filteredRecycleFiles;

    const selectedRowKeySet = useMemo(
        () => new Set(selectedRowKeys.map((key) => String(key))),
        [selectedRowKeys],
    );

    const selectedFileRows = useMemo(
        () => fileRows.filter((item) => selectedRowKeySet.has(String(item.id))),
        [fileRows, selectedRowKeySet],
    );

    const selectedSingleRow = selectedFileRows.length === 1 ? selectedFileRows[0] : null;

    const selectedNonDirRows = useMemo(
        () => selectedFileRows.filter((item) => !item.isDir),
        [selectedFileRows],
    );

    const selectedDownloadableRows = useMemo(
        () => selectedNonDirRows.filter((item) => item.processStatus === 'DONE'),
        [selectedNonDirRows],
    );

    const favoriteCandidates = useMemo(
        () => selectedNonDirRows.filter((item) => !item.isFavorite),
        [selectedNonDirRows],
    );

    const unfavoriteCandidates = useMemo(
        () => selectedNonDirRows.filter((item) => item.isFavorite),
        [selectedNonDirRows],
    );

    const hasSelectionActions = activeView !== VIEW_SHARES && selectedFileRows.length > 0;

    const selectionActionItems = useMemo(() => {
        if (!hasSelectionActions) {
            return [];
        }

        if (activeView === VIEW_RECYCLE) {
            return [
                {
                    key: 'restore',
                    icon: <UndoOutlined />,
                    label: '恢复',
                    disabled: selectedFileRows.length === 0,
                },
                {
                    key: 'purge',
                    icon: <DeleteFilled />,
                    label: '彻底删除',
                    danger: true,
                    disabled: selectedFileRows.length === 0,
                    confirmTitle: `确认彻底删除选中的 ${selectedFileRows.length} 项？该操作不可恢复`,
                },
            ];
        }

        const items = [
            {
                key: 'download',
                icon: <DownloadOutlined />,
                label: '下载',
                disabled: selectedDownloadableRows.length === 0,
            },
            {
                key: 'preview',
                icon: <EyeOutlined />,
                label: '预览',
                disabled: !selectedSingleRow || !canPreview(selectedSingleRow),
            },
            {
                key: 'rename',
                icon: <EditOutlined />,
                label: '重命名',
                disabled: !selectedSingleRow,
            },
            {
                key: 'share',
                icon: <ShareAltOutlined />,
                label: '分享',
                disabled: !selectedSingleRow || selectedSingleRow.isDir,
            },
            {
                key: 'favorite',
                icon: <StarOutlined />,
                label: '收藏',
                disabled: favoriteCandidates.length === 0,
            },
            {
                key: 'unfavorite',
                icon: <StarFilled />,
                label: '取消收藏',
                disabled: unfavoriteCandidates.length === 0,
            },
            {
                key: 'delete',
                icon: <DeleteOutlined />,
                label: '删除',
                danger: true,
                disabled: selectedFileRows.length === 0,
                confirmTitle: `确认删除选中的 ${selectedFileRows.length} 项？`,
            },
        ];

        if (activeView === VIEW_FILES) {
            items.splice(2, 0, {
                key: 'move',
                icon: <DragOutlined />,
                label: '移动',
                disabled: !selectedSingleRow,
            });
        }

        return items;
    }, [
        hasSelectionActions,
        activeView,
        selectedFileRows.length,
        selectedDownloadableRows.length,
        selectedSingleRow,
        favoriteCandidates.length,
        unfavoriteCandidates.length,
    ]);

    const runSelectionAction = (key) => {
        if (key === 'restore') {
            handleBatchRestore();
            return;
        }
        if (key === 'purge') {
            handleBatchPurge();
            return;
        }
        if (key === 'download') {
            handleToolbarDownload();
            return;
        }
        if (key === 'preview') {
            handleToolbarPreview();
            return;
        }
        if (key === 'move') {
            handleToolbarMove();
            return;
        }
        if (key === 'rename') {
            handleToolbarRename();
            return;
        }
        if (key === 'share') {
            handleToolbarShare();
            return;
        }
        if (key === 'favorite') {
            handleBatchFavorite(true);
            return;
        }
        if (key === 'unfavorite') {
            handleBatchFavorite(false);
            return;
        }
        if (key === 'delete') {
            handleBatchDelete();
        }
    };

    const runSelectionActionWithConfirm = (key) => {
        const item = selectionActionItems.find((x) => x.key === key);
        if (!item || item.disabled) {
            return;
        }
        if (item.confirmTitle) {
            Modal.confirm({
                title: item.confirmTitle,
                okText: '确认',
                cancelText: '取消',
                okType: item.danger ? 'danger' : 'primary',
                onOk: () => runSelectionAction(key),
            });
            return;
        }
        runSelectionAction(key);
    };

    const renderSelectionActionButton = (item) => {
        const button = (
            <Button
                key={item.key}
                danger={item.danger}
                icon={item.icon}
                disabled={item.disabled}
                onClick={!item.confirmTitle ? () => runSelectionAction(item.key) : undefined}
            >
                {item.label}
            </Button>
        );

        if (!item.confirmTitle) {
            return button;
        }

        return (
            <Popconfirm
                key={item.key}
                title={item.confirmTitle}
                onConfirm={() => runSelectionAction(item.key)}
                disabled={item.disabled}
            >
                {button}
            </Popconfirm>
        );
    };

    const visibleSelectionActions = selectionActionItems.slice(0, visibleSelectionActionCount);
    const overflowSelectionActions = selectionActionItems.slice(visibleSelectionActionCount);

    const overflowActionMenuItems = overflowSelectionActions.map((item) => ({
        key: item.key,
        icon: item.icon,
        label: item.label,
        danger: Boolean(item.danger),
        disabled: Boolean(item.disabled),
    }));

    const handleOverflowMenuClick = ({ key }) => {
        runSelectionActionWithConfirm(key);
    };

    useEffect(() => {
        if (!hasSelectionActions) {
            setVisibleSelectionActionCount(0);
            return undefined;
        }

        const GAP = 10;

        const fitVisibleActions = () => {
            const containerNode = toolbarLeftRef.current;
            const baseNode = toolbarBaseRef.current;
            const measureNode = selectionActionMeasureRef.current;
            if (!containerNode || !baseNode || !measureNode) {
                return;
            }

            const actionNodes = Array.from(measureNode.querySelectorAll('[data-action-key]'));
            const overflowNode = measureNode.querySelector('[data-overflow-trigger]');
            if (!actionNodes.length) {
                setVisibleSelectionActionCount(0);
                return;
            }

            const actionWidths = actionNodes.map((node) => node.getBoundingClientRect().width);
            const baseWidth = baseNode.getBoundingClientRect().width;
            const containerWidth = containerNode.clientWidth;
            const availableWidth = containerWidth - baseWidth - GAP;
            if (availableWidth <= 0) {
                setVisibleSelectionActionCount(0);
                return;
            }

            const totalActionWidth = actionWidths.reduce((sum, width) => sum + width, 0)
                + GAP * Math.max(0, actionWidths.length - 1);

            if (totalActionWidth <= availableWidth) {
                setVisibleSelectionActionCount((prev) => (prev === actionWidths.length ? prev : actionWidths.length));
                return;
            }

            const overflowWidth = overflowNode ? overflowNode.getBoundingClientRect().width : 34;
            const maxVisibleWidth = Math.max(0, availableWidth - overflowWidth - GAP);

            let usedWidth = 0;
            let visibleCount = 0;
            for (const width of actionWidths) {
                const nextWidth = usedWidth + (visibleCount > 0 ? GAP : 0) + width;
                if (nextWidth > maxVisibleWidth) {
                    break;
                }
                usedWidth = nextWidth;
                visibleCount += 1;
            }

            setVisibleSelectionActionCount((prev) => (prev === visibleCount ? prev : visibleCount));
        };

        const frameId = window.requestAnimationFrame(fitVisibleActions);
        let observer = null;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(fitVisibleActions);
            if (toolbarLeftRef.current) {
                observer.observe(toolbarLeftRef.current);
            }
            if (toolbarBaseRef.current) {
                observer.observe(toolbarBaseRef.current);
            }
            if (selectionActionMeasureRef.current) {
                observer.observe(selectionActionMeasureRef.current);
            }
        }
        window.addEventListener('resize', fitVisibleActions);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', fitVisibleActions);
            if (observer) {
                observer.disconnect();
            }
        };
    }, [hasSelectionActions, selectionActionItems]);

    useEffect(() => {
        setSelectedRowKeys((prev) => {
            if (!prev.length) {
                return prev;
            }
            const visibleIdSet = new Set(fileRows.map((item) => String(item.id)));
            const next = prev.filter((key) => visibleIdSet.has(String(key)));
            return next.length === prev.length ? prev : next;
        });
    }, [fileRows]);

    const fileCount = fileRows.filter((item) => !item.isDir).length;
    const folderCount = fileRows.filter((item) => item.isDir).length;
    const totalBytes = fileRows.filter((item) => !item.isDir).reduce((sum, item) => sum + (item.fileSize || 0), 0);

    const viewTitle = activeView === VIEW_FILES
        ? '我的文件'
        : activeView === VIEW_FAVORITES
            ? '收藏文件'
            : activeView === VIEW_RECYCLE
                ? '回收站'
                : '分享管理中心';

    const storageUsedBytes = storageSummary?.usedBytes || 0;
    const storagePendingBytes = storageSummary?.pendingBytes || 0;
    const storageReservedBytes = storageSummary?.reservedUsedBytes || storageUsedBytes;
    const storageQuotaBytes = storageSummary?.quotaBytes || 0;
    const storageRemainingBytes = storageSummary?.remainingBytes ?? Math.max(0, storageQuotaBytes - storageUsedBytes);
    const storageReservedRemainingBytes = storageSummary?.reservedRemainingBytes ?? Math.max(0, storageQuotaBytes - storageReservedBytes);
    const storageUsagePercent = storageSummary?.usagePercent ?? (storageQuotaBytes <= 0 ? 0 : Math.min(100, Math.round((storageUsedBytes * 100) / storageQuotaBytes)));
    const storageReservedPercent = storageSummary?.reservedUsagePercent ?? (storageQuotaBytes <= 0 ? 0 : Math.min(100, Math.round((storageReservedBytes * 100) / storageQuotaBytes)));

    const fileColumns = [
        {
            title: '文件名',
            dataIndex: 'fileName',
            render: (text, record) => (
                <Space>
                    {record.isDir ? <FolderOutlined style={{ color: '#faad14' }} /> : <FileOutlined />}
                    {activeView === VIEW_FILES && record.isDir ? (
                        <a className="ol-filename-link" onClick={() => handleEnterFolder(record)}>{text}</a>
                    ) : (
                        text
                    )}
                </Space>
            ),
        },
        {
            title: '大小',
            dataIndex: 'fileSize',
            width: 120,
            render: (size, record) => (record.isDir ? '-' : formatBytes(size || 0)),
        },
        {
            title: '类型',
            dataIndex: 'contentType',
            width: 170,
            render: (t, record) => (record.isDir ? <Tag color="gold">文件夹</Tag> : t || '-'),
        },
        {
            title: activeView === VIEW_RECYCLE ? '删除时间' : '创建时间',
            dataIndex: activeView === VIEW_RECYCLE ? 'deletedTime' : 'createdTime',
            width: 190,
            render: (value) => value || '-',
        },
    ];

    const shareColumns = [
        {
            title: '文件名',
            dataIndex: 'fileName',
            render: (text, record) => (
                <Space>
                    <FileOutlined />
                    <span>{text || '-'}</span>
                    {record.fileDeleted && <Tag color="warning">文件已删除</Tag>}
                </Space>
            ),
        },
        {
            title: '分享 Token',
            dataIndex: 'shareToken',
            width: 230,
        },
        {
            title: '过期时间',
            dataIndex: 'expireTime',
            width: 190,
        },
        {
            title: '状态',
            width: 140,
            render: (_, record) => {
                if (record.expired) return <Tag color="default">已过期</Tag>;
                return <Tag color="success">生效中</Tag>;
            },
        },
        {
            title: '操作',
            width: 280,
            render: (_, record) => {
                const url = getPublicShareDownloadUrl(record.shareToken);
                return (
                    <Space>
                        <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(url, '分享链接已复制')}>
                            复制链接
                        </Button>
                        <Button size="small" onClick={() => window.open(url, '_blank')}>
                            打开链接
                        </Button>
                        <Popconfirm title="确认取消该分享？" onConfirm={() => handleRevokeShare(record.id)}>
                            <Button size="small" danger>取消分享</Button>
                        </Popconfirm>
                    </Space>
                );
            },
        },
    ];

    return (
        <div className="ol-files-page">
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <div>
                    <Typography.Title level={4} style={{ margin: 0 }}>{viewTitle}</Typography.Title>
                    <Typography.Text type="secondary">
                        当前用户：{currentUser?.username || '访客'}
                    </Typography.Text>
                </div>

                {activeView !== VIEW_FAVORITES && activeView !== VIEW_SHARES && (
                    <Card className="ol-card-surface" bodyStyle={{ padding: 12 }}>
                        <Space direction="vertical" style={{ width: '100%' }} size={6}>
                            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                <Typography.Text strong>存储空间</Typography.Text>
                                <Tag color={storageUsagePercent >= 90 ? 'error' : storageUsagePercent >= 75 ? 'warning' : 'success'}>
                                    {storageUsagePercent}%
                                </Tag>
                            </Space>
                            <Progress percent={storageUsagePercent} showInfo={false} />
                            <Typography.Text type="secondary">
                                实际已用 {formatBytes(storageUsedBytes)} / 总配额 {formatBytes(storageQuotaBytes)}，剩余 {formatBytes(storageRemainingBytes)}
                            </Typography.Text>
                            <Typography.Text type="secondary">
                                上传预占 {formatBytes(storagePendingBytes)}，预占后预计占用 {formatBytes(storageReservedBytes)}（{storageReservedPercent}%），预占后剩余 {formatBytes(storageReservedRemainingBytes)}
                            </Typography.Text>
                        </Space>
                    </Card>
                )}

                {activeView === VIEW_FILES && (
                    <Breadcrumb
                        items={[
                            { title: '根目录' },
                            ...pathStack.map((x, index) => ({ title: `目录${index + 1}` })),
                            ...(parentId ? [{ title: `#${parentId}` }] : []),
                        ]}
                    />
                )}

                <div className="ol-meta-cards">
                    {activeView !== VIEW_SHARES && (
                        <>
                            <div className="ol-meta-card">
                                <div className="ol-meta-title">文件数量</div>
                                <div className="ol-meta-value">{fileCount}</div>
                            </div>
                            <div className="ol-meta-card">
                                <div className="ol-meta-title">文件夹数量</div>
                                <div className="ol-meta-value">{folderCount}</div>
                            </div>
                            <div className="ol-meta-card">
                                <div className="ol-meta-title">列表总大小</div>
                                <div className="ol-meta-value">{formatBytes(totalBytes)}</div>
                            </div>
                        </>
                    )}
                    {activeView === VIEW_SHARES && (
                        <>
                            <div className="ol-meta-card">
                                <div className="ol-meta-title">分享总数</div>
                                <div className="ol-meta-value">{filteredShares.length}</div>
                            </div>
                            <div className="ol-meta-card">
                                <div className="ol-meta-title">生效中</div>
                                <div className="ol-meta-value">{filteredShares.filter((item) => !item.expired).length}</div>
                            </div>
                            <div className="ol-meta-card">
                                <div className="ol-meta-title">已过期</div>
                                <div className="ol-meta-value">{filteredShares.filter((item) => item.expired).length}</div>
                            </div>
                        </>
                    )}
                </div>

                <div className="ol-files-toolbar">
                    <div ref={toolbarLeftRef} className="ol-files-tools-left">
                        <div ref={toolbarBaseRef} className="ol-files-base-actions">
                            {activeView === VIEW_FILES && (
                                <Tooltip title="返回上级目录">
                                    <Button
                                        icon={<ArrowLeftOutlined />}
                                        onClick={handleGoBack}
                                        disabled={pathStack.length === 0}
                                    >
                                        返回上级
                                    </Button>
                                </Tooltip>
                            )}
                            {activeView === VIEW_FILES && (
                                <Button icon={<FolderAddOutlined />} onClick={() => setFolderModalOpen(true)}>
                                    新建文件夹
                                </Button>
                            )}
                            {activeView === VIEW_RECYCLE && (
                                <Popconfirm
                                    title="确认一键清空回收站？该操作不可恢复"
                                    onConfirm={handlePurgeAllRecycle}
                                    okText="确认清空"
                                    cancelText="取消"
                                >
                                    <Button danger icon={<DeleteFilled />} disabled={recycleFiles.length === 0}>
                                        一键全部删除
                                    </Button>
                                </Popconfirm>
                            )}
                            <Button icon={<ReloadOutlined />} onClick={refreshCurrentView}>刷新</Button>
                        </div>

                        {hasSelectionActions && (
                            <div className="ol-selection-actions">
                                {visibleSelectionActions.map((item) => renderSelectionActionButton(item))}
                            </div>
                        )}

                        {hasSelectionActions && overflowSelectionActions.length > 0 && (
                            <Dropdown
                                trigger={['click']}
                                placement="bottomRight"
                                menu={{
                                    items: overflowActionMenuItems,
                                    onClick: handleOverflowMenuClick,
                                }}
                            >
                                <Button className="ol-toolbar-overflow-btn" aria-label="更多操作">...</Button>
                            </Dropdown>
                        )}

                        {hasSelectionActions && (
                            <div ref={selectionActionMeasureRef} className="ol-toolbar-action-measure" aria-hidden>
                                {selectionActionItems.map((item) => (
                                    <Button
                                        key={`measure-${item.key}`}
                                        data-action-key={item.key}
                                        danger={item.danger}
                                        icon={item.icon}
                                    >
                                        {item.label}
                                    </Button>
                                ))}
                                <Button data-overflow-trigger className="ol-toolbar-overflow-btn">...</Button>
                            </div>
                        )}
                    </div>
                    <div className="ol-files-tools-right">
                        <Input
                            placeholder={activeView === VIEW_SHARES ? '搜索文件名或分享 token' : '搜索文件名'}
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            onPressEnter={handleSearch}
                            style={{ width: 280 }}
                            allowClear
                            suffix={<SearchOutlined onClick={handleSearch} style={{ cursor: 'pointer' }} />}
                        />
                    </div>
                </div>

                <div className="ol-files-table">
                    {activeView !== VIEW_SHARES && (
                        <Table
                            className="ol-fixed-height-table"
                            rowKey="id"
                            columns={fileColumns}
                            dataSource={fileRows}
                            rowSelection={{
                                selectedRowKeys,
                                onChange: (keys) => setSelectedRowKeys(keys),
                            }}
                            loading={loading}
                            scroll={{ y: FILE_TABLE_SCROLL_Y }}
                            pagination={{ pageSize: 20, showSizeChanger: false }}
                        />
                    )}
                    {activeView === VIEW_SHARES && (
                        <Table
                            className="ol-fixed-height-table"
                            rowKey="id"
                            columns={shareColumns}
                            dataSource={filteredShares}
                            loading={loading}
                            scroll={{ y: FILE_TABLE_SCROLL_Y }}
                            pagination={{ pageSize: 20, showSizeChanger: false }}
                        />
                    )}
                </div>
            </Space>

            <Modal
                title="新建文件夹"
                open={folderModalOpen}
                onOk={handleCreateFolder}
                onCancel={() => setFolderModalOpen(false)}
            >
                <Input
                    placeholder="文件夹名称"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                />
            </Modal>

            <Modal
                title={`移动${movingRecord?.isDir ? '文件夹' : '文件'}`}
                open={moveModalOpen}
                onOk={handleMove}
                onCancel={() => {
                    setMoveModalOpen(false);
                    setMovingRecord(null);
                }}
            >
                <Space direction="vertical" style={{ width: '100%' }}>
                    <div>选择目标目录</div>
                    <TreeSelect
                        style={{ width: '100%' }}
                        value={targetParentId}
                        onChange={setTargetParentId}
                        treeData={moveTreeData}
                        fieldNames={{ label: 'title', value: 'value', children: 'children' }}
                        treeDefaultExpandAll
                        placeholder="请选择目标目录"
                    />
                </Space>
            </Modal>

            <Modal
                title={`重命名${renamingRecord?.isDir ? '文件夹' : '文件'}`}
                open={renameModalOpen}
                onOk={handleRename}
                onCancel={() => {
                    setRenameModalOpen(false);
                    setRenamingRecord(null);
                    setRenamingValue('');
                }}
            >
                <Input
                    placeholder="请输入新名称"
                    value={renamingValue}
                    onChange={(e) => setRenamingValue(e.target.value)}
                    onPressEnter={handleRename}
                    maxLength={255}
                />
            </Modal>

            <Modal
                title="分享链接"
                open={shareModalOpen}
                footer={null}
                onCancel={() => setShareModalOpen(false)}
            >
                <Space direction="vertical" style={{ width: '100%' }}>
                    <div>过期时间：{shareInfo?.expireTime || '-'}</div>
                    <Input value={shareInfo?.url || ''} readOnly />
                    <Space>
                        <Button icon={<CopyOutlined />} onClick={() => copyText(shareInfo?.url, '分享链接已复制')}>复制链接</Button>
                        <Button type="primary" onClick={() => window.open(shareInfo?.url, '_blank')}>打开链接</Button>
                    </Space>
                </Space>
            </Modal>

            <Modal
                title={previewRecord ? `预览：${previewRecord.fileName}` : '文件预览'}
                open={previewModalOpen}
                width={900}
                footer={null}
                destroyOnClose
                onCancel={closePreviewModal}
            >
                {previewLoading && <div>预览加载中...</div>}
                {!previewLoading && previewKind === 'video' && (
                    <video ref={previewVideoRef} className="ol-preview-video" controls src={previewUrl}>
                        当前浏览器不支持视频播放。
                    </video>
                )}
                {!previewLoading && previewKind === 'image' && (
                    <img className="ol-preview-image" src={previewUrl} alt={previewRecord?.fileName || '预览图片'} />
                )}
                {!previewLoading && previewKind === 'text' && (
                    <>
                        {previewTruncated && (
                            <Typography.Text type="warning">
                                文本过大，仅展示前 500000 个字符。
                            </Typography.Text>
                        )}
                        <pre className="ol-preview-text">{previewText}</pre>
                    </>
                )}
            </Modal>
        </div>
    );
}
