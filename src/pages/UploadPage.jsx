import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Progress, Typography, message, Space, Tag, Card, Alert, List, Modal, Input } from 'antd';
import { UploadOutlined, InboxOutlined, ReloadOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { initUpload, getOssSts, completeUpload, cancelUploadSession, getStorageSummary } from '../api/file';
import store from '../store';
import { addTasks, patchTask, removeTaskById, clearDoneTasks as clearDoneTasksAction, setUploadingAll } from '../store/uploadSlice';

const CHUNK_SIZE = 5 * 1024 * 1024;
const STS_EXPIRE_AHEAD_MS = 2 * 60 * 1000;

export default function UploadPage() {
    const dispatch = useDispatch();
    const [storageSummary, setStorageSummary] = useState(null);
    const [renameModalOpen, setRenameModalOpen] = useState(false);
    const [renamingTaskId, setRenamingTaskId] = useState(null);
    const [renamingTaskValue, setRenamingTaskValue] = useState('');

    //从redux中获取上传任务列表和批量上传状态
    const tasks = useSelector((state) => state.upload.tasks);
    const uploadingAll = useSelector((state) => state.upload.uploadingAll);

    //使用ref来持有当前任务列表和正在上传的任务ID集合，避免闭包问题和频繁的状态更新
    const tasksRef = useRef([]);
    const runningTaskIdsRef = useRef(new Set());
    const finishedCleanupTimersRef = useRef(new Map());
    const stsCacheRef = useRef(null);

    useEffect(() => {
        tasksRef.current = tasks;
    }, [tasks]);

    useEffect(() => {
        // 兜底：任何进入 done 状态的任务都在短时间后自动移除，避免列表长期堆积。
        tasks.forEach((task) => {
            if (task.status === 'done' && !finishedCleanupTimersRef.current.has(task.id)) {
                scheduleAutoRemoveTask(task.id);
            }
        });
    }, [tasks]);

    useEffect(() => {
        return () => {
            finishedCleanupTimersRef.current.forEach((timerId) => {
                clearTimeout(timerId);
            });
            finishedCleanupTimersRef.current.clear();
        };
    }, []);

    useEffect(() => {
        fetchStorageSummary();
    }, []);

    const updateTask = (taskId, patch) => {
        dispatch(patchTask({ taskId, patch }));
    };

    const formatBytes = (bytes) => {
        if (!bytes || bytes <= 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(2)} MB`;
        return `${(bytes / 1073741824).toFixed(2)} GB`;
    };

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

    const releaseFailedUploadSession = async (uploadId) => {
        if (!uploadId) {
            return;
        }
        try {
            await cancelUploadSession(uploadId);
        } catch {
            // ignore release failures to avoid masking original upload error
        }
    };

    const getTasksSnapshot = () => store.getState().upload.tasks;

    const scheduleAutoRemoveTask = (taskId, delayMs = 2000) => {
        const existing = finishedCleanupTimersRef.current.get(taskId);
        if (existing) {
            clearTimeout(existing);
        }
        const timerId = window.setTimeout(() => {
            dispatch(removeTaskById(taskId));
            finishedCleanupTimersRef.current.delete(taskId);
        }, delayMs);
        finishedCleanupTimersRef.current.set(taskId, timerId);
    };

    const getStsPayload = async (forceRefresh = false) => {
        const cached = stsCacheRef.current;
        const now = Date.now();
        if (!forceRefresh && cached && cached.expireAt - now > STS_EXPIRE_AHEAD_MS) {
            return cached.payload;
        }

        //获取oss临时凭证，成功后缓存并返回，失败则抛出错误
        const { data } = await getOssSts();
        if (data.code !== 200 || !data.data) {
            throw new Error(data.message || '获取STS临时凭证失败');
        }
        const payload = data.data;
        const expiration = payload.expiration ? new Date(payload.expiration).getTime() : (now + 45 * 60 * 1000);
        const safeExpiration = Number.isFinite(expiration) ? expiration : (now + 45 * 60 * 1000);
        stsCacheRef.current = { payload, expireAt: safeExpiration };
        return payload;
    };

    const isStsExpiredError = (err) => {
        const code = String(err?.code || '').toLowerCase();
        return code.includes('securitytoken') || code.includes('invalidaccesskeyid');
    };

    const uploadToOss = async (objectKey, file, onProgress) => {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const sts = await getStsPayload(attempt > 0);
                const { default: OSS } = await import('ali-oss');
                const client = new OSS({
                    region: sts.region,
                    bucket: sts.bucket,
                    endpoint: sts.endpoint,
                    accessKeyId: sts.accessKeyId,
                    accessKeySecret: sts.accessKeySecret,
                    stsToken: sts.securityToken,
                    timeout: 120000,
                });

                return await client.multipartUpload(objectKey, file, {
                    parallel: 4,
                    partSize: CHUNK_SIZE,
                    mime: file.type || 'application/octet-stream',
                    progress: async (percent) => {
                        if (typeof onProgress === 'function') {
                            onProgress(percent);
                        }
                    },
                });
            } catch (err) {
                if (attempt === 0 && isStsExpiredError(err)) {
                    stsCacheRef.current = null;
                    continue;
                }
                throw err;
            }
        }
        throw new Error('OSS上传失败');
    };


    //从redux中的任务列表计算不同状态的任务数量，用于界面显示和按钮状态控制
    const pendingCount = useMemo(
        () => tasks.filter((t) => t.status === 'pending' || t.status === 'error').length,
        [tasks]
    );
    const successCount = useMemo(() => tasks.filter((t) => t.status === 'done').length, [tasks]);
    const uploadingCount = useMemo(
        () => tasks.filter((t) => t.status === 'uploading' || t.status === 'merging').length,
        [tasks]
    );

    const waitingBytes = useMemo(
        () => tasks
            .filter((t) => t.status === 'pending' || t.status === 'uploading' || t.status === 'merging' || t.status === 'error')
            .reduce((sum, t) => sum + (t.fileSize || 0), 0),
        [tasks]
    );

    const storageUsagePercent = storageSummary?.usagePercent || 0;
    const storageQuotaBytes = storageSummary?.quotaBytes || 0;
    const storageReservedBytes = storageSummary?.reservedUsedBytes || storageSummary?.usedBytes || 0;
    const storagePendingBytes = storageSummary?.pendingBytes || 0;
    const storageRemainingBytes = storageSummary?.remainingBytes || 0;

    // 选择文件后准备上传任务
    const handleFileSelect = (e) => {

        //获取选择的文件列表，生成唯一ID，并添加到redux中的上传任务列表中
        const fileList = Array.from(e.target.files || []);
        if (fileList.length === 0) return;

        const prepared = fileList.map((file, idx) => ({
            id: `${file.name}_${file.size}_${file.lastModified}_${idx}`,
            file,
            fileName: file.name,
            fileSize: file.size,
            progress: 0,
            status: 'pending', // pending | uploading | merging | done | error
            errorMessage: '',
            uploadId: null,
            objectKey: null,
        }));

        dispatch(addTasks(prepared));
        e.target.value = '';
    };


    // 核心上传逻辑，单个任务的上传过程
    const uploadSingleTask = async (task) => {

        //如果任务已经在上传中，直接返回，避免重复上传
        if (runningTaskIdsRef.current.has(task.id)) {
            return;
        }
        runningTaskIdsRef.current.add(task.id);

        //更新任务状态为上传中，清除错误信息
        updateTask(task.id, { status: 'uploading', errorMessage: '' });

        let uploadId = task.uploadId;
        let objectKey = task.objectKey;

        try {
            // 没有上传会话时先初始化，服务端会返回 uploadId 与 objectKey。
            if (!uploadId || !objectKey) {
                const { data: initRes } = await initUpload({
                    fileName: task.fileName,
                    fileSize: task.fileSize,
                    contentType: task.file.type || 'application/octet-stream',
                });
                if (initRes.code !== 200) {
                    updateTask(task.id, { status: 'error', errorMessage: initRes.message || '初始化上传失败' });
                    return;
                }
                uploadId = initRes.data.uploadId;
                objectKey = initRes.data.objectKey;
                if (!objectKey) {
                    throw new Error('服务端未返回OSS对象路径，无法继续上传');
                }

                updateTask(task.id, {
                    uploadId,
                    objectKey,
                });
            }

            const uploadResult = await uploadToOss(objectKey, task.file, (percent) => {
                const progress = Math.min(99, Math.round((percent || 0) * 100));
                updateTask(task.id, { progress, status: 'uploading' });
            });

            // 上传成功后通知后端落库并清理上传会话。
            updateTask(task.id, { status: 'merging' });
            const { data: completeRes } = await completeUpload({
                uploadId,
                objectKey,
                etag: uploadResult?.res?.headers?.etag || uploadResult?.etag || '',
            });
            if (completeRes.code === 200) {
                updateTask(task.id, {
                    status: 'done',
                    progress: 100,
                    errorMessage: '',
                    uploadId: null,
                    objectKey: null,
                });
                fetchStorageSummary();
                scheduleAutoRemoveTask(task.id);
            } else {
                await releaseFailedUploadSession(uploadId);
                updateTask(task.id, { status: 'error', errorMessage: completeRes.message || '上传完成确认失败' });
                updateTask(task.id, {
                    uploadId: null,
                    objectKey: null,
                    progress: 0,
                });
                fetchStorageSummary();
            }
        } catch (err) {
            await releaseFailedUploadSession(uploadId);
            if (isStsExpiredError(err)) {
                stsCacheRef.current = null;
            }
            updateTask(task.id, { status: 'error', errorMessage: err?.message || '上传过程出错' });
            updateTask(task.id, {
                uploadId: null,
                objectKey: null,
                progress: 0,
            });
            fetchStorageSummary();
        } finally {
            runningTaskIdsRef.current.delete(task.id);
        }
    };

    const openRenameTaskModal = (task) => {
        if (!task) {
            return;
        }
        setRenamingTaskId(task.id);
        setRenamingTaskValue(task.fileName || '');
        setRenameModalOpen(true);
    };

    const handleRenameTask = () => {
        const name = renamingTaskValue.trim();
        if (!name) {
            message.warning('请输入文件名');
            return;
        }
        if (!renamingTaskId) {
            return;
        }
        updateTask(renamingTaskId, { fileName: name });
        setRenameModalOpen(false);
        setRenamingTaskId(null);
        setRenamingTaskValue('');
        message.success('已更新上传文件名');
    };

    //开始批量上传，内部会自动跳过已完成的任务
    const startAllUploads = () => {
        //获取当前所有任务的快照，筛选出待上传或失败状态任务进行上传
        const toUpload = getTasksSnapshot().filter((t) => t.status === 'pending' || t.status === 'error');

        if (toUpload.length === 0) {
            message.info('没有可开始的上传任务');
            return;
        }
        dispatch(setUploadingAll(true));
        // 仅负责启动批量任务，避免按钮 loading 被“上传+回调落库”长时间占用。
        const runningPromises = toUpload.map((task) => uploadSingleTask(task));
        dispatch(setUploadingAll(false));
        message.info('已开始上传，任务正在后台执行');

        void Promise.allSettled(runningPromises).then(() => {
            fetchStorageSummary();

            const latest = getTasksSnapshot();
            const hasError = latest.some((t) => t.status === 'error');
            const allDone = latest.length > 0 && latest.every((t) => t.status === 'done');

            if (allDone) {
                message.success('批量上传执行完成');
                return;
            }
            if (hasError) {
                message.warning('批量上传已结束，部分任务失败');
                return;
            }
            message.info('批量上传已结束');
        });
    };


    // 移除任务，如果正在上传则尝试取消服务端上传会话
    const removeTask = async (taskId) => {
        const task = tasksRef.current.find((t) => t.id === taskId);
        if (!task) return;

        const timerId = finishedCleanupTimersRef.current.get(taskId);
        if (timerId) {
            clearTimeout(timerId);
            finishedCleanupTimersRef.current.delete(taskId);
        }

        if (task.uploadId && task.status !== 'done') {
            try {
                await cancelUploadSession(task.uploadId);
                fetchStorageSummary();
            } catch {
                message.warning('上传任务已移除，但服务端上传会话清理可能失败');
            }
        }

        dispatch(removeTaskById(taskId));
    };

    const retryTask = async (taskId) => {
        const task = tasksRef.current.find((t) => t.id === taskId);
        if (!task) return;
        updateTask(taskId, { status: 'pending', errorMessage: '' });
        await uploadSingleTask({ ...task, status: 'pending' });
    };

    const handleClearDoneTasks = () => {
        dispatch(clearDoneTasksAction());
    };

    const statusTag = {
        pending: <Tag>等待上传</Tag>,
        uploading: <Tag color="processing">上传中</Tag>,
        merging: <Tag color="processing">处理中</Tag>,
        done: <Tag color="success">上传完成</Tag>,
        error: <Tag color="error">上传失败</Tag>,
    };

    return (
        <div>
            <div className="ol-upload-head">
                <div>
                    <Typography.Title level={4} style={{ margin: 0 }}>上传中心</Typography.Title>
                    <Typography.Text type="secondary">服务端签发STS，客户端直传OSS，每个文件独立进度</Typography.Text>
                </div>
                <Space>
                    <Tag color="blue">上传中 {uploadingCount}</Tag>
                    <Tag color="success">已完成 {successCount}</Tag>
                </Space>
            </div>

            <Card className="ol-card-surface" bodyStyle={{ padding: 16 }} style={{ marginBottom: 14 }}>
                <Space direction="vertical" style={{ width: '100%' }} size={6}>
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Typography.Text strong>存储空间</Typography.Text>
                        <Tag color={storageUsagePercent >= 90 ? 'error' : storageUsagePercent >= 75 ? 'warning' : 'success'}>
                            {storageUsagePercent}%
                        </Tag>
                    </Space>
                    <Progress percent={storageUsagePercent} showInfo={false} />
                    <Typography.Text type="secondary">
                        已用 {formatBytes(storageReservedBytes)}（含上传占用 {formatBytes(storagePendingBytes)}） / 总配额 {formatBytes(storageQuotaBytes)}，剩余 {formatBytes(storageRemainingBytes)}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                        当前任务累计大小：{formatBytes(waitingBytes)}
                    </Typography.Text>
                </Space>
            </Card>

            <Card className="ol-card-surface" bodyStyle={{ padding: 16 }}>
                <div className="ol-upload-drop">
                    <Space direction="vertical" size={6}>
                        <Space>
                            <InboxOutlined style={{ color: 'var(--ol-primary)' }} />
                            <Typography.Text strong>选择要上传的文件（可多选）</Typography.Text>
                        </Space>
                        <Typography.Text type="secondary">直传OSS分片大小 5MB</Typography.Text>
                        <Space>

                            {/* 文件选择框 */}
                            <input multiple type="file" onChange={handleFileSelect} />
                            <Button
                                type="primary"
                                icon={<UploadOutlined />}
                                loading={uploadingAll}
                                onClick={startAllUploads}
                                disabled={pendingCount === 0}
                            >
                                开始全部上传
                            </Button>
                            <Button icon={<ReloadOutlined />} onClick={handleClearDoneTasks} disabled={successCount === 0}>
                                清理已完成
                            </Button>
                        </Space>
                    </Space>
                </div>

                {tasks.length === 0 && (
                    <Alert type="info" showIcon message="请选择文件后点击“开始全部上传”" style={{ marginBottom: 12 }} />
                )}
            </Card>

            {/* 上传任务列表 */}
            <Card className="ol-card-surface" bodyStyle={{ padding: 8 }} style={{ marginTop: 14 }}>
                <List
                    dataSource={tasks}
                    locale={{ emptyText: '暂无上传任务' }}
                    renderItem={(task) => (
                        <List.Item
                            actions={[
                                task.status === 'error' ? (
                                    <Button
                                        key="retry"
                                        size="small"
                                        icon={<ReloadOutlined />}
                                        onClick={() => retryTask(task.id)}
                                    >
                                        重试
                                    </Button>
                                ) : null,
                                (task.status === 'pending' || task.status === 'error') ? (
                                    <Button
                                        key="rename"
                                        size="small"
                                        icon={<EditOutlined />}
                                        onClick={() => openRenameTaskModal(task)}
                                    >
                                        重命名
                                    </Button>
                                ) : null,
                                <Button
                                    key="remove"
                                    size="small"
                                    icon={<DeleteOutlined />}
                                    onClick={() => removeTask(task.id)}
                                    disabled={task.status === 'uploading' || task.status === 'merging'}
                                >
                                    移除
                                </Button>,
                            ].filter(Boolean)}
                        >
                            <div style={{ width: '100%' }}>
                                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                    <Typography.Text strong>{task.fileName}</Typography.Text>
                                    {statusTag[task.status]}
                                </Space>
                                <Typography.Text type="secondary">{(task.fileSize / 1048576).toFixed(2)} MB</Typography.Text>
                                <Progress
                                    percent={task.progress}
                                    status={task.status === 'error' ? 'exception' : task.status === 'done' ? 'success' : 'active'}
                                    style={{ marginTop: 6 }}
                                />
                                {task.errorMessage && (
                                    <Typography.Text type="danger" style={{ fontSize: 12 }}>{task.errorMessage}</Typography.Text>
                                )}
                            </div>
                        </List.Item>
                    )}
                />
            </Card>

            <Modal
                title="重命名上传任务"
                open={renameModalOpen}
                onOk={handleRenameTask}
                onCancel={() => {
                    setRenameModalOpen(false);
                    setRenamingTaskId(null);
                    setRenamingTaskValue('');
                }}
            >
                <Input
                    placeholder="请输入上传后的文件名"
                    value={renamingTaskValue}
                    onChange={(e) => setRenamingTaskValue(e.target.value)}
                    onPressEnter={handleRenameTask}
                    maxLength={255}
                />
            </Modal>
        </div>
    );
}
