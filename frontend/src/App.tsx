import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import RequireAuth from './auth/RequireAuth';
import DashboardApp from './dashboard/DashboardApp';
import DashboardUnlockGate from './dashboard/DashboardUnlockGate';
import AuthFinishPage from './pages/AuthFinishPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

const SECTIONS = ['overview', 'github', 'configurations', 'schedule', 'findings', 'keys'] as const;

export default function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/auth/finish" element={<AuthFinishPage />} />
                    <Route
                        path="/"
                        element={
                            <RequireAuth>
                                <DashboardUnlockGate>
                                    <DashboardApp />
                                </DashboardUnlockGate>
                            </RequireAuth>
                        }
                    />
                    {SECTIONS.map((s) => (
                        <Route
                            key={s}
                            path={`/${s}`}
                            element={
                                <RequireAuth>
                                    <DashboardUnlockGate>
                                        <DashboardApp />
                                    </DashboardUnlockGate>
                                </RequireAuth>
                            }
                        />
                    ))}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    );
}
