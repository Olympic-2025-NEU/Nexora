// SPDX-License-Identifier: AGPL-3.0-only
import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  ConnectionStatus,
  MembershipRecord,
  MembershipRole,
  MembershipStatus,
  OrganizationRecord,
  OrganizationStatus,
  PartnerConnectionRecord,
  PartnerRecord,
  PartnerStatus,
} from "../domain/types";

type Db = PrismaClient | Prisma.TransactionClient;

function mapOrg(row: {
  id: string;
  instanceId: string;
  code: string;
  name: string;
  timezone: string;
  status: string;
  version: number;
  contactEmail: string | null;
}): OrganizationRecord {
  return {
    id: row.id,
    instanceId: row.instanceId,
    code: row.code,
    name: row.name,
    timezone: row.timezone,
    status: row.status as OrganizationStatus,
    version: row.version,
    contactEmail: row.contactEmail,
  };
}

function mapMember(row: {
  id: string;
  organizationId: string;
  keycloakSub: string;
  displayName: string;
  email: string | null;
  role: string;
  status: string;
  version: number;
}): MembershipRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    keycloakSub: row.keycloakSub,
    displayName: row.displayName,
    email: row.email,
    role: row.role as MembershipRole,
    status: row.status as MembershipStatus,
    version: row.version,
  };
}

export function createSystemRepos(db: Db) {
  return {
    async getOrganization(): Promise<OrganizationRecord | null> {
      const row = await db.organization.findUnique({ where: { singletonSlot: 1 } });
      return row ? mapOrg(row) : null;
    },

    async updateOrganization(input: {
      expectedVersion: number;
      name?: string;
      contactEmail?: string | null;
      timezone?: string;
    }): Promise<OrganizationRecord | null> {
      const current = await db.organization.findUnique({ where: { singletonSlot: 1 } });
      if (!current) return null;
      if (current.version !== input.expectedVersion) return null;
      const updated = await db.organization.updateMany({
        where: { id: current.id, version: input.expectedVersion },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) return null;
      const row = await db.organization.findUniqueOrThrow({ where: { id: current.id } });
      return mapOrg(row);
    },

    async listMemberships(filters?: {
      role?: MembershipRole;
      status?: MembershipStatus;
    }): Promise<MembershipRecord[]> {
      const rows = await db.membership.findMany({
        where: {
          ...(filters?.role ? { role: filters.role } : {}),
          ...(filters?.status ? { status: filters.status } : {}),
        },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(mapMember);
    },

    async findMembershipById(id: string): Promise<MembershipRecord | null> {
      const row = await db.membership.findUnique({ where: { id } });
      return row ? mapMember(row) : null;
    },

    async findMembershipBySub(sub: string): Promise<MembershipRecord | null> {
      const row = await db.membership.findUnique({ where: { keycloakSub: sub } });
      return row ? mapMember(row) : null;
    },

    async countActiveAdministrators(): Promise<number> {
      return db.membership.count({
        where: { role: "administrator", status: "active" },
      });
    },

    async createMembership(input: {
      id: string;
      organizationId: string;
      keycloakSub: string;
      displayName: string;
      email?: string | null;
      role: MembershipRole;
      status: MembershipStatus;
    }): Promise<MembershipRecord> {
      const row = await db.membership.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          keycloakSub: input.keycloakSub,
          displayName: input.displayName,
          email: input.email ?? null,
          role: input.role,
          status: input.status,
          lastSyncedAt: new Date(),
        },
      });
      return mapMember(row);
    },

    async updateMembership(
      id: string,
      expectedVersion: number,
      patch: { role?: MembershipRole; status?: MembershipStatus },
    ): Promise<MembershipRecord | null> {
      const current = await db.membership.findUnique({ where: { id } });
      if (!current || current.version !== expectedVersion) return null;
      const updated = await db.membership.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...(patch.role !== undefined ? { role: patch.role } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          version: { increment: 1 },
          updatedAt: new Date(),
          lastSyncedAt: new Date(),
        },
      });
      if (updated.count !== 1) return null;
      const row = await db.membership.findUniqueOrThrow({ where: { id } });
      return mapMember(row);
    },

    async listPartners(): Promise<PartnerRecord[]> {
      const rows = await db.partner.findMany({
        include: { connection: { select: { status: true } } },
        orderBy: { code: "asc" },
      });
      return rows.map((row) => ({
        id: row.id,
        issuerInstanceId: row.issuerInstanceId,
        code: row.code,
        displayName: row.displayName,
        status: row.status as PartnerStatus,
        contactEmail: row.contactEmail,
        version: row.version,
        connectionStatus: (row.connection?.status as ConnectionStatus | undefined) ?? null,
      }));
    },

    async findPartnerById(id: string): Promise<PartnerRecord | null> {
      const row = await db.partner.findUnique({
        where: { id },
        include: { connection: { select: { status: true } } },
      });
      if (!row) return null;
      return {
        id: row.id,
        issuerInstanceId: row.issuerInstanceId,
        code: row.code,
        displayName: row.displayName,
        status: row.status as PartnerStatus,
        contactEmail: row.contactEmail,
        version: row.version,
        connectionStatus: (row.connection?.status as ConnectionStatus | undefined) ?? null,
      };
    },

    async createPartner(input: {
      id: string;
      issuerInstanceId: string;
      code: string;
      displayName: string;
      contactEmail?: string | null;
      createdBySub: string;
    }): Promise<PartnerRecord> {
      const row = await db.partner.create({
        data: {
          id: input.id,
          issuerInstanceId: input.issuerInstanceId,
          code: input.code,
          displayName: input.displayName,
          contactEmail: input.contactEmail ?? null,
          createdBySub: input.createdBySub,
          status: "active",
        },
      });
      return {
        id: row.id,
        issuerInstanceId: row.issuerInstanceId,
        code: row.code,
        displayName: row.displayName,
        status: row.status as PartnerStatus,
        contactEmail: row.contactEmail,
        version: row.version,
        connectionStatus: null,
      };
    },

    async updatePartner(
      id: string,
      expectedVersion: number,
      patch: {
        displayName?: string;
        status?: PartnerStatus;
        contactEmail?: string | null;
      },
    ): Promise<PartnerRecord | null> {
      const current = await db.partner.findUnique({ where: { id } });
      if (!current || current.version !== expectedVersion) return null;
      const updated = await db.partner.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.contactEmail !== undefined ? { contactEmail: patch.contactEmail } : {}),
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) return null;
      const row = await db.partner.findUniqueOrThrow({
        where: { id },
        include: { connection: { select: { status: true } } },
      });
      return {
        id: row.id,
        issuerInstanceId: row.issuerInstanceId,
        code: row.code,
        displayName: row.displayName,
        status: row.status as PartnerStatus,
        contactEmail: row.contactEmail,
        version: row.version,
        connectionStatus: (row.connection?.status as ConnectionStatus | undefined) ?? null,
      };
    },

    async findConnectionByPartnerId(partnerId: string): Promise<PartnerConnectionRecord | null> {
      const row = await db.partnerConnection.findUnique({ where: { partnerId } });
      if (!row) return null;
      return {
        id: row.id,
        partnerId: row.partnerId,
        endpointUrl: row.endpointUrl,
        outboundTokenUrl: row.outboundTokenUrl,
        outboundClientId: row.outboundClientId,
        outboundSecretRef: row.outboundSecretRef,
        outboundAudience: row.outboundAudience,
        inboundClientId: row.inboundClientId,
        allowedInboundScope: row.allowedInboundScope,
        status: row.status as ConnectionStatus,
        version: row.version,
        lastVerifiedAt: row.lastVerifiedAt,
        rotatedAt: row.rotatedAt,
      };
    },

    async upsertConnection(input: {
      id: string;
      partnerId: string;
      endpointUrl: string;
      outboundTokenUrl: string;
      outboundClientId: string;
      outboundSecretRef: string;
      outboundAudience: string;
      inboundClientId: string;
      allowedInboundScope: string;
      status: ConnectionStatus;
      rotatedAt?: Date | null;
    }): Promise<PartnerConnectionRecord> {
      const existing = await db.partnerConnection.findUnique({ where: { partnerId: input.partnerId } });
      const row = existing
        ? await db.partnerConnection.update({
            where: { partnerId: input.partnerId },
            data: {
              endpointUrl: input.endpointUrl,
              outboundTokenUrl: input.outboundTokenUrl,
              outboundClientId: input.outboundClientId,
              outboundSecretRef: input.outboundSecretRef,
              outboundAudience: input.outboundAudience,
              inboundClientId: input.inboundClientId,
              allowedInboundScope: input.allowedInboundScope,
              status: input.status,
              rotatedAt: input.rotatedAt ?? new Date(),
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          })
        : await db.partnerConnection.create({
            data: {
              id: input.id,
              partnerId: input.partnerId,
              endpointUrl: input.endpointUrl,
              outboundTokenUrl: input.outboundTokenUrl,
              outboundClientId: input.outboundClientId,
              outboundSecretRef: input.outboundSecretRef,
              outboundAudience: input.outboundAudience,
              inboundClientId: input.inboundClientId,
              allowedInboundScope: input.allowedInboundScope,
              status: input.status,
              rotatedAt: input.rotatedAt ?? null,
            },
          });
      return {
        id: row.id,
        partnerId: row.partnerId,
        endpointUrl: row.endpointUrl,
        outboundTokenUrl: row.outboundTokenUrl,
        outboundClientId: row.outboundClientId,
        outboundSecretRef: row.outboundSecretRef,
        outboundAudience: row.outboundAudience,
        inboundClientId: row.inboundClientId,
        allowedInboundScope: row.allowedInboundScope,
        status: row.status as ConnectionStatus,
        version: row.version,
        lastVerifiedAt: row.lastVerifiedAt,
        rotatedAt: row.rotatedAt,
      };
    },

    async findConnectionByInboundClientId(clientId: string) {
      const conn = await db.partnerConnection.findUnique({
        where: { inboundClientId: clientId },
        include: { partner: { select: { id: true, code: true, status: true } } },
      });
      if (!conn) return null;
      return {
        id: conn.id,
        partnerId: conn.partnerId,
        partnerCode: conn.partner.code,
        partnerStatus: conn.partner.status as PartnerStatus,
        inboundClientId: conn.inboundClientId,
        allowedInboundScope: conn.allowedInboundScope,
        status: conn.status as ConnectionStatus,
      };
    },
  };
}

export type SystemRepos = ReturnType<typeof createSystemRepos>;
