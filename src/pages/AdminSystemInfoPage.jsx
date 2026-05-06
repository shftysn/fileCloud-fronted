import React from 'react';
import { Card, Descriptions, Typography } from 'antd';

export default function AdminSystemInfoPage() {
  return (
    <div>
      <div className="ol-upload-head">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            管理员功能 - 系统信息
          </Typography.Title>
          <Typography.Text type="secondary">
            查看系统基础架构、技术栈与运行环境说明
          </Typography.Text>
        </div>
      </div>

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
    </div>
  );
}
