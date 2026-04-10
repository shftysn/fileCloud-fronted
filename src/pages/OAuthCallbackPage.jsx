import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Spin, Typography, message } from 'antd';
import { GithubOutlined } from '@ant-design/icons';
import { useDispatch } from 'react-redux';
import { exchangeGithubTicket, getCurrentUser } from '../api/auth';
import { setAccessToken, setCurrentUser } from '../store/authSlice';

export default function OAuthCallbackPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const startedRef = useRef(false);
    const dispatch = useDispatch();

    useEffect(() => {
        if (startedRef.current) {
            return;
        }
        startedRef.current = true;

        const params = new URLSearchParams(location.search);
        const ticket = params.get('ticket');
        const error = params.get('error');
        const errorDescription = params.get('error_description');

        if (error) {
            message.error(errorDescription || 'GitHub 登录失败');
            navigate('/login', { replace: true });
            return;
        }

        if (!ticket) {
            message.error('缺少登录凭据，请重试');
            navigate('/login', { replace: true });
            return;
        }

        exchangeGithubTicket(ticket)
            .then(async ({ data }) => {
                if (data.code !== 200) {
                    throw new Error(data.message || '登录失败');
                }
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

                message.success('GitHub 登录成功');
                navigate('/files', { replace: true });
            })
            .catch((err) => {
                message.error(err.response?.data?.message || err.message || 'GitHub 登录失败');
                navigate('/login', { replace: true });
            });
    }, [dispatch, location.search, navigate]);

    return (
        <div className="ol-center-shell">
            <div className="ol-center-panel">
                <div className="ol-center-icon">
                    <GithubOutlined />
                </div>
                <Typography.Title level={4} style={{ marginTop: 0 }}>正在完成 GitHub 登录</Typography.Title>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                    我们正在安全交换凭据并同步你的用户信息。
                </Typography.Paragraph>
                <Spin size="large" />
            </div>
        </div>
    );
}
