import React from 'react';
import { Button, Typography, Space } from 'antd';
import { WarningOutlined, HomeOutlined, RollbackOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

export default function ErrorPage() {
    const navigate = useNavigate();

    return (
        <div className="ol-center-shell">
            <div className="ol-center-panel">
                <div className="ol-center-icon" style={{ background: '#fff1f2', color: '#e11d48' }}>
                    <WarningOutlined />
                </div>
                <Typography.Title level={3} style={{ marginTop: 0 }}>页面发生错误</Typography.Title>
                <Typography.Paragraph type="secondary">
                    抱歉，页面加载失败或地址不存在。
                </Typography.Paragraph>
                <Space>
                    <Button icon={<RollbackOutlined />} onClick={() => navigate(-1)}>
                        返回上一页
                    </Button>
                    <Button type="primary" icon={<HomeOutlined />} onClick={() => navigate('/files')}>
                        返回文件页
                    </Button>
                </Space>
            </div>
        </div>
    );
}
