import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Form, Input, Button, Typography, message, Space } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, RocketOutlined } from '@ant-design/icons';
import { register as registerApi, sendEmailCode } from '../api/auth';

export default function RegisterPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [codeSending, setCodeSending] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (codeCountdown <= 0) {
      return undefined;
    }
    const timer = setInterval(() => {
      setCodeCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [codeCountdown]);

  const handleSendCode = async () => {
    try {
      const values = await form.validateFields(['email']);
      setCodeSending(true);
      const { data } = await sendEmailCode({
        email: values.email,
        scene: 'REGISTER',
      });
      if (data.code === 200) {
        message.success('验证码已发送，请查收邮箱');
        setCodeCountdown(60);
      } else {
        message.error(data.message || '发送验证码失败');
      }
    } catch (err) {
      if (err?.errorFields) {
        return;
      }
      message.error(err.response?.data?.message || '发送验证码失败');
    } finally {
      setCodeSending(false);
    }
  };

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const { data } = await registerApi(values);
      if (data.code === 200) {
        message.success('注册成功，请登录');
        navigate('/login');
      } else {
        message.error(data.message || '注册失败');
      }
    } catch (err) {
      message.error(err.response?.data?.message || '网络错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ol-auth-shell">
      <div className="ol-auth-panel">
        <div className="ol-auth-grid">
          <div className="ol-auth-hero">
            <div className="ol-auth-badge">
              <RocketOutlined /> Quick Start
            </div>
            <Typography.Title level={2}>创建账号</Typography.Title>
            <Typography.Paragraph>
              几步完成注册，马上使用 OpenList 风格文件管理界面。
            </Typography.Paragraph>
            <Space direction="vertical" size={6}>
              <Typography.Text style={{ color: '#dbeafe' }}>• 支持本地账号注册</Typography.Text>
              <Typography.Text style={{ color: '#dbeafe' }}>• 支持 GitHub OAuth 登录</Typography.Text>
              <Typography.Text style={{ color: '#dbeafe' }}>• 安全鉴权 + 刷新续期</Typography.Text>
            </Space>
          </div>
          <div className="ol-auth-form">
            <Typography.Title level={3} style={{ marginTop: 2 }}>注册</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
              填写基础信息并完成邮箱验证即可创建账号。
            </Typography.Paragraph>
            <Form form={form} onFinish={onFinish} size="large">
              <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input prefix={<UserOutlined />} placeholder="用户名" />
              </Form.Item>
              <Form.Item
                name="password"
                rules={[
                  { required: true, message: '请输入密码' },
                  { min: 6, message: '密码长度至少6位' },
                ]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="密码" />
              </Form.Item>
              <Form.Item
                name="email"
                rules={[
                  { required: true, message: '请输入邮箱' },
                  { type: 'email', message: '邮箱格式不正确' },
                ]}
              >
                <Input prefix={<MailOutlined />} placeholder="邮箱" />
              </Form.Item>
              <Form.Item
                name="emailCode"
                rules={[{ required: true, message: '请输入邮箱验证码' }]}
              >
                <Input
                  placeholder="邮箱验证码"
                  addonAfter={(
                    <Button
                      type="link"
                      onClick={handleSendCode}
                      loading={codeSending}
                      disabled={codeCountdown > 0}
                      style={{ padding: 0, height: 'auto' }}
                    >
                      {codeCountdown > 0 ? `${codeCountdown}s后重发` : '获取验证码'}
                    </Button>
                  )}
                />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" block loading={loading}>注册</Button>
              </Form.Item>
              <div style={{ textAlign: 'center' }}>
                已有账号？ <Link to="/login">去登录</Link>
              </div>
            </Form>
          </div>
        </div>
      </div>
    </div>
  );
}
