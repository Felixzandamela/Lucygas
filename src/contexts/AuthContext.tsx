import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { auth, googleProvider } from '../lib/firebase';
import { ensureDepotInitialized } from '../services/depotService';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  depotReady: boolean;
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
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);

      if (currentUser) {
        setDepotReady(false);
        setAuthError(null);
        try {
          await ensureDepotInitialized(currentUser.uid, currentUser.displayName);
          setDepotReady(true);
        } catch (err) {
          setAuthError(
            err instanceof Error
              ? err.message
              : 'Falha ao inicializar os dados da distribuidora.'
          );
          setDepotReady(false);
        }
      } else {
        setDepotReady(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? 'Não foi possível concluir o login com o Google. Tente novamente.'
          : 'Erro inesperado ao autenticar.'
      );
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
