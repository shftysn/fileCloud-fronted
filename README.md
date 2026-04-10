# 分布式网盘前端项目说明

## 1. 项目定位
这是一个基于 React 18 + Vite + Ant Design 5 的分布式网盘系统前端，主要提供以下能力：

- 用户注册、登录
- GitHub OAuth 登录
- 文件列表管理（浏览、搜索、删除、下载）
- 文件夹管理（新建、层级浏览、移动）
- 文件分享链接生成
- 分片上传 + 断点续传
- 管理员用户管理（查看用户、启用/禁用）

后端通过 `/api` 前缀统一访问（开发环境由 Vite 代理到 `http://localhost:8080`）。

## 2. 技术栈

- 构建与运行：Vite 5
- UI：React 18、Ant Design 5、@ant-design/icons
- 路由：react-router-dom 6
- 状态管理：Redux Toolkit + react-redux
- HTTP：axios
- 样式：全局 CSS + Ant Design 组件样式

关键依赖见 `package.json`。

## 3. 目录结构与职责

```text
src/
  App.jsx                 # 应用启动鉴权 bootstrap + 全局 loading/suspense
  router/
    index.jsx             # 路由配置（公共路由 + 私有路由）
    guards.jsx            # 路由守卫（PrivateRoute/AdminRoute）
  main.jsx                # React 挂载入口，注入 Router 和 Redux Provider
  index.css               # 全局样式

  api/
    auth.js               # 认证与用户管理 API
    file.js               # 文件相关 API（上传、列表、下载、分享、移动）

  utils/
    request.js            # axios 实例 + token 注入 + 401 自动刷新

  store/
    index.js              # Redux store
    authSlice.js          # 登录态、用户信息、初始化状态

  layouts/
    MainLayout.jsx        # 登录后主布局（侧边栏 + 顶栏 + 内容区）

  pages/
    LoginPage.jsx         # 用户名密码登录 + GitHub 登录入口
    RegisterPage.jsx      # 注册页面
    OAuthCallbackPage.jsx # GitHub 回调页，ticket 换 token
    FilesPage.jsx         # 文件管理主页面
    UploadPage.jsx        # 分片上传页面
    AdminPage.jsx         # 管理后台页面
```

## 4. 认证与登录态机制（核心）

### 4.1 本地状态
`authSlice` 管理三块状态：

- `accessToken`: 访问令牌（用于请求头）
- `currentUser`: 当前登录用户信息（含角色）
- `initialized`: 应用是否完成启动鉴权检查

### 4.2 启动鉴权流程（App bootstrap）
`App.jsx` 首次加载时执行：

1. 调用 `refreshToken()`（依赖 HttpOnly Cookie）
2. 若成功拿到新 `accessToken`：
   - 写入 Redux
   - 调 `getCurrentUser()` 获取用户资料
3. 无论成功或失败，最终都设置 `initialized = true`

在 `initialized` 之前页面显示全屏 `Spin`，避免闪屏和路由误跳。

### 4.3 受保护路由
`PrivateRoute` 基于 `state.auth.accessToken` 判断：

- 有 token：放行到主布局
- 无 token：重定向到 `/login`

`AdminRoute` 基于 `state.auth.currentUser.roles` 判断：

- 是 ADMIN：允许访问 `/admin`
- 非 ADMIN：重定向到 `/files`

### 4.4 请求拦截与自动续期
`utils/request.js` 提供两个关键能力：

1. 请求拦截：自动在请求头注入 `Authorization: Bearer <token>`
2. 响应拦截：
   - 普通请求 401 时自动触发 `/api/auth/refresh`
   - 支持并发 401 的队列等待（`pendingQueue`）
   - 刷新成功后重放失败请求
   - 刷新失败时清理登录态并跳转登录页

并且对登录/注册/刷新/OAuth相关接口做了“跳过刷新”的保护，防止循环调用。

## 5. 路由设计
路由定义在 `src/router/index.jsx`，采用 `createBrowserRouter([...])` 的配置式写法：

- 公共路由：
  - `/login`
  - `/register`
  - `/oauth/callback`
- 私有路由（挂载在 `/` 下，使用 `MainLayout`）：
  - `/files` 文件管理
  - `/upload` 上传页面
  - `/admin` 管理后台
- 默认与兜底：
  - `/` 重定向到 `/files`
  - `*` 重定向到 `/`

## 6. 各页面功能说明

### 6.1 LoginPage
- 表单登录：调用 `login`
- 登录成功后获取用户信息 `getCurrentUser`
- 支持 GitHub 登录：跳转 `githubAuthorizeUrl`

### 6.2 RegisterPage
- 提交注册信息到 `register`
- 成功后跳转登录页

### 6.3 OAuthCallbackPage
- 读取 URL `ticket`
- 调用 `exchangeGithubTicket(ticket)` 换取 `accessToken`
- 获取当前用户后进入 `/files`

### 6.4 FilesPage（业务核心）
- 列表查询：`listFiles({ parentId, keyword })`
- 文件夹层级浏览：`parentId + pathStack`
- 新建文件夹：`createFolder`
- 删除：`deleteFile`
- 下载：`getDownloadUrl` + `fetch(blob)`（附带 token）
- 移动：`getFolderTree` + `moveFile`
- 分享：`createShareLink`，生成公开下载链接

### 6.5 UploadPage（分片上传）
关键流程：

1. `initUpload` 初始化上传会话（拿到 `uploadId`、`totalChunks`、`uploadedChunks`）
2. 按分片循环上传 `uploadChunk`
3. 全部分片成功后 `mergeChunks`

页面支持：

- 暂停上传（通过 `pauseRef`）
- 继续上传（重新发起流程并利用已上传分片信息）
- 单分片进度展示与总体进度展示

分片大小固定为 `5MB`，需与后端保持一致。

### 6.6 AdminPage
- 通过 `currentUser.roles` 判断是否 ADMIN
- ADMIN 可调用：
  - `listUsers`
  - `updateUserStatus`
- 非 ADMIN 显示权限提示，不展示管理表格

## 7. API 模块划分

### 7.1 auth.js
- 登录/注册/登出
- 刷新 token
- 获取当前用户
- GitHub OAuth ticket 兑换
- 管理员用户管理接口

### 7.2 file.js
- 上传初始化、分片上传、合并
- 文件列表、文件夹树
- 下载 URL、公开分享下载 URL
- 删除、新建目录、移动、创建分享链接

## 8. 运行方式

```bash
npm install
npm run dev
```

默认开发地址：`http://localhost:5173`

构建与预览：

```bash
npm run build
npm run preview
```

## 9. 与后端对接要点

- 前端 API 前缀统一为 `/api`
- `withCredentials: true` 已开启，依赖后端正确设置 Cookie 与 CORS
- 401 自动刷新依赖 `/api/auth/refresh` 可用
- 下载接口需要支持 Bearer Token（当前实现使用 `fetch` 携带头）

## 10. 当前实现特点与可改进点

实现特点：

- 认证链路完整（启动刷新 + 拦截刷新 + 并发队列）
- 文件管理功能较完整（移动/分享/目录树）
- 上传流程清晰，具备断点续传基础能力

可改进点（建议）：

- 面包屑名称目前使用 `...` 占位，可改为真实路径名称
- 上传恢复可进一步做“并发分片上传 + 限速 + 重试次数配置”
- 全局错误提示可统一封装（例如按状态码映射）
- 增加路由级权限控制（例如 `/admin` 直接拦截非管理员）
- 增加单元测试与 E2E 测试（认证流程、上传流程、分享流程）

---

如果你要用于毕业设计答辩，这份前端说明可直接作为“系统实现-前端模块”章节的基础稿。