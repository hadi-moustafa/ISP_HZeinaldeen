import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { StaffProvider } from './context/StaffContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminLayout } from './components/AdminLayout'
import { SubscribersLayout } from './components/SubscribersLayout'
import { ReportsLayout } from './components/ReportsLayout'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { ReceiptPage } from './pages/ReceiptPage'
import { CompanyPage } from './pages/admin/CompanyPage'
import { CollectorsPage } from './pages/admin/CollectorsPage'
import { OwnersPage } from './pages/admin/OwnersPage'
import { AddressesPage } from './pages/admin/AddressesPage'
import { ProductsHubPage } from './pages/admin/ProductsHubPage'
import { SubscriberToolsPage } from './pages/admin/SubscriberToolsPage'
import { WhatsAppMessagesPage } from './pages/admin/WhatsAppMessagesPage'
import { ActivityLogPage } from './pages/admin/ActivityLogPage'
import { SubscribersListPage } from './pages/subscribers/SubscribersListPage'
import { SubscriberFormPage } from './pages/subscribers/SubscriberFormPage'
import { SubscriberDetailPage } from './pages/subscribers/SubscriberDetailPage'
import { MonthlyLogPage } from './pages/reports/MonthlyLogPage'
import { FinancialsPage } from './pages/reports/FinancialsPage'
import { OfflinePage } from './pages/OfflinePage'
import { DabdabehPage } from './pages/DabdabehPage'

function App() {
  return (
    <StaffProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/receipt/:id" element={<ReceiptPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route path="company" element={<CompanyPage />} />
            <Route path="collectors" element={<CollectorsPage />} />
            <Route path="owners" element={<OwnersPage />} />
            <Route path="addresses" element={<AddressesPage />} />
            <Route path="products" element={<ProductsHubPage />} />
            <Route path="subscriber-tools" element={<SubscriberToolsPage />} />
            <Route path="whatsapp-messages" element={<WhatsAppMessagesPage />} />
            <Route path="activity-log" element={<ActivityLogPage />} />

            {/* Old routes consolidated above -- redirect so no existing
                bookmark or link 404s. */}
            <Route path="companies" element={<Navigate to="/admin/company?tab=companies" replace />} />
            <Route path="services" element={<Navigate to="/admin/company?tab=services" replace />} />
            <Route path="company-payments" element={<Navigate to="/admin/company?tab=payments" replace />} />
            <Route
              path="company-payments/analysis"
              element={<Navigate to="/admin/company?tab=analysis" replace />}
            />
            <Route path="product-sale" element={<Navigate to="/admin/products?tab=sell" replace />} />
            <Route path="import" element={<Navigate to="/admin/subscriber-tools?tab=import" replace />} />
            <Route
              path="missing-data"
              element={<Navigate to="/admin/subscriber-tools?tab=missing" replace />}
            />
            <Route
              path="duplicates"
              element={<Navigate to="/admin/subscriber-tools?tab=duplicates" replace />}
            />
          </Route>
          <Route
            path="/subscribers"
            element={
              <ProtectedRoute>
                <SubscribersLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<SubscribersListPage />} />
            <Route path="new" element={<SubscriberFormPage />} />
            <Route path=":id" element={<SubscriberDetailPage />} />
            <Route path=":id/edit" element={<SubscriberFormPage />} />
          </Route>
          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <ReportsLayout />
              </ProtectedRoute>
            }
          >
            <Route path="monthly-log" element={<MonthlyLogPage />} />
            <Route
              path="financials"
              element={
                <ProtectedRoute adminOnly>
                  <FinancialsPage />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route
            path="/field"
            element={
              <ProtectedRoute>
                <OfflinePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dabdabeh"
            element={
              <ProtectedRoute>
                <DabdabehPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </StaffProvider>
  )
}

export default App
