
import React, { Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { useRealtimeSync } from '@/socket/useRealtimeSync';
import { connectSocket, disconnectSocket } from '@/socket/client';
import { useCurrentUser } from '@/api/hooks/useAuth';
import { UserRole } from '@nit-wms/shared/types';
import type { User } from '@nit-wms/shared/types';

/** Map backend systemRole string to frontend UserRole enum */
function mapSystemRoleToUserRole(systemRole: string): UserRole {
  switch (systemRole) {
    case 'admin':
      return UserRole.ADMIN;
    case 'manager':
      return UserRole.MANAGER;
    case 'warehouse_supervisor':
    case 'warehouse_staff':
      return UserRole.WAREHOUSE;
    case 'freight_forwarder':
      return UserRole.TRANSPORT;
    case 'logistics_coordinator':
      return UserRole.LOGISTICS_COORDINATOR;
    case 'site_engineer':
      return UserRole.SITE_ENGINEER;
    case 'qc_officer':
      return UserRole.QC_OFFICER;
    default:
      return UserRole.ENGINEER;
  }
}

// ── Lazy-loaded pages (code-split) ──────────────────────────────────────────
const AdminDashboard = React.lazy(() => import('@/pages/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const AdminResourceList = React.lazy(() => import('@/pages/AdminResourceList').then(m => ({ default: m.AdminResourceList })));
const WarehouseDashboard = React.lazy(() => import('@/pages/WarehouseDashboard').then(m => ({ default: m.WarehouseDashboard })));
const TransportDashboard = React.lazy(() => import('@/pages/TransportDashboard').then(m => ({ default: m.TransportDashboard })));
const EngineerDashboard = React.lazy(() => import('@/pages/EngineerDashboard').then(m => ({ default: m.EngineerDashboard })));
const ResourceForm = React.lazy(() => import('@/pages/ResourceForm').then(m => ({ default: m.ResourceForm })));
const SlaDashboard = React.lazy(() => import('@/pages/SlaDashboard').then(m => ({ default: m.SlaDashboard })));
const PaymentsDashboard = React.lazy(() => import('@/pages/PaymentsDashboard').then(m => ({ default: m.PaymentsDashboard })));
const RfimList = React.lazy(() => import('@/pages/quality/RfimList').then(m => ({ default: m.RfimList })));
const JobOrdersKanban = React.lazy(() => import('@/pages/transport/JobOrdersKanban').then(m => ({ default: m.JobOrdersKanban })));
const MapDashboard = React.lazy(() => import('@/pages/MapDashboard').then(m => ({ default: m.MapDashboard })));
const ShiftingMaterialDashboard = React.lazy(() => import('@/pages/warehouse/ShiftingMaterialDashboard').then(m => ({ default: m.ShiftingMaterialDashboard })));
const InventoryDashboard = React.lazy(() => import('@/pages/warehouse/InventoryDashboard').then(m => ({ default: m.InventoryDashboard })));
const NonMovingMaterialsDashboard = React.lazy(() => import('@/pages/warehouse/NonMovingMaterialsDashboard').then(m => ({ default: m.NonMovingMaterialsDashboard })));
const LoginPage = React.lazy(() => import('@/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const GatePassForm = React.lazy(() => import('@/pages/GatePassForm').then(m => ({ default: m.GatePassForm })));
const StockTransferForm = React.lazy(() => import('@/pages/StockTransferForm').then(m => ({ default: m.StockTransferForm })));
const MrfForm = React.lazy(() => import('@/pages/MrfForm').then(m => ({ default: m.MrfForm })));
const ShipmentForm = React.lazy(() => import('@/pages/ShipmentForm').then(m => ({ default: m.ShipmentForm })));
const CustomsForm = React.lazy(() => import('@/pages/CustomsForm').then(m => ({ default: m.CustomsForm })));
const ReportsPage = React.lazy(() => import('@/pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const AuditLogPage = React.lazy(() => import('@/pages/AuditLogPage').then(m => ({ default: m.AuditLogPage })));
const RolesPage = React.lazy(() => import('@/pages/RolesPage').then(m => ({ default: m.RolesPage })));
const SettingsPage = React.lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));

// New role dashboards
const ManagerDashboard = React.lazy(() => import('@/pages/ManagerDashboard').then(m => ({ default: m.ManagerDashboard })));
const QCOfficerDashboard = React.lazy(() => import('@/pages/QCOfficerDashboard').then(m => ({ default: m.QCOfficerDashboard })));
const LogisticsCoordinatorDashboard = React.lazy(() => import('@/pages/LogisticsCoordinatorDashboard').then(m => ({ default: m.LogisticsCoordinatorDashboard })));
const SiteEngineerDashboard = React.lazy(() => import('@/pages/SiteEngineerDashboard').then(m => ({ default: m.SiteEngineerDashboard })));

// Feature pages
const TasksPage = React.lazy(() => import('@/pages/TasksPage').then(m => ({ default: m.TasksPage })));
const DocumentsPage = React.lazy(() => import('@/pages/DocumentsPage').then(m => ({ default: m.DocumentsPage })));

// ── Section Landing Pages (code-split) ──────────────────────────────────────
const InventorySectionPage = React.lazy(() => import('@/pages/sections/InventorySectionPage').then(m => ({ default: m.InventorySectionPage })));
const ReceivingSectionPage = React.lazy(() => import('@/pages/sections/ReceivingSectionPage').then(m => ({ default: m.ReceivingSectionPage })));
const IssuingSectionPage = React.lazy(() => import('@/pages/sections/IssuingSectionPage').then(m => ({ default: m.IssuingSectionPage })));
const QualitySectionPage = React.lazy(() => import('@/pages/sections/QualitySectionPage').then(m => ({ default: m.QualitySectionPage })));
const LogisticsSectionPage = React.lazy(() => import('@/pages/sections/LogisticsSectionPage').then(m => ({ default: m.LogisticsSectionPage })));
const MasterDataSectionPage = React.lazy(() => import('@/pages/sections/MasterDataSectionPage').then(m => ({ default: m.MasterDataSectionPage })));
const AdminSystemPage = React.lazy(() => import('@/pages/sections/AdminSystemPage').then(m => ({ default: m.AdminSystemPage })));

// Page loading skeleton
const PageLoader = () => (
  <div className="flex items-center justify-center h-64">
    <div className="animate-spin w-8 h-8 border-2 border-nesma-secondary border-t-transparent rounded-full"></div>
  </div>
);

const Layout: React.FC<{
  children: React.ReactNode;
  role: UserRole;
  setRole: (r: UserRole) => void;
  onLogout: () => void;
}> = ({ children, role, setRole, onLogout }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
  const location = useLocation();
  const navigate = useNavigate();

  // Real-time: invalidate React Query caches on Socket.IO events
  useRealtimeSync();

  // Close sidebar on mobile route change
  useEffect(() => {
    if (window.innerWidth <= 1024) {
      setIsSidebarOpen(false);
    }
  }, [location.pathname]);

  // Handle Role Switching Redirection
  useEffect(() => {
    const basePath = location.pathname.split('/')[1];
    const roleBasePaths: Record<UserRole, string> = {
      [UserRole.ADMIN]: 'admin',
      [UserRole.WAREHOUSE]: 'warehouse',
      [UserRole.TRANSPORT]: 'transport',
      [UserRole.ENGINEER]: 'engineer',
      [UserRole.MANAGER]: 'manager',
      [UserRole.QC_OFFICER]: 'qc',
      [UserRole.LOGISTICS_COORDINATOR]: 'logistics',
      [UserRole.SITE_ENGINEER]: 'site-engineer',
    };
    const expectedPath = roleBasePaths[role] || 'admin';

    if (basePath !== expectedPath) {
      navigate(`/${expectedPath}`);
    }
  }, [role, navigate]);

  // Build user object from real API data (useCurrentUser is already cached from AppRoutes)
  const meQuery = useCurrentUser();
  const meData = meQuery.data?.data as Record<string, string> | undefined;

  const user: User = meData
    ? {
        id: meData.id,
        name: meData.fullName || meData.email,
        email: meData.email,
        role,
        avatar: '',
        department: meData.department,
      }
    : { id: '', name: 'Loading...', email: '', role, avatar: '' };

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-nesma-dark to-[#051020] text-white font-sans">
      {/* Mobile Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        ></div>
      )}

      {/* Sidebar - Fixed on Mobile, Relative on Desktop */}
      <div className={`fixed inset-y-0 left-0 z-50 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0 transition-transform duration-300 ease-in-out h-full`}>
        <Sidebar
          role={role}
          isOpen={isSidebarOpen}
          setRole={setRole}
          isMobile={window.innerWidth <= 1024}
          onLogout={onLogout}
        />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden transition-all duration-300 w-full">
        <Header
          toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          user={user}
          role={role}
        />
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6 relative scroll-smooth">
          {/* Background texture */}
          <div className="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none fixed"></div>
          <div className="relative z-10 min-h-full pb-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

const AppRoutes: React.FC = () => {
  const queryClient = useQueryClient();
  const hasToken = !!localStorage.getItem('nit_wms_token');
  const meQuery = useCurrentUser();

  const [currentRole, setCurrentRole] = useState<UserRole>(UserRole.ADMIN);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitializing, setIsInitializing] = useState(hasToken);

  // Restore session from token on mount / when meQuery resolves
  useEffect(() => {
    if (meQuery.data?.data) {
      const user = meQuery.data.data;
      const role = mapSystemRoleToUserRole(user.systemRole);
      setCurrentRole(role);
      setIsAuthenticated(true);
      setIsInitializing(false);
      // Reconnect socket with existing token
      connectSocket(localStorage.getItem('nit_wms_token') || '');
    } else if (meQuery.isError || (!hasToken && !meQuery.isLoading)) {
      // Token invalid or missing — clear and show login
      if (meQuery.isError) {
        localStorage.removeItem('nit_wms_token');
        localStorage.removeItem('nit_wms_refresh_token');
      }
      setIsInitializing(false);
    }
  }, [meQuery.data, meQuery.isError, meQuery.isLoading, hasToken]);

  const handleLogin = (role: UserRole) => {
    setCurrentRole(role);
    setIsAuthenticated(true);
    // Connect Socket.IO with the stored JWT token
    const token = localStorage.getItem('nit_wms_token') || '';
    connectSocket(token);
  };

  const handleLogout = () => {
    disconnectSocket();
    localStorage.removeItem('nit_wms_token');
    localStorage.removeItem('nit_wms_refresh_token');
    queryClient.clear();
    setIsAuthenticated(false);
  };

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-nesma-dark to-[#051020]">
        <div className="animate-spin w-8 h-8 border-2 border-nesma-secondary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<PageLoader />}>
        <LoginPage onLogin={handleLogin} />
      </Suspense>
    );
  }

  return (
    <Layout role={currentRole} setRole={setCurrentRole} onLogout={handleLogout}>
      <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={
          currentRole === UserRole.ADMIN ? <Navigate to="/admin" /> :
          currentRole === UserRole.WAREHOUSE ? <Navigate to="/warehouse" /> :
          currentRole === UserRole.TRANSPORT ? <Navigate to="/transport" /> :
          currentRole === UserRole.MANAGER ? <Navigate to="/manager" /> :
          currentRole === UserRole.QC_OFFICER ? <Navigate to="/qc" /> :
          currentRole === UserRole.LOGISTICS_COORDINATOR ? <Navigate to="/logistics" /> :
          currentRole === UserRole.SITE_ENGINEER ? <Navigate to="/site-engineer" /> :
          <Navigate to="/engineer" />
        } />

        {/* ═══════════ ADMIN SECTION ROUTES ═══════════ */}
        <Route path="/admin" element={<AdminDashboard />} />

        {/* Section Landing Pages */}
        <Route path="/admin/inventory" element={<InventorySectionPage />} />
        <Route path="/admin/receiving" element={<ReceivingSectionPage />} />
        <Route path="/admin/issuing" element={<IssuingSectionPage />} />
        <Route path="/admin/quality" element={<QualitySectionPage />} />
        <Route path="/admin/logistics" element={<LogisticsSectionPage />} />
        <Route path="/admin/master" element={<MasterDataSectionPage />} />
        <Route path="/admin/system" element={<AdminSystemPage />} />

        {/* ═══════════ LEGACY REDIRECTS ═══════════ */}
        {/* Old Warehouse section → Inventory/Receiving/Issuing */}
        <Route path="/admin/warehouse/mrrv" element={<Navigate to="/admin/receiving?tab=mrrv" replace />} />
        <Route path="/admin/warehouse/mirv" element={<Navigate to="/admin/issuing?tab=mirv" replace />} />
        <Route path="/admin/warehouse/mrv" element={<Navigate to="/admin/quality?tab=mrv" replace />} />
        <Route path="/admin/warehouse/inventory" element={<Navigate to="/admin/inventory?tab=stock-levels" replace />} />
        <Route path="/admin/warehouse/inventory-dashboard" element={<Navigate to="/admin/inventory?tab=dashboard" replace />} />
        <Route path="/admin/warehouse/shifting-materials" element={<Navigate to="/admin/inventory?tab=shifting" replace />} />
        <Route path="/admin/warehouse/non-moving" element={<Navigate to="/admin/inventory?tab=non-moving" replace />} />
        <Route path="/admin/warehouse/gate-pass" element={<Navigate to="/admin/receiving?tab=gate-passes" replace />} />
        <Route path="/admin/warehouse/stock-transfer" element={<Navigate to="/admin/issuing?tab=stock-transfers" replace />} />

        {/* Old Transport section → Logistics */}
        <Route path="/admin/transport/board" element={<Navigate to="/admin/logistics?tab=kanban" replace />} />
        <Route path="/admin/transport/job-orders" element={<Navigate to="/admin/logistics?tab=all-jobs" replace />} />
        <Route path="/admin/transport/fleet" element={<Navigate to="/admin/logistics?tab=fleet" replace />} />
        <Route path="/admin/transport/suppliers" element={<Navigate to="/admin/master?tab=suppliers" replace />} />

        {/* Old Shipping section → Receiving */}
        <Route path="/admin/shipping/shipments" element={<Navigate to="/admin/receiving?tab=shipments" replace />} />
        <Route path="/admin/shipping/customs" element={<Navigate to="/admin/receiving?tab=customs" replace />} />
        <Route path="/admin/shipping/reports" element={<Navigate to="/admin/system?tab=reports" replace />} />

        {/* Old Quality section → Quality */}
        <Route path="/admin/quality/rfim" element={<Navigate to="/admin/quality?tab=rfim" replace />} />
        <Route path="/admin/quality/osd" element={<Navigate to="/admin/quality?tab=osd" replace />} />

        {/* Old Management section → Master/System */}
        <Route path="/admin/management/employees" element={<Navigate to="/admin/master?tab=employees" replace />} />
        <Route path="/admin/management/projects" element={<Navigate to="/admin/master?tab=projects" replace />} />
        <Route path="/admin/management/roles" element={<Navigate to="/admin/system?tab=roles" replace />} />
        <Route path="/admin/audit-log" element={<Navigate to="/admin/system?tab=audit" replace />} />
        <Route path="/admin/settings" element={<Navigate to="/admin/system?tab=settings" replace />} />

        {/* Old standalone pages → Logistics */}
        <Route path="/admin/sla" element={<Navigate to="/admin/logistics?tab=sla" replace />} />
        <Route path="/admin/payments" element={<Navigate to="/admin/logistics?tab=payments" replace />} />
        <Route path="/admin/map" element={<Navigate to="/admin/logistics?tab=map" replace />} />

        {/* Old Reports → System */}
        <Route path="/admin/reports" element={<Navigate to="/admin/system?tab=reports" replace />} />
        <Route path="/admin/reports/:tab" element={<Navigate to="/admin/system?tab=reports" replace />} />

        {/* ═══════════ FORM ROUTES (unchanged) ═══════════ */}
        <Route path="/admin/forms/gatepass" element={<GatePassForm />} />
        <Route path="/admin/forms/stock-transfer" element={<StockTransferForm />} />
        <Route path="/admin/forms/mrf" element={<MrfForm />} />
        <Route path="/admin/forms/shipment" element={<ShipmentForm />} />
        <Route path="/admin/forms/customs" element={<CustomsForm />} />
        <Route path="/admin/forms/:formType" element={<ResourceForm />} />
        <Route path="/admin/forms/:formType/:id" element={<ResourceForm />} />

        {/* Generic resource routes (catch-all for any remaining /admin/:section/:resource) */}
        <Route path="/admin/:section/:resource" element={<AdminResourceList />} />

        {/* ═══════════ WAREHOUSE ROUTES ═══════════ */}
        <Route path="/warehouse" element={<WarehouseDashboard />} />
        <Route path="/warehouse/:tab" element={<WarehouseDashboard />} />

        {/* ═══════════ TRANSPORT ROUTES ═══════════ */}
        <Route path="/transport" element={<TransportDashboard />} />
        <Route path="/transport/:view" element={<TransportDashboard />} />

        {/* ═══════════ ENGINEER ROUTES ═══════════ */}
        <Route path="/engineer" element={<EngineerDashboard />} />
        <Route path="/engineer/*" element={<EngineerDashboard />} />

        {/* ═══════════ MANAGER ROUTES ═══════════ */}
        <Route path="/manager" element={<ManagerDashboard />} />
        <Route path="/manager/:tab" element={<ManagerDashboard />} />
        <Route path="/manager/forms/:formType" element={<ResourceForm />} />
        <Route path="/manager/forms/:formType/:id" element={<ResourceForm />} />
        <Route path="/manager/tasks" element={<TasksPage />} />
        <Route path="/manager/documents" element={<DocumentsPage />} />

        {/* ═══════════ QC OFFICER ROUTES ═══════════ */}
        <Route path="/qc" element={<QCOfficerDashboard />} />
        <Route path="/qc/:tab" element={<QCOfficerDashboard />} />
        <Route path="/qc/forms/osd" element={<ResourceForm />} />
        <Route path="/qc/forms/:formType" element={<ResourceForm />} />
        <Route path="/qc/tasks" element={<TasksPage />} />

        {/* ═══════════ LOGISTICS COORDINATOR ROUTES ═══════════ */}
        <Route path="/logistics" element={<LogisticsCoordinatorDashboard />} />
        <Route path="/logistics/:tab" element={<LogisticsCoordinatorDashboard />} />
        <Route path="/logistics/forms/jo" element={<ResourceForm />} />
        <Route path="/logistics/forms/shipment" element={<ShipmentForm />} />
        <Route path="/logistics/forms/gatepass" element={<GatePassForm />} />
        <Route path="/logistics/forms/:formType" element={<ResourceForm />} />
        <Route path="/logistics/forms/:formType/:id" element={<ResourceForm />} />
        <Route path="/logistics/tasks" element={<TasksPage />} />

        {/* ═══════════ SITE ENGINEER ROUTES ═══════════ */}
        <Route path="/site-engineer" element={<SiteEngineerDashboard />} />
        <Route path="/site-engineer/*" element={<SiteEngineerDashboard />} />
        <Route path="/site-engineer/forms/:formType" element={<ResourceForm />} />
        <Route path="/site-engineer/tasks" element={<TasksPage />} />

        {/* ═══════════ SHARED FEATURE ROUTES ═══════════ */}
        <Route path="/admin/tasks" element={<TasksPage />} />
        <Route path="/admin/documents" element={<DocumentsPage />} />
        <Route path="/warehouse/tasks" element={<TasksPage />} />
        <Route path="/transport/tasks" element={<TasksPage />} />
        <Route path="/engineer/tasks" element={<TasksPage />} />
      </Routes>
      </Suspense>
    </Layout>
  );
};

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
