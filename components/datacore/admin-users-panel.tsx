'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { Users, CheckCircle, XCircle, Trash2, Clock, Shield, X, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface AppUser {
  id: number;
  email: string;
  name: string;
  role: string;
  status: string;
  created_at: string;
}

export default function AdminUsersPanel({ onClose }: { onClose: () => void }) {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch {
      toast.error('Error al cargar usuarios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleAction = useCallback(async (userId: number, action: 'approve' | 'reject') => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action }),
      });
      if (res.ok) {
        toast.success(action === 'approve' ? 'Usuario aprobado' : 'Usuario rechazado');
        loadUsers();
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Error');
      }
    } catch {
      toast.error('Error de conexión');
    }
  }, [loadUsers]);

  const handleDelete = useCallback(async (userId: number, userName: string) => {
    if (!confirm(`¿Eliminar usuario "${userName}"?`)) return;
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        toast.success('Usuario eliminado');
        loadUsers();
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Error');
      }
    } catch {
      toast.error('Error de conexión');
    }
  }, [loadUsers]);

  if (!isAdmin) return null;

  const pendingUsers = users.filter(u => u.status === 'pending');
  const approvedUsers = users.filter(u => u.status === 'approved');
  const rejectedUsers = users.filter(u => u.status === 'rejected');

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
      <div className="bg-[#111827] border border-cyan-900/30 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-cyan-400" />
            <h2 className="text-white font-bold text-lg">Administrar Usuarios</h2>
            {pendingUsers.length > 0 && (
              <span className="bg-yellow-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                {pendingUsers.length} pendiente{pendingUsers.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadUsers} className="text-gray-400 hover:text-cyan-400 p-1">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 space-y-4">
            {/* Pending */}
            {pendingUsers.length > 0 && (
              <div>
                <h3 className="text-yellow-400 text-xs font-bold tracking-wider mb-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> PENDIENTES DE APROBACIÓN
                </h3>
                <div className="space-y-2">
                  {pendingUsers.map(u => (
                    <UserRow key={u.id} user={u} onAction={handleAction} onDelete={handleDelete} />
                  ))}
                </div>
              </div>
            )}

            {/* Approved */}
            {approvedUsers.length > 0 && (
              <div>
                <h3 className="text-green-400 text-xs font-bold tracking-wider mb-2 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> USUARIOS APROBADOS
                </h3>
                <div className="space-y-2">
                  {approvedUsers.map(u => (
                    <UserRow key={u.id} user={u} onAction={handleAction} onDelete={handleDelete} />
                  ))}
                </div>
              </div>
            )}

            {/* Rejected */}
            {rejectedUsers.length > 0 && (
              <div>
                <h3 className="text-red-400 text-xs font-bold tracking-wider mb-2 flex items-center gap-1">
                  <XCircle className="w-3 h-3" /> USUARIOS RECHAZADOS
                </h3>
                <div className="space-y-2">
                  {rejectedUsers.map(u => (
                    <UserRow key={u.id} user={u} onAction={handleAction} onDelete={handleDelete} />
                  ))}
                </div>
              </div>
            )}

            {users.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-8">No hay usuarios registrados</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function UserRow({ user, onAction, onDelete }: {
  user: AppUser;
  onAction: (id: number, action: 'approve' | 'reject') => void;
  onDelete: (id: number, name: string) => void;
}) {
  const isAdmin = user.role === 'admin';
  return (
    <div className="bg-slate-800 border border-cyan-900/20 rounded-lg p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-semibold truncate">{user.name}</span>
          {isAdmin && (
            <span className="bg-cyan-600/30 text-cyan-300 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
              <Shield className="w-2.5 h-2.5" /> ADMIN
            </span>
          )}
        </div>
        <p className="text-gray-500 text-xs truncate">{user.email}</p>
        <p className="text-gray-600 text-[10px]">
          Registrado: {new Date(user.created_at).toLocaleDateString('es-CO')}
        </p>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {user.status === 'pending' && (
          <>
            <button onClick={() => onAction(user.id, 'approve')}
              className="bg-green-800/50 hover:bg-green-700/60 text-green-400 p-1.5 rounded-md transition-colors" title="Aprobar">
              <CheckCircle className="w-4 h-4" />
            </button>
            <button onClick={() => onAction(user.id, 'reject')}
              className="bg-red-800/50 hover:bg-red-700/60 text-red-400 p-1.5 rounded-md transition-colors" title="Rechazar">
              <XCircle className="w-4 h-4" />
            </button>
          </>
        )}
        {user.status === 'rejected' && (
          <button onClick={() => onAction(user.id, 'approve')}
            className="bg-green-800/50 hover:bg-green-700/60 text-green-400 p-1.5 rounded-md transition-colors" title="Aprobar">
            <CheckCircle className="w-4 h-4" />
          </button>
        )}
        {user.status === 'approved' && !isAdmin && (
          <button onClick={() => onAction(user.id, 'reject')}
            className="bg-orange-800/50 hover:bg-orange-700/60 text-orange-400 p-1.5 rounded-md transition-colors" title="Revocar acceso">
            <XCircle className="w-4 h-4" />
          </button>
        )}
        {!isAdmin && (
          <button onClick={() => onDelete(user.id, user.name)}
            className="bg-red-900/30 hover:bg-red-800/40 text-red-500 p-1.5 rounded-md transition-colors" title="Eliminar">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
