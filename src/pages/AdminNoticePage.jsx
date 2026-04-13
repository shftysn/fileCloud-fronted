import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Typography,
    Card,
    Form,
    Input,
    Select,
    Button,
    Space,
    Tag,
    List,
    Popconfirm,
    message,
    Empty,
    Alert,
} from 'antd';
import { DeleteOutlined, ReloadOutlined, NotificationOutlined } from '@ant-design/icons';
import { useDispatch } from 'react-redux';
import { useSelector } from 'react-redux';
import { createAdminNotice, deleteAdminNotice, listAdminNotices, refreshToken } from '../api/auth';
import { setAccessToken } from '../store/authSlice';

export default function AdminNoticePage() {
    const [form] = Form.useForm();
    const dispatch = useDispatch();
    const currentUser = useSelector((state) => state.auth.currentUser);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const [notices, setNotices] = useState([]);

    const isAdmin = useMemo(() => {
        const roles = currentUser?.roles || [];
        return Array.isArray(roles) && roles.includes('ADMIN');
    }, [currentUser]);

    const levelColorMap = {
        INFO: 'blue',
        SUCCESS: 'success',
        WARNING: 'warning',
        ERROR: 'error',
    };

    const retryByRefresh = async (requestFn) => {
        const refreshResp = await refreshToken();
        if (refreshResp.data?.code === 200 && refreshResp.data?.data?.accessToken) {
            dispatch(setAccessToken(refreshResp.data.data.accessToken));
            return requestFn();
        }
        throw new Error(refreshResp.data?.message || '刷新登录态失败');
    };

    const loadNotices = useCallback(async () => {
        if (!isAdmin) {
            setNotices([]);
            return;
        }
        setLoading(true);
        try {
            const { data } = await listAdminNotices({ limit: 50 });
            if (data?.code === 200) {
                setNotices(Array.isArray(data.data) ? data.data : []);
            } else if (String(data?.message || '').includes('无权限')) {
                try {
                    const retried = await retryByRefresh(() => listAdminNotices({ limit: 50 }));
                    if (retried.data?.code === 200) {
                        setNotices(Array.isArray(retried.data.data) ? retried.data.data : []);
                        return;
                    }
                } catch {
                    // ignore and fallback to error message below
                }
                message.error(data?.message || '通知列表加载失败');
            } else {
                message.error(data?.message || '通知列表加载失败');
            }
        } catch (err) {
            const isForbidden = err?.response?.status === 403;
            if (isForbidden) {
                try {
                    const retried = await retryByRefresh(() => listAdminNotices({ limit: 50 }));
                    if (retried.data?.code === 200) {
                        setNotices(Array.isArray(retried.data.data) ? retried.data.data : []);
                        return;
                    }
                } catch {
                    // ignore and fallback to error message below
                }
            }
            message.error(err?.response?.data?.message || '通知列表加载失败');
        } finally {
            setLoading(false);
        }
    }, [isAdmin]);

    useEffect(() => {
        loadNotices();
    }, [loadNotices]);

    const handlePublish = async (values) => {
        setSubmitting(true);
        try {
            const payload = {
                title: values.title?.trim(),
                content: values.content?.trim(),
                level: values.level,
            };
            const { data } = await createAdminNotice(payload);
            if (data?.code === 200) {
                message.success('系统通知发布成功');
                form.resetFields();
                loadNotices();
            } else {
                message.error(data?.message || '系统通知发布失败');
            }
        } catch (err) {
            message.error(err?.response?.data?.message || '系统通知发布失败');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id) => {
        setDeletingId(id);
        try {
            const { data } = await deleteAdminNotice(id);
            if (data?.code === 200) {
                message.success('系统通知删除成功');
                loadNotices();
            } else {
                message.error(data?.message || '系统通知删除失败');
            }
        } catch (err) {
            message.error(err?.response?.data?.message || '系统通知删除失败');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div>
            <div className="ol-upload-head">
                <div>
                    <Typography.Title level={4} style={{ margin: 0 }}>管理员功能 - 系统通知栏</Typography.Title>
                    <Typography.Text type="secondary">管理员系统通知发布与维护</Typography.Text>
                </div>
                <Button icon={<ReloadOutlined />} onClick={loadNotices}>刷新通知列表</Button>
            </div>

            {!isAdmin ? (
                <Card className="ol-card-surface">
                    <Alert type="warning" showIcon message="当前账号不是 ADMIN，无法使用系统通知栏" />
                </Card>
            ) : (
                <>
                    <Card title="发布系统通知" className="ol-card-surface" style={{ marginBottom: 14 }}>
                        <Form form={form} layout="vertical" onFinish={handlePublish} initialValues={{ level: 'INFO' }}>
                            <div className="ol-admin-notice-form-grid">
                                <Form.Item
                                    label="通知标题"
                                    name="title"
                                    rules={[{ required: true, message: '请输入通知标题' }, { max: 120, message: '最多120字' }]}
                                >
                                    <Input maxLength={120} placeholder="例如：今晚 23:00 系统维护窗口" />
                                </Form.Item>
                                <Form.Item
                                    label="通知级别"
                                    name="level"
                                    rules={[{ required: true, message: '请选择通知级别' }]}
                                >
                                    <Select
                                        options={[
                                            { value: 'INFO', label: 'INFO - 常规通知' },
                                            { value: 'SUCCESS', label: 'SUCCESS - 成功通知' },
                                            { value: 'WARNING', label: 'WARNING - 预警通知' },
                                            { value: 'ERROR', label: 'ERROR - 紧急通知' },
                                        ]}
                                    />
                                </Form.Item>
                            </div>

                            <Form.Item
                                label="通知内容"
                                name="content"
                                rules={[{ required: true, message: '请输入通知内容' }, { max: 1000, message: '最多1000字' }]}
                            >
                                <Input.TextArea rows={4} maxLength={1000} showCount placeholder="请输入通知详情" />
                            </Form.Item>

                            <Button type="primary" htmlType="submit" loading={submitting} icon={<NotificationOutlined />}>
                                发布通知
                            </Button>
                        </Form>
                    </Card>

                    <Card title="通知栏历史" className="ol-card-surface">
                        <List
                            loading={loading}
                            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无系统通知" /> }}
                            dataSource={notices}
                            renderItem={(item) => (
                                <List.Item
                                    actions={[
                                        <Popconfirm
                                            key="delete"
                                            title="确认删除这条系统通知吗？"
                                            onConfirm={() => handleDelete(item.id)}
                                            okButtonProps={{ loading: deletingId === item.id }}
                                        >
                                            <Button danger size="small" icon={<DeleteOutlined />}>删除</Button>
                                        </Popconfirm>,
                                    ]}
                                >
                                    <div className="ol-admin-notice-row">
                                        <Space wrap>
                                            <Tag color={levelColorMap[item.level] || 'blue'}>{item.level || 'INFO'}</Tag>
                                            <Typography.Text strong>{item.title}</Typography.Text>
                                        </Space>
                                        <Typography.Paragraph style={{ marginTop: 6, marginBottom: 8 }}>
                                            {item.content}
                                        </Typography.Paragraph>
                                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                            发布人：{item.publisherUsername || '-'} · 发布时间：{item.createdTime || '-'}
                                        </Typography.Text>
                                    </div>
                                </List.Item>
                            )}
                        />
                    </Card>
                </>
            )}
        </div>
    );
}
