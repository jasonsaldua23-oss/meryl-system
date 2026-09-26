import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, useRouteError } from 'react-router';
import { ProtectedRoute } from './components/ProtectedRoute';
import { getPostLoginPath, useAuth } from '../lib/auth-context';

const chunkReloadKey = 'meryl_chunk_reload_attempted';

function lazyWithChunkReload<T extends { default: React.ComponentType<any> }>(loader: () => Promise<T>) {
  return lazy(async () => {
    try {
      const module = await loader();
      sessionStorage.removeItem(chunkReloadKey);
      return module;
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      const isChunkError = /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|dynamically imported module/i.test(message);

      if (isChunkError && !sessionStorage.getItem(chunkReloadKey)) {
        sessionStorage.setItem(chunkReloadKey, '1');
        window.location.reload();
      }

      throw error;
    }
  });
}

const Login = lazyWithChunkReload(() => import('./components/Login').then((module) => ({ default: module.Login })));
const AuthCallback = lazyWithChunkReload(() =>
  import('./components/AuthCallback').then((module) => ({ default: module.AuthCallback })),
);
const ResetPassword = lazyWithChunkReload(() =>
  import('./components/ResetPassword').then((module) => ({ default: module.ResetPassword })),
);
const AdminLayout = lazyWithChunkReload(() => import('./components/AdminLayout').then((module) => ({ default: module.AdminLayout })));
const SalesStaffLayout = lazyWithChunkReload(() =>
  import('./components/SalesStaffLayout').then((module) => ({ default: module.SalesStaffLayout })),
);
const InventoryStaffLayout = lazyWithChunkReload(() =>
  import('./components/InventoryStaffLayout').then((module) => ({ default: module.InventoryStaffLayout })),
);

function RouteLoader({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading...</div>}>{children}</Suspense>;
}

function RouteErrorFallback() {
  const error = useRouteError() as Error;
  const message = String(error?.message ?? 'The app could not load this page.');
  const isChunkError = /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|dynamically imported module/i.test(message);

  return (
    <div className="min-h-screen bg-[#0E0E12] text-white flex items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-white/10 bg-[#16161C] p-6 shadow-2xl">
        <h1 className="text-xl font-semibold text-white">{isChunkError ? 'Page needs a refresh' : 'Something went wrong'}</h1>
        <p className="mt-2 text-sm text-white/60">
          {isChunkError
            ? 'A newer version of Meryl System was deployed. Refreshing loads the latest portal files.'
            : 'This page hit an unexpected error. Refreshing usually fixes it; your saved data is not affected.'}
        </p>
        <p className="mt-4 rounded-lg bg-black/30 p-3 text-xs text-white/50 break-words">{message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 w-full rounded-xl bg-[#FFD60A] px-4 py-2 text-sm font-semibold text-[#1A1A22] hover:bg-[#ffcf24]"
        >
          Refresh page
        </button>
      </div>
    </div>
  );
}

function RootRedirect() {
  const { user, loading } = useAuth();

  if (loading) return null;

  if (user) {
    return <Navigate to={getPostLoginPath(user)} replace />;
  }

  return <Login />;
}

export const router = createBrowserRouter([
  {
    path: '/',
    errorElement: <RouteErrorFallback />,
    element: (
      <RouteLoader>
        <RootRedirect />
      </RouteLoader>
    ),
  },
  {
    path: '/admin',
    errorElement: <RouteErrorFallback />,
    element: (
      <RouteLoader>
        <ProtectedRoute allowedRoles={['admin']}>
          <AdminLayout />
        </ProtectedRoute>
      </RouteLoader>
    ),
  },
  {
    path: '/auth/callback',
    errorElement: <RouteErrorFallback />,
    element: (
      <RouteLoader>
        <AuthCallback />
      </RouteLoader>
    ),
  },
  {
    path: '/auth/reset-password',
    errorElement: <RouteErrorFallback />,
    element: (
      <RouteLoader>
        <ResetPassword />
      </RouteLoader>
    ),
  },
  {
    path: '/reset-password',
    errorElement: <RouteErrorFallback />,
    element: (
      <RouteLoader>
        <ResetPassword />
      </RouteLoader>
    ),
  },
  {
    path: '/sales',
    errorElement: <RouteErrorFallback />,
    element: (
      <RouteLoader>
        <ProtectedRoute allowedRoles={['sales', 'sales staff']}>
          <SalesStaffLayout />
        </ProtectedRoute>
      </RouteLoader>
    ),
  },
  {
    path: '/inventory',
    errorElement: <RouteErrorFallback />,
    element: (
      <RouteLoader>
        <ProtectedRoute allowedRoles={['inventory', 'inventory staff']}>
          <InventoryStaffLayout />
        </ProtectedRoute>
      </RouteLoader>
    ),
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
