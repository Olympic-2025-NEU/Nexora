// SPDX-License-Identifier: AGPL-3.0-only
import type { OrganizationId } from "../kernel/id";

/** Bytes live in object storage. platform.attachment holds only metadata. */
export type StoredFile = {
  id: string;
  organizationId: OrganizationId;
  fileName: string;
  mediaType: string;
  byteSize: number;
};

export type FileStore = {
  put(input: {
    organizationId: OrganizationId;
    fileName: string;
    mediaType: string;
    body: Uint8Array;
  }): Promise<StoredFile>;
};
