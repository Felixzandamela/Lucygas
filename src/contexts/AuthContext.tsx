import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { auth, db, googleProvider } from '../lib/firebase';
import {
  ensureDepotInitialized,
  normalizeEmail,
  setDepotMemberEmailsContext,
} from '../services/depotService';
import type { Depot } from '../types/gas';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  depotReady: boolean;
  activeDepotId: string | null;
  availableDepots: Depot[];
  switchDepot: (depotId: string) => void;
  authError: string | null;
  signingIn: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [depotReady, setDepotReady] = useState(false);
  const [activeDepotId, setActiveDepotId] = useState<string | null>(null);
  const [availableDepots, setAvailableDepots] = useState<Depot[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const switchDepot = useCallback(
    (depotId: string) => {
      if (!user) return;
      const currentDepot = availableDepots.find((d) => d.id === activeDepotId);
      if (currentDepot && currentDepot.ownerId !== user.uid) return;
      setActiveDepotId(depotId);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`lucygas_active_depot_${user.uid}`, depotId);
      }
    },
    [user, availableDepots, activeDepotId]
  );

  useEffect(() => {
    let unsubSharedDepots: (() => void) | null = null;
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (unsubSharedDepots) {
        unsubSharedDepots();
        unsubSharedDepots = null;
      }

      setUser(currentUser);
      setAuthReady(true);

      if (currentUser) {
        setDepotReady(false);
        setAuthError(null);
        try {
          const result = await ensureDepotInitialized(
            currentUser.uid,
            currentUser.displayName,
            currentUser.email
          );
          if (cancelled) return;

          setAvailableDepots(result.availableDepots);
          setActiveDepotId(result.activeDepotId);
          setDepotReady(true);

          const userEmail = normalizeEmail(currentUser.email);
          if (userEmail) {
            unsubSharedDepots = onSnapshot(
              query(collection(db, 'depots'), where('memberEmails', 'array-contains', userEmail)),
              (snap) => {
                const list = snap.docs.map((d) => {
                  const data = {
                    id: d.id,
                    ...(d.data({ serverTimestamps: 'estimate' }) as Omit<Depot, 'id'>),
                  };
                  setDepotMemberEmailsContext(d.id, data.memberEmails);
                  return data;
                });
                if (list.length === 0) return;

                setAvailableDepots(list);

                const savedChoice =
                  typeof window !== 'undefined'
                    ? window.localStorage.getItem(`lucygas_active_depot_${currentUser.uid}`)
                    : null;

                setActiveDepotId((prev) => {
                  if (savedChoice && list.some((d) => d.id === savedChoice)) {
                    return savedChoice;
                  }
                  const shared = list.find((d) => d.ownerId !== currentUser.uid);
                  if (shared && (!prev || prev === currentUser.uid)) {
                    return shared.id;
                  }
                  if (prev && list.some((d) => d.id === prev)) {
                    return prev;
                  }
                  return shared?.id ?? list[0].id;
                });
              },
              () => {
                // Keep initial depot resolution on transient listener error
              }
            );
          }
        } catch (err) {
          if (cancelled) return;
          setAuthError(
            err instanceof Error
              ? err.message
              : 'Falha ao inicializar os dados da distribuidora.'
          );
          setDepotReady(false);
        }
      } else {
        setActiveDepotId(null);
        setAvailableDepots([]);
        setDepotReady(false);
      }
    });

    return () => {
      cancelled = true;
      if (unsubSharedDepots) unsubSharedDepots();
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      const currentHost =
        typeof window !== 'undefined' ? window.location.hostname : '';

      if (code === 'auth/unauthorized-domain') {
        setAuthError(
          `O domínio "${currentHost}" não está autorizado no Firebase Authentication. Adicione-o em Authentication > Configurações > Domínios autorizados no Console do Firebase.`
        );
      } else if (code === 'auth/popup-blocked') {
        setAuthError(
          'O pop-up de login foi bloqueado pelo navegador. Permita pop-ups para este site e tente novamente.'
        );
      } else if (code === 'auth/popup-closed-by-user') {
        setAuthError(
          'A janela de login foi fechada antes de concluir a autenticação.'
        );
      } else if (code === 'auth/operation-not-allowed') {
        setAuthError(
          'O provedor de login Google não está ativado no Firebase Authentication deste projeto.'
        );
      } else if (code === 'auth/network-request-failed') {
        setAuthError(
          'Falha de conexão ao tentar autenticar com o Google. Verifique sua internet e tente novamente.'
        );
      } else {
        setAuthError(
          err instanceof Error
            ? 'Não foi possível concluir o login com o Google. Tente novamente.'
            : 'Erro inesperado ao autenticar.'
        );
      }
    } finally {
      setSigningIn(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        depotReady,
        activeDepotId,
        availableDepots,
        switchDepot,
        authError,
        signingIn,
        signInWithGoogle,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
