
import React, { useState, useRef, useEffect } from 'react';
import { Bell, Menu, Search, Settings, CheckCircle, AlertTriangle, Package, Clock, Info, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { User, UserRole } from '@nit-wms/shared/types';
import { useAppStore } from '@/store/useAppStore';
import { formatRelativeTime } from '@nit-wms/shared/formatters';

interface HeaderProps {
  toggleSidebar: () => void;
  user: User;
  role: UserRole;
}

const notificationIcon = (type: string) => {
  switch (type) {
    case 'approval_request': return <Clock size={16} className="text-amber-400" />;
    case 'approval_result': return <CheckCircle size={16} className="text-emerald-400" />;
    case 'sla_warning': return <AlertTriangle size={16} className="text-amber-400" />;
    case 'sla_breach': return <AlertTriangle size={16} className="text-red-400" />;
    case 'stock_alert': return <Package size={16} className="text-red-400" />;
    case 'status_change': return <Info size={16} className="text-blue-400" />;
    default: return <Info size={16} className="text-gray-400" />;
  }
};

export const Header: React.FC<HeaderProps> = ({ toggleSidebar, user, role }) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useAppStore();

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleNotificationClick = (notification: { id: string; actionUrl?: string }) => {
    markAsRead(notification.id);
    if (notification.actionUrl) {
      navigate(notification.actionUrl);
      setShowNotifications(false);
    }
  };

  void role; // role available for future use

  return (
    <header className="h-16 md:h-20 flex items-center justify-between px-4 md:px-6 z-30 border-b border-white/10 bg-nesma-dark/80 backdrop-blur-md sticky top-0 shadow-lg">
      <div className="flex items-center gap-3 md:gap-4 w-full md:w-auto">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-xl hover:bg-white/10 text-white transition-colors border border-transparent hover:border-white/10 active:scale-95 transform transition-transform lg:hidden"
        >
          <Menu size={24} />
        </button>

        <span className="lg:hidden font-bold text-lg text-white tracking-wider">NESMA</span>

        {/* Desktop Search */}
        <div className="hidden md:flex items-center bg-white/5 border border-white/10 rounded-full px-4 py-2 w-64 lg:w-96 focus-within:bg-white/10 focus-within:border-nesma-secondary/50 transition-all focus-within:w-full focus-within:max-w-md group">
          <Search size={18} className="text-gray-400 group-focus-within:text-nesma-secondary transition-colors" />
          <input
            type="text"
            placeholder="Search assets, orders..."
            className="bg-transparent border-none outline-none text-sm w-full px-3 placeholder-gray-500 text-white"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 md:gap-6 pl-2">
        {/* Mobile Search Icon */}
        <button className="md:hidden p-2 text-gray-300 hover:text-white">
          <Search size={20} />
        </button>

        <div className="flex items-center gap-1 md:gap-2">
          {/* Notification Bell with Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative cursor-pointer p-2 rounded-full hover:bg-white/10 transition-colors text-gray-300 hover:text-white"
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[18px] h-[18px] bg-red-500 rounded-full border-2 border-nesma-dark flex items-center justify-center text-[10px] font-bold text-white animate-pulse">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* Notification Dropdown */}
            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 w-96 max-h-[480px] bg-[#0a1929]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50 animate-fade-in">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5">
                  <h3 className="text-sm font-bold text-white">Notifications</h3>
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllAsRead}
                        className="text-[10px] text-nesma-secondary hover:text-white transition-colors font-medium"
                      >
                        Mark all read
                      </button>
                    )}
                    <button
                      onClick={() => setShowNotifications(false)}
                      className="p-1 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Notification List */}
                <div className="overflow-y-auto max-h-[400px] custom-scrollbar">
                  {notifications.length === 0 ? (
                    <div className="py-12 text-center text-gray-500">
                      <Bell size={32} className="mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No notifications</p>
                    </div>
                  ) : (
                    notifications.map(n => (
                      <button
                        key={n.id}
                        onClick={() => handleNotificationClick(n)}
                        className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors flex gap-3 ${!n.read ? 'bg-nesma-primary/5' : ''}`}
                      >
                        <div className="mt-0.5 flex-shrink-0">
                          {notificationIcon(n.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium truncate ${!n.read ? 'text-white' : 'text-gray-300'}`}>
                              {n.title}
                            </span>
                            {!n.read && (
                              <span className="w-2 h-2 bg-nesma-secondary rounded-full flex-shrink-0"></span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                          <p className="text-[10px] text-gray-600 mt-1">{formatRelativeTime(n.createdAt)}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="relative cursor-pointer p-2 rounded-full hover:bg-white/10 transition-colors text-gray-300 hover:text-white hidden sm:block">
            <Settings size={20} />
          </div>
        </div>

        <div className="h-8 w-px bg-white/10 mx-1 md:mx-2 hidden sm:block"></div>

        <div className="flex items-center gap-3 pl-2 sm:pl-0 border-l border-white/10 sm:border-0">
          <div className="text-right hidden lg:block">
            <p className="text-sm font-bold text-white leading-tight">{user.name}</p>
            <p className="text-[10px] text-nesma-secondary font-medium tracking-wide uppercase mt-0.5">{user.role}</p>
          </div>
          <div className="h-9 w-9 md:h-10 md:w-10 rounded-full bg-gradient-to-br from-nesma-primary to-nesma-secondary p-[2px] cursor-pointer shadow-lg hover:shadow-nesma-secondary/20 transition-all hover:scale-105">
             <div className="h-full w-full rounded-full border-2 border-nesma-dark overflow-hidden bg-nesma-dark flex items-center justify-center">
                {user.avatar ? (
                  <img src={user.avatar} alt="User" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs font-bold text-nesma-secondary">
                    {user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                )}
             </div>
          </div>
        </div>
      </div>
    </header>
  );
};
