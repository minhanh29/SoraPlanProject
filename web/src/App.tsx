import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ImageViewerHost, Toaster, Spinner } from "./components/ui";
import Shell from "./layout/Shell";
import LoginPage from "./pages/LoginPage";
import ChatView from "./chat/ChatView";
import AssetsPage from "./assets/AssetsPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="boot">
        <Spinner size={22} />
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <Shell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<ChatView />} />
            <Route path="/p/:projectId" element={<ChatView />} />
            <Route path="/assets" element={<Navigate to="/assets/system" replace />} />
            <Route path="/assets/system" element={<AssetsPage tab="system" />} />
            <Route path="/assets/mine" element={<AssetsPage tab="mine" />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
      <ImageViewerHost />
    </AuthProvider>
  );
}
