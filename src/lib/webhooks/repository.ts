import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WebhookRepository } from "./service";

const resultSchema = z.object({
  outcome: z.enum(["applied", "unchanged", "duplicate", "ignored", "not_found"]),
});

export function createWebhookRepository(): WebhookRepository {
  const admin = createAdminClient();
  return {
    async processEvent(input) {
      const { data, error } = await admin.rpc("process_webhook_event", {
        p_provider: input.provider,
        p_event_id: input.eventId,
        p_event_type: input.eventType,
        p_payload: input.payload,
        p_provider_document_id: input.providerDocumentId ?? null,
        p_status: input.status ?? null,
        p_access_key: input.accessKey ?? null,
        p_authorization_number: input.authorizationNumber ?? null,
        p_authorized_at: input.authorizedAt ?? null,
        p_rejection_reason: input.rejectionReason ?? null,
      });
      if (error) throw new Error(`process_webhook_event: ${error.message}`);
      return resultSchema.parse(data).outcome;
    },
  };
}
