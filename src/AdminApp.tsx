import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from './contexts/AuthContext';
import { isAdminUser } from './types/auth';
import { fetchJson } from './services/resilientFetch';
import { formatDateTime } from './utils/dateFormatting';
import { 
  ShieldCheck, 
  Lock, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Eye, 
  LogOut, 
  ArrowLeft, 
  RefreshCw, 
  Save, 
  CreditCard, 
  AlertTriangle,
  FileText,
  Calendar,
  Layers,
  Settings,
  X
} from 'lucide-react';

export function AdminApp() {
  const { user, status, login, logout } = useAuth();
  
  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Admin dashboard state
  const [activeTab, setActiveTab] = useState<'pending' | 'history' | 'access' | 'students' | 'settings' | 'system'>('pending');
  const [adminStudents, setAdminStudents] = useState<any[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [termOverride, setTermOverride] = useState<'AUTO' | 'FALL' | 'SPRING' | 'SUMMER'>('AUTO');
  const [pendingSubmissions, setPendingSubmissions] = useState<any[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<any[]>([]);
  const [methods, setMethods] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [academicContext, setAcademicContext] = useState<any>(null);
  const [entitlements, setEntitlements] = useState<any[]>([]);
  const [revokingEntitlementId, setRevokingEntitlementId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Proof Modal state
  const [selectedProofSubmission, setSelectedProofSubmission] = useState<any | null>(null);

  // Reject Modal state
  const [rejectingSubmissionId, setRejectingSubmissionId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  // Status Filter for History
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'APPROVED' | 'REJECTED'>('ALL');

  const handleSaveTermOverride = async () => {
    try {
      const { response: res, data } = await fetchJson('/api/admin/term-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ mode: termOverride }),
      });
      if (!res.ok) throw new Error((data as any).error || 'Failed to update term override.');
      setSuccessMessage(`Term override updated to ${termOverride}.`);
      setTimeout(() => setSuccessMessage(''), 3000);
      await fetchAdminData();
    } catch (e: any) {
      setDashboardError(e.message || 'Failed to update term override.');
    }
  };

  const handleSaveProduct = async (product: any) => {
    try {
      const { response: res, data } = await fetchJson('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: product.id, amount: Number(product.amount), enabled: Number(product.enabled) === 1, name: product.name }),
      });
      if (!res.ok) throw new Error((data as any).error || 'Failed to save product.');
      setProducts((data as any).products || []);
      setSuccessMessage('Product pricing saved.');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (e: any) {
      setDashboardError(e.message || 'Failed to save product.');
    }
  };

  const fetchAdminData = useCallback(async (searchOverride = '') => {
    setIsLoadingData(true);
    setDashboardError('');
    try {
      // 1. Fetch pending submissions
      const { response: pendingRes, data: pendingData } = await fetchJson('/api/admin/payments?status=PENDING', { timeoutMs: 10_000 });
      if (pendingRes.ok) {
        setPendingSubmissions((pendingData as any).submissions || []);
      } else if (pendingRes.status === 403 || pendingRes.status === 401) {
        setDashboardError('Unauthorized: Server rejected admin privileges.');
      }

      // 2. Fetch all submissions (history)
      const { response: allRes, data: allData } = await fetchJson('/api/admin/payments/all', { timeoutMs: 10_000 });
      if (allRes.ok) {
        setAllSubmissions((allData as any).submissions || []);
      }

      // 3. Fetch payment methods
      const { response: methodsRes, data: methodsData } = await fetchJson('/api/payment/methods', { timeoutMs: 8_000 });
      if (methodsRes.ok) {
        const data = methodsData as any;
        const defaultMethods = [
          { id: 'MANUAL_INSTAPAY', enabled: 0, destination: '', instructions: '' },
          { id: 'MANUAL_TELDA', enabled: 0, destination: '', instructions: '' },
          { id: 'MANUAL_VODAFONE_CASH', enabled: 0, destination: '', instructions: '' }
        ];
        const merged = defaultMethods.map(dm => {
          const existing = (data.methods || []).find((m: any) => m.id === dm.id);
          return existing ? existing : dm;
        });
        setMethods(merged);
      }

      // 4. Fetch configurable products
      const { response: productsRes, data: productData } = await fetchJson('/api/admin/products', { timeoutMs: 8_000 });
      if (productsRes.ok) {
        setProducts((productData as any).products || []);
      }

      // 5. Fetch entitlements for manual revocation/support
      const { response: entitlementsRes, data: entitlementData } = await fetchJson('/api/admin/entitlements', { timeoutMs: 10_000 });
      if (entitlementsRes.ok) {
        setEntitlements((entitlementData as any).entitlements || []);
      }

      // 6. Fetch academic context
      const { response: studentsRes, data: studentsData } = await fetchJson(`/api/admin/students?search=${encodeURIComponent(searchOverride ?? studentSearch)}`, { timeoutMs: 10_000 });
      if (studentsRes.ok) setAdminStudents((studentsData as any).students || []);

      const { response: contextRes, data: contextData } = await fetchJson('/api/admin/academic-context', { timeoutMs: 8_000 });
      if (contextRes.ok) {
        setAcademicContext(contextData);
        if ((contextData as any)?.config?.termOverrideMode) setTermOverride((contextData as any).config.termOverrideMode);
      }
    } catch (e: any) {
      setDashboardError(e.message || 'Failed to load dashboard data');
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated' && isAdminUser(user)) {
      fetchAdminData('');
    }
  }, [status, user, fetchAdminData]);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);
    try {
      const res = await login({ email: loginEmail.trim(), password: loginPassword });
      if (!res.ok) {
        setLoginError(res.error || 'Invalid credentials.');
      }
    } catch (err: any) {
      setLoginError(err.message || 'Login failed.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleApprove = async (submissionId: string) => {
    if (!window.confirm('Are you sure you want to approve this payment? This will grant the student immediate paid access.')) {
      return;
    }

    try {
      const { response: res, data } = await fetchJson(`/api/admin/payments/${submissionId}/approve`, {
        method: 'POST',
      });
      if (res.ok) {
        setSuccessMessage('Payment approved successfully!');
        setTimeout(() => setSuccessMessage(''), 4000);
        if (selectedProofSubmission?.id === submissionId) {
          setSelectedProofSubmission(null);
        }
        await fetchAdminData();
      } else {
        alert((data as any).error || 'Failed to approve payment.');
      }
    } catch (e: any) {
      alert(e.message || 'Approval error.');
    }
  };

  const openRejectModal = (submissionId: string) => {
    setRejectingSubmissionId(submissionId);
    setRejectionReason('');
  };

  const handleConfirmReject = async () => {
    if (!rejectingSubmissionId) return;
    if (!rejectionReason.trim()) {
      alert('Please provide a reason for rejecting this payment.');
      return;
    }

    try {
      const { response: res, data } = await fetchJson(`/api/admin/payments/${rejectingSubmissionId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectionReason.trim() }),
      });
      if (res.ok) {
        setSuccessMessage('Payment rejected.');
        setTimeout(() => setSuccessMessage(''), 4000);
        if (selectedProofSubmission?.id === rejectingSubmissionId) {
          setSelectedProofSubmission(null);
        }
        setRejectingSubmissionId(null);
        setRejectionReason('');
        await fetchAdminData();
      } else {
        alert((data as any).error || 'Failed to reject payment.');
      }
    } catch (e: any) {
      alert(e.message || 'Rejection error.');
    }
  };

  const handleSaveMethod = async (method: any) => {
    try {
      const { response: res, data } = await fetchJson('/api/admin/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(method),
      });
      if (res.ok) {
        setSuccessMessage(`Updated ${method.id} configuration successfully!`);
        setTimeout(() => setSuccessMessage(''), 4000);
        await fetchAdminData();
      } else {
        alert((data as any).error || 'Failed to save payment method.');
      }
    } catch (e: any) {
      alert(e.message || 'Error saving payment method.');
    }
  };

  const handleRevokeEntitlement = async (entitlementId: string) => {
    if (!revokeReason.trim()) {
      alert('Please provide a reason for revoking this access.');
      return;
    }
    if (!window.confirm('Revoke this active access entitlement? The student will lose this paid access immediately.')) return;
    setRevokingEntitlementId(entitlementId);
    try {
      const { response: res, data } = await fetchJson(`/api/admin/entitlements/${entitlementId}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: revokeReason.trim() }),
      });
      if (!res.ok) throw new Error((data as any).error || 'Failed to revoke access.');
      setSuccessMessage('Access entitlement revoked.');
      setRevokeReason('');
      await fetchAdminData();
    } catch (e: any) {
      setDashboardError(e.message || 'Failed to revoke access.');
    } finally {
      setRevokingEntitlementId(null);
    }
  };

  // 1. Loading State
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-neutral-900 flex items-center justify-center p-4">
        <div className="text-center text-white space-y-3">
          <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-neutral-400 font-medium">Verifying administrator session...</p>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated State -> Show Admin Sign In Form
  if (status === 'unauthenticated' || !user) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col justify-center items-center p-4">
        <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto text-emerald-400">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Gadwal Administrator</h1>
            <p className="text-sm text-neutral-400">Sign in with your verified MIU administrator credentials</p>
          </div>

          {loginError && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm p-3.5 rounded-xl flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                Admin Email
              </label>
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="name@miuegypt.edu.eg"
                className="w-full min-h-[44px] bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full min-h-[44px] bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-sm text-white placeholder-neutral-500 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              />
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-4 rounded-xl transition duration-150 flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 disabled:opacity-50 cursor-pointer"
            >
              {isLoggingIn ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Access Dashboard</span>
                </>
              )}
            </button>
          </form>

          <div className="pt-2 text-center">
            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Gadwal Student App</span>
            </a>
          </div>
        </div>
      </div>
    );
  }

  // 3. Authenticated as Non-Admin Student -> Access Denied
  if (!isAdminUser(user)) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col justify-center items-center p-4">
        <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto text-rose-400">
            <XCircle className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">Access Restricted</h1>
            <p className="text-sm text-neutral-400">
              The account <strong className="text-neutral-200">{user.email}</strong> does not have administrator privileges.
            </p>
          </div>
          <div className="p-4 bg-neutral-800/60 rounded-xl text-xs text-neutral-400 text-left space-y-1">
            <p>• Admin authorization is strictly enforced on the server.</p>
            <p>• If you believe this is in error, contact the system administrator.</p>
          </div>
          <div className="space-y-2.5 pt-2">
            <a
              href="/"
              className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-medium py-2.5 px-4 rounded-xl transition inline-flex items-center justify-center gap-2 text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Return to Student App</span>
            </a>
            <button
              onClick={() => logout()}
              className="w-full border border-neutral-700 hover:bg-neutral-800 text-neutral-300 font-medium py-2.5 px-4 rounded-xl transition inline-flex items-center justify-center gap-2 text-sm cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Filter history
  const filteredHistory = allSubmissions.filter((item) => {
    if (historyFilter === 'ALL') return true;
    return item.submission?.status === historyFilter;
  });

  // 4. Authenticated Administrator Dashboard
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="bg-neutral-900 border-b border-neutral-800 sticky top-0 z-30 px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center text-emerald-400 font-bold">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-lg tracking-tight">Gadwal</span>
                <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
                  ADMIN CONSOLE
                </span>
              </div>
              <p className="text-xs text-neutral-400">Payment verification & system management</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-semibold text-neutral-200">{user.name || 'Administrator'}</span>
              <span className="text-[11px] text-neutral-400 font-mono">{user.email}</span>
            </div>
            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-300 bg-neutral-800 hover:bg-neutral-700 hover:text-white px-3 py-1.5 rounded-lg border border-neutral-700 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Student App</span>
            </a>
            <button
              onClick={() => logout()}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 rounded-lg border border-rose-500/20 transition cursor-pointer"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl w-full mx-auto p-4 sm:p-8 flex-1 space-y-6">
        {/* Banner Messages */}
        {dashboardError && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm p-4 rounded-xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>{dashboardError}</span>
            </div>
            <button onClick={() => setDashboardError('')} className="text-rose-400 hover:text-rose-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successMessage && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm p-4 rounded-xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage('')} className="text-emerald-400 hover:text-emerald-200">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
          {[["Students",adminStudents.length],["Active access",entitlements.filter((x:any)=>x.entitlement?.status==='ACTIVE').length],["Pending payments",pendingSubmissions.length],["Approved value",`${allSubmissions.filter((x:any)=>(x.submission?.status||x.status)==='APPROVED').reduce((sum:number,x:any)=>sum+Number(x.submission?.amount||x.amount||0),0)} EGP`],["Current term",academicContext?.context?.term||'—'],["Free runs used",adminStudents.filter((x:any)=>x.student?.freeRunStatus==='used').length]].map(([label,value])=><div key={String(label)} className="bg-neutral-900 border border-neutral-800 rounded-xl p-3"><p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p><p className="mt-1 text-lg font-black text-white">{value}</p></div>)}
        </div>

        {/* Navigation Tabs & Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveTab('pending')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition cursor-pointer ${
                activeTab === 'pending'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30'
                  : 'bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800 border border-neutral-800'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>Pending Submissions</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                activeTab === 'pending' ? 'bg-white/20 text-white' : 'bg-neutral-800 text-neutral-300'
              }`}>
                {pendingSubmissions.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30'
                  : 'bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800 border border-neutral-800'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Payment History</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                activeTab === 'history' ? 'bg-white/20 text-white' : 'bg-neutral-800 text-neutral-300'
              }`}>
                {allSubmissions.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('access')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition cursor-pointer ${
                activeTab === 'access'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30'
                  : 'bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800 border border-neutral-800'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Access</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                activeTab === 'access' ? 'bg-white/20 text-white' : 'bg-neutral-800 text-neutral-300'
              }`}>
                {entitlements.filter((x: any) => x.entitlement?.status === 'ACTIVE').length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('students')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition cursor-pointer ${activeTab === 'students' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30' : 'bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800 border border-neutral-800'}`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Students</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300 font-bold">{adminStudents.length}</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30'
                  : 'bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800 border border-neutral-800'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>Payment Methods</span>
            </button>

            <button
              onClick={() => setActiveTab('system')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 transition cursor-pointer ${
                activeTab === 'system'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30'
                  : 'bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800 border border-neutral-800'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Academic Context</span>
            </button>
          </div>

          <button
            onClick={() => fetchAdminData()}
            disabled={isLoadingData}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-300 bg-neutral-900 hover:bg-neutral-800 px-3.5 py-2 rounded-xl border border-neutral-800 transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingData ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* TAB 1: PENDING SUBMISSIONS */}
        {activeTab === 'pending' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Pending Payment Reviews</h2>
                <p className="text-xs text-neutral-400">Review student proof screenshots and activate entitlements</p>
              </div>
            </div>

            {pendingSubmissions.length === 0 ? (
              <div className="bg-neutral-900/80 border border-neutral-800 rounded-2xl p-12 text-center space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-400/60 mx-auto" />
                <h3 className="text-base font-semibold text-white">All Caught Up!</h3>
                <p className="text-sm text-neutral-400 max-w-md mx-auto">
                  There are no pending payment submissions awaiting verification at this time.
                </p>
              </div>
            ) : (
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-neutral-950/60 border-b border-neutral-800 text-neutral-400 text-xs uppercase tracking-wider font-semibold">
                        <th className="p-4">Student Details</th>
                        <th className="p-4">Package</th>
                        <th className="p-4">Method & Amount</th>
                        <th className="p-4">Submitted Details</th>
                        <th className="p-4">Proof</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/60">
                      {pendingSubmissions.map((item: any) => {
                        const sub = item.submission;
                        return (
                          <tr key={sub.id} className="hover:bg-neutral-800/30 transition">
                            <td className="p-4">
                              <div className="font-semibold text-white">{sub.fullName || item.studentDisplayName || 'MIU Student'}</div>
                              <div className="text-xs text-emerald-400 font-mono">{item.studentEmail}</div>
                              <div className="text-[10px] text-neutral-500 font-mono mt-0.5">ID: {sub.studentId?.slice(0, 8)}...</div>
                            </td>

                            <td className="p-4">
                              <div className="font-semibold text-neutral-200">
                                {sub.plan === 'CURRENT_TERM' ? 'Current Term' : 'Academic Year'}
                              </div>
                              <div className="text-xs text-neutral-400">
                                {sub.academicYear} {sub.term ? `• ${sub.term}` : ''}
                              </div>
                            </td>

                            <td className="p-4">
                              <div className="font-bold text-white text-base">{sub.amount} EGP</div>
                              <span className="inline-block text-[11px] font-semibold text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700 mt-1">
                                {sub.paymentMethod?.replace('MANUAL_', '')}
                              </span>
                            </td>

                            <td className="p-4 space-y-1">
                              <div className="text-xs text-neutral-300">
                                <span className="text-neutral-500">Phone:</span> {sub.phoneNumber}
                              </div>
                              {sub.teldaUsername && (
                                <div className="text-xs text-neutral-300">
                                  <span className="text-neutral-500">Telda:</span> @{sub.teldaUsername.replace('@', '')}
                                </div>
                              )}
                              <div className="text-[11px] text-neutral-500 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDateTime(sub.createdAt)}
                              </div>
                            </td>

                            <td className="p-4">
                              {sub.proofId ? (
                                <button
                                  type="button"
                                  onClick={() => setSelectedProofSubmission({ ...sub, studentEmail: item.studentEmail })}
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/30 transition cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>View Proof</span>
                                </button>
                              ) : (
                                <span className="text-xs text-neutral-500 italic">No proof image</span>
                              )}
                            </td>

                            <td className="p-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleApprove(sub.id)}
                                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3.5 py-1.5 rounded-lg shadow-sm transition inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Approve</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openRejectModal(sub.id)}
                                  className="bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-xs font-semibold px-3 py-1.5 rounded-lg transition inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Reject</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: PAYMENT HISTORY */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Payment Submission History</h2>
                <p className="text-xs text-neutral-400">Complete audit log of all reviewed and processed payments</p>
              </div>

              <div className="flex items-center gap-2">
                {(['ALL', 'APPROVED', 'REJECTED'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setHistoryFilter(filter)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      historyFilter === filter
                        ? 'bg-neutral-100 text-neutral-900'
                        : 'bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 text-center text-sm text-neutral-400">
                No submissions found matching filter: {historyFilter}
              </div>
            ) : (
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-neutral-950/60 border-b border-neutral-800 text-neutral-400 text-xs uppercase tracking-wider font-semibold">
                        <th className="p-4">Student</th>
                        <th className="p-4">Plan & Amount</th>
                        <th className="p-4">Method & Details</th>
                        <th className="p-4">Status</th>
                        <th className="p-4">Review Info</th>
                        <th className="p-4">Proof</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/60">
                      {filteredHistory.map((item: any) => {
                        const sub = item.submission;
                        return (
                          <tr key={sub.id} className="hover:bg-neutral-800/30 transition">
                            <td className="p-4">
                              <div className="font-semibold text-white">{sub.fullName}</div>
                              <div className="text-xs text-neutral-400 font-mono">{item.studentEmail}</div>
                            </td>

                            <td className="p-4">
                              <div className="font-medium text-neutral-200">
                                {sub.plan === 'CURRENT_TERM' ? 'Current Term' : 'Academic Year'}
                              </div>
                              <div className="text-xs text-neutral-400">
                                {sub.amount} EGP • {sub.academicYear} {sub.term || ''}
                              </div>
                            </td>

                            <td className="p-4 text-xs space-y-0.5">
                              <div className="font-semibold text-neutral-300">{sub.paymentMethod?.replace('MANUAL_', '')}</div>
                              <div className="text-neutral-400">Phone: {sub.phoneNumber}</div>
                              {sub.teldaUsername && <div className="text-neutral-400">Telda: @{sub.teldaUsername}</div>}
                            </td>

                            <td className="p-4">
                              {sub.status === 'APPROVED' && (
                                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Approved</span>
                                </span>
                              )}
                              {sub.status === 'CANCELLED' && (
                                <span className="inline-flex items-center gap-1 text-xs font-bold text-neutral-400 bg-neutral-500/10 px-2.5 py-1 rounded-full border border-neutral-500/20">
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Cancelled</span>
                                </span>
                              )}
                              {sub.status === 'REJECTED' && (
                                <div className="space-y-1">
                                  <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-500/20">
                                    <XCircle className="w-3.5 h-3.5" />
                                    <span>Rejected</span>
                                  </span>
                                  {sub.rejectionReason && (
                                    <p className="text-[11px] text-rose-300 max-w-xs">
                                      <span className="font-semibold">Reason:</span> {sub.rejectionReason}
                                    </p>
                                  )}
                                </div>
                              )}
                              {sub.status === 'PENDING' && (
                                <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                                  <Clock className="w-3.5 h-3.5" />
                                  <span>Pending</span>
                                </span>
                              )}
                            </td>

                            <td className="p-4 text-xs text-neutral-400">
                              {sub.reviewedAt ? (
                                <>
                                  <div>By: {sub.reviewedBy || 'Admin'}</div>
                                  <div className="text-[11px] text-neutral-500">{formatDateTime(sub.reviewedAt)}</div>
                                </>
                              ) : (
                                <span className="text-neutral-600">—</span>
                              )}
                            </td>

                            <td className="p-4">
                              {sub.proofId && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedProofSubmission({ ...sub, studentEmail: item.studentEmail })}
                                  className="text-xs font-medium text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>View</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ACTIVE ACCESS / ENTITLEMENTS */}
        {activeTab === 'access' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Access & Entitlements</h2>
              <p className="text-xs text-neutral-400">Review active paid access and revoke it when a refund, chargeback, or support decision requires it.</p>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
              {entitlements.length === 0 ? (
                <div className="p-8 text-center text-sm text-neutral-400">No entitlements have been created yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-neutral-950/60 border-b border-neutral-800 text-neutral-400 text-xs uppercase tracking-wider font-semibold">
                        <th className="p-4">Student</th>
                        <th className="p-4">Plan</th>
                        <th className="p-4">Scope</th>
                        <th className="p-4">Status</th>
                        <th className="p-4">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/60">
                      {entitlements.map((item: any) => {
                        const e = item.entitlement;
                        const active = e.status === 'ACTIVE';
                        return (
                          <tr key={e.id} className="hover:bg-neutral-800/30 transition">
                            <td className="p-4">
                              <div className="font-semibold text-white">{item.studentDisplayName || 'Student'}</div>
                              <div className="text-xs text-neutral-400 font-mono">{item.studentEmail || e.studentId}</div>
                            </td>
                            <td className="p-4 text-neutral-200">{e.plan === 'CURRENT_TERM' ? 'Current Term' : 'Academic Year'}</td>
                            <td className="p-4 text-xs text-neutral-400">{e.academicYear}{e.term ? ` • ${e.term}` : ' • Full academic year'}</td>
                            <td className="p-4">
                              <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border ${active ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-400 bg-rose-500/10 border-rose-500/20'}`}>
                                {active ? 'Active' : 'Revoked'}
                              </span>
                            </td>
                            <td className="p-4">
                              {active ? (
                                <button
                                  type="button"
                                  onClick={() => { setRevokingEntitlementId(e.id); setRevokeReason(''); }}
                                  className="text-xs font-semibold text-rose-300 border border-rose-500/30 bg-rose-600/10 hover:bg-rose-600 hover:text-white px-3 py-2 rounded-lg"
                                >
                                  Revoke Access
                                </button>
                              ) : (
                                <span className="text-xs text-neutral-600">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STUDENTS */}
        {activeTab === 'students' && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div><h2 className="text-xl font-bold text-white">Students</h2><p className="text-xs text-neutral-400">Search accounts, inspect access, and troubleshoot free-run state.</p></div>
              <div className="flex gap-2"><input value={studentSearch} onChange={e=>setStudentSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')fetchAdminData(studentSearch);}} placeholder="Search name or MIU email" className="min-h-[44px] w-full sm:w-72 rounded-xl bg-neutral-900 border border-neutral-700 px-3 text-sm text-white"/><button onClick={()=>fetchAdminData(studentSearch)} className="min-h-[44px] px-4 rounded-xl bg-emerald-600 text-white font-semibold">Search</button></div>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
              {adminStudents.length===0 ? <div className="p-8 text-center text-neutral-400">No matching students.</div> : <div className="divide-y divide-neutral-800">{adminStudents.map((item:any)=><div key={item.student.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div><p className="font-bold text-white">{item.student.displayName||'Student'}</p><p className="text-xs text-neutral-400">{item.student.email}</p><p className="text-xs text-neutral-500 mt-1">Access: {item.access.accessLabel}</p></div><div className="flex gap-2"><button onClick={async()=>{const r=await fetchJson(`/api/admin/students/${item.student.id}`);if(r.response.ok)setSelectedStudent((r.data as any).student);}} className="min-h-[44px] px-3 rounded-lg border border-neutral-700 text-white text-sm font-semibold">View</button><button onClick={async()=>{if(!window.confirm('Reset this student free run?'))return;const r=await fetchJson(`/api/admin/students/${item.student.id}/free-run/reset`,{method:'POST'});if(!r.response.ok)alert((r.data as any).error||'Could not reset free run.');else await fetchAdminData();}} className="min-h-[44px] px-3 rounded-lg border border-amber-500/30 text-amber-300 text-sm font-semibold">Reset free run</button></div></div>)}</div>}
            </div>
            {selectedStudent&&<div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-white">{selectedStudent.student.displayName||'Student'}</h3><p className="text-sm text-neutral-400">{selectedStudent.student.email}</p></div><button onClick={()=>setSelectedStudent(null)} className="text-neutral-400"><X className="w-4 h-4"/></button></div><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm"><div className="p-3 rounded-xl bg-neutral-950"><p className="text-neutral-500">Access</p><p className="font-semibold text-white mt-1">{selectedStudent.access.accessLabel}</p></div><div className="p-3 rounded-xl bg-neutral-950"><p className="text-neutral-500">Free run</p><p className="font-semibold text-white mt-1">{selectedStudent.student.freeRunStatus}</p></div><div className="p-3 rounded-xl bg-neutral-950"><p className="text-neutral-500">Payments</p><p className="font-semibold text-white mt-1">{selectedStudent.payments.length}</p></div><div className="p-3 rounded-xl bg-neutral-950"><p className="text-neutral-500">Schedules</p><p className="font-semibold text-white mt-1">{selectedStudent.schedules.length}</p></div></div></div>}
          </div>
        )}

        {/* TAB 4: PAYMENT METHODS CONFIGURATION */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Payment Methods & Destinations</h2>
              <p className="text-xs text-neutral-400">Configure recipient account numbers, usernames, and student instructions</p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {methods.map((method) => {
                const methodTitles: Record<string, string> = {
                  MANUAL_INSTAPAY: 'InstaPay Transfer',
                  MANUAL_TELDA: 'Telda Payment',
                  MANUAL_VODAFONE_CASH: 'Vodafone Cash',
                };
                const destinationPlaceholders: Record<string, string> = {
                  MANUAL_INSTAPAY: 'e.g. user@instapay or 01012345678',
                  MANUAL_TELDA: 'e.g. @telda_username',
                  MANUAL_VODAFONE_CASH: 'e.g. 01012345678',
                };

                return (
                  <div key={method.id} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-5 flex flex-col justify-between shadow-lg">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
                        <div className="flex items-center gap-2">
                          <CreditCard className="w-5 h-5 text-emerald-400" />
                          <h3 className="font-bold text-white text-base">{methodTitles[method.id] || method.id}</h3>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={method.enabled === 1}
                            onChange={(e) => {
                              const updated = methods.map((m) =>
                                m.id === method.id ? { ...m, enabled: e.target.checked ? 1 : 0 } : m
                              );
                              setMethods(updated);
                            }}
                            className="sr-only peer"
                          />
                          <div className="w-10 h-5 bg-neutral-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                        </label>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                          Destination / Account Number
                        </label>
                        <input
                          type="text"
                          value={method.destination || ''}
                          placeholder={destinationPlaceholders[method.id] || 'Account details'}
                          onChange={(e) => {
                            const updated = methods.map((m) =>
                              m.id === method.id ? { ...m, destination: e.target.value } : m
                            );
                            setMethods(updated);
                          }}
                          className="w-full min-h-[44px] bg-neutral-800 border border-neutral-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-hidden focus:border-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                          Custom Instructions (shown to students)
                        </label>
                        <textarea
                          rows={3}
                          value={method.instructions || ''}
                          placeholder="Special instructions for students when paying..."
                          onChange={(e) => {
                            const updated = methods.map((m) =>
                              m.id === method.id ? { ...m, instructions: e.target.value } : m
                            );
                            setMethods(updated);
                          }}
                          className="w-full min-h-[44px] bg-neutral-800 border border-neutral-700 rounded-xl p-3 text-sm text-white placeholder-neutral-500 focus:outline-hidden focus:border-emerald-500 resize-none"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSaveMethod(method)}
                      className="w-full min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 text-sm shadow-md cursor-pointer"
                    >
                      <Save className="w-4 h-4" />
                      <span>Save Configuration</span>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-4">
              <div>
                <h3 className="font-bold text-white">Products & Pricing</h3>
                <p className="text-xs text-neutral-400">Current launch prices are configurable without changing code.</p>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {products.map((product) => (
                  <div key={product.id} className="border border-neutral-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-white">{product.name}</div>
                        <div className="text-xs text-neutral-500">{product.id}</div>
                      </div>
                      <label className="text-xs text-neutral-400 flex items-center gap-2">
                        <input type="checkbox" checked={Number(product.enabled) === 1}
                          onChange={(e) => setProducts(products.map(p => p.id === product.id ? {...p, enabled: e.target.checked ? 1 : 0} : p))} />
                        Active
                      </label>
                    </div>
                    <input type="number" min="1" step="1" value={product.amount}
                      onChange={(e) => setProducts(products.map(p => p.id === product.id ? {...p, amount: e.target.value} : p))}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white" />
                    <button type="button" onClick={() => handleSaveProduct(product)}
                      className="w-full min-h-[44px] bg-neutral-700 hover:bg-neutral-600 text-white font-semibold py-2 rounded-xl text-sm">
                      Save Price
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: SYSTEM & ACADEMIC CONTEXT */}
        {activeTab === 'system' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">System & Academic Term Context</h2>
              <p className="text-xs text-neutral-400">Current calendar context used for schedule generation & entitlement scope</p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-2 shadow-lg">
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                  <Calendar className="w-4 h-4" />
                  <span>Active Academic Year</span>
                </div>
                <div className="text-2xl font-bold text-white tracking-tight">
                  {academicContext?.context?.academicYear || 'Unavailable'}
                </div>
                <p className="text-xs text-neutral-400">Derived from current date or system configuration</p>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-2 shadow-lg">
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                  <Layers className="w-4 h-4" />
                  <span>Active Term</span>
                </div>
                <div className="text-2xl font-bold text-white tracking-tight">
                  {academicContext?.context?.term || 'Unavailable'}
                </div>
                <p className="text-xs text-neutral-400">Fall / Spring / Summer detection</p>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-3 shadow-lg">
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                  <Settings className="w-4 h-4" />
                  <span>Term Override</span>
                </div>
                <select
                  value={termOverride}
                  onChange={(e) => setTermOverride(e.target.value as any)}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value="AUTO">AUTO</option>
                  <option value="FALL">FALL</option>
                  <option value="SPRING">SPRING</option>
                  <option value="SUMMER">SUMMER</option>
                </select>
                <p className="text-xs text-neutral-400">AUTO uses Gadwal's historical MIU term-detection rule.</p>
                <button onClick={handleSaveTermOverride} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold py-2 rounded-lg">
                  Save Term
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {revokingEntitlementId && (
        <div className="fixed inset-0 z-50 bg-black/80  flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white">Revoke access</h3>
              <button onClick={() => setRevokingEntitlementId(null)} className="text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-neutral-400">This immediately removes the entitlement. Use a clear reason, for example a refund, chargeback, or support correction.</p>
            <textarea value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} rows={4} placeholder="Reason for revocation..." className="w-full min-h-[44px] bg-neutral-800 border border-neutral-700 rounded-xl p-3 text-sm text-white placeholder-neutral-500" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRevokingEntitlementId(null)} className="px-4 py-2 text-xs font-semibold text-neutral-400 hover:text-white rounded-lg">Cancel</button>
              <button type="button" onClick={() => revokingEntitlementId && handleRevokeEntitlement(revokingEntitlementId)} disabled={!revokeReason.trim()} className="bg-rose-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-semibold">{revokingEntitlementId ? 'Revoke Access' : 'Revoke'}</button>
            </div>
          </div>
        </div>
      )}

      {/* PROOF VIEWER MODAL */}
      {selectedProofSubmission && (
        <div className="fixed inset-0 z-50 bg-black/80  flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Payment Proof Review</h3>
                <p className="text-xs text-neutral-400">
                  {selectedProofSubmission.fullName} • {selectedProofSubmission.studentEmail}
                </p>
              </div>
              <button
                onClick={() => setSelectedProofSubmission(null)}
                className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body - Image */}
            <div className="flex-1 overflow-y-auto p-4 bg-black/40 flex items-center justify-center min-h-[300px]">
              <img
                src={`/api/admin/payments/${selectedProofSubmission.id}/proof`}
                alt="Payment proof screenshot"
                className="max-h-[60vh] max-w-full object-contain rounded-xl border border-neutral-800 shadow-md"
              />
            </div>

            {/* Modal Footer - Submission Details & Actions */}
            <div className="p-4 bg-neutral-900 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs space-y-0.5">
                <div>
                  <span className="font-semibold text-white">{selectedProofSubmission.amount} EGP</span>
                  <span className="text-neutral-400"> for {selectedProofSubmission.plan}</span>
                </div>
                <div className="text-neutral-400">
                  Method: {selectedProofSubmission.paymentMethod} • Phone: {selectedProofSubmission.phoneNumber}
                </div>
              </div>

              {selectedProofSubmission.status === 'PENDING' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleApprove(selectedProofSubmission.id)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Approve Payment</span>
                  </button>
                  <button
                    onClick={() => openRejectModal(selectedProofSubmission.id)}
                    className="bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-xs font-semibold px-4 py-2 rounded-xl transition inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>Reject</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* REJECT MODAL */}
      {rejectingSubmissionId && (
        <div className="fixed inset-0 z-50 bg-black/80  flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-400">
                <XCircle className="w-5 h-5" />
                <h3 className="font-bold text-white text-base">Reject Payment Submission</h3>
              </div>
              <button
                onClick={() => setRejectingSubmissionId(null)}
                className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-neutral-400">
              Provide a clear reason explaining why this payment proof could not be verified. The student will see this explanation in their payment history.
            </p>

            <textarea
              rows={3}
              required
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Screenshot unreadable, amount does not match, transaction not found..."
              className="w-full min-h-[44px] bg-neutral-800 border border-neutral-700 rounded-xl p-3 text-sm text-white placeholder-neutral-500 focus:outline-hidden focus:border-rose-500 resize-none"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectingSubmissionId(null)}
                className="px-4 py-2 text-xs font-semibold text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition inline-flex items-center gap-1.5 shadow-md cursor-pointer"
              >
                <XCircle className="w-4 h-4" />
                <span>Confirm Rejection</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
