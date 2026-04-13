import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Space, Avatar, Tag, Popover, Typography } from 'antd';
import {
  FileOutlined,
  UploadOutlined,
  SettingOutlined,
  LogoutOutlined,
  BellOutlined,
  CloudServerOutlined,
  FolderOpenOutlined,
  UserOutlined,
  StarOutlined,
  DeleteOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { listUserNotices, logout } from '../api/auth';
import { clearAuth } from '../store/authSlice';
import { countUnreadNotices, NOTICE_READ_CHANGE_EVENT } from '../utils/noticeRead';

const { Header, Sider, Content } = Layout;

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const currentUser = useSelector((state) => state.auth.currentUser);
  const [unreadNoticeCount, setUnreadNoticeCount] = useState(0);
  const roles = currentUser?.roles || [];
  const isAdmin = Array.isArray(roles) && roles.includes('ADMIN');
  const currentUserId = currentUser?.id || null;

  const pageMetaMap = {
    '/files': { title: '我的文件', sub: '浏览、下载、移动与分享你的文件' },
    '/files/favorites': { title: '收藏文件', sub: '快速访问你标记的常用文件' },
    '/files/recycle': { title: '回收站', sub: '恢复误删文件或彻底清理' },
    '/files/shares': { title: '分享管理中心', sub: '查看、复制与取消分享链接' },
    '/upload': { title: '上传中心', sub: '分片上传与断点续传' },
    '/notices': { title: '通知中心', sub: '未读优先、已读归档的收件箱式通知阅读' },
    '/admin/users': { title: '管理员功能 - 用户管理', sub: '管理员用户状态管理与权限检查' },
    '/admin/notices': { title: '管理员功能 - 系统通知栏', sub: '发布、查看与维护管理员系统通知' },
  };

  const pageMeta = pageMetaMap[location.pathname] || {
    title: '文件管理面板',
    sub: '简洁、稳定、适合大规模文件浏览',
  };

  const handleLogout = async () => {
    try { await logout(); } catch { /* ignore */ }
    dispatch(clearAuth());
    navigate('/login', { replace: true });
  };

  const handleProfileClick = () => {
    navigate(isAdmin ? '/admin/users' : '/files');
  };

  const fetchUnreadNoticeCount = useCallback(async () => {
    if (!currentUserId) {
      setUnreadNoticeCount(0);
      return;
    }

    try {
      const { data } = await listUserNotices({ limit: 100 });
      if (data?.code === 200) {
        setUnreadNoticeCount(countUnreadNotices(currentUserId, data.data));
      } else {
        setUnreadNoticeCount(0);
      }
    } catch {
      setUnreadNoticeCount(0);
    }
  }, [currentUserId]);

  useEffect(() => {
    fetchUnreadNoticeCount();
  }, [location.pathname, fetchUnreadNoticeCount]);

  useEffect(() => {
    const handleNoticeReadChanged = () => {
      fetchUnreadNoticeCount();
    };
    window.addEventListener(NOTICE_READ_CHANGE_EVENT, handleNoticeReadChanged);
    return () => {
      window.removeEventListener(NOTICE_READ_CHANGE_EVENT, handleNoticeReadChanged);
    };
  }, [fetchUnreadNoticeCount]);

  const noticeMenuLabel = (
    <span className="ol-menu-notice-label">
      <span>通知中心</span>
      {unreadNoticeCount > 0 && <span className="ol-menu-notice-dot" aria-label={`${unreadNoticeCount} 条未读`} />}
    </span>
  );

  const userMenuChildren = [
    { key: '/files', icon: <FileOutlined />, label: '我的文件' },
    { key: '/notices', icon: <BellOutlined />, label: noticeMenuLabel },
    { key: '/files/favorites', icon: <StarOutlined />, label: '收藏文件' },
    { key: '/files/recycle', icon: <DeleteOutlined />, label: '回收站' },
    { key: '/files/shares', icon: <ShareAltOutlined />, label: '分享管理中心' },
    { key: '/upload', icon: <UploadOutlined />, label: '上传文件' },
  ];

  const adminMenuChildren = [
    { key: '/notices', icon: <BellOutlined />, label: noticeMenuLabel },
    { key: '/admin/users', icon: <SettingOutlined />, label: '用户管理' },
    { key: '/admin/notices', icon: <BellOutlined />, label: '系统通知栏' },
  ];

  const menuItems = useMemo(() => {
    if (!isAdmin) {
      return userMenuChildren;
    }
    return adminMenuChildren;
  }, [isAdmin, unreadNoticeCount]);

  const userCard = (
    <div className="ol-user-popover">
      <div className="ol-user-popover-head">
        <Avatar size={44} icon={<CloudServerOutlined />} />
        <div className="ol-user-popover-meta">
          <div className="ol-user-popover-name">{currentUser?.username || '未命名用户'}</div>
          <div className="ol-user-popover-email">{currentUser?.email || '未绑定邮箱'}</div>
        </div>
      </div>
      <div className="ol-user-popover-foot">
        <Tag color={isAdmin ? 'volcano' : 'blue'}>{isAdmin ? 'ADMIN' : 'USER'}</Tag>
      </div>
      <div className="ol-user-popover-menu">
        <button type="button" className="ol-user-popover-item" onClick={handleProfileClick}>
          <UserOutlined />
          <span>进入我的文件</span>
        </button>
        <button type="button" className="ol-user-popover-item danger" onClick={handleLogout}>
          <LogoutOutlined />
          <span>退出登录</span>
        </button>
      </div>
    </div>
  );

  return (
    <Layout className="ol-layout">
      <Sider theme="dark" width={230} className="ol-sider" breakpoint="lg" collapsedWidth={72}>
        <div className="ol-brand">
          <span className="ol-brand-dot" />
          <div className="ol-brand-text">
            <div className="ol-brand-title">功能菜单</div>

          </div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          className="ol-side-menu"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
        <div className="ol-sider-foot">
          <FolderOpenOutlined /> 在线文件管理
        </div>
      </Sider>
      <Layout className="ol-main">
        <Header className="ol-header">
          <div className="ol-header-left">
            <div className="ol-header-title">{pageMeta.title}</div>
            <div className="ol-header-sub">{pageMeta.sub}</div>
          </div>
          <Space size={12} className="ol-header-right">
            <Typography.Text type="secondary" className="ol-header-hello">
              Hi, {currentUser?.username || '用户'}
            </Typography.Text>
            <Popover
              trigger="hover"
              placement="bottomRight"
              overlayClassName="ol-user-popover-overlay"
              content={userCard}
            >
              <button type="button" className="ol-avatar-trigger is-online" aria-label="用户信息">
                <Avatar icon={<CloudServerOutlined />} />
              </button>
            </Popover>
          </Space>
        </Header>
        <Content className="ol-content-wrap">
          <div className="ol-content-inner">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
