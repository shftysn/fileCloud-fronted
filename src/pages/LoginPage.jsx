import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Form, Input, Button, Typography, message, Divider, Space } from 'antd';
import { UserOutlined, LockOutlined, GithubOutlined, CloudServerOutlined } from '@ant-design/icons';
import { useDispatch } from 'react-redux';
import { getCurrentUser, githubAuthorizeUrl, login as loginApi } from '../api/auth';
import { setAccessToken, setCurrentUser } from '../store/authSlice';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const { data } = await loginApi(values);
      if (data.code === 200) {
        dispatch(setAccessToken(data.data.accessToken));

        try {
          const meResp = await getCurrentUser();
          if (meResp.data.code === 200) {
            dispatch(setCurrentUser(meResp.data.data));
          } else {
            dispatch(setCurrentUser(null));
          }
        } catch {
          dispatch(setCurrentUser(null));
        }

        message.success('登录成功');
        navigate('/files', { replace: true });
      } else {
        message.error(data.message || '登录失败');
      }
    } catch (err) {
      message.error(err.response?.data?.message || '网络错误');
    } finally {
      setLoading(false);
    }
  };

  const onGithubLogin = () => {
    window.location.href = githubAuthorizeUrl;
  };

  return (
    <div className="ol-auth-shell">
      <div className="ol-auth-panel">
        <div className="ol-auth-grid">
          <div className="ol-auth-hero">
            <div className="ol-auth-badge">
              {/* <CloudServerOutlined /> OpenList Style */}
            </div>
            <Typography.Title level={2}>分布式网盘</Typography.Title>
            <Typography.Paragraph>
              简洁目录视图、可靠断点续传、统一权限鉴权。
            </Typography.Paragraph>
            <Space direction="vertical" size={6}>
              <Typography.Text style={{ color: '#dbeafe' }}>• 刷新自动恢复登录状态</Typography.Text>
              <Typography.Text style={{ color: '#dbeafe' }}>• 文件名下载保持原始名称</Typography.Text>
              <Typography.Text style={{ color: '#dbeafe' }}>• 上传状态实时、稳定</Typography.Text>
            </Space>
          </div>
          <div className="ol-auth-form">
            <Typography.Title level={3} style={{ marginTop: 2 }}>登录</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
              使用账号密码，或通过 GitHub 快速登录。
            </Typography.Paragraph>
            <Form onFinish={onFinish} size="large">
              <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input prefix={<UserOutlined />} placeholder="用户名" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="密码" />
              </Form.Item>
              <div style={{ textAlign: 'right', margin: '-8px 0 10px' }}>
                <Link to="/reset-password">忘记密码？</Link>
              </div>
              <Form.Item>
                <Button type="primary" htmlType="submit" block loading={loading}>登录</Button>
              </Form.Item>
              <Divider style={{ margin: '12px 0' }}>或</Divider>
              <Form.Item>
                <Button icon={<GithubOutlined />} block onClick={onGithubLogin}>使用 GitHub 登录</Button>
              </Form.Item>
              <div style={{ textAlign: 'center' }}>
                还没有账号？ <Link to="/register">立即注册</Link>
              </div>
            </Form>
          </div>
        </div>
      </div>
    </div>
  );
}
