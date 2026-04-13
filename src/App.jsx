import React, { Suspense, lazy, useEffect } from 'react';
import { Spin } from 'antd';
import { useDispatch, useSelector } from 'react-redux';
import { getCurrentUser, refreshToken } from './api/auth';
import { setAccessToken, setCurrentUser, setInitialized } from './store/authSlice';
const AppRoutes = lazy(() => import('./router'));

export default function App() {
  const dispatch = useDispatch();
  const initialized = useSelector((state) => state.auth.initialized);
  const accessToken = useSelector((state) => state.auth.accessToken);

  useEffect(() => {
    // 这个 effect 的作用是：在应用启动时尝试恢复登录状态。
    //mounted 变量的作用是：在异步操作完成后检查组件是否仍然挂载，避免在组件卸载后调用 setState 导致内存泄漏或警告。
    let mounted = true;

    const bootstrap = async () => {
      try {

        // 尝试刷新 token 来恢复登录状态。
        const { data } = await refreshToken();
        if (!mounted) {
          return;
        }
        if (data.code === 200 && data.data?.accessToken) {
          // 成功刷新 token，说明用户之前已经登录过了，可以恢复登录状态。
          dispatch(setAccessToken(data.data.accessToken));

          try {
            // 刷新 token 成功后获取当前用户信息，更新到 Redux 中。
            //包含{id,username,email,status,roles,permissions}等字段
            const meResp = await getCurrentUser();
            if (!mounted) {
              return;
            }
            if (meResp.data.code === 200) {
              dispatch(setCurrentUser(meResp.data.data));
            } else {
              dispatch(setCurrentUser(null));
            }
          } catch {
            if (mounted) {
              dispatch(setCurrentUser(null));
            }
          }
        }
      } catch {
        // 无有效 refresh cookie 时保持未登录即可。
      } finally {
        if (mounted) {
          dispatch(setInitialized(true));
        }
      }
    };

    bootstrap();

    return () => {
      mounted = false;
    };
  }, [dispatch]);

  useEffect(() => {
    if (!initialized || !accessToken) {
      return undefined;
    }

    const timer = window.setInterval(async () => {
      try {
        const meResp = await getCurrentUser();
        if (meResp.data?.code === 200) {
          dispatch(setCurrentUser(meResp.data.data));
          return;
        }

        // 禁用账号场景由 request 拦截器统一处理：先提示原因，再延时退出登录。
      } catch {
        // ignore, request interceptor handles token refresh and redirect
      }
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [initialized, accessToken, dispatch]);

  if (!initialized) {
    return <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}><Spin size="large" /></div>;
  }

  return (
    /* 
      Suspense 作用是：当子组件“还没准备好渲染”时，先显示一个兜底 UI（fallback），等准备好再切回真实内容。
    */
    <Suspense fallback={<div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}><Spin size="large" /></div>}>
      <AppRoutes />
    </Suspense>
  );
}
