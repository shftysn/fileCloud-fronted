import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Form, Input, Button, Typography, message, Space } from 'antd';
import { MailOutlined, LockOutlined, SafetyOutlined } from '@ant-design/icons';
import { resetPasswordByEmailCode, sendEmailCode } from '../api/auth';

export default function ResetPasswordPage() {
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
                scene: 'RESET_PASSWORD',
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
            const { data } = await resetPasswordByEmailCode({
                email: values.email,
                emailCode: values.emailCode,
                newPassword: values.newPassword,
            });
            if (data.code === 200) {
                message.success('密码重置成功，请重新登录');
                navigate('/login', { replace: true });
            } else {
                message.error(data.message || '密码重置失败');
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
                            <SafetyOutlined /> Account Security
                        </div>
                        <Typography.Title level={2}>重置密码</Typography.Title>
                        <Typography.Paragraph>
                            通过邮箱验证码重置密码，确保账号安全。
                        </Typography.Paragraph>
                        <Space direction="vertical" size={6}>
                            <Typography.Text style={{ color: '#dbeafe' }}>• 仅对已注册邮箱生效</Typography.Text>
                            <Typography.Text style={{ color: '#dbeafe' }}>• 验证码有效期较短，请及时使用</Typography.Text>
                            <Typography.Text style={{ color: '#dbeafe' }}>• 重置后请妥善保管新密码</Typography.Text>
                        </Space>
                    </div>
                    <div className="ol-auth-form">
                        <Typography.Title level={3} style={{ marginTop: 2 }}>找回密码</Typography.Title>
                        <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
                            输入邮箱、验证码和新密码完成重置。
                        </Typography.Paragraph>
                        <Form form={form} onFinish={onFinish} size="large">
                            <Form.Item
                                name="email"
                                rules={[
                                    { required: true, message: '请输入邮箱' },
                                    { type: 'email', message: '邮箱格式不正确' },
                                ]}
                            >
                                <Input prefix={<MailOutlined />} placeholder="邮箱" />
                            </Form.Item>
                            <Form.Item name="emailCode" rules={[{ required: true, message: '请输入邮箱验证码' }]}>
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
                            <Form.Item
                                name="newPassword"
                                rules={[
                                    { required: true, message: '请输入新密码' },
                                    { min: 6, message: '密码长度至少6位' },
                                ]}
                            >
                                <Input.Password prefix={<LockOutlined />} placeholder="新密码" />
                            </Form.Item>
                            <Form.Item
                                name="confirmPassword"
                                dependencies={['newPassword']}
                                rules={[
                                    { required: true, message: '请再次输入新密码' },
                                    ({ getFieldValue }) => ({
                                        validator(_, value) {
                                            if (!value || getFieldValue('newPassword') === value) {
                                                return Promise.resolve();
                                            }
                                            return Promise.reject(new Error('两次输入的密码不一致'));
                                        },
                                    }),
                                ]}
                            >
                                <Input.Password prefix={<LockOutlined />} placeholder="确认新密码" />
                            </Form.Item>
                            <Form.Item>
                                <Button type="primary" htmlType="submit" block loading={loading}>重置密码</Button>
                            </Form.Item>
                            <div style={{ textAlign: 'center' }}>
                                想起密码了？ <Link to="/login">返回登录</Link>
                            </div>
                        </Form>
                    </div>
                </div>
            </div>
        </div>
    );
}
