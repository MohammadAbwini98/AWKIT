/**
 * SecurityKernel — thin composition root for the security subsystem. Opens the store, wires the
 * provider registry (Local active, Active Directory disabled), the session manager, and the
 * authentication service, and exposes the boot state the renderer's gate needs. UI-agnostic and
 * Electron-agnostic: the main process supplies the DB path + a DPAPI-backed ColumnCrypto; tsx verifiers
 * supply a temp path + a passthrough crypto.
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §7, §8.
 */
import type { ColumnCrypto } from "@src/security/crypto/ColumnCrypto";
import { SecurityStore } from "@src/security/store/SecurityStore";
import { AuthenticationService, type LockoutPolicy } from "@src/security/auth/AuthenticationService";
import { ActiveDirectoryProvider, type AuthenticationProvider } from "@src/security/auth/AuthenticationProvider";
import { LocalVirtualUserProvider } from "@src/security/auth/LocalVirtualUserProvider";
import { DEFAULT_SESSION_POLICY, SessionManager, type SessionPolicy } from "@src/security/session/SessionManager";
import { AuthorizationService } from "@src/security/authz/AuthorizationService";
import { UserAdminService } from "@src/security/admin/UserAdminService";
import type { ProviderId } from "@src/security/auth/AuthTypes";

export interface BootState {
  provisioned: boolean;
  /** Idle timeout (ms) so the renderer can lock proactively in step with the server-side session sweep. */
  idleTimeoutMs: number;
}

export interface SecurityKernelOptions {
  sessionPolicy?: SessionPolicy;
  lockout?: LockoutPolicy;
  now?: () => number;
  /** Test/dev override for the sensitive-op re-auth window (ms); production uses the 5-minute default. */
  reauthWindowMs?: number;
}

export class SecurityKernel {
  private constructor(
    readonly store: SecurityStore,
    readonly auth: AuthenticationService,
    readonly authz: AuthorizationService,
    readonly userAdmin: UserAdminService,
    private readonly sessions: SessionManager
  ) {}

  static async open(dbPath: string, crypto: ColumnCrypto, options: SecurityKernelOptions = {}): Promise<SecurityKernel> {
    const store = await SecurityStore.open(dbPath, crypto);
    const providers = new Map<ProviderId, AuthenticationProvider>();
    providers.set("local", new LocalVirtualUserProvider(store));
    providers.set("activeDirectory", new ActiveDirectoryProvider());

    const sessions = new SessionManager(store, options.sessionPolicy ?? DEFAULT_SESSION_POLICY, options.now);
    const auth = new AuthenticationService({ store, providers, sessions, lockout: options.lockout, now: options.now });
    const authz = new AuthorizationService(store, sessions, { reauthWindowMs: options.reauthWindowMs });
    const userAdmin = new UserAdminService(store, sessions, authz, options.now);
    return new SecurityKernel(store, auth, authz, userAdmin, sessions);
  }

  /** State the renderer's SecurityGate needs on boot: first-run vs login, and the idle-lock window. */
  getBootState(): BootState {
    return { provisioned: this.store.isProvisioned(), idleTimeoutMs: this.sessions.idleTimeoutMs };
  }

  async close(): Promise<void> {
    await this.store.close();
  }
}
