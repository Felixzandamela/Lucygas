import {
  CheckCircle2,
  Copy,
  Edit3,
  Mail,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import {
  inviteOrUpdateDepotMember,
  normalizeEmail,
  removeDepotMember,
} from '../services/depotService';
import {
  FIELD_LIMITS,
  FULL_ADMIN_PERMISSIONS,
  inferRoleFromPermissions,
  LEGACY_MEMBER_PERMISSIONS,
  MEMBER_ROLE_LABELS,
  normalizePermissions,
  PERMISSION_DEFINITIONS,
  ROLE_PRESET_PERMISSIONS,
  type Depot,
  type DepotMember,
  type MemberPermissions,
  type MemberRole,
} from '../types/gas';

interface UserManagementTabProps {
  depotId: string;
  depot: Depot | null;
  members: DepotMember[];
  currentUserUid: string;
  currentUserEmail: string;
  canManageUsers: boolean;
  availableDepots: Depot[];
  onSwitchDepot: (depotId: string) => void;
}

const PERMISSION_GROUPS: Array<
  'Operação e Vendas' | 'Estoque e Clientes' | 'Financeiro e Administração'
> = ['Operação e Vendas', 'Estoque e Clientes', 'Financeiro e Administração'];

const ASSIGNABLE_ROLES: { id: Exclude<MemberRole, 'custom'>; label: string }[] = [
  { id: 'seller', label: MEMBER_ROLE_LABELS.seller },
  { id: 'manager', label: MEMBER_ROLE_LABELS.manager },
  { id: 'inventory', label: MEMBER_ROLE_LABELS.inventory },
  { id: 'driver', label: MEMBER_ROLE_LABELS.driver },
  { id: 'admin', label: MEMBER_ROLE_LABELS.admin },
];

function summarizeGrantedModules(perms: MemberPermissions): string[] {
  const tags: string[] = [];
  if (perms.viewDashboard) tags.push('Painel');
  if (perms.createSales) tags.push('PDV');
  if (perms.viewSales || perms.manageDeliveries) tags.push('Vendas/Entregas');
  if (perms.viewInventory || perms.manageInventory) tags.push('Estoque');
  if (perms.viewCustomers || perms.manageCustomers) tags.push('Clientes');
  if (perms.viewFinance || perms.manageExpenses) tags.push('Financeiro');
  if (perms.manageSettings) tags.push('Configurações');
  if (perms.manageUsers) tags.push('Usuários');
  return tags;
}

export function UserManagementTab({
  depotId,
  depot,
  members,
  currentUserUid,
  currentUserEmail,
  canManageUsers,
  availableDepots,
  onSwitchDepot,
}: UserManagementTabProps) {
  const normalizedSelfEmail = normalizeEmail(currentUserEmail);
  const isDepotOwner = Boolean(depot && depot.ownerId === currentUserUid);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('seller');
  const [invitePerms, setInvitePerms] = useState<MemberPermissions>({
    ...ROLE_PRESET_PERMISSIONS.seller,
  });

  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<MemberRole>('seller');
  const [editPerms, setEditPerms] = useState<MemberPermissions>({
    ...ROLE_PRESET_PERMISSIONS.seller,
  });

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [confirmRemoveEmail, setConfirmRemoveEmail] = useState<string | null>(null);

  const ownerEmail = useMemo(() => {
    const first = normalizeEmail(depot?.memberEmails?.[0]);
    if (first) return first;
    return isDepotOwner ? normalizedSelfEmail : '';
  }, [depot?.memberEmails, isDepotOwner, normalizedSelfEmail]);

  const unifiedMembers = useMemo(() => {
    const emailSet = new Set<string>();
    const orderedEmails: string[] = [];

    const addEmail = (raw?: string | null) => {
      const clean = normalizeEmail(raw);
      if (clean && !emailSet.has(clean)) {
        emailSet.add(clean);
        orderedEmails.push(clean);
      }
    };

    if (ownerEmail) addEmail(ownerEmail);
    for (const e of depot?.memberEmails ?? []) addEmail(e);
    for (const m of members) addEmail(m.email);
    if (orderedEmails.length === 0 && normalizedSelfEmail) addEmail(normalizedSelfEmail);

    const docByEmail = new Map<string, DepotMember>();
    for (const m of members) {
      const clean = normalizeEmail(m.email);
      if (clean) docByEmail.set(clean, m);
    }

    return orderedEmails.map((email) => {
      const docItem = docByEmail.get(email);
      const isPrincipal = email === ownerEmail;
      const explicitMap = depot?.memberPermissions?.[email];
      const permissions = isPrincipal
        ? { ...FULL_ADMIN_PERMISSIONS }
        : explicitMap
          ? normalizePermissions(explicitMap, LEGACY_MEMBER_PERMISSIONS)
          : docItem?.permissions
            ? normalizePermissions(docItem.permissions, LEGACY_MEMBER_PERMISSIONS)
            : { ...LEGACY_MEMBER_PERMISSIONS };

      const role: MemberRole = isPrincipal
        ? 'admin'
        : docItem?.role || inferRoleFromPermissions(permissions);

      const status = isPrincipal ? 'active' : docItem?.status || 'active';

      return {
        email,
        displayName: docItem?.displayName || '',
        role,
        permissions,
        status,
        isPrincipal,
        isSelf: email === normalizedSelfEmail,
      };
    });
  }, [depot?.memberEmails, depot?.memberPermissions, members, ownerEmail, normalizedSelfEmail]);

  const selfEntry = unifiedMembers.find((m) => m.email === normalizedSelfEmail);

  const handleSelectInvitePreset = (roleId: MemberRole) => {
    setInviteRole(roleId);
    if (roleId !== 'custom') {
      setInvitePerms({ ...ROLE_PRESET_PERMISSIONS[roleId] });
    }
  };

  const handleToggleInvitePerm = (key: keyof MemberPermissions) => {
    setInvitePerms((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      setInviteRole(inferRoleFromPermissions(next));
      return next;
    });
  };

  const handleInviteSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!depot || !canManageUsers) return;
    setErrorMsg(null);
    setNotice(null);

    const candidate = normalizeEmail(inviteEmail);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) || candidate.length > FIELD_LIMITS.EMAIL) {
      setErrorMsg('Informe um endereço de e-mail Google válido.');
      return;
    }
    const cleanName = inviteName.trim();
    if (cleanName.length > FIELD_LIMITS.CUSTOMER_NAME) {
      setErrorMsg(`O nome do colaborador deve ter no máximo ${FIELD_LIMITS.CUSTOMER_NAME} caracteres.`);
      return;
    }
    if (!Object.values(invitePerms).some(Boolean)) {
      setErrorMsg('Selecione pelo menos uma permissão de acesso para o colaborador.');
      return;
    }
    if (
      !unifiedMembers.some((m) => m.email === candidate) &&
      unifiedMembers.length >= FIELD_LIMITS.MAX_MEMBER_EMAILS
    ) {
      setErrorMsg(`Limite máximo de ${FIELD_LIMITS.MAX_MEMBER_EMAILS} usuários atingido.`);
      return;
    }

    setSaving(true);
    try {
      await inviteOrUpdateDepotMember({
        depotId,
        depot,
        actorEmail: normalizedSelfEmail,
        email: candidate,
        displayName: cleanName,
        role: inviteRole,
        permissions: invitePerms,
        existingMembers: members,
      });
      setInviteEmail('');
      setInviteName('');
      setInviteRole('seller');
      setInvitePerms({ ...ROLE_PRESET_PERMISSIONS.seller });
      setNotice(
        `Convite salvo para ${candidate} com perfil "${MEMBER_ROLE_LABELS[inviteRole]}". Assim que entrar com essa conta Google, os dados compartilhados e permissões serão carregados automaticamente.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível salvar o convite.');
    } finally {
      setSaving(false);
    }
  };

  const startEditingMember = (entry: (typeof unifiedMembers)[number]) => {
    setEditingEmail(entry.email);
    setEditName(entry.displayName);
    setEditRole(entry.role);
    setEditPerms({ ...entry.permissions });
    setErrorMsg(null);
    setNotice(null);
  };

  const handleSelectEditPreset = (roleId: MemberRole) => {
    setEditRole(roleId);
    if (roleId !== 'custom') {
      setEditPerms({ ...ROLE_PRESET_PERMISSIONS[roleId] });
    }
  };

  const handleToggleEditPerm = (key: keyof MemberPermissions) => {
    setEditPerms((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      setEditRole(inferRoleFromPermissions(next));
      return next;
    });
  };

  const handleSaveEditMember = async () => {
    if (!depot || !canManageUsers || !editingEmail) return;
    setErrorMsg(null);
    setNotice(null);

    const cleanName = editName.trim();
    if (cleanName.length > FIELD_LIMITS.CUSTOMER_NAME) {
      setErrorMsg(`O nome do colaborador deve ter no máximo ${FIELD_LIMITS.CUSTOMER_NAME} caracteres.`);
      return;
    }
    if (!Object.values(editPerms).some(Boolean)) {
      setErrorMsg('Selecione pelo menos uma permissão de acesso para o colaborador.');
      return;
    }

    setSaving(true);
    try {
      await inviteOrUpdateDepotMember({
        depotId,
        depot,
        actorEmail: normalizedSelfEmail,
        email: editingEmail,
        displayName: cleanName,
        role: editRole,
        permissions: editPerms,
        existingMembers: members,
      });
      setNotice(`Permissões de ${editingEmail} atualizadas em tempo real.`);
      setEditingEmail(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível atualizar as permissões.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!depot || !canManageUsers || !confirmRemoveEmail) return;
    setErrorMsg(null);
    setNotice(null);
    setSaving(true);
    try {
      await removeDepotMember({
        depotId,
        depot,
        actorEmail: normalizedSelfEmail,
        emailToRemove: confirmRemoveEmail,
        existingMembers: members,
      });
      setNotice(`Acesso de ${confirmRemoveEmail} revogado com sucesso.`);
      setConfirmRemoveEmail(null);
      if (editingEmail === confirmRemoveEmail) {
        setEditingEmail(null);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível remover o colaborador.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopySelfEmail = async () => {
    if (!normalizedSelfEmail || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(normalizedSelfEmail);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const totalPermCount = Object.keys(FULL_ADMIN_PERMISSIONS).length;

  return (
    <div className="space-y-6">
      {/* Centralized Depot Header & Switcher */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="pb-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Users className="w-5 h-5 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Gestão de Usuários e Permissões
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Convide colaboradores por e-mail Google e defina exatamente o que cada usuário pode acessar na base centralizada{' '}
                <strong className="text-slate-800 dark:text-slate-200">
                  {depot?.name || 'Distribuidora'}
                </strong>
              </p>
            </div>
          </div>

          <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 whitespace-nowrap">
            {unifiedMembers.length}/{FIELD_LIMITS.MAX_MEMBER_EMAILS} usuários
          </span>
        </div>

        {isDepotOwner && canManageUsers && availableDepots.length > 1 && (
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Distribuidora Ativa nesta Sessão
            </label>
            <select
              value={depotId}
              onChange={(e) => onSwitchDepot(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
            >
              {availableDepots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{' '}
                  {d.ownerId === currentUserUid
                    ? '(Sua conta principal)'
                    : '(Compartilhada com você)'}
                </option>
              ))}
            </select>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-lg p-3 text-xs text-red-800 dark:text-red-300"
          >
            {errorMsg}
          </div>
        )}

        {notice && (
          <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-lg p-3 flex items-start gap-2 text-xs text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
            <span>{notice}</span>
          </div>
        )}

        {!canManageUsers && (
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <Shield className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
                <span>
                  Você está acessando a base compartilhada como{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {selfEntry ? MEMBER_ROLE_LABELS[selfEntry.role] : 'Colaborador'}
                  </strong>
                  . Apenas administradores podem convidar ou alterar permissões.
                </span>
              </div>
            </div>
            {selfEntry && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                {PERMISSION_DEFINITIONS.map((def) => {
                  const allowed = selfEntry.permissions[def.key];
                  return (
                    <div
                      key={def.key}
                      className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                        allowed
                          ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      <span className="truncate font-medium">{def.label}</span>
                      <span className="font-mono text-[10px] shrink-0">
                        {allowed ? 'Permitido' : 'Restrito'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Invite New Collaborator Form (Admins only) */}
      {canManageUsers && (
        <form
          noValidate
          onSubmit={handleInviteSubmit}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5"
        >
          <div className="pb-4 border-b border-slate-100 dark:border-slate-800 flex items-start gap-2.5">
            <UserPlus className="w-5 h-5 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Convidar Novo Colaborador
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Informe o e-mail Google do colaborador, escolha um perfil ou personalize cada permissão
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                E-mail Google *
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  maxLength={FIELD_LIMITS.EMAIL}
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colaborador@gmail.com"
                  className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Nome / Cargo (Opcional)
              </label>
              <input
                type="text"
                maxLength={FIELD_LIMITS.CUSTOMER_NAME}
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Ex: Maria (Caixa)"
                className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-orange-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Perfil de Acesso
              </label>
              <select
                value={inviteRole}
                onChange={(e) => handleSelectInvitePreset(e.target.value as MemberRole)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
                {inviteRole === 'custom' && (
                  <option value="custom">{MEMBER_ROLE_LABELS.custom}</option>
                )}
              </select>
            </div>
          </div>

          {/* Granular Permissions Matrix */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Permissões Específicas do Convite
              </span>
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                {Object.values(invitePerms).filter(Boolean).length}/{totalPermCount} ativas
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {PERMISSION_GROUPS.map((group) => (
                <div
                  key={group}
                  className="border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 bg-slate-50/60 dark:bg-slate-950/50 space-y-2.5"
                >
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 pb-2 border-b border-slate-200/80 dark:border-slate-800">
                    {group}
                  </h4>
                  <div className="space-y-2">
                    {PERMISSION_DEFINITIONS.filter((d) => d.group === group).map((def) => (
                      <label
                        key={def.key}
                        className="flex items-start gap-2.5 cursor-pointer group"
                      >
                        <input
                          type="checkbox"
                          checked={invitePerms[def.key]}
                          onChange={() => handleToggleInvitePerm(def.key)}
                          className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-orange-600 focus:ring-orange-600 shrink-0"
                        />
                        <div className="min-w-0">
                          <span className="block text-xs font-medium text-slate-900 dark:text-slate-100 group-hover:text-orange-600 dark:group-hover:text-orange-400">
                            {def.label}
                          </span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                            {def.description}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
            {isDepotOwner && unifiedMembers.length <= 1 && normalizedSelfEmail ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  Sua conta atual:{' '}
                  <strong className="font-mono text-slate-800 dark:text-slate-200">
                    {normalizedSelfEmail}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopySelfEmail()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copiedEmail ? 'Copiado!' : 'Copiar'}</span>
                </button>
              </div>
            ) : (
              <span />
            )}

            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-xs sm:text-sm font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 disabled:opacity-50 inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4 shrink-0" />
              <span>{saving ? 'Salvando convite...' : 'Convidar e Aplicar Permissões'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Team Members & Active Permissions List */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="pb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Usuários com Acesso à Distribuidora
            </h3>
          </div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          {unifiedMembers.map((entry) => {
            const isEditingThis = editingEmail === entry.email;
            const grantedCount = Object.values(entry.permissions).filter(Boolean).length;
            const moduleTags = summarizeGrantedModules(entry.permissions);

            return (
              <div
                key={entry.email}
                className="bg-white dark:bg-slate-950/60 p-4 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {entry.displayName || entry.email.split('@')[0]}
                      </span>
                      {entry.isPrincipal ? (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-900/60">
                          Administrador Principal
                        </span>
                      ) : entry.status === 'invited' ? (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60">
                          Convite Pendente
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60">
                          Ativo
                        </span>
                      )}
                      {entry.isSelf && (
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          (Você)
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono break-all">{entry.email}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {MEMBER_ROLE_LABELS[entry.role]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">
                        {grantedCount}/{totalPermCount} permissões
                      </span>
                    </div>

                    {!entry.isPrincipal && moduleTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {moduleTags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {canManageUsers && !entry.isPrincipal && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          isEditingThis ? setEditingEmail(null) : startEditingMember(entry)
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>{isEditingThis ? 'Fechar Edição' : 'Editar Permissões'}</span>
                      </button>
                      {!entry.isSelf && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setConfirmRemoveEmail(entry.email)}
                          title={`Remover acesso de ${entry.email}`}
                          className="p-2 rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer shrink-0 disabled:opacity-40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Inline Permissions Editor */}
                {canManageUsers && isEditingThis && (
                  <div className="mt-3 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Nome / Identificação
                        </label>
                        <input
                          type="text"
                          maxLength={FIELD_LIMITS.CUSTOMER_NAME}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Nome do colaborador"
                          className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Perfil de Acesso
                        </label>
                        <select
                          value={editRole}
                          onChange={(e) => handleSelectEditPreset(e.target.value as MemberRole)}
                          className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-orange-600"
                        >
                          {ASSIGNABLE_ROLES.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label}
                            </option>
                          ))}
                          {editRole === 'custom' && (
                            <option value="custom">{MEMBER_ROLE_LABELS.custom}</option>
                          )}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {PERMISSION_GROUPS.map((group) => (
                        <div
                          key={group}
                          className="border border-slate-200 dark:border-slate-800 rounded-lg p-3 bg-slate-50/70 dark:bg-slate-900/60 space-y-2"
                        >
                          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {group}
                          </h4>
                          <div className="space-y-1.5">
                            {PERMISSION_DEFINITIONS.filter((d) => d.group === group).map((def) => (
                              <label
                                key={def.key}
                                className="flex items-start gap-2 cursor-pointer text-xs text-slate-800 dark:text-slate-200"
                              >
                                <input
                                  type="checkbox"
                                  checked={editPerms[def.key]}
                                  onChange={() => handleToggleEditPerm(def.key)}
                                  className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-orange-600 focus:ring-orange-600 shrink-0"
                                />
                                <span>{def.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingEmail(null)}
                        className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleSaveEditMember()}
                        className="px-4 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
                      >
                        {saving ? 'Salvando...' : 'Salvar Permissões'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Confirm Removal Modal */}
      {confirmRemoveEmail && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                Remover acesso de colaborador?
              </h3>
              <button
                type="button"
                onClick={() => setConfirmRemoveEmail(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              A conta <strong className="font-mono text-slate-900 dark:text-slate-100">{confirmRemoveEmail}</strong> perderá imediatamente o acesso aos dados compartilhados desta distribuidora.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRemoveEmail(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleConfirmRemove()}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Removendo...' : 'Confirmar Remoção'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
