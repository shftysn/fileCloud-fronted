import React, { useEffect, useMemo, useRef } from 'react';
import { Button, Progress, Typography, message, Space, Tag, Card, Alert, List } from 'antd';
import { UploadOutlined, InboxOutlined, ReloadOutlined, DeleteOutlined, PauseOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { initUpload, uploadChunk, mergeChunks, cancelUploadSession } from '../api/file';
import store from '../store';
import { addTasks, patchTask, removeTaskById, clearDoneTasks as clearDoneTasksAction, setUploadingAll } from '../store/uploadSlice';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB，与后端保持一致

export default function UploadPage() {
    const dispatch = useDispatch();

    //从redux中获取上传任务列表和批量上传状态
    const tasks = useSelector((state) => state.upload.tasks);
    const uploadingAll = useSelector((state) => state.upload.uploadingAll);

    //使用ref来持有当前任务列表和正在上传的任务ID集合，避免闭包问题和频繁的状态更新
    const tasksRef = useRef([]);
    const runningTaskIdsRef = useRef(new Set());
    const pauseRequestedRef = useRef(new Set());
    const finishedCleanupTimersRef = useRef(new Map());

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

    const updateTask = (taskId, patch) => {
        dispatch(patchTask({ taskId, patch }));
    };

    const getTasksSnapshot = () => store.getState().upload.tasks;

    const isTaskPaused = (taskId) => {
        return pauseRequestedRef.current.has(taskId);
    };

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


    //从redux中的任务列表计算不同状态的任务数量，用于界面显示和按钮状态控制
    const pendingCount = useMemo(
        () => tasks.filter((t) => t.status === 'pending' || t.status === 'error' || t.status === 'paused').length,
        [tasks]
    );
    const successCount = useMemo(() => tasks.filter((t) => t.status === 'done').length, [tasks]);
    const uploadingCount = useMemo(
        () => tasks.filter((t) => t.status === 'uploading' || t.status === 'merging').length,
        [tasks]
    );

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
            status: 'pending', // pending(待定) | uploading | merging | done | error
            errorMessage: '',
            uploadId: null,
            totalChunks: 0,
            uploadedChunks: [],  //记录已上传分片索引，便于断点续传和进度计算
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
        pauseRequestedRef.current.delete(task.id);

        //更新任务状态为上传中，清除错误信息
        updateTask(task.id, { status: 'uploading', errorMessage: '' });

        try {
            let uploadId = task.uploadId;
            let totalChunks = task.totalChunks;
            let uploadedSet = new Set(task.uploadedChunks || []);

            //如果没有上传会话ID或总分片数，说明是第一次上传或之前的会话无效，需要与后端交互初始化上传会话
            if (!uploadId || !totalChunks) {
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
                totalChunks = initRes.data.totalChunks;
                uploadedSet = new Set(initRes.data.uploadedChunks || []);

                updateTask(task.id, {
                    uploadId,
                    totalChunks,
                    uploadedChunks: Array.from(uploadedSet),
                });
            }

            //如果已经有部分分片上传成功，先更新进度显示
            updateTask(task.id, {
                progress: Math.round((uploadedSet.size / totalChunks) * 100),
            });

            // 分片顺序上传，任务之间并发执行
            for (let i = 0; i < totalChunks; i++) {
                if (isTaskPaused(task.id)) {
                    return;
                }
                if (uploadedSet.has(i)) continue;

                //计算当前分片的起始和结束位置，从文件中切出对应的Blob对象
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, task.file.size);
                const blob = task.file.slice(start, end);

                try {
                    //上传一个分片
                    await uploadChunk(uploadId, i, blob, (e) => {
                        //这里的e是上传进度对象，有属性loaded和total，可以计算当前分片的上传进度，并结合已上传的分片数量计算整体进度，更新任务状态
                        //上传进度回调中计算当前分片的上传进度和整体进度，更新任务状态
                        if (isTaskPaused(task.id)) {
                            return;
                        }
                        const chunkFraction = e.total ? (e.loaded / e.total) : 0;
                        const overall = Math.round(((uploadedSet.size + chunkFraction) / totalChunks) * 100);
                        updateTask(task.id, { progress: Math.min(99, overall) });
                    });

                    uploadedSet.add(i);
                    if (isTaskPaused(task.id)) {
                        updateTask(task.id, {
                            progress: Math.round((uploadedSet.size / totalChunks) * 100),
                            status: 'paused',
                            uploadedChunks: Array.from(uploadedSet),
                        });
                        return;
                    }
                    updateTask(task.id, {
                        progress: Math.round((uploadedSet.size / totalChunks) * 100),
                        status: 'uploading',
                        uploadedChunks: Array.from(uploadedSet),
                    });
                } catch {
                    updateTask(task.id, {
                        status: 'error',
                        errorMessage: `上传失败（分片 ${i}）`,
                        uploadedChunks: Array.from(uploadedSet),
                    });
                    return;
                }
            }

            //一个文件的所有分片上传成功后，通知后端合并分片
            updateTask(task.id, { status: 'merging' });
            const { data: mergeRes } = await mergeChunks(uploadId);
            if (mergeRes.code === 200) {
                updateTask(task.id, {
                    status: 'done',
                    progress: 100,
                    errorMessage: '',
                    uploadId: null,
                    totalChunks: 0,
                    uploadedChunks: [],
                });
                scheduleAutoRemoveTask(task.id);
            } else {
                updateTask(task.id, { status: 'error', errorMessage: mergeRes.message || '合并失败' });
            }
        } catch {
            updateTask(task.id, { status: 'error', errorMessage: '上传过程出错' });
        } finally {
            runningTaskIdsRef.current.delete(task.id);
        }
    };

    //开始批量上传，内部会自动跳过已完成的任务
    const startAllUploads = async () => {
        //获取当前所有任务的快照，筛选出待上传、错误或暂停状态的任务进行上传
        const toUpload = getTasksSnapshot().filter((t) => t.status === 'pending' || t.status === 'error' || t.status === 'paused');

        if (toUpload.length === 0) {
            message.info('没有可开始的上传任务');
            return;
        }
        dispatch(setUploadingAll(true));
        //并发执行所有待上传任务，使用Promise.allSettled来等待所有任务完成，无论成功或失败
        await Promise.allSettled(toUpload.map((task) => uploadSingleTask(task)));
        dispatch(setUploadingAll(false));

        const latest = getTasksSnapshot();
        const hasPaused = latest.some((t) => t.status === 'paused');
        const hasError = latest.some((t) => t.status === 'error');
        const allDone = latest.length > 0 && latest.every((t) => t.status === 'done');

        if (allDone) {
            message.success('批量上传执行完成');
            return;
        }
        if (hasPaused && !hasError) {
            message.info('批量上传已暂停，可继续上传');
            return;
        }
        if (hasError) {
            message.warning('批量上传已结束，部分任务失败');
            return;
        }
        message.info('批量上传已结束');
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

        pauseRequestedRef.current.add(taskId);
        if (task.uploadId && task.status !== 'done') {
            try {
                await cancelUploadSession(task.uploadId);
            } catch {
                message.warning('上传任务已移除，但服务端分片清理可能失败');
            }
        }

        dispatch(removeTaskById(taskId));
        pauseRequestedRef.current.delete(taskId);
    };


    //暂停上传任务
    const pauseTask = (taskId) => {
        pauseRequestedRef.current.add(taskId);
        updateTask(taskId, { status: 'paused' });
    };

    //继续上传任务
    const resumeTask = async (taskId) => {
        const task = tasksRef.current.find((t) => t.id === taskId);
        if (!task) return;
        pauseRequestedRef.current.delete(taskId);
        await uploadSingleTask(task);
    };

    const retryTask = async (taskId) => {
        const task = tasksRef.current.find((t) => t.id === taskId);
        if (!task) return;
        pauseRequestedRef.current.delete(taskId);
        updateTask(taskId, { status: 'pending', errorMessage: '' });
        await uploadSingleTask({ ...task, status: 'pending' });
    };

    const handleClearDoneTasks = () => {
        dispatch(clearDoneTasksAction());
    };

    const statusTag = {
        pending: <Tag>等待上传</Tag>,
        uploading: <Tag color="processing">上传中</Tag>,
        paused: <Tag color="warning">已暂停</Tag>,
        merging: <Tag color="processing">合并中</Tag>,
        done: <Tag color="success">上传完成</Tag>,
        error: <Tag color="error">上传失败</Tag>,
    };

    return (
        <div>
            <div className="ol-upload-head">
                <div>
                    <Typography.Title level={4} style={{ margin: 0 }}>上传中心</Typography.Title>
                    <Typography.Text type="secondary">支持多个文件同时上传，每个文件独立进度</Typography.Text>
                </div>
                <Space>
                    <Tag color="blue">上传中 {uploadingCount}</Tag>
                    <Tag color="success">已完成 {successCount}</Tag>
                </Space>
            </div>

            <Card className="ol-card-surface" bodyStyle={{ padding: 16 }}>
                <div className="ol-upload-drop">
                    <Space direction="vertical" size={6}>
                        <Space>
                            <InboxOutlined style={{ color: 'var(--ol-primary)' }} />
                            <Typography.Text strong>选择要上传的文件（可多选）</Typography.Text>
                        </Space>
                        <Typography.Text type="secondary">支持断点续传，单分片 5MB</Typography.Text>
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
                                task.status === 'uploading' ? (
                                    <Button
                                        key="pause"
                                        size="small"
                                        icon={<PauseOutlined />}
                                        onClick={() => pauseTask(task.id)}
                                    >
                                        暂停
                                    </Button>
                                ) : null,
                                task.status === 'paused' ? (
                                    <Button
                                        key="resume"
                                        size="small"
                                        type="primary"
                                        icon={<PlayCircleOutlined />}
                                        onClick={() => resumeTask(task.id)}
                                    >
                                        继续
                                    </Button>
                                ) : null,
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
        </div>
    );
}
