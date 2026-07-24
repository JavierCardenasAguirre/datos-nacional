'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { Activity, UserPlus, Eye, EyeOff, LogIn, Loader2, CheckCircle } from 'lucide-react';
import Link from 'next/link';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPw) {
      setError('Las contraseñas no coinciden');
      return;
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    setLoading(true);
    const result = await register(email, password, name);
    setLoading(false);
    if (result.success) {
      if (result.pending) {
        setPendingApproval(true);
      } else {
        router.push('/');
      }
    } else {
      setError(result.error ?? 'Error al registrar');
    }
  }, [name, email, password, confirmPw, register, router]);

  if (pendingApproval) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="relative z-10 w-full max-w-md text-center">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <h2 className="text-white text-xl font-bold mb-2">Registro Exitoso</h2>
          <p className="text-gray-400 text-sm mb-6">
            Tu cuenta ha sido creada exitosamente. El administrador debe aprobar tu acceso antes de que puedas iniciar sesión.
          </p>
          <Link href="/login"
            className="inline-flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-2.5 rounded-lg font-semibold text-sm transition-all">
            <LogIn className="w-4 h-4" /> IR A INICIAR SESIÓN
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-red-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <Activity className="w-10 h-10 text-cyan-400" />
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              <span className="text-white">DATACORE</span>{' '}
              <span className="text-cyan-400">INTEL</span>
            </h1>
          </div>
        </div>

        <div className="bg-slate-800/80 border border-slate-600/30 rounded-xl p-6 shadow-xl">
          <h2 className="text-white text-lg font-bold mb-1">Crear Cuenta</h2>
          <p className="text-gray-400 text-sm mb-6">El primer usuario será administrador. Los demás requieren aprobación.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-slate-300 text-xs font-semibold block mb-1">Nombre Completo</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} required
                className="w-full bg-slate-900/80 border border-slate-600/50 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                placeholder="Tu nombre" />
            </div>
            <div>
              <label className="text-slate-300 text-xs font-semibold block mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full bg-slate-900/80 border border-slate-600/50 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                placeholder="tu@email.com" />
            </div>
            <div>
              <label className="text-slate-300 text-xs font-semibold block mb-1">Contraseña</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                  className="w-full bg-slate-900/80 border border-slate-600/50 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors pr-10"
                  placeholder="Mínimo 6 caracteres" />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-cyan-400">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-slate-300 text-xs font-semibold block mb-1">Confirmar Contraseña</label>
              <input type={showPw ? 'text' : 'password'} value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required
                className="w-full bg-slate-900/80 border border-slate-600/50 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                placeholder="Repite la contraseña" />
            </div>

            {error && <div className="bg-red-900/30 border border-red-800/50 text-red-400 text-xs rounded-lg px-3 py-2">{error}</div>}

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white py-2.5 rounded-lg font-semibold text-sm transition-all disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {loading ? 'REGISTRANDO...' : 'CREAR CUENTA'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-600/30 text-center">
            <p className="text-gray-500 text-xs">
              ¿Ya tienes cuenta?{' '}
              <Link href="/login" className="text-cyan-400 hover:text-cyan-300 font-semibold">Inicia sesión</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
