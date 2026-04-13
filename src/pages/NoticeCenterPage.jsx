import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Space, Spin, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined, BellOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { listUserNotices } from '../api/auth';
import { loadReadNoticeIds, markNoticeAsRead } from '../utils/noticeRead';

const parseNoticeTime = (timeText) => {
    const ts = Date.parse(String(timeText || ''));
    return Number.isNaN(ts) ? 0 : ts;
};

export default function NoticeCenterPage() {
    const currentUser = useSelector((state) => state.auth.currentUser);
    const userId = currentUser?.id || 'anonymous';

    const [notices, setNotices] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedNotice, setSelectedNotice] = useState(null);
    const [readNoticeIds, setReadNoticeIds] = useState(() => loadReadNoticeIds(userId));

    const fetchNotices = async () => {
        setLoading(true);
        try {
            const { data } = await listUserNotices({ limit: 100 });
            if (data?.code === 200) {
                setNotices(Array.isArray(data.data) ? data.data : []);
                return;
            }
            setNotices([]);
            message.error(data?.message || '通知加载失败');
        } catch {
            setNotices([]);
            message.error('通知加载失败');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setReadNoticeIds(loadReadNoticeIds(userId));
        setSelectedNotice(null);
    }, [userId]);

    useEffect(() => {
        fetchNotices();
    }, [userId]);

    const groupedNotices = useMemo(() => {
        const withRead = (Array.isArray(notices) ? notices : []).map((item) => ({
            ...item,
            isRead: readNoticeIds.has(String(item?.id)),
        }));

        const sortDescByTime = (a, b) => parseNoticeTime(b.createdTime) - parseNoticeTime(a.createdTime);

        const unread = withRead.filter((item) => !item.isRead).sort(sortDescByTime);
        const read = withRead.filter((item) => item.isRead).sort(sortDescByTime);

        return { unread, read };
    }, [notices, readNoticeIds]);

    const handleOpenNotice = (notice) => {
        if (!notice) {
            return;
        }

        markNoticeAsRead(userId, notice.id);
        setReadNoticeIds((prev) => {
            const next = new Set(prev);
            next.add(String(notice.id));
            return next;
        });
        setSelectedNotice(notice);
    };

    const levelColorMap = {
        INFO: 'blue',
        SUCCESS: 'success',
        WARNING: 'warning',
        ERROR: 'error',
    };

    return (
        <div className="ol-notice-center-page">
            <div>
                <Typography.Title level={4} style={{ margin: 0 }}>通知中心</Typography.Title>
                <Typography.Text type="secondary">未读消息在上方，已读消息归档在下方</Typography.Text>
            </div>

            <div className="ol-notice-center-body">
                {loading ? (
                    <div className="ol-notice-center-loading"><Spin /></div>
                ) : selectedNotice ? (
                    <div className="ol-notice-detail-panel">
                        <Button
                            type="text"
                            icon={<ArrowLeftOutlined />}
                            className="ol-notice-back-btn"
                            onClick={() => setSelectedNotice(null)}
                        >
                            返回消息列表
                        </Button>
                        <div className="ol-notice-detail-head">
                            <Typography.Title level={5} style={{ margin: 0 }}>
                                {selectedNotice.title || '无标题通知'}
                            </Typography.Title>
                            <Tag color={levelColorMap[selectedNotice.level] || 'blue'}>
                                {selectedNotice.level || 'INFO'}
                            </Tag>
                        </div>
                        <Typography.Text type="secondary">
                            发布者：{selectedNotice.publisherUsername || '-'} · {selectedNotice.createdTime || '-'}
                        </Typography.Text>
                        <div className="ol-notice-detail-content">{selectedNotice.content || '-'}</div>
                    </div>
                ) : (
                    <div className="ol-notice-mail-list-wrap">
                        {groupedNotices.unread.length === 0 && groupedNotices.read.length === 0 ? (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" />
                        ) : (
                            <Space direction="vertical" style={{ width: '100%' }} size={12}>
                                <div>
                                    <div className="ol-notice-section-title unread">未读消息</div>
                                    {groupedNotices.unread.length === 0 ? (
                                        <div className="ol-notice-empty-line">暂无未读消息</div>
                                    ) : (
                                        <div className="ol-notice-mail-list">
                                            {groupedNotices.unread.map((item) => (
                                                <button
                                                    type="button"
                                                    className="ol-notice-mail-item is-unread"
                                                    key={item.id}
                                                    onClick={() => handleOpenNotice(item)}
                                                >
                                                    <div className="ol-notice-mail-title-row">
                                                        <span className="ol-notice-mail-dot" aria-hidden />
                                                        <BellOutlined />
                                                        <span className="ol-notice-mail-title">{item.title || '无标题通知'}</span>
                                                    </div>
                                                    <div className="ol-notice-mail-meta">发布者：{item.publisherUsername || '-'} · {item.createdTime || '-'}</div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <div className="ol-notice-section-title read">已读消息</div>
                                    {groupedNotices.read.length === 0 ? (
                                        <div className="ol-notice-empty-line">暂无已读消息</div>
                                    ) : (
                                        <div className="ol-notice-mail-list">
                                            {groupedNotices.read.map((item) => (
                                                <button
                                                    type="button"
                                                    className="ol-notice-mail-item is-read"
                                                    key={item.id}
                                                    onClick={() => handleOpenNotice(item)}
                                                >
                                                    <div className="ol-notice-mail-title-row">
                                                        <BellOutlined />
                                                        <span className="ol-notice-mail-title">{item.title || '无标题通知'}</span>
                                                    </div>
                                                    <div className="ol-notice-mail-meta">发布者：{item.publisherUsername || '-'} · {item.createdTime || '-'}</div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </Space>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
