import React, { useEffect, useMemo, useState } from 'react';
import { Table, Input, Button, Space, Popconfirm, Modal, message, Tag, TreeSelect, Breadcrumb, Tooltip, Typography } from 'antd';
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
    listRecycleFiles,
    restoreRecycleFile,
    purgeRecycleFile,
    listMyShareLinks,
    revokeShareLink,
} from '../api/file';
import store from '../store';
import { clearAuth } from '../store/authSlice';

const VIEW_FILES = 'files';
const VIEW_FAVORITES = 'favorites';
const VIEW_RECYCLE = 'recycle';
const VIEW_SHARES = 'shares';

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

    const fetchFiles = async (options = {}) => {
        const silent = options.silent === true;
        if (!silent) {
            setLoading(true);
        }
        try {
            const { data } = await listFiles({ parentId, keyword: keyword || undefined });
            if (data.code === 200) {
                setFiles(data.data || []);
            }
        } catch {
            message.error('获取文件列表失败');
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    };

    const fetchFavoriteFiles = async (options = {}) => {
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

    const refreshCurrentView = async (options = {}) => {
        if (activeView === VIEW_FILES) {
            await fetchFiles(options);
            return;
        }
        if (activeView === VIEW_FAVORITES) {
            await fetchFavoriteFiles(options);
            return;
        }
        if (activeView === VIEW_RECYCLE) {
            await fetchRecycleFiles(options);
            return;
        }
        await fetchShareRecords(options);
    };

    useEffect(() => {
        refreshCurrentView();
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
    };

    const handleEnterFolder = (record) => {
        setPathStack([...pathStack, { id: parentId, name: '...' }]);
        setParentId(record.id);
        setKeyword('');
    };

    const handleGoBack = () => {
        if (pathStack.length === 0) return;
        const prev = pathStack[pathStack.length - 1];
        setPathStack(pathStack.slice(0, -1));
        setParentId(prev.id);
    };

    const handleDelete = async (fileId) => {
        try {
            const { data } = await deleteFile(fileId);
            if (data.code === 200) {
                message.success('已移入回收站');
                setFiles((prev) => prev.filter((item) => item.id !== fileId));
                setFavoriteFiles((prev) => prev.filter((item) => item.id !== fileId));
                refreshCurrentView({ silent: true });
            }
        } catch {
            message.error('删除失败');
        }
    };

    const handleRestore = async (fileId) => {
        try {
            const { data } = await restoreRecycleFile(fileId);
            if (data.code === 200) {
                message.success('恢复成功');
                refreshCurrentView();
            } else {
                message.error(data.message || '恢复失败');
            }
        } catch (err) {
            message.error(err.response?.data?.message || '恢复失败');
        }
    };

    const handlePurge = async (fileId) => {
        try {
            const { data } = await purgeRecycleFile(fileId);
            if (data.code === 200) {
                message.success('彻底删除成功');
                refreshCurrentView();
            } else {
                message.error(data.message || '彻底删除失败');
            }
        } catch (err) {
            message.error(err.response?.data?.message || '彻底删除失败');
        }
    };

    const handleToggleFavorite = async (record, favorite) => {
        try {
            const { data } = await setFavoriteFile(record.id, favorite);
            if (data.code === 200) {
                message.success(favorite ? '已收藏' : '已取消收藏');
                if (activeView === VIEW_FILES) {
                    fetchFiles();
                }
                fetchFavoriteFiles();
            } else {
                message.error(data.message || '操作失败');
            }
        } catch (err) {
            message.error(err.response?.data?.message || '操作失败');
        }
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
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) {
                throw new Error('预览内容读取失败');
            }
            const text = await res.text();
            const maxChars = 500000;
            if (text.length > maxChars) {
                setPreviewText(text.slice(0, maxChars));
                setPreviewTruncated(true);
            } else {
                setPreviewText(text);
            }
            setPreviewLoading(false);
        } catch {
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
                const url = `${window.location.origin}${getPublicShareDownloadUrl(token)}`;
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
        {
            title: '处理状态',
            dataIndex: 'processStatus',
            width: 120,
            render: (s, record) => {
                if (record.isDir) return '-';
                if (s === 'DONE') return <Tag color="success">完成</Tag>;
                if (s === 'PENDING') return <Tag color="processing">处理中</Tag>;
                return <Tag>未知</Tag>;
            },
        },
        {
            title: '操作',
            width: activeView === VIEW_RECYCLE ? 240 : 380,
            render: (_, record) => {
                if (activeView === VIEW_RECYCLE) {
                    return (
                        <Space>
                            <Button size="small" icon={<UndoOutlined />} onClick={() => handleRestore(record.id)}>
                                恢复
                            </Button>
                            <Popconfirm title="确认彻底删除？该操作不可恢复" onConfirm={() => handlePurge(record.id)}>
                                <Button size="small" danger icon={<DeleteFilled />}>
                                    彻底删除
                                </Button>
                            </Popconfirm>
                        </Space>
                    );
                }

                return (
                    <Space>
                        {!record.isDir && (
                            <Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(record)}>
                                下载
                            </Button>
                        )}
                        {canPreview(record) && (
                            <Button size="small" icon={<EyeOutlined />} onClick={() => handlePreview(record)}>
                                预览
                            </Button>
                        )}
                        {activeView === VIEW_FILES && (
                            <Button size="small" icon={<DragOutlined />} onClick={() => openMoveModal(record)}>
                                移动
                            </Button>
                        )}
                        {!record.isDir && (
                            <Button size="small" icon={<ShareAltOutlined />} onClick={() => handleCreateShare(record)}>
                                分享
                            </Button>
                        )}
                        {!record.isDir && (
                            <Button
                                size="small"
                                icon={record.isFavorite ? <StarFilled /> : <StarOutlined />}
                                onClick={() => handleToggleFavorite(record, !record.isFavorite)}
                            >
                                {record.isFavorite ? '已收藏' : '收藏'}
                            </Button>
                        )}
                        <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
                            <Button size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                    </Space>
                );
            },
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
                const url = `${window.location.origin}${getPublicShareDownloadUrl(record.shareToken)}`;
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
                    <div className="ol-files-tools-left">
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
                        <Button icon={<ReloadOutlined />} onClick={refreshCurrentView}>刷新</Button>
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
                            rowKey="id"
                            columns={fileColumns}
                            dataSource={fileRows}
                            loading={loading}
                            pagination={{ pageSize: 20, showSizeChanger: false }}
                        />
                    )}
                    {activeView === VIEW_SHARES && (
                        <Table
                            rowKey="id"
                            columns={shareColumns}
                            dataSource={filteredShares}
                            loading={loading}
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
                onCancel={closePreviewModal}
            >
                {previewLoading && <div>预览加载中...</div>}
                {!previewLoading && previewKind === 'video' && (
                    <video className="ol-preview-video" controls src={previewUrl}>
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
