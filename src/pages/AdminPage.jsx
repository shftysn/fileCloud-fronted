import React, { useEffect, useMemo, useState } from 'react';
import { Typography, Card, Descriptions, Table, Tag, Space, Button, message, Alert, Modal, Input } from 'antd';
import { useDispatch, useSelector } from 'react-redux';
import { ReloadOutlined } from '@ant-design/icons';
import { listUsers, refreshToken, updateUserStatus } from '../api/auth';
import { setAccessToken } from '../store/authSlice';

export default function AdminPage() {
  const dispatch = useDispatch();
  const currentUser = useSelector((state) => state.auth.currentUser);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionTarget, setActionTarget] = useState(null);
  const [verifyPassword, setVerifyPassword] = useState('');
  const [actionReason, setActionReason] = useState('');

  const isAdmin = useMemo(() => {
    const roles = currentUser?.roles || [];
    return Array.isArray(roles) && roles.includes('ADMIN');
  }, [currentUser]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // 首次尝试获取用户列表
      const { data } = await listUsers();
      if (data.code === 200) {
        setUsers(data.data || []);
      } else {
        message.error(data.message || '获取用户列表失败');
      }
    } catch (err) {
      const isForbidden = err?.response?.status === 403;
      if (isForbidden) {
        try {
          const refreshResp = await refreshToken();
          if (refreshResp.data?.code === 200 && refreshResp.data?.data?.accessToken) {
            dispatch(setAccessToken(refreshResp.data.data.accessToken));
            const retried = await listUsers();
            if (retried.data?.code === 200) {
              setUsers(retried.data.data || []);
              return;
            }
          }
        } catch {
          // 刷新失败时走默认错误提示
        }
      }
      message.error(err.response?.data?.message || '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

  const openToggleStatusModal = (record) => {
    setActionTarget(record);
    setVerifyPassword('');
    setActionReason('');
    setActionModalOpen(true);
  };

  const handleToggleStatus = async () => {
    if (!actionTarget) {
      return;
    }

    const trimmedReason = actionReason.trim();
    if (!verifyPassword.trim()) {
      message.warning('请输入当前管理员密码完成二次验证');
      return;
    }
    if (!trimmedReason) {
      message.warning('请输入操作原因');
      return;
    }

    const target = actionTarget.status === 1 ? 0 : 1;
    setActionSubmitting(true);
    try {
      const { data } = await updateUserStatus(actionTarget.id, {
        status: target,
        verifyPassword: verifyPassword.trim(),
        reason: trimmedReason,
      });
      if (data.code === 200) {
        message.success('状态更新成功');
        setActionModalOpen(false);
        fetchUsers();
      } else {
        message.error(data.message || '状态更新失败');
      }
    } catch (err) {
      message.error(err.response?.data?.message || '状态更新失败');
    } finally {
      setActionSubmitting(false);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '用户名', dataIndex: 'username', width: 160 },
    { title: '邮箱', dataIndex: 'email', render: (v) => v || '-' },
    {
      title: '角色',
      dataIndex: 'roles',
      width: 180,
      render: (roles) => (
        <Space wrap>
          {(roles || []).map((r) => (
            <Tag color={r === 'ADMIN' ? 'volcano' : 'blue'} key={r}>{r}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s) => (s === 1 ? <Tag color="success">启用</Tag> : <Tag color="error">禁用</Tag>),
    },
    { title: '创建时间', dataIndex: 'createdTime', width: 190 },
    {
      title: '操作',
      width: 140,
      render: (_, record) => (
        <Button size="small" onClick={() => openToggleStatusModal(record)}>
          {record.status === 1 ? '禁用' : '启用'}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div className="ol-upload-head">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>管理员后台</Typography.Title>
          <Typography.Text type="secondary">系统概览、用户状态管理与权限检查</Typography.Text>
        </div>
        {isAdmin && <Button icon={<ReloadOutlined />} onClick={fetchUsers}>刷新用户数据</Button>}
      </div>

      <div className="ol-admin-grid">
        <Card title="系统信息" className="ol-card-surface">
          <Descriptions column={1} size="small">
            <Descriptions.Item label="系统名称">分布式网盘系统</Descriptions.Item>
            <Descriptions.Item label="后端框架">Spring Cloud Alibaba (Nacos + Gateway)</Descriptions.Item>
            <Descriptions.Item label="前端框架">React 18 + Ant Design 5 + Vite</Descriptions.Item>
            <Descriptions.Item label="数据库">MySQL 8 (主从复制)</Descriptions.Item>
            <Descriptions.Item label="缓存">Redis</Descriptions.Item>
            <Descriptions.Item label="消息队列">RabbitMQ (Spring Cloud Stream)</Descriptions.Item>
            <Descriptions.Item label="安全">Spring Security + OAuth2 + JWT</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title="功能说明" className="ol-card-surface">
          <Space direction="vertical" size={6}>
            <Typography.Text>• 用户管理：注册、登录、角色权限（RBAC）</Typography.Text>
            <Typography.Text>• 文件管理：分片上传、断点续传、在线下载、文件夹管理</Typography.Text>
            <Typography.Text>• 网关鉴权：JWT 校验 + Redis 黑名单 + 用户信息透传</Typography.Text>
            <Typography.Text>• 服务治理：Nacos 注册与发现、动态配置</Typography.Text>
            <Typography.Text>• 异步解耦：RabbitMQ 消息队列</Typography.Text>
          </Space>
        </Card>
      </div>

      <Card title="用户管理" className="ol-card-surface">
        {!isAdmin ? (
          <Alert type="warning" showIcon message="当前账号不是 ADMIN，无法使用用户管理接口" />
        ) : (
          <div className="ol-files-table">
            <Table
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={users}
              pagination={{ pageSize: 10, showSizeChanger: false }}
            />
          </div>
        )}
      </Card>

      <Modal
        title="管理员二次验证"
        open={actionModalOpen}
        onOk={handleToggleStatus}
        onCancel={() => setActionModalOpen(false)}
        confirmLoading={actionSubmitting}
        okText={actionTarget?.status === 1 ? '确认禁用' : '确认启用'}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text>
            即将对用户 {actionTarget?.username || '-'} 执行{actionTarget?.status === 1 ? '禁用' : '启用'}操作。
          </Typography.Text>
          <Input.Password
            placeholder="请输入当前管理员密码"
            value={verifyPassword}
            onChange={(e) => setVerifyPassword(e.target.value)}
          />
          <Input.TextArea
            rows={3}
            maxLength={200}
            showCount
            placeholder="请输入本次操作原因（必填）"
            value={actionReason}
            onChange={(e) => setActionReason(e.target.value)}
          />
        </Space>
      </Modal>
    </div>
  );
}
