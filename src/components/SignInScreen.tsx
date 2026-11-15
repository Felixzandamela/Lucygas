import { Flame, ShieldCheck, Truck, PackageCheck } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import depotPhoto from '../assets/images/gas_depot_logistics_1794631289908.jpg';

export function SignInScreen() {
  const { signInWithGoogle, signingIn, authError } = useAuth();
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col lg:flex-row">
      <div className="flex-1 flex flex-col justify-between p-8 sm:p-12 lg:p-16 max-w-2xl mx-auto lg:mx-0">
        <div>
          <div className="flex items-center gap-2.5 text-slate-900 dark:text-slate-100">
            <div className="w-9 h-9 rounded-lg bg-orange-600 text-white flex items-center justify-center shrink-0">
              <Flame className="w-5 h-5" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight whitespace-nowrap">
              Lucygas
            </span>
          </div>
        </div>

        <div className="my-12 space-y-8">
          <div className="space-y-4">
            <p className="text-sm font-medium text-orange-600 dark:text-orange-400">
              Gestão Operacional de GLP
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100 text-balance leading-tight">
              Controle completo de vendas, cascos e entregas da sua distribuidora.
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-lg">
              Registre pedidos de P8, P13, P20 e P45 no balcão ou delivery, acompanhe o giro entre botijões cheios e vazios e feche o caixa diário sem planilhas soltas.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="pt-4">
              <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-medium text-sm">
                <PackageCheck className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
                <span>Cheios e Vazios</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Baixa automática na troca ou venda de casco novo.
              </p>
            </div>
            <div className="pt-4">
              <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-medium text-sm">
                <Truck className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
                <span>Fila de Entregas</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Despacho por entregador com status em tempo real.
              </p>
            </div>
            <div className="pt-4">
              <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-medium text-sm">
                <ShieldCheck className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
                <span>Caixa e Fiado</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Controle de M-Pesa, e-Mola, dinheiro, cartão e saldo de clientes.
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={signingIn}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-semibold hover:bg-slate-800 dark:hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.8C6.2 7.2 8.9 5 12 5z"
                />
                <path
                  fill="#4285F4"
                  d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6l3.7 2.9c2.2-2 3.7-5 3.7-8.7z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.3 14.8c-.2-.8-.4-1.8-.4-2.8s.2-2 .4-2.8L1.6 6.4C.6 8.1 0 10 0 12s.6 3.9 1.6 5.6l3.7-2.8z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.1-6.7-5l-3.7 2.8C3.5 20.4 7.4 23 12 23z"
                />
              </svg>
              <span>{signingIn ? 'Conectando...' : 'Entrar com Google para Acessar'}</span>
            </button>

            {authError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400 font-medium">
                {authError}
              </p>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500">
          Lucygas · Dados sincronizados em nuvem com acesso privado por distribuidora
        </p>
      </div>

      <div className="lg:flex-1 relative min-h-[320px] lg:min-h-screen bg-slate-900 overflow-hidden">
        {!imgFailed ? (
          <img
            src={depotPhoto}
            alt="Pátio organizado de distribuidora de botijões de gás GLP"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-8 text-center">
            <Flame className="w-12 h-12 text-orange-500 mb-3" />
            <p className="font-display text-lg font-semibold text-white">Central de Distribuição GLP</p>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent" />
        <div className="absolute bottom-8 left-8 right-8 text-white">
          <p className="text-xs font-medium text-orange-300">Operação Diária</p>
          <p className="font-display text-xl font-semibold mt-1 max-w-md text-balance">
            Do balcão à entrega em domicílio, cada botijão rastreado em tempo real.
          </p>
        </div>
      </div>
    </div>
  );
}
