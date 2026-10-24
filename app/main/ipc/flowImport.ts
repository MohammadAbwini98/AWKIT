/**
 * The `flows:import` authorization contract (Phase N, N6.9 / VA-11). Electron-free so
 * `verify:flow-import-authorization` exercises exactly what the handler runs.
 *
 *  - Entry: `WORKFLOW_CREATE`, as before. A new id imports as a create.
 *  - Overwrite: importing over an EXISTING flow additionally needs `WORKFLOW_EDIT`. The check is made
 *    by the flow store inside its critical section (lane and cross-process lock), at the moment of
 *    decision, before anything is read, quarantined, invalidated or written; it is never cached from
 *    the entry check, so a permission revoked while the import waited is honored. A denial or timeout
 *    is the typed `ProfileImportOverwriteError` (`FLOW_IMPORT_OVERWRITE_FORBIDDEN`).
 */
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { ProfileImportRequest } from "@src/storage/ProfileStore";

export interface FlowImportPermissions {
  /** Throws unless the sender holds `WORKFLOW_CREATE`. */
  assertCreate(): Promise<unknown>;
  /** Throws unless the sender holds `WORKFLOW_EDIT` NOW (audited on denial). */
  assertEdit(): Promise<unknown>;
}

export async function importFlowAuthorized(
  store: { import(profile: FlowProfile, request?: ProfileImportRequest): Promise<FlowProfile> },
  profile: FlowProfile,
  permissions: FlowImportPermissions
): Promise<FlowProfile> {
  await permissions.assertCreate();
  return store.import(profile, {
    authorizeOverwrite: async () => {
      try {
        await permissions.assertEdit();
        return true;
      } catch {
        return false;
      }
    }
  });
}
