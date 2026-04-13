export const NOTICE_READ_CHANGE_EVENT = 'notice-read-state-changed';

const NOTICE_READ_KEY_PREFIX = 'notice-read:';

const normalizeNoticeId = (noticeId) => String(noticeId ?? '').trim();

const buildStorageKey = (userId) => `${NOTICE_READ_KEY_PREFIX}${userId || 'anonymous'}`;

export const loadReadNoticeIds = (userId) => {
    if (typeof window === 'undefined') {
        return new Set();
    }

    const key = buildStorageKey(userId);
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) {
            return new Set();
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return new Set();
        }

        const normalized = parsed
            .map((item) => normalizeNoticeId(item))
            .filter((item) => item.length > 0);
        return new Set(normalized);
    } catch {
        return new Set();
    }
};

const persistReadNoticeIds = (userId, idSet) => {
    if (typeof window === 'undefined') {
        return;
    }

    const key = buildStorageKey(userId);
    const payload = Array.from(idSet || []);
    try {
        window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
        // ignore localStorage errors
    }
};

export const markNoticeAsRead = (userId, noticeId) => {
    const normalizedId = normalizeNoticeId(noticeId);
    if (!normalizedId) {
        return false;
    }

    const readIds = loadReadNoticeIds(userId);
    if (readIds.has(normalizedId)) {
        return false;
    }

    readIds.add(normalizedId);
    persistReadNoticeIds(userId, readIds);

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(NOTICE_READ_CHANGE_EVENT));
    }
    return true;
};

export const countUnreadNotices = (userId, notices) => {
    const readIds = loadReadNoticeIds(userId);
    const list = Array.isArray(notices) ? notices : [];
    return list.filter((notice) => !readIds.has(normalizeNoticeId(notice?.id))).length;
};

export const isNoticeRead = (userId, noticeId) => {
    const normalizedId = normalizeNoticeId(noticeId);
    if (!normalizedId) {
        return false;
    }
    const readIds = loadReadNoticeIds(userId);
    return readIds.has(normalizedId);
};
