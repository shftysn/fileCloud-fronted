import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  createAdminUser,
  deleteAdminUser,
  listUsers,
  refreshToken,
  updateUserStatus,
} from '../api/auth';
import { setAccessToken } from '../store/authSlice';

export default function AdminPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentUser = useSelector((state) => state.auth.currentUser);

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionTarget, setActionTarget] = useState(null);
  const [verifyPassword, setVerifyPassword] = useState('');
  const [actionReason, setActionReason] = useState('');

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: '',
    password: '',
    email: '',
    admin: false,
  });

  const isAdmin = useMemo(() => {
    const roles = currentUser?.roles || [];
    return Array.isArray(roles) && roles.includes('ADMIN');
  }, [currentUser]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
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
          // ignore and fall through
        }
      }
      message.error(err?.response?.data?.message || '获取用户列表失败');
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

    setActionSubmitting(true);
    try {
      const targetStatus = actionTarget.status === 1 ? 0 : 1;
      const { data } = await updateUserStatus(actionTarget.id, {
        status: targetStatus,
        verifyPassword: verifyPassword.trim(),
        reason: trimmedReason,
      });
      if (data.code === 200) {
        message.success('用户状态更新成功');
        setActionModalOpen(false);
        fetchUsers();
      } else {
        message.error(data.message || '用户状态更新失败');
      }
    } catch (err) {
      message.error(err?.response?.data?.message || '用户状态更新失败');
    } finally {
      setActionSubmitting(false);
    }
  };

  const openCreateModal = () => {
    setCreateForm({
      username: '',
      password: '',
      email: '',
      admin: false,
    });
    setCreateModalOpen(true);
  };

  const handleCreateUser = async () => {
    const username = createForm.username.trim();
    const password = createForm.password;
    const email = createForm.email.trim();

    if (!username) {
      message.warning('请输入用户名');
      return;
    }
    if (!password || password.length < 6) {
      message.warning('密码至少 6 位');
      return;
    }

    if (!email) {
      message.warning('请输入邮箱');
      return;
    }

    setCreateSubmitting(true);
    try {
      const payload = {
        username,
        password,
        email,
        admin: !!createForm.admin,
      };
      const { data } = await createAdminUser(payload);
      if (data.code === 200) {
        message.success(createForm.admin ? '管理员用户创建成功' : '普通用户创建成功');
        setCreateModalOpen(false);
        fetchUsers();
      } else {
        message.error(data.message || '创建用户失败');
      }
    } catch (err) {
      message.error(err?.response?.data?.message || '创建用户失败');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleDeleteUser = async (record) => {
    try {
      const { data } = await deleteAdminUser(record.id);
      if (data.code === 200) {
        message.success('用户删除成功');
        fetchUsers();
      } else {
        message.error(data.message || '用户删除失败');
      }
    } catch (err) {
      message.error(err?.response?.data?.message || '用户删除失败');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '用户名', dataIndex: 'username', width: 180 },
    { title: '邮箱', dataIndex: 'email', render: (value) => value || '-' },
    {
      title: '角色',
      dataIndex: 'roles',
      width: 180,
      render: (roles) => (
        <Space wrap>
          {(roles || []).map((role) => (
            <Tag color={role === 'ADMIN' ? 'volcano' : 'blue'} key={role}>
              {role}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status) => (status === 1 ? <Tag color="success">启用</Tag> : <Tag color="error">禁用</Tag>),
    },
    { title: '创建时间', dataIndex: 'createdTime', width: 190 },
    {
      title: '操作',
      width: 220,
      render: (_, record) => {
        const roles = record.roles || [];
        const isTargetAdmin = roles.includes('ADMIN');
        return (
          <Space>
            <Button size="small" onClick={() => openToggleStatusModal(record)}>
              {record.status === 1 ? '禁用' : '启用'}
            </Button>
            <Popconfirm
              title={isTargetAdmin ? '管理员用户不允许删除' : `确认删除用户 ${record.username} 吗？`}
              description={isTargetAdmin ? '该操作仅允许删除普通用户。' : '删除后该用户将无法再登录。'}
              disabled={isTargetAdmin}
              onConfirm={() => handleDeleteUser(record)}
              okText="确认删除"
              cancelText="取消"
            >
              <Button danger size="small" icon={<DeleteOutlined />} disabled={isTargetAdmin}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div className="ol-upload-head">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            管理员功能 - 用户管理
          </Typography.Title>
          <Typography.Text type="secondary">
            管理员可以新增用户、设置用户是否为管理员，并删除普通用户
          </Typography.Text>
        </div>
        {isAdmin && (
          <Space>
            <Button onClick={() => navigate('/admin/notices')}>进入系统通知页</Button>
            <Button icon={<PlusOutlined />} type="primary" onClick={openCreateModal}>
              新增用户
            </Button>
            <Button icon={<ReloadOutlined />} onClick={fetchUsers}>
              刷新用户数据
            </Button>
          </Space>
        )}
      </div>

      <div className="ol-admin-grid">
        <Card title="系统信息" className="ol-card-surface">
          <Descriptions column={1} size="small">
            <Descriptions.Item label="系统名称">分布式网盘系统</Descriptions.Item>
            <Descriptions.Item label="后端框架">Spring Cloud Alibaba</Descriptions.Item>
            <Descriptions.Item label="前端框架">React 18 + Ant Design 5 + Vite</Descriptions.Item>
            <Descriptions.Item label="数据库">MySQL 8</Descriptions.Item>
            <Descriptions.Item label="缓存">Redis</Descriptions.Item>
            <Descriptions.Item label="消息队列">RabbitMQ</Descriptions.Item>
            <Descriptions.Item label="安全">Spring Security + OAuth2 + JWT</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title="功能说明" className="ol-card-surface">
          <Space direction="vertical" size={6}>
            <Typography.Text>用户管理：新增用户、删除普通用户、启用/禁用用户。</Typography.Text>
            <Typography.Text>角色控制：创建用户时可直接指定是否为管理员。</Typography.Text>
            <Typography.Text>安全约束：管理员不能删除管理员，只能删除普通用户。</Typography.Text>
            <Typography.Text>高风险操作：启用/禁用仍要求管理员密码二次验证。</Typography.Text>
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

      <Modal
        title="新增用户"
        open={createModalOpen}
        onOk={handleCreateUser}
        onCancel={() => setCreateModalOpen(false)}
        confirmLoading={createSubmitting}
        okText="创建用户"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="用户名"
            maxLength={50}
            value={createForm.username}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, username: e.target.value }))}
          />
          <Input.Password
            placeholder="密码，至少 6 位"
            value={createForm.password}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))}
          />
          <Input
            placeholder="邮箱"
            maxLength={100}
            value={createForm.email}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
          />
          <Space>
            <Typography.Text>设为管理员</Typography.Text>
            <Switch
              checked={createForm.admin}
              onChange={(checked) => setCreateForm((prev) => ({ ...prev, admin: checked }))}
            />
          </Space>
        </Space>
      </Modal>
    </div>
  );
}
