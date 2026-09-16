import React, { useEffect, useState } from 'react';
import { ModalShell } from './ModalShell';
import { fetchJson } from '../services/resilientFetch';
import { 
  Star, Download, Trash2, Bell, BookOpen, CalendarDays, Shield, 
  CreditCard, LayoutDashboard, HelpCircle, LogOut, Loader2, ArrowRight
} from 'lucide-react';
import { formatDate, formatDateTime } from '../utils/dateFormatting';

export interface AccountCenterProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenUpgrade?: () => void;
  onStartNewTerm?: () => void;
  onOpenAuth?: (view: 'forgot') => void;
  onLogout?: () => void;
  onResume?: () => void;
}

type TabType = 'overview' | 'schedules' | 'payments' | 'notifications' | 'help';

export const AccountCenter: React.FC<AccountCenterProps> = ({ 
  isOpen, onClose, onOpenUpgrade, onStartNewTerm, onOpenAuth, onLogout, onResume 
}) => {
  const [tab, setTab] = useState<TabType>('overview');
  const [data, setData] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    try {
      const { response: res, data: d } = await fetchJson('/api/account/overview', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(d.error || 'Could not load account.');
      setData(d);
      
      const n = await fetchJson('/api/account/notifications', { credentials: 'same-origin' });
      if (n.response.ok) setNotifications(n.data.notifications || []);
    } catch (e: any) {
      setError(e.message || 'Could not load account.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      void load();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const perform = async (id: string, fn: () => Promise<void>) => {
    try {
      setBusy(id);
      setError('');
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message || 'Action failed.');
    } finally {
      setBusy('');
    }
  };

  const tabs: { id: TabType, label: string, icon: React.ReactNode, count?: number }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'schedules', label: 'Schedules', icon: <CalendarDays className="w-4 h-4" /> },
    { id: 'payments', label: 'Billing & Access', icon: <CreditCard className="w-4 h-4" /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" />, count: data?.unreadCount || 0 },
    { id: 'help', label: 'Help & FAQ', icon: <HelpCircle className="w-4 h-4" /> },
  ];

  const activeTabContent = () => {
    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-text-secondary">
          <Loader2 className="w-8 h-8 animate-spin mb-4" />
          <p>Loading your account details...</p>
        </div>
      );
    }

    if (!data) {
      return (
        <div className="flex flex-col items-center justify-center h-64 text-text-secondary">
          <p>Failed to load account data.</p>
        </div>
      );
    }

    switch (tab) {
      case 'overview':
        const active = data?.access?.hasScheduleAccess;
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
            {/* Header Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-5 rounded-2xl border border-line bg-mist flex flex-col justify-between">
                <div>
                  <p className="text-xs font-bold tracking-wider text-text-secondary uppercase">Gadwal Access</p>
                  <h3 className="text-2xl font-black mt-2 text-ink">{data.access.accessLabel}</h3>
                </div>
                <div className="mt-4">
                  <p className="text-sm font-medium text-text-secondary">
                    {data.access.daysRemaining != null 
                      ? `${data.access.daysRemaining} days remaining · expires ${formatDate(data.access.expiresOn)}` 
                      : 'No paid access currently'}
                  </p>
                </div>
              </div>
              
              <div className="p-5 rounded-2xl border border-line bg-white flex flex-col justify-between">
                <div>
                  <p className="text-xs font-bold tracking-wider text-text-secondary uppercase">Student Profile</p>
                  <p className="font-bold text-lg mt-2 text-ink">{data.profile?.displayName || 'MIU Student'}</p>
                  <p className="text-sm text-text-secondary">{data.profile?.email}</p>
                </div>
                <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-md w-fit">
                  <Shield className="w-3.5 h-3.5" />
                  Verified MIU account
                </div>
              </div>
            </div>

            {/* Resume Work */}
            {data.profile?.onboardingCompletedAt && ((data.currentCourses && data.currentCourses.length > 0) || data.schedules?.length > 0) && (
              <div className="p-6 rounded-2xl border border-accent/20 bg-accent/5 relative overflow-hidden group">
                <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-accent/10 to-transparent pointer-events-none" />
                <h4 className="font-black text-xl text-ink">Resume your work</h4>
                <p className="text-text-secondary mt-1 max-w-md">Your current course configurations and generated schedules are safely stored.</p>
                <button onClick={() => onResume?.()} className="mt-5 inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl bg-ink text-white font-bold hover:bg-black transition-colors shadow-sm">
                  Continue where you left off
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Current Context */}
            <div className="p-5 rounded-2xl border border-line bg-white flex items-center justify-between">
              <div>
                <p className="text-xs font-bold tracking-wider text-text-secondary uppercase">Current Term</p>
                <p className="font-bold text-lg mt-1">{data.context.term} · {data.context.academicYear}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold tracking-wider text-text-secondary uppercase">Free Run</p>
                <p className={`font-bold mt-1 ${data.access.freeRunStatus === 'available' ? 'text-green-600' : 'text-text-muted'}`}>
                  {data.access.freeRunStatus === 'available' ? 'Available' : data.access.freeRunStatus === 'in-progress' ? 'In progress' : 'Used'}
                </p>
              </div>
            </div>

            {data.access.previousAccessExpired && (
              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900">
                <p className="font-bold flex items-center gap-2"><Bell className="w-4 h-4" /> {data.access.previousAccessLabel}</p>
                <p className="text-sm mt-1">Your saved courses and schedules are still available in your account.</p>
              </div>
            )}

            {!active && data.access.freeRunStatus === 'used' && (
              <button onClick={onOpenUpgrade} className="w-full min-h-[52px] rounded-xl bg-accent text-white font-bold hover:bg-accent-hover transition-colors shadow-sm">
                Get Gadwal Access
              </button>
            )}

            {data.profile?.deletionScheduledFor && (
              <div className="p-5 border border-red-200 bg-red-50 rounded-2xl">
                <p className="font-bold text-red-900 text-lg">Account deletion scheduled</p>
                <p className="text-sm text-red-800 mt-1">Your data will be permanently deleted on {formatDateTime(data.profile.deletionScheduledFor)}.</p>
                <button 
                  className="mt-4 min-h-[44px] px-5 bg-white border border-red-200 hover:border-red-300 text-red-700 rounded-lg font-bold transition-colors" 
                  disabled={busy === 'cancel'} 
                  onClick={() => perform('cancel', async () => {
                    const password = window.prompt('Enter your current password to cancel account deletion.');
                    if (!password) return;
                    const r = await fetchJson('/api/account/delete-cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
                    if (!r.response.ok) throw new Error(r.data.error || 'Could not cancel.');
                  })}
                >
                  {busy === 'cancel' ? 'Cancelling...' : 'Cancel deletion request'}
                </button>
              </div>
            )}
          </div>
        );
      
      case 'schedules':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <h3 className="font-black text-xl">Saved Schedules</h3>
            
            {data?.schedules?.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {data.schedules.map((s: any) => (
                  <div key={s.id} className="p-5 border border-line rounded-2xl bg-white flex flex-col justify-between transition-all hover:border-text-secondary/40 hover:shadow-xs group">
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div>
                        <p className="font-bold text-ink line-clamp-1">{s.title || 'Saved Schedule'}</p>
                        <p className="text-xs text-text-secondary mt-1">{s.term} · {s.academicYear}</p>
                      </div>
                      <button 
                        title="Toggle favorite" 
                        onClick={() => perform(`fav-${s.id}`, async () => {
                          const r = await fetchJson(`/api/account/schedules/${s.id}/favorite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: !Boolean(s.isFavorite) }) });
                          if (!r.response.ok) throw new Error(r.data.error || 'Could not update favorite.');
                        })} 
                        className={`p-2 rounded-lg transition-colors ${s.isFavorite ? 'text-accent bg-accent/10' : 'text-text-muted hover:bg-mist'}`}
                      >
                        <Star className={`w-5 h-5 ${s.isFavorite ? 'fill-current' : ''}`} />
                      </button>
                    </div>
                    
                    <div className="flex items-center gap-2 pt-4 border-t border-line/50">
                      <button 
                        onClick={() => {
                          const title = window.prompt('Schedule name', s.title || 'Saved Schedule'); 
                          if (title) void perform(`rename-${s.id}`, async () => {
                            const r = await fetchJson(`/api/account/schedules/${s.id}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
                            if (!r.response.ok) throw new Error(r.data.error || 'Could not rename.');
                          });
                        }} 
                        className="flex-1 min-h-[36px] bg-mist hover:bg-line/50 rounded-lg text-sm font-semibold transition-colors"
                      >
                        Rename
                      </button>
                      <button 
                        onClick={() => perform(`delete-${s.id}`, async () => {
                          if (!window.confirm('Delete this saved schedule?')) return;
                          const r = await fetchJson(`/api/account/schedules/${s.id}`, { method: 'DELETE' });
                          if (!r.response.ok) throw new Error(r.data.error || 'Could not delete.');
                        })} 
                        className="flex-1 min-h-[36px] bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-sm font-semibold transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center border-2 border-dashed border-line rounded-2xl bg-mist/50">
                <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-line flex items-center justify-center mx-auto mb-4">
                  <CalendarDays className="w-8 h-8 text-text-muted" />
                </div>
                <p className="font-bold text-lg text-ink">No saved schedules yet</p>
                <p className="text-sm text-text-secondary mt-2 max-w-sm mx-auto">Generate your first schedule and save it here to compare or refer back to it later.</p>
              </div>
            )}
          </div>
        );

      case 'payments':
        const pendingPayment = data?.payments?.find((x: any) => x.status === 'PENDING');
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-200">
            {pendingPayment && (
              <div className="p-6 border border-amber-200 bg-amber-50 rounded-2xl">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <p className="font-black text-amber-900 text-lg">Payment Under Review</p>
                </div>
                <p className="text-sm text-amber-800">Submitted {formatDateTime(pendingPayment.createdAt)} via {pendingPayment.paymentMethod.replace('MANUAL_', '')}</p>
                <div className="mt-5 flex items-center justify-between max-w-xs text-xs font-bold text-amber-900">
                  <span className="flex flex-col items-center gap-1"><CheckCircle className="w-5 h-5" /> Submitted</span>
                  <div className="h-0.5 flex-1 bg-amber-300 mx-2" />
                  <span className="flex flex-col items-center gap-1"><Loader2 className="w-5 h-5 animate-spin" /> Reviewing</span>
                  <div className="h-0.5 flex-1 bg-amber-200 mx-2" />
                  <span className="flex flex-col items-center gap-1 opacity-50"><Shield className="w-5 h-5" /> Access</span>
                </div>
              </div>
            )}

            <div className="p-6 border border-line rounded-2xl bg-white shadow-xs">
              <p className="text-xs font-bold tracking-wider uppercase text-text-secondary">Current Entitlement</p>
              <div className="flex items-end justify-between gap-4 mt-2">
                <div>
                  <p className="font-black text-2xl text-ink">{data.access.accessLabel}</p>
                  <p className="text-sm text-text-secondary mt-1">{data.access.expiresOn ? `Valid until ${formatDate(data.access.expiresOn)}` : 'No active paid access'}</p>
                </div>
                {data.access.upgradeAvailable && (
                  <button onClick={onOpenUpgrade} className="min-h-[44px] px-5 rounded-xl bg-accent hover:bg-accent-hover text-white font-bold transition-colors shadow-sm">
                    Upgrade Access
                  </button>
                )}
              </div>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-4">Payment History</h3>
              {data.payments?.length ? (
                <div className="space-y-3">
                  {data.payments.map((x: any) => (
                    <div key={x.id} className="p-4 border border-line rounded-xl bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <p className="font-bold text-ink">{x.productNameSnapshot || (x.plan === 'ACADEMIC_YEAR' ? 'Academic Year' : 'Current Term')} <span className="font-normal text-text-secondary ml-1">· {x.amount} EGP</span></p>
                        <p className="text-xs text-text-muted mt-1">{x.academicYear}{x.term ? ` · ${x.term}` : ''} · {formatDateTime(x.createdAt)}</p>
                      </div>
                      <div className="flex flex-col sm:items-end">
                        <span className={`px-2.5 py-1 rounded-md text-xs font-bold w-fit ${
                          x.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                          x.status === 'PENDING' ? 'bg-amber-100 text-amber-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {x.status}
                        </span>
                        <p className="text-[10px] text-text-muted mt-2 font-mono" title="Receipt ID">ID: {String(x.id).slice(0, 8).toUpperCase()}</p>
                      </div>
                      {x.rejectionReason && <div className="w-full mt-2 p-3 bg-red-50 text-red-800 text-sm rounded-lg border border-red-100">Reason: {x.rejectionReason}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 border border-dashed border-line rounded-xl text-center text-sm text-text-secondary">
                  No payment history available.
                </div>
              )}
            </div>
          </div>
        );

      case 'notifications':
        return (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-black text-xl">Notifications</h3>
              {notifications.some(n => !n.readAt) && (
                <button 
                  onClick={() => perform('readall', async () => {
                    const r = await fetchJson('/api/account/notifications/read-all', { method: 'POST' });
                    if (!r.response.ok) throw new Error('Could not update notifications.');
                  })} 
                  className="text-sm font-semibold text-accent hover:text-accent-hover transition-colors"
                >
                  Mark all as read
                </button>
              )}
            </div>

            {notifications?.length ? (
              <div className="space-y-3">
                {notifications.map(n => (
                  <button 
                    key={n.id} 
                    onClick={() => n.readAt ? null : perform(`n-${n.id}`, async () => {
                      const r = await fetchJson(`/api/account/notifications/${n.id}/read`, { method: 'POST' });
                      if (!r.response.ok) throw new Error('Could not update notification.');
                    })} 
                    className={`w-full text-left p-5 border rounded-2xl transition-all ${
                      n.readAt ? 'border-line bg-white hover:bg-mist' : 'border-accent/40 bg-accent/5 ring-1 ring-accent/10 shadow-sm'
                    }`}
                  >
                    <div className="flex gap-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${n.readAt ? 'bg-mist text-text-muted' : 'bg-accent/20 text-accent'}`}>
                        <Bell className="w-5 h-5" />
                      </div>
                      <div>
                        <p className={`font-bold ${n.readAt ? 'text-ink' : 'text-accent'}`}>{n.title}</p>
                        <p className="text-sm text-text-secondary mt-1">{n.message}</p>
                        <p className="text-xs text-text-muted mt-3 font-medium tracking-wide uppercase">{formatDateTime(n.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center border-2 border-dashed border-line rounded-2xl bg-mist/50">
                <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-line flex items-center justify-center mx-auto mb-4">
                  <Bell className="w-8 h-8 text-text-muted" />
                </div>
                <p className="font-bold text-lg text-ink">You're all caught up!</p>
                <p className="text-sm text-text-secondary mt-2 max-w-sm mx-auto">Important account updates, payment receipts, and feature announcements will appear here.</p>
              </div>
            )}
          </div>
        );

      case 'help':
        const feedbackEmail = String(import.meta.env.VITE_FEEDBACK_EMAIL || '').trim();
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <h3 className="font-black text-xl">Help & FAQ</h3>
            
            <div className="space-y-4">
              <div className="p-5 border border-line rounded-2xl bg-white shadow-xs">
                <p className="font-bold text-lg text-ink">How does OCR extraction work?</p>
                <p className="text-sm text-text-secondary mt-2 leading-relaxed">Gadwal securely analyzes screenshots of your university portal timetable. It extracts course names, section numbers, and time slots using advanced computer vision. You always get to review and edit the extracted data before any schedules are generated.</p>
              </div>
              
              <div className="p-5 border border-line rounded-2xl bg-white shadow-xs">
                <p className="font-bold text-lg text-ink">What is a "Free Run"?</p>
                <p className="text-sm text-text-secondary mt-2 leading-relaxed">Every verified MIU student receives one free complete schedule-generation run per term to test the platform. A run is only consumed if it successfully finds and saves valid schedule combinations. Errors or zero-result generations do not cost you your free run.</p>
              </div>
              
              <div className="p-5 border border-line rounded-2xl bg-white shadow-xs">
                <p className="font-bold text-lg text-ink">Payment Activations</p>
                <p className="text-sm text-text-secondary mt-2 leading-relaxed">Because Gadwal uses manual local transfer methods (InstaPay/Vodafone Cash), payments remain in "Pending" status until an admin verifies the receipt ID against the bank logs. This usually takes less than 24 hours.</p>
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-mist flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 text-center sm:text-left">
              <div>
                <p className="font-bold text-lg text-ink">Still need help?</p>
                <p className="text-sm text-text-secondary mt-1">Reach out to our support team with your student email.</p>
              </div>
              {feedbackEmail && (
                <a href={`mailto:${feedbackEmail}`} className="inline-flex min-h-[48px] items-center px-6 rounded-xl bg-ink hover:bg-black text-white font-bold transition-colors">
                  Contact Support
                </a>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} title="Account Center" maxWidthClass="max-w-5xl" autoHeight>
      {error && (
        <div className="m-4 mb-0 p-4 rounded-xl bg-red-50 border border-red-100 flex items-start gap-3 text-red-800 animate-in fade-in" role="alert">
          <div className="p-1 rounded-full bg-red-100 shrink-0"><Shield className="w-4 h-4 text-red-600" /></div>
          <p className="text-sm font-medium mt-0.5">{error}</p>
        </div>
      )}

      <div className="flex flex-col md:flex-row min-h-[60vh] sm:min-h-[500px]">
        {/* Sidebar Navigation */}
        <div className="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-line bg-paper/50">
          <nav className="flex md:flex-col gap-1 p-3 overflow-x-auto no-scrollbar" aria-label="Account navigation">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-3 px-3 md:px-4 py-2.5 md:py-3 rounded-xl min-h-[44px] whitespace-nowrap text-sm font-semibold transition-all duration-200 ${
                  tab === t.id 
                    ? 'bg-ink text-white shadow-md' 
                    : 'text-text-secondary hover:bg-mist hover:text-ink'
                }`}
              >
                <span className={tab === t.id ? 'opacity-100' : 'opacity-70'}>{t.icon}</span>
                {t.label}
                {t.count ? (
                  <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-bold ${
                    tab === t.id ? 'bg-white/20 text-white' : 'bg-accent text-white'
                  }`}>
                    {t.count}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-4 sm:p-6 lg:p-8 bg-paper overflow-y-auto">
          {activeTabContent()}
        </div>
      </div>
    </ModalShell>
  );
};

// Helper for the payments tab checkmark icon
const CheckCircle = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);
