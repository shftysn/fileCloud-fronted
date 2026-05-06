import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Progress, Typography, message, Space, Tag, Card, Alert, List, Modal, Input } from 'antd';
import { UploadOutlined, InboxOutlined, ReloadOutlined, DeleteOutlined, EditOutlined, PauseOutlined, CaretRightOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { initUpload, getOssSts, completeUpload, cancelUploadSession, getStorageSummary } from '../api/file';
import store from '../store';
import { addTasks, patchTask, patchTaskRuntime, removeTaskById, clearDoneTasks as clearDoneTasksAction, setUploadingAll } from '../store/uploadSlice';
import { cacheUploadFile, getCachedUploadFile, removeCachedUploadFile, removeCachedUploadFiles } from '../utils/uploadFileCache';

const MB = 1024 * 1024;
const DEFAULT_CHUNK_SIZE = 16 * MB;
const LARGE_FILE_CHUNK_SIZE = 16 * MB;
const HUGE_FILE_CHUNK_SIZE = 32 * MB;
const GIANT_FILE_CHUNK_SIZE = 48 * MB;
const PROGRESS_UPDATE_INTERVAL_MS = 250;
const STS_REFRESH_BUFFER_MS = 2 * 60 * 1000;
const OSS_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const OSS_UPLOAD_PARALLEL = 4;

let ossCtorPromise = null;

const getOssCtor = async () => {
    if (!ossCtorPromise) {
        ossCtorPromise = import('ali-oss').then((mod) => mod.default || mod);
    }
    return ossCtorPromise;
};

const getFileFingerprint = (fileOrTask) => {
    if (!fileOrTask) {
        return '';
    }
    if (fileOrTask.name && Number(fileOrTask.size) >= 0 && Number(fileOrTask.lastModified) >= 0) {
        return `${fileOrTask.name}_${fileOrTask.size}_${fileOrTask.lastModified}`;
    }
    if (fileOrTask.fileFingerprint) {
        return fileOrTask.fileFingerprint;
    }
    const taskId = String(fileOrTask.id || '');
    return taskId.replace(/_\d+$/, '');
};

const toPlainJson = (value) => {
    if (value == null) {
        return null;
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
};

const normalizeUploadCheckpoint = (checkpoint, file) => {
    const plain = toPlainJson(checkpoint);
    if (!plain || typeof plain !== 'object') {
        return null;
    }
    if (file?.size > 0 && Number(plain.fileSize) > 0 && Number(plain.fileSize) !== Number(file.size)) {
        return null;
    }
    if (!plain.uploadId || !plain.name) {
        return null;
    }
    return {
        ...plain,
        fileSize: Number(plain.fileSize) > 0 ? Number(plain.fileSize) : (file?.size || 0),
        doneParts: Array.isArray(plain.doneParts) ? plain.doneParts : [],
    };
};

const getChunkSize = (fileSize) => {
    if (fileSize >= 10 * 1024 * MB) {
        return GIANT_FILE_CHUNK_SIZE;
    }
    if (fileSize >= 5 * 1024 * MB) {
        return HUGE_FILE_CHUNK_SIZE;
    }
    if (fileSize >= 1024 * MB) {
        return LARGE_FILE_CHUNK_SIZE;
    }
    return DEFAULT_CHUNK_SIZE;
};

const getExpirationTime = (expiration) => {
    if (!expiration) {
        return 0;
    }
    const time = new Date(expiration).getTime();
    return Number.isFinite(time) ? time : 0;
};

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
    const uploadRuntimeRef = useRef(new Map());
    const restoringTaskIdsRef = useRef(new Set());
    const stsCacheRef = useRef(null);

    useEffect(() => {
        tasksRef.current = tasks;
    }, [tasks]);

    useEffect(() => {
        tasks.forEach((task) => {
            if (!task?.id) {
                return;
            }

            const runtime = uploadRuntimeRef.current.get(task.id) || {};
            if (!runtime.checkpoint && task.uploadCheckpoint) {
                runtime.checkpoint = normalizeUploadCheckpoint(task.uploadCheckpoint, task.file);
                uploadRuntimeRef.current.set(task.id, runtime);
                return;
            }
            if (!task.uploadCheckpoint && runtime.checkpoint && !runningTaskIdsRef.current.has(task.id)) {
                runtime.checkpoint = null;
                uploadRuntimeRef.current.set(task.id, runtime);
            }
        });
    }, [tasks]);

    useEffect(() => {
        tasks.forEach((task) => {
            if (!task || task.status === 'done' || task.file instanceof File) {
                return;
            }
            if (restoringTaskIdsRef.current.has(task.id)) {
                return;
            }

            restoringTaskIdsRef.current.add(task.id);
            void getCachedUploadFile(task.id)
                .then((cachedFile) => {
                    if (!(cachedFile instanceof File)) {
                        return;
                    }
                    updateTask(task.id, {
                        file: cachedFile,
                        fileName: cachedFile.name,
                        fileSize: cachedFile.size,
                        errorMessage: '',
                    });
                })
                .finally(() => {
                    restoringTaskIdsRef.current.delete(task.id);
                });
        });
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
            uploadRuntimeRef.current.clear();
        };
    }, []);

    useEffect(() => {
        fetchStorageSummary();
    }, []);

    const updateTask = (taskId, patch) => {
        dispatch(patchTask({ taskId, patch }));
    };

    const updateTaskRuntimeState = (taskId, patch) => {
        dispatch(patchTaskRuntime({ taskId, patch }));
    };

    const formatBytes = (bytes) => {
        if (!bytes || bytes <= 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(2)} MB`;
        return `${(bytes / 1073741824).toFixed(2)} GB`;
    };

    const formatMegabytes = (bytes) => `${(Math.max(0, bytes || 0) / MB).toFixed(2)} MB`;

    const formatSpeed = (bytesPerSecond) => {
        if (!bytesPerSecond || bytesPerSecond <= 0) {
            return '-';
        }
        return `${formatBytes(bytesPerSecond)}/s`;
    };

    const formatDuration = (seconds) => {
        if (!Number.isFinite(seconds) || seconds < 0) {
            return '-';
        }
        const totalSeconds = Math.max(0, Math.round(seconds));
        if (totalSeconds < 60) {
            return `${totalSeconds}s`;
        }
        const minutes = Math.floor(totalSeconds / 60);
        const remainSeconds = totalSeconds % 60;
        if (minutes < 60) {
            return `${minutes}m ${remainSeconds}s`;
        }
        const hours = Math.floor(minutes / 60);
        const remainMinutes = minutes % 60;
        return `${hours}h ${remainMinutes}m`;
    };

    const getUploadedBytes = (task) => {
        if (!task) {
            return 0;
        }
        if (task.status === 'done') {
            return task.fileSize || 0;
        }
        if (Number(task.uploadedBytes) > 0) {
            return Math.min(task.fileSize || 0, Number(task.uploadedBytes));
        }
        const fileSize = task.fileSize || 0;
        return Math.min(fileSize, Math.round((Number(task.progress) || 0) * fileSize / 100));
    };

    const getTaskProgressText = (task) => {
        const uploadedBytes = getUploadedBytes(task);
        const totalBytes = task?.fileSize || 0;
        if (task?.status === 'merging') {
            return `已上传 ${formatMegabytes(totalBytes)} / ${formatMegabytes(totalBytes)}，等待服务端确认`;
        }
        const speedText = task?.status === 'uploading' ? `，速度 ${formatSpeed(task.uploadSpeedBps)}` : '';
        const etaText = task?.status === 'uploading' ? `，剩余 ${formatDuration(task.uploadEtaSeconds)}` : '';
        return `已上传 ${formatMegabytes(uploadedBytes)} / ${formatMegabytes(totalBytes)}${speedText}${etaText}`;
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

    const clearTaskRuntime = (taskId) => {
        uploadRuntimeRef.current.delete(taskId);
    };

    const persistTaskUploadSnapshot = (taskId, patch = {}) => {
        const runtime = uploadRuntimeRef.current.get(taskId) || {};
        runtime.lastCheckpointPersistAt = Date.now();
        uploadRuntimeRef.current.set(taskId, runtime);
        updateTask(taskId, {
            uploadCheckpoint: runtime.checkpoint || null,
            ...patch,
        });
    };

    const updateTaskProgress = (taskId, progress, options = {}) => {
        const { forcePersist = false, status } = options;
        const runtime = uploadRuntimeRef.current.get(taskId) || {};
        const nextProgress = Math.max(0, Math.min(99.9, progress));
        const now = Date.now();
        const shouldRefreshUi = forcePersist
            || runtime.lastProgressValue !== nextProgress
            || !runtime.lastProgressUiAt
            || (now - runtime.lastProgressUiAt >= PROGRESS_UPDATE_INTERVAL_MS);

        runtime.lastProgressValue = nextProgress;
        if (shouldRefreshUi) {
            runtime.lastProgressUiAt = now;
            uploadRuntimeRef.current.set(taskId, runtime);
            updateTaskRuntimeState(taskId, {
                progress: nextProgress,
                ...(options.uploadedBytes != null ? { uploadedBytes: options.uploadedBytes } : {}),
                ...(options.uploadSpeedBps != null ? { uploadSpeedBps: options.uploadSpeedBps } : {}),
                ...(options.uploadEtaSeconds != null ? { uploadEtaSeconds: options.uploadEtaSeconds } : {}),
                ...(status ? { status } : {}),
            });
        } else {
            uploadRuntimeRef.current.set(taskId, runtime);
        }

        if (forcePersist) {
            persistTaskUploadSnapshot(taskId, {
                progress: nextProgress,
                ...(status ? { status } : {}),
            });
        }
    };

    const updateUploadMetrics = (taskId, fileSize, percent, options = {}) => {
        const runtime = uploadRuntimeRef.current.get(taskId) || {};
        const now = Date.now();
        const uploadedBytes = Math.min(fileSize, Math.max(0, Math.round((percent || 0) * fileSize)));

        if (!runtime.metricStartedAt) {
            runtime.metricStartedAt = now;
            runtime.metricStartedBytes = uploadedBytes;
            runtime.metricLastAt = now;
            runtime.metricLastBytes = uploadedBytes;
        }

        const elapsedSeconds = Math.max(0.001, (now - runtime.metricStartedAt) / 1000);
        const instantElapsedSeconds = Math.max(0.001, (now - (runtime.metricLastAt || now)) / 1000);
        const instantDeltaBytes = Math.max(0, uploadedBytes - (runtime.metricLastBytes || 0));
        const averageSpeed = Math.max(0, (uploadedBytes - (runtime.metricStartedBytes || 0)) / elapsedSeconds);
        const instantSpeed = instantDeltaBytes / instantElapsedSeconds;
        const previousSpeed = Number(runtime.smoothedSpeedBps) || 0;
        const smoothedSpeed = previousSpeed > 0
            ? (previousSpeed * 0.7 + instantSpeed * 0.3)
            : (instantSpeed > 0 ? instantSpeed : averageSpeed);
        const effectiveSpeed = smoothedSpeed > 0 ? smoothedSpeed : averageSpeed;
        const etaSeconds = effectiveSpeed > 0 ? (fileSize - uploadedBytes) / effectiveSpeed : null;

        runtime.metricLastAt = now;
        runtime.metricLastBytes = uploadedBytes;
        runtime.smoothedSpeedBps = effectiveSpeed;
        uploadRuntimeRef.current.set(taskId, runtime);

        updateTaskProgress(taskId, Number(((percent || 0) * 100).toFixed(1)), {
            ...options,
            uploadedBytes,
            uploadSpeedBps: Math.round(effectiveSpeed),
            uploadEtaSeconds: etaSeconds,
        });
    };

    const isUploadCanceled = (taskId, err) => {
        const runtime = uploadRuntimeRef.current.get(taskId);
        if (runtime?.cancelRequested) {
            return true;
        }
        const name = String(err?.name || '').toLowerCase();
        const code = String(err?.code || '').toLowerCase();
        if (name === 'cancel' || name === 'abort' || name === 'cancelederror' || code === 'err_canceled') {
            return true;
        }
        return false;
    };

    const createCheckpoint = (checkpoint, file) => {
        const plain = toPlainJson(checkpoint);
        if (!plain || typeof plain !== 'object') {
            return null;
        }
        delete plain.file;
        plain.fileSize = file?.size || Number(plain.fileSize) || 0;
        plain.doneParts = Array.isArray(plain.doneParts) ? plain.doneParts : [];
        return plain;
    };

    const getUploadedBytesFromCheckpoint = (fileSize, checkpoint) => {
        if (!checkpoint) {
            return 0;
        }
        const doneParts = Array.isArray(checkpoint.doneParts) ? checkpoint.doneParts.length : 0;
        const partSize = Number(checkpoint.partSize) > 0 ? Number(checkpoint.partSize) : getChunkSize(fileSize || 0);
        return Math.min(fileSize || 0, doneParts * partSize);
    };

    const getValidSts = async () => {
        const cached = stsCacheRef.current;
        if (cached?.expirationTime && cached.expirationTime - Date.now() > STS_REFRESH_BUFFER_MS) {
            return cached;
        }
        const { data: stsRes } = await getOssSts();
        if (stsRes.code !== 200 || !stsRes.data) {
            throw new Error(stsRes.message || '获取 OSS 临时凭证失败');
        }
        const next = {
            ...stsRes.data,
            expirationTime: getExpirationTime(stsRes.data.expiration),
        };
        stsCacheRef.current = next;
        return next;
    };

    const createOssClient = async () => {
        const OSS = await getOssCtor();
        const sts = await getValidSts();
        return new OSS({
            accessKeyId: sts.accessKeyId,
            accessKeySecret: sts.accessKeySecret,
            stsToken: sts.securityToken,
            bucket: sts.bucket,
            region: sts.region,
            endpoint: sts.endpoint,
            secure: true,
            timeout: OSS_UPLOAD_TIMEOUT_MS,
            refreshSTSToken: async () => {
                const refreshed = await getValidSts();
                return {
                    accessKeyId: refreshed.accessKeyId,
                    accessKeySecret: refreshed.accessKeySecret,
                    stsToken: refreshed.securityToken,
                };
            },
            refreshSTSTokenInterval: Math.max(60000, STS_REFRESH_BUFFER_MS),
        });
    };

    const uploadFileToOss = async (taskId, file, objectKey, onProgress) => {
        const runtime = uploadRuntimeRef.current.get(taskId) || {};
        const checkpoint = normalizeUploadCheckpoint(runtime.checkpoint, file)
            || null;
        const client = await createOssClient();
        runtime.ossClient = client;
        runtime.checkpoint = checkpoint;
        uploadRuntimeRef.current.set(taskId, runtime);

        const result = await client.multipartUpload(objectKey, file, {
            checkpoint,
            parallel: OSS_UPLOAD_PARALLEL,
            partSize: getChunkSize(file.size || 0),
            progress: async (percent, nextCheckpoint) => {
                const latestRuntime = uploadRuntimeRef.current.get(taskId) || {};
                if (latestRuntime.pauseRequested || latestRuntime.removeRequested || latestRuntime.cancelRequested) {
                    client.cancel();
                    return;
                }
                latestRuntime.checkpoint = createCheckpoint(nextCheckpoint, file);
                latestRuntime.lastCheckpointPersistAt = Date.now();
                uploadRuntimeRef.current.set(taskId, latestRuntime);
                if (typeof onProgress === 'function') {
                    onProgress(percent, latestRuntime.checkpoint);
                }
            },
        });
        const latestRuntime = uploadRuntimeRef.current.get(taskId) || runtime;
        latestRuntime.checkpoint = null;
        uploadRuntimeRef.current.set(taskId, latestRuntime);
        return result;
    };

    const abortOssUploadIfNeeded = async (taskId, options = {}) => {
        const runtime = uploadRuntimeRef.current.get(taskId) || {};
        const client = runtime.ossClient;
        const checkpoint = runtime.checkpoint;
        if (client?.cancel) {
            client.cancel();
        }
        if (options.abortRemote && client?.abortMultipartUpload && checkpoint?.name && checkpoint?.uploadId) {
            const latestRuntime = uploadRuntimeRef.current.get(taskId) || {};
            try {
                await client.abortMultipartUpload(checkpoint.name, checkpoint.uploadId);
            } catch {
                if (!latestRuntime.removeRequested) {
                    throw new Error('服务端分片清理失败');
                }
            }
        }
    };


    //从redux中的任务列表计算不同状态的任务数量，用于界面显示和按钮状态控制
    const pendingCount = useMemo(
        () => tasks.filter((t) => t.status === 'pending' || t.status === 'paused' || t.status === 'error').length,
        [tasks]
    );
    const successCount = useMemo(() => tasks.filter((t) => t.status === 'done').length, [tasks]);
    const uploadingCount = useMemo(
        () => tasks.filter((t) => t.status === 'uploading' || t.status === 'merging').length,
        [tasks]
    );

    const waitingBytes = useMemo(
        () => tasks
            .filter((t) => t.status === 'pending' || t.status === 'paused' || t.status === 'uploading' || t.status === 'merging' || t.status === 'error')
            .reduce((sum, t) => sum + (t.fileSize || 0), 0),
        [tasks]
    );

    const storageUsedBytes = storageSummary?.usedBytes || 0;
    const storageQuotaBytes = storageSummary?.quotaBytes || 0;
    const storageReservedBytes = storageSummary?.reservedUsedBytes || storageSummary?.usedBytes || 0;
    const storagePendingBytes = storageSummary?.pendingBytes || 0;
    const storageRemainingBytes = storageSummary?.remainingBytes ?? Math.max(0, storageQuotaBytes - storageUsedBytes);
    const storageReservedRemainingBytes = storageSummary?.reservedRemainingBytes ?? Math.max(0, storageQuotaBytes - storageReservedBytes);
    const storageUsagePercent = storageSummary?.usagePercent ?? (storageQuotaBytes <= 0 ? 0 : Math.min(100, Math.round((storageUsedBytes * 100) / storageQuotaBytes)));
    const storageReservedPercent = storageSummary?.reservedUsagePercent ?? (storageQuotaBytes <= 0 ? 0 : Math.min(100, Math.round((storageReservedBytes * 100) / storageQuotaBytes)));

    // 选择文件后准备上传任务
    const handleFileSelect = (e) => {

        //获取选择的文件列表，生成唯一ID，并添加到redux中的上传任务列表中
        const fileList = Array.from(e.target.files || []);
        if (fileList.length === 0) return;

        const snapshot = getTasksSnapshot();
        const prepared = [];

        fileList.forEach((file) => {
            const fingerprint = getFileFingerprint(file);
            const existed = snapshot.find((task) => {
                const taskFingerprint = getFileFingerprint(task);
                return taskFingerprint === fingerprint;
            });

            if (existed) {
                updateTask(existed.id, {
                    file,
                    fileName: file.name,
                    fileSize: file.size,
                    fileFingerprint: fingerprint,
                    errorMessage: '',
                });
                void cacheUploadFile(existed.id, file);
                return;
            }

            prepared.push({
                id: fingerprint,
                file,
                fileName: file.name,
                fileSize: file.size,
                fileFingerprint: fingerprint,
                progress: 0,
                status: 'pending', // pending | paused | uploading | merging | done | error
                errorMessage: '',
                uploadId: null,
                objectKey: null,
                totalChunks: null,
                uploadCheckpoint: null,
            });
            void cacheUploadFile(fingerprint, file);
        });

        if (prepared.length > 0) {
            dispatch(addTasks(prepared));
        }
        e.target.value = '';
    };


    // 核心上传逻辑，单个任务的上传过程
    const uploadSingleTask = async (task) => {
        let uploadFile = task.file;
        if (!(uploadFile instanceof File)) {
            uploadFile = await getCachedUploadFile(task.id);
            if (uploadFile instanceof File) {
                updateTask(task.id, {
                    file: uploadFile,
                    fileName: uploadFile.name,
                    fileSize: uploadFile.size,
                    errorMessage: '',
                });
            }
        }

        if (!(uploadFile instanceof File)) {
            updateTask(task.id, {
                status: 'paused',
                errorMessage: '未找到本地缓存文件，请重新选择文件',
            });
            return;
        }

        //如果任务已经在上传中，直接返回，避免重复上传
        if (runningTaskIdsRef.current.has(task.id)) {
            return;
        }
        runningTaskIdsRef.current.add(task.id);

        const runtime = uploadRuntimeRef.current.get(task.id) || {};
        runtime.pauseRequested = false;
        runtime.removeRequested = false;
        runtime.cancelRequested = false;
        runtime.lastProgressUiAt = 0;
        runtime.lastProgressValue = runtime.checkpoint ? task.progress : 0;
        runtime.metricStartedAt = 0;
        runtime.metricStartedBytes = 0;
        runtime.metricLastAt = 0;
        runtime.metricLastBytes = 0;
        runtime.smoothedSpeedBps = 0;
        uploadRuntimeRef.current.set(task.id, runtime);

        //更新任务状态为上传中，清除错误信息
        updateTask(task.id, {
            status: 'uploading',
            errorMessage: '',
            progress: runtime.checkpoint ? task.progress : 0,
            uploadSpeedBps: 0,
            uploadEtaSeconds: null,
            uploadedBytes: getUploadedBytesFromCheckpoint(uploadFile.size || 0, runtime.checkpoint) || getUploadedBytes(task),
        });

        let uploadId = task.uploadId;
        let objectKey = task.objectKey;

        try {
            if (!uploadId || !objectKey) {
                const { data: initRes } = await initUpload({
                    fileName: task.fileName,
                    fileSize: task.fileSize,
                    contentType: uploadFile.type || 'application/octet-stream',
                });
                if (initRes.code !== 200) {
                    updateTask(task.id, { status: 'error', errorMessage: initRes.message || '初始化上传失败' });
                    return;
                }
                uploadId = initRes.data.uploadId;
                objectKey = initRes.data.objectKey;
                runtime.checkpoint = null;
                uploadRuntimeRef.current.set(task.id, runtime);

                updateTask(task.id, {
                    uploadId,
                    objectKey,
                    totalChunks: null,
                    uploadCheckpoint: null,
                });
            }

            runtime.checkpoint = normalizeUploadCheckpoint(runtime.checkpoint, uploadFile) || null;
            uploadRuntimeRef.current.set(task.id, runtime);

            updateTaskRuntimeState(task.id, {
                uploadPartSize: runtime.checkpoint?.partSize || getChunkSize(uploadFile.size || 0),
                uploadParallel: OSS_UPLOAD_PARALLEL,
            });

            const initialUploadedBytes = getUploadedBytesFromCheckpoint(uploadFile.size || 0, runtime.checkpoint);
            if (initialUploadedBytes > 0) {
                updateUploadMetrics(task.id, uploadFile.size || 0, (initialUploadedBytes / (uploadFile.size || 1)) || 0, {
                    status: 'uploading',
                    forcePersist: true,
                });
            }

            const uploadResult = await uploadFileToOss(task.id, uploadFile, objectKey, (percent, checkpoint) => {
                const latestRuntime = uploadRuntimeRef.current.get(task.id);
                if (latestRuntime?.pauseRequested || latestRuntime?.removeRequested) {
                    return;
                }
                updateUploadMetrics(task.id, uploadFile.size || 0, percent || 0, {
                    status: 'uploading',
                    forcePersist: Boolean(checkpoint),
                });
            });

            persistTaskUploadSnapshot(task.id, { progress: 99, status: 'merging' });
            const { data: completeRes } = await completeUpload({
                uploadId,
                objectKey,
                etag: uploadResult?.etag || '',
            });
            if (completeRes.code !== 200) {
                throw new Error(completeRes.message || '提交上传完成失败');
            }
            updateTask(task.id, {
                status: 'done',
                progress: 100,
                errorMessage: '',
                uploadId: null,
                objectKey: null,
                uploadCheckpoint: null,
                file: null,
            });
            clearTaskRuntime(task.id);
            void removeCachedUploadFile(task.id);
            fetchStorageSummary();
            scheduleAutoRemoveTask(task.id);
        } catch (err) {
            const latestRuntime = uploadRuntimeRef.current.get(task.id);
            if (isUploadCanceled(task.id, err)) {
                if (!latestRuntime?.removeRequested) {
                    persistTaskUploadSnapshot(task.id, {
                        status: 'paused',
                        errorMessage: '',
                    });
                }
                fetchStorageSummary();
                return;
            }

            updateTask(task.id, {
                status: 'error',
                errorMessage: err?.message || '上传过程出错',
                uploadId,
                objectKey,
                uploadCheckpoint: latestRuntime?.checkpoint || runtime.checkpoint || null,
            });
            fetchStorageSummary();
        } finally {
            const latestRuntime = uploadRuntimeRef.current.get(task.id) || runtime;
            latestRuntime.ossClient = null;
            uploadRuntimeRef.current.set(task.id, latestRuntime);
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
        const toUpload = getTasksSnapshot().filter((t) => t.status === 'pending' || t.status === 'paused' || t.status === 'error');

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
    const removeTask = (taskId) => {
        const task = tasksRef.current.find((t) => t.id === taskId);
        if (!task) return;

        const runtime = uploadRuntimeRef.current.get(taskId);
        if (runtime) {
            runtime.removeRequested = true;
            runtime.cancelRequested = true;
            uploadRuntimeRef.current.set(taskId, runtime);
            void abortOssUploadIfNeeded(taskId, { abortRemote: true }).catch(() => {
                message.warning('OSS 上传取消请求已发出，但远端分片清理可能失败');
            });
        }

        const timerId = finishedCleanupTimersRef.current.get(taskId);
        if (timerId) {
            clearTimeout(timerId);
            finishedCleanupTimersRef.current.delete(taskId);
        }

        dispatch(removeTaskById(taskId));
        clearTaskRuntime(taskId);
        void removeCachedUploadFile(taskId);

        if (task.uploadId && task.status !== 'done') {
            void cancelUploadSession(task.uploadId)
                .then(() => {
                    fetchStorageSummary();
                })
                .catch(() => {
                    message.warning('上传任务已移除，但服务端上传会话清理可能失败');
                });
        }
    };

    const pauseTask = (taskId) => {
        const task = tasksRef.current.find((t) => t.id === taskId);
        if (!task) {
            return;
        }
        if (task.status === 'pending' || task.status === 'error') {
            updateTask(taskId, { status: 'paused', errorMessage: '' });
            return;
        }
        if (task.status !== 'uploading') {
            return;
        }

        const runtime = uploadRuntimeRef.current.get(taskId) || {};
        runtime.pauseRequested = true;
        runtime.cancelRequested = true;
        uploadRuntimeRef.current.set(taskId, runtime);
        updateTask(taskId, { status: 'paused', errorMessage: '' });
        void abortOssUploadIfNeeded(taskId);
    };

    const resumeTask = async (taskId) => {
        const task = tasksRef.current.find((t) => t.id === taskId);
        if (!task) {
            return;
        }
        updateTask(taskId, { status: 'pending', errorMessage: '' });
        await uploadSingleTask({ ...task, status: 'pending' });
    };

    const retryTask = async (taskId) => {
        const task = tasksRef.current.find((t) => t.id === taskId);
        if (!task) return;
        updateTask(taskId, { status: 'pending', errorMessage: '' });
        await uploadSingleTask({ ...task, status: 'pending' });
    };

    const handleClearDoneTasks = () => {
        const doneTaskIds = tasksRef.current.filter((task) => task.status === 'done').map((task) => task.id);
        void removeCachedUploadFiles(doneTaskIds);
        dispatch(clearDoneTasksAction());
    };

    const statusTag = {
        pending: <Tag>等待上传</Tag>,
        paused: <Tag color="warning">已暂停</Tag>,
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
                    <Typography.Text type="secondary">服务端签发临时凭证，客户端直传 OSS，上传完成后服务端校验并落库</Typography.Text>
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
                        实际已用 {formatBytes(storageUsedBytes)} / 总配额 {formatBytes(storageQuotaBytes)}，剩余 {formatBytes(storageRemainingBytes)}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                        上传预占 {formatBytes(storagePendingBytes)}，预占后预计占用 {formatBytes(storageReservedBytes)}（{storageReservedPercent}%），预占后剩余 {formatBytes(storageReservedRemainingBytes)}
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
                        <Typography.Text type="secondary">本地分片上传大小自适应，16MB-48MB；支持暂停、继续和断点续传</Typography.Text>
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
                        <List.Item className="ol-upload-task-item">
                            <div className="ol-upload-task">
                                <div className="ol-upload-task-head">
                                    <Typography.Text className="ol-upload-task-name" strong title={task.fileName}>
                                        {task.fileName}
                                    </Typography.Text>
                                    {statusTag[task.status]}
                                </div>
                                <Space className="ol-upload-task-meta" wrap size={6}>
                                    <Typography.Text type="secondary">{(task.fileSize / 1048576).toFixed(2)} MB</Typography.Text>
                                    {task.uploadParallel > 0 && (
                                        <Tag color="blue">并发 {task.uploadParallel}</Tag>
                                    )}
                                    {task.uploadPartSize > 0 && (
                                        <Tag color="geekblue">分片 {formatBytes(task.uploadPartSize)}</Tag>
                                    )}
                                </Space>
                                <Progress
                                    percent={Number(task.progress || 0)}
                                    status={task.status === 'error' ? 'exception' : task.status === 'done' ? 'success' : 'active'}
                                    format={(percent) => `${Number(percent || 0).toFixed(1)}%`}
                                    style={{ marginTop: 6 }}
                                />
                                <Typography.Text className="ol-upload-task-progress-text" type="secondary">
                                    {getTaskProgressText(task)}
                                </Typography.Text>
                                {task.errorMessage && (
                                    <Typography.Text className="ol-upload-task-error" type="danger">{task.errorMessage}</Typography.Text>
                                )}
                                <Space className="ol-upload-task-actions" wrap>
                                    {task.status === 'uploading' && (
                                        <Button
                                            key="pause"
                                            size="small"
                                            icon={<PauseOutlined />}
                                            onClick={() => pauseTask(task.id)}
                                        >
                                            暂停
                                        </Button>
                                    )}
                                    {task.status === 'paused' && (
                                        <Button
                                            key="resume"
                                            size="small"
                                            icon={<CaretRightOutlined />}
                                            onClick={() => resumeTask(task.id)}
                                        >
                                            继续
                                        </Button>
                                    )}
                                    {task.status === 'error' && (
                                        <Button
                                            key="retry"
                                            size="small"
                                            icon={<ReloadOutlined />}
                                            onClick={() => retryTask(task.id)}
                                        >
                                            重试
                                        </Button>
                                    )}
                                    {(task.status === 'pending' || task.status === 'error') && (
                                        <Button
                                            key="rename"
                                            size="small"
                                            icon={<EditOutlined />}
                                            onClick={() => openRenameTaskModal(task)}
                                        >
                                            重命名
                                        </Button>
                                    )}
                                    <Button
                                        key="remove"
                                        size="small"
                                        icon={<DeleteOutlined />}
                                        onClick={() => removeTask(task.id)}
                                        disabled={task.status === 'merging'}
                                    >
                                        删除
                                    </Button>
                                </Space>
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
