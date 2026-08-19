import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { StaffProvider } from './context/StaffContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminLayout } from './components/AdminLayout'
import { SubscribersLayout } from './components/SubscribersLayout'
import { ReportsLayout } from './components/ReportsLayout'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { ReceiptPage } from './pages/ReceiptPage'
import { CompaniesPage } from './pages/admin/CompaniesPage'
import { ServicesPage } from './pages/admin/ServicesPage'
import { CollectorsPage } from './pages/admin/CollectorsPage'
import { OwnersPage } from './pages/admin/OwnersPage'
import { AddressesPage } from './pages/admin/AddressesPage'
import { ProductsPage } from './pages/admin/ProductsPage'
import { ProductSalePage } from './pages/admin/ProductSalePage'
import { ImportPage } from './pages/admin/ImportPage'
import { MissingDataPage } from './pages/admin/MissingDataPage'
import { DuplicateSubscribersPage } from './pages/admin/DuplicateSubscribersPage'
import { WhatsAppMessagesPage } from './pages/admin/WhatsAppMessagesPage'
import { CompanyPaymentsPage } from './pages/admin/CompanyPaymentsPage'
import { CompanyPaymentsAnalysisPage } from './pages/admin/CompanyPaymentsAnalysisPage'
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
            <Route path="companies" element={<CompaniesPage />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="collectors" element={<CollectorsPage />} />
            <Route path="owners" element={<OwnersPage />} />
            <Route path="addresses" element={<AddressesPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="product-sale" element={<ProductSalePage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="missing-data" element={<MissingDataPage />} />
            <Route path="duplicates" element={<DuplicateSubscribersPage />} />
            <Route path="whatsapp-messages" element={<WhatsAppMessagesPage />} />
            <Route path="company-payments" element={<CompanyPaymentsPage />} />
            <Route path="company-payments/analysis" element={<CompanyPaymentsAnalysisPage />} />
            <Route path="activity-log" element={<ActivityLogPage />} />
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
