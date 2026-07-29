import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { StaffProvider } from './context/StaffContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminLayout } from './components/AdminLayout'
import { SubscribersLayout } from './components/SubscribersLayout'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { CompaniesPage } from './pages/admin/CompaniesPage'
import { ServicesPage } from './pages/admin/ServicesPage'
import { CollectorsPage } from './pages/admin/CollectorsPage'
import { OwnersPage } from './pages/admin/OwnersPage'
import { ProductsPage } from './pages/admin/ProductsPage'
import { SubscribersListPage } from './pages/subscribers/SubscribersListPage'
import { SubscriberFormPage } from './pages/subscribers/SubscriberFormPage'
import { SubscriberDetailPage } from './pages/subscribers/SubscriberDetailPage'

function App() {
  return (
    <StaffProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
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
            <Route path="products" element={<ProductsPage />} />
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
        </Routes>
      </BrowserRouter>
    </StaffProvider>
  )
}

export default App
