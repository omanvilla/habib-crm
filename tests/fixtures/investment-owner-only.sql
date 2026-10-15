-- ISOLATED TEST DATABASE ONLY. Exact live schema definitions captured read-only 2026-10-15.
-- No production rows/IDs/secrets. This fixture reproduces tables, constraints, triggers,
-- function privileges, permissive policies and views to test the additional investment
-- boundary against the real older branch behavior (including legacy investor flags).
-- Auth is the sole adapter: test.actor stands in for the verified JWT subject.
DO $$BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END$$;
DO $$BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END$$;
DO $$BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END$$;
CREATE SCHEMA auth;
CREATE SCHEMA crm_repair_private;
CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_user_meta_data jsonb DEFAULT '{}'::jsonb, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_user::text$$;
GRANT USAGE ON SCHEMA public,auth,crm_repair_private TO authenticated,service_role;
GRANT USAGE ON SCHEMA public,auth TO anon;
SET check_function_bodies=off;
CREATE FUNCTION public.test_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;


CREATE TABLE public."events"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid,
  "user_id" uuid,
  "client_id" uuid,
  "title" text NOT NULL,
  "type" text DEFAULT 'meeting'::text,
  "event_date" date NOT NULL,
  "event_time" time without time zone,
  "duration_minutes" integer DEFAULT 60,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE public."profiles"(
  "id" uuid NOT NULL,
  "company_id" uuid,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "role" text DEFAULT 'agent'::text NOT NULL,
  "commission_rate" numeric(5,2) DEFAULT 10.0,
  "avatar_url" text,
  "is_active" boolean DEFAULT true,
  "last_login_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE public."companies"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "license_number" text,
  "phone" text,
  "email" text,
  "logo_url" text,
  "default_company_commission" numeric(5,2) DEFAULT 2.5,
  "default_agent_commission" numeric(5,2) DEFAULT 10.0,
  "created_at" timestamp with time zone DEFAULT now(),
  "cr_number" text,
  "address" text,
  "gsheet_url" text,
  "gsheet_last_sync" timestamp with time zone
);

CREATE TABLE public."deals"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "client_id" uuid,
  "property_id" uuid,
  "agent_id" uuid,
  "stage" text DEFAULT 'new'::text NOT NULL,
  "deal_value" numeric(12,2),
  "deposit_amount" numeric(12,2),
  "closing_probability" integer DEFAULT 50,
  "expected_close_date" date,
  "bank_financing" text,
  "notes" text,
  "closed_at" timestamp with time zone,
  "company_commission" numeric(12,2),
  "agent_commission" numeric(12,2),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "commission_total" numeric(12,2),
  "company_share" numeric(12,2),
  "agent_share" numeric(12,2),
  "commission_status" text DEFAULT 'pending'::text,
  "broker_id" uuid,
  "broker_commission" numeric(12,2),
  "request_id" uuid,
  "viewing_id" uuid,
  "lost_reason_id" uuid,
  "lost_reason_note" text,
  "lost_from_stage" text,
  "lost_at" timestamp with time zone,
  "entry_mode" text DEFAULT 'legacy'::text NOT NULL,
  "commission_received_at" timestamp with time zone,
  "employee_commission_percent" numeric(5,2)
);

CREATE TABLE public."notifications"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "type" text,
  "is_read" boolean DEFAULT false,
  "link" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE public."expenses"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid,
  "user_id" uuid,
  "description" text NOT NULL,
  "category" text NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "expense_date" date NOT NULL,
  "payment_method" text,
  "notes" text,
  "archived" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE public."owners"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid,
  "added_by" uuid,
  "name" text NOT NULL,
  "phone" text NOT NULL,
  "email" text,
  "nationality" text,
  "id_number" text,
  "exclusive" boolean DEFAULT false,
  "terms" text,
  "address" text,
  "notes" text,
  "archived" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "last_contact" timestamp with time zone,
  "next_followup" date,
  "rating" text DEFAULT 'good'::text,
  "relationship_type" text DEFAULT 'owner'::text,
  "responsive" boolean DEFAULT true,
  "multiple_brokers" boolean DEFAULT false,
  "total_revenue" numeric(12,2) DEFAULT 0,
  "successful_deals" integer DEFAULT 0,
  "failed_deals" integer DEFAULT 0,
  "owner_type" text DEFAULT 'owner'::text,
  "commission_rate" numeric(5,2)
);

CREATE TABLE public."company_lead_routes"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "route_key" text NOT NULL,
  "label" text NOT NULL,
  "assigned_to" uuid,
  "whatsapp_number" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "meta_phone_number_id" text,
  "channel_type" text DEFAULT 'whatsapp'::text NOT NULL,
  "owner_only_inbox" boolean DEFAULT false NOT NULL,
  "meta_waba_id" text,
  "meta_login_configuration_id" text
);

CREATE TABLE public."deposits"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid,
  "deal_id" uuid,
  "client_id" uuid,
  "property_id" uuid,
  "amount" numeric(12,2) NOT NULL,
  "payment_method" text,
  "payment_date" date NOT NULL,
  "received_by" text,
  "refundable" text DEFAULT 'per_agreement'::text,
  "duration_days" integer DEFAULT 30,
  "expiry_date" date,
  "extension_days" integer DEFAULT 0,
  "status" text DEFAULT 'active'::text,
  "contract_url" text,
  "receipt_url" text,
  "legal_notes" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE public."viewings"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid,
  "client_id" uuid,
  "property_id" uuid,
  "agent_id" uuid,
  "viewing_date" date NOT NULL,
  "viewing_time" time without time zone,
  "duration_minutes" integer DEFAULT 60,
  "location" text,
  "status" text DEFAULT 'scheduled'::text,
  "attendance" text,
  "client_feedback" text,
  "rejection_reason" text,
  "liked" boolean,
  "next_step" text,
  "followup_date" date,
  "notes" text,
  "archived" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "created_by" uuid,
  "request_id" uuid,
  "appointment_id" uuid,
  "pipeline_outcome" text,
  "outcome_note" text,
  "created_via" text DEFAULT 'manual'::text NOT NULL,
  "source_whatsapp_message_id" uuid,
  "auto_confidence" numeric,
  "row_version" bigint DEFAULT 1 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE public."tasks"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid,
  "user_id" uuid,
  "client_id" uuid,
  "deal_id" uuid,
  "title" text NOT NULL,
  "notes" text,
  "due_date" date,
  "priority" text DEFAULT 'medium'::text,
  "done" boolean DEFAULT false,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "request_id" uuid,
  "viewing_id" uuid
);

CREATE TABLE public."clients"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "assigned_to" uuid,
  "name" text NOT NULL,
  "phone" text,
  "email" text,
  "client_type" text,
  "source" text,
  "preferred_area" text,
  "property_type" text,
  "budget_min" numeric(12,2),
  "budget_max" numeric(12,2),
  "status" text DEFAULT 'warm'::text,
  "notes" text,
  "last_contact_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "is_buyer" boolean DEFAULT false,
  "is_seller" boolean DEFAULT false,
  "is_investor" boolean DEFAULT false,
  "importance" integer,
  "readiness" integer,
  "tags" text[],
  "archived" boolean DEFAULT false,
  "archived_at" timestamp with time zone,
  "archived_by" uuid,
  "pipeline_stage" text DEFAULT 'new'::text,
  "payment_method" text,
  "purchase_timing" text,
  "purpose" text,
  "nationality" text,
  "country" text,
  "wilayat" text,
  "lead_score" integer DEFAULT 50,
  "lead_temperature" text DEFAULT 'warm'::text,
  "next_followup" date,
  "lead_route" text,
  "inbound_number" text,
  "phone_normalized" text,
  "human_contact_at" timestamp with time zone,
  "followup_suppressed" boolean DEFAULT false NOT NULL,
  "followup_suppressed_reason" text,
  "followup_suppressed_at" timestamp with time zone,
  "followup_suppressed_by" uuid,
  "last_ai_profile" jsonb,
  "last_ai_profile_at" timestamp with time zone,
  "instagram_participant_id" text
);

CREATE TABLE public."company_invites"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "email" text NOT NULL,
  "role" text DEFAULT 'agent'::text NOT NULL,
  "token" uuid DEFAULT gen_random_uuid() NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "created_by" uuid,
  "used_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
  "used_at" timestamp with time zone
);

CREATE TABLE public."property_marketing_events"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "channel" text NOT NULL,
  "event_type" text DEFAULT 'update'::text NOT NULL,
  "published_at" timestamp with time zone,
  "views" integer,
  "url" text,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "instagram_media_id" text,
  "auto_sync" boolean DEFAULT false NOT NULL,
  "sync_status" text DEFAULT 'manual'::text NOT NULL,
  "last_synced_at" timestamp with time zone,
  "sync_error" text,
  "reach" integer,
  "likes" integer,
  "comments" integer,
  "shares" integer,
  "saves" integer,
  "total_interactions" integer,
  "plays" integer,
  "watch_time_ms" bigint,
  "avg_watch_time_ms" bigint,
  "replays" integer,
  "insights_payload" jsonb,
  "link_key" text,
  "link_provider" text
);

CREATE TABLE public."whatsapp_conversations"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "client_id" uuid,
  "assigned_to" uuid,
  "route_key" text DEFAULT 'general'::text NOT NULL,
  "meta_phone_number_id" text NOT NULL,
  "inbound_number" text,
  "customer_wa_id" text NOT NULL,
  "customer_phone" text NOT NULL,
  "customer_name" text,
  "status" text DEFAULT 'open'::text NOT NULL,
  "last_message_at" timestamp with time zone,
  "last_inbound_at" timestamp with time zone,
  "last_outbound_at" timestamp with time zone,
  "unread_count" integer DEFAULT 0 NOT NULL,
  "ai_summary" text,
  "ai_last_extracted" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "human_handoff_required" boolean DEFAULT false NOT NULL,
  "handoff_reason" text,
  "handoff_updated_at" timestamp with time zone,
  "last_automation_action" jsonb,
  "last_message_seq" bigint DEFAULT 0 NOT NULL,
  "read_through_seq" bigint DEFAULT 0 NOT NULL
);

CREATE TABLE public."whatsapp_messages"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "client_id" uuid,
  "whatsapp_message_id" text NOT NULL,
  "direction" text NOT NULL,
  "message_type" text DEFAULT 'text'::text NOT NULL,
  "sender_wa_id" text,
  "recipient_wa_id" text,
  "body" text,
  "media_id" text,
  "reply_to_message_id" text,
  "message_timestamp" timestamp with time zone,
  "delivery_status" text,
  "raw_payload" jsonb,
  "ai_extracted" jsonb,
  "ai_processed_at" timestamp with time zone,
  "processing_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "request_id" uuid,
  "sent_by_user_id" uuid,
  "actor_type" text,
  "channel_source" text,
  "matched_property_id" uuid,
  "matched_marketing_event_id" uuid,
  "property_match_status" text,
  "property_link_key" text,
  "transcript" text,
  "transcription_status" text,
  "automation_result" jsonb,
  "property_image_analysis" jsonb,
  "ingestion_seq" bigint,
  "conversation_touched_at" timestamp with time zone
);

CREATE TABLE public."whatsapp_webhook_events"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid,
  "event_key" text NOT NULL,
  "meta_phone_number_id" text,
  "event_type" text DEFAULT 'unknown'::text NOT NULL,
  "payload" jsonb NOT NULL,
  "processed" boolean DEFAULT false NOT NULL,
  "processed_at" timestamp with time zone,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "next_retry_at" timestamp with time zone,
  "dead_letter" boolean DEFAULT false NOT NULL
);

CREATE TABLE public."whatsapp_message_requests"(
  "company_id" uuid NOT NULL,
  "message_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "relation" text DEFAULT 'created'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."client_request_events"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "source" text,
  "actor_id" uuid,
  "whatsapp_message_id" uuid,
  "before_data" jsonb,
  "after_data" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "stage" text,
  "notes" text,
  "occurred_at" timestamp with time zone,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."client_requests"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "request_type" text NOT NULL,
  "property_type" text,
  "property_types" text[] DEFAULT '{}'::text[] NOT NULL,
  "preferred_area" text,
  "preferred_areas" text[] DEFAULT '{}'::text[] NOT NULL,
  "wilayat" text,
  "budget_min" numeric,
  "budget_max" numeric,
  "payment_method" text,
  "purchase_timing" text,
  "purpose" text,
  "bedrooms_min" integer,
  "bathrooms_min" integer,
  "land_size_min" numeric,
  "land_size_max" numeric,
  "built_size_min" numeric,
  "built_size_max" numeric,
  "furnished" boolean,
  "status" text DEFAULT 'active'::text NOT NULL,
  "pipeline_stage" text DEFAULT 'new'::text NOT NULL,
  "priority" smallint DEFAULT 2 NOT NULL,
  "next_followup" date,
  "followup_note" text,
  "last_contact_at" timestamp with time zone,
  "source" text,
  "source_detail" text,
  "assigned_to" uuid,
  "route_key" text,
  "inbound_number" text,
  "subject_property_id" uuid,
  "created_via" text DEFAULT 'manual'::text NOT NULL,
  "origin_whatsapp_message_id" uuid,
  "ai_confidence" numeric,
  "needs_human_review" boolean DEFAULT false NOT NULL,
  "ai_extracted" jsonb,
  "lead_score" integer DEFAULT 20 NOT NULL,
  "lead_temperature" text DEFAULT 'cold'::text NOT NULL,
  "notes" text,
  "closed_reason" text,
  "closed_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "branch_key" text,
  "alternative_areas" text[] DEFAULT '{}'::text[] NOT NULL,
  "financing_readiness" text,
  "must_haves" text[] DEFAULT '{}'::text[] NOT NULL,
  "flexible_preferences" text[] DEFAULT '{}'::text[] NOT NULL,
  "decision_maker_status" text,
  "search_status" text DEFAULT 'unknown'::text NOT NULL,
  "next_action" text,
  "is_first_request" boolean,
  "first_human_response_at" timestamp with time zone,
  "first_mutual_dialogue_at" timestamp with time zone,
  "requirements_completed_at" timestamp with time zone,
  "qualified_at" timestamp with time zone,
  "first_match_sent_at" timestamp with time zone,
  "first_appointment_booked_at" timestamp with time zone,
  "first_appointment_confirmed_at" timestamp with time zone,
  "first_attended_at" timestamp with time zone,
  "serious_interest_at" timestamp with time zone,
  "opportunity_opened_at" timestamp with time zone,
  "negotiation_started_at" timestamp with time zone,
  "deposit_paid_at" timestamp with time zone,
  "contract_completed_at" timestamp with time zone,
  "closed_won_at" timestamp with time zone,
  "last_mutual_contact_at" timestamp with time zone,
  "missing_required_fields" text[] DEFAULT '{}'::text[] NOT NULL,
  "last_requirements_prompt_at" timestamp with time zone,
  "last_requirements_prompt_fields" text[] DEFAULT '{}'::text[] NOT NULL,
  "requirements_prompt_count" integer DEFAULT 0 NOT NULL,
  "manual_assigned_to" uuid
);

CREATE TABLE public."property_inquiries"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "assigned_to" uuid,
  "source" text DEFAULT 'other'::text NOT NULL,
  "source_detail" text,
  "status" text DEFAULT 'inquiry'::text NOT NULL,
  "first_inquiry_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_inquiry_at" timestamp with time zone DEFAULT now() NOT NULL,
  "inquiry_count" integer DEFAULT 1 NOT NULL,
  "rejection_reason" text,
  "rejection_notes" text,
  "last_message" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "next_followup" date,
  "followup_note" text,
  "last_contact_at" timestamp with time zone,
  "request_id" uuid,
  "campaign_name" text,
  "ad_name" text,
  "is_first_attraction" boolean DEFAULT false NOT NULL,
  "shown_by_agent" boolean DEFAULT false NOT NULL,
  "match_status" text,
  "match_notes" text,
  "client_response" text,
  "viewing_booked" boolean DEFAULT false NOT NULL,
  "viewing_completed" boolean DEFAULT false NOT NULL,
  "post_visit_interest" text,
  "outcome" text,
  "has_inbound_inquiry" boolean DEFAULT true NOT NULL,
  "marketing_event_id" uuid,
  "source_url" text,
  "source_whatsapp_message_id" uuid
);

CREATE TABLE public."appointments"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "request_id" uuid,
  "branch_key" text,
  "agent_id" uuid,
  "booked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "appointment_at" timestamp with time zone NOT NULL,
  "confirmed_at" timestamp with time zone,
  "attended_at" timestamp with time zone,
  "status" text DEFAULT 'scheduled'::text NOT NULL,
  "no_show_reason" text,
  "visit_notes" text,
  "result" text,
  "next_action" text,
  "next_followup" date,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."appointment_properties"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "appointment_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "sequence_no" integer DEFAULT 1 NOT NULL,
  "viewing_started_at" timestamp with time zone,
  "viewing_ended_at" timestamp with time zone,
  "viewing_result" text,
  "interest_level" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."activities"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" uuid,
  "client_id" uuid,
  "deal_id" uuid,
  "type" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "property_id" uuid,
  "request_id" uuid,
  "appointment_id" uuid,
  "channel" text,
  "direction" text,
  "actor_type" text,
  "occurred_at" timestamp with time zone,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "outcome" text,
  "next_action" text,
  "before_data" jsonb,
  "after_data" jsonb,
  "activity_type" text,
  "activity_text" text
);

CREATE TABLE public."rejection_reasons"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "code" text NOT NULL,
  "label_ar" text NOT NULL,
  "category" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."property_rejection_reasons"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "property_inquiry_id" uuid,
  "client_id" uuid NOT NULL,
  "request_id" uuid,
  "property_id" uuid NOT NULL,
  "reason_id" uuid NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "phase" text DEFAULT 'unknown'::text NOT NULL,
  "note" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."property_action_reviews"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "alert_type" text NOT NULL,
  "trigger_reason" text,
  "severity" text DEFAULT 'high'::text NOT NULL,
  "status" text DEFAULT 'open'::text NOT NULL,
  "rule_recommendation" jsonb,
  "ai_recommendation" jsonb,
  "decision" text,
  "decision_note" text,
  "created_by" uuid,
  "resolved_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone
);

CREATE TABLE public."measurement_periods"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "starts_on" date NOT NULL,
  "ends_on" date NOT NULL,
  "definition_version" text DEFAULT 'v1'::text NOT NULL,
  "status" text DEFAULT 'setup'::text NOT NULL,
  "participating_branches" text[] DEFAULT '{muscat,barka}'::text[] NOT NULL,
  "definitions_locked_at" timestamp with time zone,
  "owner_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."measurement_targets"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "period_id" uuid NOT NULL,
  "branch_key" text NOT NULL,
  "metric_key" text NOT NULL,
  "target_value" numeric NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."whatsapp_onboarding_events"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "route_key" text NOT NULL,
  "initiated_by" uuid,
  "configuration_id" text,
  "waba_id" text,
  "phone_number_id" text,
  "display_phone_number" text,
  "status" text DEFAULT 'started'::text NOT NULL,
  "details" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);

CREATE TABLE public."deal_stage_history"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "deal_id" uuid NOT NULL,
  "client_id" uuid,
  "property_id" uuid,
  "from_stage" text,
  "to_stage" text NOT NULL,
  "reason_id" uuid,
  "note" text,
  "changed_by" uuid,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."properties"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "added_by" uuid,
  "title" text NOT NULL,
  "type" text,
  "area" text NOT NULL,
  "price" numeric(12,2) NOT NULL,
  "bedrooms" integer,
  "bathrooms" integer,
  "land_size" numeric(10,2),
  "built_size" numeric(10,2),
  "status" text DEFAULT 'available'::text,
  "description" text,
  "images" text[],
  "views_count" integer DEFAULT 0,
  "inquiries_count" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "owner_client_id" uuid,
  "archived" boolean DEFAULT false,
  "archived_at" timestamp with time zone,
  "archived_by" uuid,
  "owner_id" uuid,
  "owner_net" numeric(12,2),
  "wilayat" text,
  "source_type" text DEFAULT 'owner'::text,
  "marketing_status" text DEFAULT 'ready_to_advertise'::text,
  "expected_commission" numeric(12,2),
  "property_code" text,
  "internal_name" text,
  "branch_key" text,
  "availability_checked_at" timestamp with time zone,
  "performance_tracking_started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "photography_status" text DEFAULT 'unknown'::text NOT NULL,
  "photography_reason" text,
  "photography_required_at" timestamp with time zone,
  "photography_completed_at" timestamp with time zone,
  "marketing_review_status" text DEFAULT 'healthy'::text NOT NULL,
  "marketing_reviewed_at" timestamp with time zone,
  "marketing_review_note" text,
  "last_ai_recommendation" jsonb,
  "last_ai_recommendation_at" timestamp with time zone,
  "public_details" text,
  "map_url" text,
  "has_listing_agreement" boolean DEFAULT false NOT NULL,
  "agreement_start_date" date,
  "agreement_duration_months" integer,
  "agreement_end_date" date,
  "agreement_reminder_days" integer,
  "sourced_by" uuid
);

CREATE TABLE public."whatsapp_automation_events"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "conversation_id" uuid,
  "message_id" uuid,
  "client_id" uuid,
  "request_id" uuid,
  "property_id" uuid,
  "viewing_id" uuid,
  "deal_id" uuid,
  "action_type" text NOT NULL,
  "status" text DEFAULT 'detected'::text NOT NULL,
  "confidence" numeric,
  "reason" text,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "applied_at" timestamp with time zone
);

CREATE TABLE public."unmatched_property_links"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "conversation_id" uuid,
  "whatsapp_message_id" uuid NOT NULL,
  "inbound_number" text,
  "raw_url" text NOT NULL,
  "link_key" text NOT NULL,
  "provider" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "property_id" uuid,
  "marketing_event_id" uuid,
  "resolved_by" uuid,
  "resolved_at" timestamp with time zone,
  "occurrence_count" integer DEFAULT 1 NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."whatsapp_route_credentials"(
  "company_id" uuid NOT NULL,
  "route_key" text NOT NULL,
  "token_ciphertext" text NOT NULL,
  "token_iv" text NOT NULL,
  "token_type" text DEFAULT 'system_user'::text NOT NULL,
  "meta_system_user_id" text,
  "meta_app_id" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."client_request_assignees"(
  "request_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "branch_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."instagram_outbound_operations"(
  "company_id" uuid NOT NULL,
  "operation_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "body_sha256" text NOT NULL,
  "status" text DEFAULT 'claimed'::text NOT NULL,
  "instagram_message_id" text,
  "recorded" boolean DEFAULT false NOT NULL,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."employee_monthly_targets"(
  "company_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "month_start" date NOT NULL,
  "inventory_target" integer DEFAULT 10 NOT NULL,
  "new_properties_target" integer,
  "sold_target" integer,
  "commission_target" numeric(14,3),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "inquiries_target" integer,
  "visits_target" integer
);

CREATE TABLE public."whatsapp_followup_optouts"(
  "request_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "reason" text,
  "source_message_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."whatsapp_template_registry"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "route_key" text NOT NULL,
  "waba_id" text NOT NULL,
  "template_name" text NOT NULL,
  "language" text DEFAULT 'ar'::text NOT NULL,
  "category" text DEFAULT 'MARKETING'::text NOT NULL,
  "template_id" text,
  "status" text,
  "last_error" text,
  "last_checked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."whatsapp_followup_events"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "route_key" text NOT NULL,
  "conversation_id" uuid,
  "step" text NOT NULL,
  "due_reason" text,
  "template_name" text,
  "send_mode" text,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "responded_at" timestamp with time zone,
  "meta_message_id" text,
  "error" text,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."whatsapp_followup_optins"(
  "client_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "consent_category" text DEFAULT 'property_request_followup'::text NOT NULL,
  "consent_text" text NOT NULL,
  "source_message_id" uuid,
  "source_conversation_id" uuid,
  "consented_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."whatsapp_automation_runtime"(
  "company_id" uuid NOT NULL,
  "mode" text DEFAULT 'off'::text NOT NULL,
  "allowed_customer_phones" text[] DEFAULT '{}'::text[] NOT NULL,
  "enabled_scenarios" text[] DEFAULT '{}'::text[] NOT NULL,
  "allowed_routes" text[] DEFAULT '{}'::text[] NOT NULL,
  "max_requirements_prompts" integer DEFAULT 0 NOT NULL,
  "after_hours_enabled" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."instagram_accounts"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "facebook_page_id" text NOT NULL,
  "facebook_page_name" text,
  "instagram_user_id" text NOT NULL,
  "instagram_username" text,
  "instagram_name" text,
  "profile_picture_url" text,
  "followers_count" integer,
  "media_count" integer,
  "permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "webhook_subscribed" boolean DEFAULT false NOT NULL,
  "connection_status" text DEFAULT 'connected'::text NOT NULL,
  "connected_by" uuid,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "token_expires_at" timestamp with time zone,
  "last_checked_at" timestamp with time zone,
  "last_error" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."instagram_account_credentials"(
  "account_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "token_ciphertext" text NOT NULL,
  "token_iv" text NOT NULL,
  "token_type" text DEFAULT 'page_long_lived'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."instagram_webhook_events"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid,
  "event_key" text NOT NULL,
  "object_type" text,
  "payload" jsonb NOT NULL,
  "processing_status" text DEFAULT 'received'::text NOT NULL,
  "processing_error" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone
);

CREATE TABLE public."instagram_conversations"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "client_id" uuid,
  "assigned_to" uuid,
  "participant_id" text NOT NULL,
  "participant_username" text,
  "participant_name" text,
  "participant_profile_picture_url" text,
  "status" text DEFAULT 'open'::text NOT NULL,
  "last_message_at" timestamp with time zone,
  "last_inbound_at" timestamp with time zone,
  "last_outbound_at" timestamp with time zone,
  "unread_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_message_seq" bigint DEFAULT 0 NOT NULL,
  "read_through_seq" bigint DEFAULT 0 NOT NULL
);

CREATE TABLE public."instagram_messages"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "client_id" uuid,
  "instagram_message_id" text NOT NULL,
  "direction" text NOT NULL,
  "message_type" text DEFAULT 'text'::text NOT NULL,
  "sender_id" text,
  "recipient_id" text,
  "body" text,
  "media_url" text,
  "reply_to_message_id" text,
  "message_timestamp" timestamp with time zone,
  "delivery_status" text,
  "sent_by_user_id" uuid,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ingestion_seq" bigint
);

CREATE TABLE public."whatsapp_send_operations"(
  "company_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "operation_key" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "crm_request_id" uuid,
  "payload_hash" text NOT NULL,
  "status" text NOT NULL,
  "result" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."property_message_attributions"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "message_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "marketing_event_id" uuid,
  "inquiry_id" uuid,
  "request_id" uuid,
  "evidence_key" text NOT NULL,
  "source_url" text,
  "method" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE crm_repair_private."branch_performance_owners"(
  "company_id" uuid NOT NULL,
  "branch_key" text NOT NULL,
  "employee_id" uuid NOT NULL,
  "effective_from" date NOT NULL
);

CREATE TABLE crm_repair_private."deal_save_operations"(
  "user_id" uuid NOT NULL,
  "operation_key" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "payload_hash" text NOT NULL,
  "deal_id" uuid NOT NULL,
  "result" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE crm_repair_private."deal_workflow_context"(
  "transaction_id" bigint NOT NULL,
  "user_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "deal_id" uuid NOT NULL
);

CREATE TABLE crm_repair_private."rejection_change_audit"(
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "source_table" text NOT NULL,
  "source_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "property_id" uuid NOT NULL,
  "request_id" uuid,
  "before_data" jsonb,
  "after_data" jsonb,
  "changed_by" uuid,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE crm_repair_private."viewing_save_operations"(
  "operation_key" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "payload_hash" text NOT NULL,
  "viewing_id" uuid,
  "appointment_id" uuid,
  "followup_task_id" uuid,
  "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE OR REPLACE FUNCTION public.crm_whatsapp_inbox_counts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'unread_total',coalesce(sum(c.unread_count),0),
    'handoff_total',count(*) FILTER(WHERE c.human_handoff_required IS TRUE)
  ) FROM public.whatsapp_conversations c
  WHERE auth.uid() IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active IS TRUE
  );
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'phone',
    'agent'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- في حالة أي خطأ، لا تمنع إنشاء المستخدم
  RAISE WARNING 'Error creating profile: %', SQLERRM;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_employee_performance(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid:=public.my_company(); v_actor uuid:=auth.uid(); v_role text:=public.my_role();
 v_start timestamptz;v_end timestamptz;v_result jsonb;v_inception date;
begin
 if v_company is null or v_actor is null or v_role not in ('owner','manager','agent') then
  raise exception using errcode='42501',message='performance_not_allowed';
 end if;
 -- Company row creation is not the beginning of the historical business ledger.
 select least((c.created_at at time zone 'Asia/Muscat')::date,(
   select min((hd.closed_at at time zone 'Asia/Muscat')::date)
   from public.deals hd where hd.company_id=c.id and hd.stage in('closed','commission_collected')
    and (v_role<>'agent' or (hd.agent_id=v_actor
      and crm_repair_private.can_access_client(hd.company_id,hd.client_id)
      and (hd.property_id is null or exists(select 1 from public.properties hp where hp.id=hd.property_id and hp.company_id=hd.company_id and crm_repair_private.staff_can_access_branch(hp.company_id,hp.branch_key)))))
 )) into v_inception from public.companies c where c.id=v_company;
 if p_from is null then p_from:=v_inception;end if;
 if p_from is null or p_to is null or p_to<=p_from then
  raise exception using errcode='22023',message='invalid_performance_period';
 end if;
 v_start:=p_from::timestamp at time zone 'Asia/Muscat';
 v_end:=p_to::timestamp at time zone 'Asia/Muscat';
 select coalesce(jsonb_agg(jsonb_build_object(
   'employee_id',e.id,'name',e.full_name,
   'active_inventory',coalesce(pr.active_inventory,0),
   'new_properties',coalesce(pr.new_properties,0),
   'inquiries',coalesce(i.inquiries,0),
   'inquiry_to_visit',coalesce(i.to_visit,0),
   'visits_booked',coalesce(v.booked,0),'visits_done',coalesce(v.done,0),
   'visit_to_sale',coalesce(v.to_sale,0),
   'sales',coalesce(d.sales,0),
   'company_commission',case when v_role='owner' or (v_role='agent' and e.id=v_actor) then coalesce(d.company_commission,0) else null end,
   'activities',coalesce(a.activities,0),
   'outbound_messages',coalesce(w.outbound,0),
   'targets',jsonb_build_object('inventory_target',10)||coalesce(to_jsonb(t)-'company_id'-'employee_id'-'month_start'-'updated_at','{}'::jsonb)
 )),'[]'::jsonb) into v_result
 from public.profiles e
 left join public.employee_monthly_targets t on t.company_id=e.company_id and t.employee_id=e.id
   and t.month_start=date_trunc('month',p_from)::date
 left join lateral (
   select count(*) filter(where p.archived=false and p.status not in('sold','not_available')) active_inventory,
    count(*) filter(where p.created_at>=v_start and p.created_at<v_end) new_properties
   from public.properties p where p.company_id=e.company_id and crm_repair_private.performance_employee(p.company_id,p.branch_key,p.created_at,p.sourced_by)=e.id and (v_role<>'agent' or crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))
 ) pr on true
 left join lateral (
   select count(*) inquiries,
    count(*) filter(where exists(select 1 from public.viewings vv
      where vv.company_id=pi.company_id and vv.client_id=pi.client_id and vv.property_id=pi.property_id
       and vv.archived=false and vv.status<>'cancelled' and vv.created_at>=pi.first_inquiry_at)) to_visit
   from public.property_inquiries pi
   where pi.company_id=e.company_id and crm_repair_private.performance_employee(pi.company_id,(select pp.branch_key from public.properties pp where pp.id=pi.property_id and pp.company_id=pi.company_id),pi.first_inquiry_at,pi.assigned_to)=e.id
    and (v_role<>'agent' or (crm_repair_private.can_access_client(pi.company_id,pi.client_id) and exists(select 1 from public.properties pp where pp.id=pi.property_id and pp.company_id=pi.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
    and pi.has_inbound_inquiry=true and pi.first_inquiry_at>=v_start and pi.first_inquiry_at<v_end
 ) i on true
 left join lateral (
   select count(*) filter(where vv.created_at>=v_start and vv.created_at<v_end and vv.status<>'cancelled') booked,
    count(*) filter(where vv.status='done' and vv.viewing_date>=p_from and vv.viewing_date<p_to) done,
    count(*) filter(where vv.status='done' and vv.viewing_date>=p_from and vv.viewing_date<p_to
      and exists(select 1 from public.deals dd where dd.company_id=vv.company_id and crm_repair_private.performance_employee(dd.company_id,coalesce((select pp.branch_key from public.properties pp where pp.id=dd.property_id and pp.company_id=dd.company_id),(select cc.lead_route from public.clients cc where cc.id=dd.client_id and cc.company_id=dd.company_id)),dd.closed_at,dd.agent_id)=e.id
        and dd.client_id=vv.client_id and dd.property_id=vv.property_id
        and dd.stage in('closed','commission_collected') and dd.closed_at>=vv.viewing_date::timestamp at time zone 'Asia/Muscat')) to_sale
   from public.viewings vv where vv.company_id=e.company_id and crm_repair_private.performance_employee(vv.company_id,(select pp.branch_key from public.properties pp where pp.id=vv.property_id and pp.company_id=vv.company_id),vv.created_at,vv.agent_id)=e.id and vv.archived=false and (v_role<>'agent' or (crm_repair_private.can_access_client(vv.company_id,vv.client_id) and exists(select 1 from public.properties pp where pp.id=vv.property_id and pp.company_id=vv.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
 ) v on true
 left join lateral (
   select count(*) sales,sum(coalesce(dd.company_commission,dd.company_share,0)) company_commission
   from public.deals dd where dd.company_id=e.company_id and crm_repair_private.performance_employee(dd.company_id,coalesce((select pp.branch_key from public.properties pp where pp.id=dd.property_id and pp.company_id=dd.company_id),(select cc.lead_route from public.clients cc where cc.id=dd.client_id and cc.company_id=dd.company_id)),dd.closed_at,dd.agent_id)=e.id
     and (v_role<>'agent' or (crm_repair_private.can_access_client(dd.company_id,dd.client_id) and (dd.property_id is null or exists(select 1 from public.properties pp where pp.id=dd.property_id and pp.company_id=dd.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key)))))
     and dd.stage in('closed','commission_collected') and dd.closed_at>=v_start and dd.closed_at<v_end
 ) d on true
 left join lateral (
   select count(*) activities from public.activities aa where aa.company_id=e.company_id and crm_repair_private.performance_employee(aa.company_id,coalesce((select pp.branch_key from public.properties pp where pp.id=aa.property_id and pp.company_id=aa.company_id),(select cc.lead_route from public.clients cc where cc.id=aa.client_id and cc.company_id=aa.company_id)),coalesce(aa.occurred_at,aa.created_at),aa.user_id)=e.id
    and aa.created_at>=v_start and aa.created_at<v_end and (v_role<>'agent' or (aa.client_id is null or crm_repair_private.can_access_client(aa.company_id,aa.client_id))) and aa.actor_type = 'human' and coalesce(aa.channel,'') <> 'system'
 ) a on true
 left join lateral (
   select count(*) outbound from public.whatsapp_messages mm
   where mm.company_id=e.company_id and crm_repair_private.performance_employee(mm.company_id,(select wc.route_key from public.whatsapp_conversations wc where wc.id=mm.conversation_id and wc.company_id=mm.company_id),mm.message_timestamp,mm.sent_by_user_id)=e.id and mm.direction='outbound' and mm.actor_type='human' and (v_role<>'agent' or crm_repair_private.can_access_whatsapp_conversation(mm.company_id,mm.conversation_id))
    and mm.message_timestamp>=v_start and mm.message_timestamp<v_end
 ) w on true
 where e.company_id=v_company and e.role='agent' and e.is_active
  and (v_role in('owner','manager') or e.id=v_actor);
 return jsonb_build_object('from',p_from,'to',p_to,'employees',v_result);
end $function$
;

CREATE OR REPLACE FUNCTION public.get_public_company_name(p_company_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select c.name
  from public.companies c
  where c.id = p_company_id
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.is_company_owner(target_company uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.company_id = target_company
      and p.role = 'owner'
      and coalesce(p.is_active, true) = true
  );
$function$
;

CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid;
begin
  uid := auth.uid();

  -- العمليات الداخلية الموثوقة مثل Trigger الدعوات
  if uid is null then
    return new;
  end if;

  -- المستخدم يعدّل حسابه الشخصي
  if uid = old.id then

    if new.role is distinct from old.role then
      raise exception 'غير مسموح لك بتغيير صلاحية حسابك';
    end if;

    if new.company_id is distinct from old.company_id then
      raise exception 'غير مسموح لك بتغيير الشركة';
    end if;

    if new.is_active is distinct from old.is_active then
      raise exception 'غير مسموح لك بتغيير حالة حسابك';
    end if;

    if new.email is distinct from old.email then
      raise exception 'تغيير البريد الإلكتروني غير مسموح من ملف المستخدم';
    end if;

    return new;
  end if;

  -- تعديل حساب موظف آخر: Owner فقط
  if not public.is_company_owner(old.company_id) then
    raise exception 'فقط صاحب الشركة يستطيع تعديل صلاحيات الموظفين';
  end if;

  -- لا يسمح بنقل الموظف إلى شركة أخرى
  if new.company_id is distinct from old.company_id then
    raise exception 'لا يمكن نقل المستخدم إلى شركة أخرى بهذه الطريقة';
  end if;

  -- البريد مرتبط بحساب Auth ولا يعدّل من صفحة الفريق
  if new.email is distinct from old.email then
    raise exception 'لا يمكن تغيير بريد الموظف من صفحة الفريق';
  end if;

  -- حماية حساب الـ Owner من التعطيل أو تغيير دوره
  if old.role = 'owner'
     and (
       new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
     ) then
    raise exception 'لا يمكن تغيير أو تعطيل حساب صاحب الشركة';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_company_invite_to_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  invite_token_text text;
  invite_token uuid;
  inv public.company_invites%rowtype;
  v_name text;
  v_phone text;
begin
  invite_token_text := nullif(new.raw_user_meta_data ->> 'invite_token', '');
  v_name := coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email,''), '@', 1));
  v_phone := nullif(new.raw_user_meta_data ->> 'phone', '');

  if invite_token_text is not null then
    begin
      invite_token := invite_token_text::uuid;
    exception when others then
      invite_token := null;
    end;
  end if;

  if invite_token is not null then
    select * into inv
    from public.company_invites ci
    where ci.token = invite_token
      and lower(ci.email) = lower(coalesce(new.email,''))
      and ci.status = 'pending'
      and ci.expires_at > now()
    for update;
  end if;

  if found then
    insert into public.profiles (id, email, full_name, phone, role, is_active, company_id)
    values (new.id, new.email, v_name, v_phone, inv.role, true, inv.company_id)
    on conflict (id) do update set
      email = excluded.email,
      full_name = excluded.full_name,
      phone = coalesce(excluded.phone, public.profiles.phone),
      role = excluded.role,
      is_active = true,
      company_id = excluded.company_id;

    update public.company_invites
    set status = 'used', used_by = new.id, used_at = now()
    where id = inv.id;
  else
    -- Keep uninvited accounts outside company data. This protects against public self-signup.
    insert into public.profiles (id, email, full_name, phone, role, is_active, company_id)
    values (new.id, new.email, v_name, v_phone, 'viewer', false, null)
    on conflict (id) do update set
      email = excluded.email,
      full_name = coalesce(nullif(public.profiles.full_name,''), excluded.full_name),
      phone = coalesce(public.profiles.phone, excluded.phone),
      is_active = case when public.profiles.company_id is null then false else public.profiles.is_active end;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_public_lead(p_company_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return public.submit_public_lead(p_company_id,p_payload,'general'::text);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.calc_client_request_score(p_request jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_score integer := 20;
  v_payment text := nullif(lower(btrim(coalesce(p_request->>'payment_method',''))),'');
  v_timing text := nullif(lower(btrim(coalesce(p_request->>'purchase_timing',''))),'');
  v_purpose text := nullif(lower(btrim(coalesce(p_request->>'purpose',''))),'');
  v_area text := nullif(btrim(coalesce(p_request->>'preferred_area','')),'');
  v_property text := nullif(btrim(coalesce(p_request->>'property_type','')),'');
  v_budget_min numeric;
  v_budget_max numeric;
begin
  begin v_budget_min := nullif(p_request->>'budget_min','')::numeric; exception when others then v_budget_min := null; end;
  begin v_budget_max := nullif(p_request->>'budget_max','')::numeric; exception when others then v_budget_max := null; end;

  if v_budget_min is not null or v_budget_max is not null then v_score := v_score + 15; end if;
  if v_payment = 'cash' then v_score := v_score + 25;
  elsif v_payment = 'bank_ready' then v_score := v_score + 20;
  elsif v_payment = 'needs_finance' then v_score := v_score + 8;
  elsif v_payment = 'unclear' then v_score := v_score - 5;
  end if;

  if v_timing = 'immediate' then v_score := v_score + 25;
  elsif v_timing = 'this_week' then v_score := v_score + 20;
  elsif v_timing = 'this_month' then v_score := v_score + 12;
  elsif v_timing = '3_months' then v_score := v_score + 5;
  elsif v_timing = 'just_looking' then v_score := v_score - 15;
  end if;

  if v_purpose in ('investment','residence') then v_score := v_score + 8;
  elsif v_purpose is not null then v_score := v_score + 5;
  end if;
  if v_area is not null then v_score := v_score + 5; end if;
  if v_property is not null then v_score := v_score + 3; end if;

  return greatest(0, least(100, v_score));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_whatsapp_client(p_company_id uuid, p_phone text, p_customer_name text, p_route_key text, p_assigned_to uuid, p_inbound_number text, p_message_body text, p_extracted jsonb DEFAULT '{}'::jsonb, p_message_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_client public.clients%rowtype;
  v_client_id uuid;
  v_created boolean := false;
  v_phone text := btrim(coalesce(p_phone,''));
  v_name text := nullif(left(btrim(coalesce(p_customer_name,'')),120),'');
  v_route text := lower(btrim(coalesce(p_route_key,'general')));
  v_client_type text := nullif(lower(btrim(coalesce(p_extracted->>'client_type',''))),'');
  v_area text := nullif(left(btrim(coalesce(p_extracted->>'preferred_area','')),200),'');
  v_wilayat text := nullif(left(btrim(coalesce(p_extracted->>'wilayat','')),200),'');
  v_property_type text := nullif(left(btrim(coalesce(p_extracted->>'property_type','')),120),'');
  v_payment_method text := nullif(left(btrim(coalesce(p_extracted->>'payment_method','')),120),'');
  v_purchase_timing text := nullif(left(btrim(coalesce(p_extracted->>'purchase_timing','')),120),'');
  v_purpose text := nullif(left(btrim(coalesce(p_extracted->>'purpose','')),120),'');
  v_budget_min numeric;
  v_budget_max numeric;
  v_is_buyer boolean := false;
  v_is_seller boolean := false;
  v_is_investor boolean := false;
  v_score integer := 20;
  v_temperature text := 'cold';
  v_note text;
  v_old_assigned_to uuid;
begin
  if p_company_id is null or not exists (
    select 1 from public.companies c where c.id = p_company_id
  ) then
    raise exception 'Invalid company';
  end if;

  if v_phone !~ '^\+[0-9]{7,15}$' then
    raise exception 'Invalid WhatsApp phone';
  end if;

  if v_route not in ('muscat','barka','investment','general') then
    v_route := 'general';
  end if;

  if v_client_type not in ('buyer','seller','tenant','landlord','consultation','investor') then
    v_client_type := null;
  end if;

  begin
    v_budget_min := nullif(p_extracted->>'budget_min','')::numeric;
  exception when others then
    v_budget_min := null;
  end;

  begin
    v_budget_max := nullif(p_extracted->>'budget_max','')::numeric;
  exception when others then
    v_budget_max := null;
  end;

  v_is_buyer := coalesce((p_extracted->>'is_buyer')::boolean, false) or v_client_type = 'buyer';
  v_is_seller := coalesce((p_extracted->>'is_seller')::boolean, false) or v_client_type = 'seller';
  v_is_investor := coalesce((p_extracted->>'is_investor')::boolean, false)
                   or v_client_type = 'investor'
                   or v_purpose in ('investment','resale');

  -- Mirror the CRM's lead scoring rules so automatic WhatsApp leads behave like manual leads.
  if v_budget_min is not null or v_budget_max is not null then v_score := v_score + 15; end if;
  if v_payment_method = 'cash' then v_score := v_score + 25;
  elsif v_payment_method = 'bank_ready' then v_score := v_score + 20;
  elsif v_payment_method = 'needs_finance' then v_score := v_score + 8;
  elsif v_payment_method = 'unclear' then v_score := v_score - 5;
  end if;

  if v_purchase_timing = 'immediate' then v_score := v_score + 25;
  elsif v_purchase_timing = 'this_week' then v_score := v_score + 20;
  elsif v_purchase_timing = 'this_month' then v_score := v_score + 12;
  elsif v_purchase_timing = '3_months' then v_score := v_score + 5;
  elsif v_purchase_timing = 'just_looking' then v_score := v_score - 15;
  end if;

  if v_purpose in ('investment','residence') then v_score := v_score + 8;
  elsif v_purpose is not null then v_score := v_score + 5;
  end if;
  if v_area is not null then v_score := v_score + 5; end if;
  if v_property_type is not null then v_score := v_score + 3; end if;
  v_score := v_score + 2;
  v_score := greatest(0, least(100, v_score));

  if coalesce(p_extracted, '{}'::jsonb) = '{}'::jsonb then
    v_score := 50;
  end if;
  v_temperature := case when v_score >= 65 then 'hot' when v_score >= 35 then 'warm' else 'cold' end;

  select c.* into v_client
  from public.clients c
  where c.company_id = p_company_id
    and regexp_replace(coalesce(c.phone,''), '[^0-9+]', '', 'g') = v_phone
  order by c.created_at asc
  limit 1;

  if v_client.id is null then
    v_note := case
      when nullif(btrim(coalesce(p_message_body,'')),'') is null then '💚 عميل وارد تلقائياً من WhatsApp'
      else '💚 أول رسالة WhatsApp: ' || left(btrim(p_message_body), 1500)
    end;

    insert into public.clients (
      company_id, name, phone, client_type, is_buyer, is_seller, is_investor,
      preferred_area, wilayat, property_type, budget_min, budget_max,
      payment_method, purchase_timing, purpose, notes, status, lead_temperature,
      lead_score, source, pipeline_stage, assigned_to, lead_route, inbound_number,
      last_contact_at
    ) values (
      p_company_id,
      coalesce(v_name, 'عميل واتساب ' || right(v_phone,4)),
      v_phone,
      coalesce(v_client_type, 'consultation'),
      v_is_buyer,
      v_is_seller,
      v_is_investor,
      v_area,
      v_wilayat,
      v_property_type,
      v_budget_min,
      v_budget_max,
      v_payment_method,
      v_purchase_timing,
      v_purpose,
      v_note,
      v_temperature,
      v_temperature,
      v_score,
      'whatsapp',
      'new',
      case when v_route = 'general' then null else p_assigned_to end,
      v_route,
      p_inbound_number,
      coalesce(p_message_at, now())
    ) returning id into v_client_id;

    v_created := true;
  else
    v_client_id := v_client.id;
    v_old_assigned_to := v_client.assigned_to;

    update public.clients c
    set
      -- Keep a real CRM name; only replace a placeholder WhatsApp name.
      name = case
        when v_name is not null
         and (c.name is null or btrim(c.name) = '' or c.name like 'عميل واتساب %')
        then v_name else c.name end,

      -- Merge roles permanently; do not remove an older known role.
      is_buyer = coalesce(c.is_buyer,false) or v_is_buyer,
      is_seller = coalesce(c.is_seller,false) or v_is_seller,
      is_investor = coalesce(c.is_investor,false) or v_is_investor,

      -- The latest explicit concrete intent becomes the primary/current client type.
      -- Consultation/unknown never downgrades an established role.
      client_type = case
        when v_client_type is not null and v_client_type <> 'consultation' then v_client_type
        when c.client_type is null then coalesce(v_client_type, 'consultation')
        else c.client_type
      end,

      -- Latest EXPLICIT WhatsApp qualification becomes the current request.
      -- If the latest message did not state a field, preserve the existing value.
      preferred_area = case when v_area is not null then v_area else c.preferred_area end,
      wilayat = case when v_wilayat is not null then v_wilayat else c.wilayat end,
      property_type = case when v_property_type is not null then v_property_type else c.property_type end,

      -- Budget is a pair: if either bound is stated in the latest message, replace the pair together.
      budget_min = case
        when v_budget_min is not null or v_budget_max is not null then v_budget_min
        else c.budget_min
      end,
      budget_max = case
        when v_budget_min is not null or v_budget_max is not null then v_budget_max
        else c.budget_max
      end,

      payment_method = case when v_payment_method is not null then v_payment_method else c.payment_method end,
      purchase_timing = case when v_purchase_timing is not null then v_purchase_timing else c.purchase_timing end,
      purpose = case when v_purpose is not null then v_purpose else c.purpose end,

      -- Receiving number controls active routing. General keeps the current assignee.
      assigned_to = case
        when v_route <> 'general' and p_assigned_to is not null then p_assigned_to
        else c.assigned_to
      end,
      lead_route = v_route,
      inbound_number = coalesce(p_inbound_number, c.inbound_number),
      last_contact_at = greatest(coalesce(c.last_contact_at, '-infinity'::timestamptz), coalesce(p_message_at, now())),

      -- Never cool down or reduce an already stronger manually-qualified lead.
      lead_score = greatest(coalesce(c.lead_score,0), v_score),
      lead_temperature = case
        when coalesce(c.lead_score,0) >= v_score then coalesce(c.lead_temperature,c.status,v_temperature)
        else v_temperature
      end,
      status = case
        when coalesce(c.lead_score,0) >= v_score then coalesce(c.status,c.lead_temperature,v_temperature)
        else v_temperature
      end,

      archived = false,
      archived_at = null,
      archived_by = null
    where c.id = v_client_id;
  end if;

  select c.assigned_to into v_old_assigned_to
  from public.clients c
  where c.id = v_client_id;

  return jsonb_build_object(
    'ok', true,
    'client_id', v_client_id,
    'created', v_created,
    'route_key', v_route,
    'assigned_to', v_old_assigned_to,
    'lead_score', v_score,
    'lead_temperature', v_temperature
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_whatsapp_route(p_company_id uuid, p_meta_phone_number_id text)
 RETURNS TABLE(route_key text, assigned_to uuid, whatsapp_number text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    coalesce(r.route_key, 'general') as route_key,
    case when coalesce(r.route_key,'general') = 'general' then null else r.assigned_to end as assigned_to,
    r.whatsapp_number
  from (select 1) x
  left join lateral (
    select lr.route_key, lr.assigned_to, lr.whatsapp_number
    from public.company_lead_routes lr
    where lr.company_id = p_company_id
      and lr.meta_phone_number_id = p_meta_phone_number_id
      and lr.is_active = true
    limit 1
  ) r on true;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_property_inquiry_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_client_pipeline_from_property_inquiry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_stage text;
  target_rank int;
  current_stage text;
  current_rank int;
begin
  target_stage := case new.status
    when 'inquiry' then 'contacted'
    when 'followup' then 'contacted'
    when 'viewing_scheduled' then 'viewing_scheduled'
    when 'viewed' then 'viewed'
    when 'negotiation' then 'negotiating'
    when 'reserved' then 'deposit'
    when 'deal' then 'negotiating'
    else null
  end;

  if target_stage is null then
    return new;
  end if;

  select c.pipeline_stage into current_stage
  from public.clients c
  where c.id = new.client_id and c.company_id = new.company_id;

  current_rank := case current_stage
    when 'new' then 0
    when 'contacted' then 1
    when 'qualified' then 2
    when 'options_sent' then 3
    when 'viewing_scheduled' then 4
    when 'viewed' then 5
    when 'negotiating' then 6
    when 'awaiting_finance' then 7
    when 'deposit' then 8
    when 'sold' then 9
    else 0
  end;

  target_rank := case target_stage
    when 'contacted' then 1
    when 'viewing_scheduled' then 4
    when 'viewed' then 5
    when 'negotiating' then 6
    when 'deposit' then 8
    else 0
  end;

  if target_rank > current_rank then
    update public.clients
    set pipeline_stage = target_stage
    where id = new.client_id and company_id = new.company_id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_client_request_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at := now();
  if new.status in ('won','lost','cancelled','archived') and new.closed_at is null then
    new.closed_at := now();
  elsif new.status in ('active','paused') then
    new.closed_at := null;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.audit_client_request_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_source text;
  v_event_type text;
  v_stage text;
begin
  v_source := case when tg_op='INSERT' then coalesce(new.created_via,'manual') else coalesce(new.created_via,old.created_via,'manual') end;
  if tg_op='INSERT' then
    v_event_type := 'created'; v_stage := new.pipeline_stage;
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,whatsapp_message_id,after_data,occurred_at,recorded_at)
    values(new.company_id,new.id,new.client_id,v_event_type,v_stage,v_source,coalesce(new.updated_by,new.created_by),new.origin_whatsapp_message_id,to_jsonb(new),coalesce(new.created_at,now()),now());
    return new;
  elsif tg_op='UPDATE' then
    v_event_type := case when new.pipeline_stage is distinct from old.pipeline_stage then 'stage_changed' else 'updated' end;
    v_stage := new.pipeline_stage;
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,whatsapp_message_id,before_data,after_data,occurred_at,recorded_at)
    values(new.company_id,new.id,new.client_id,v_event_type,v_stage,v_source,new.updated_by,new.origin_whatsapp_message_id,to_jsonb(old),to_jsonb(new),now(),now());
    return new;
  else
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,whatsapp_message_id,before_data,occurred_at,recorded_at)
    values(old.company_id,old.id,old.client_id,'deleted',old.pipeline_stage,coalesce(old.created_via,'manual'),coalesce(old.updated_by,old.created_by),old.origin_whatsapp_message_id,to_jsonb(old),now(),now());
    return old;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_client_summary_after_request_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_client_request_summary(old.client_id);
    return old;
  end if;

  perform public.refresh_client_request_summary(new.client_id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_public_lead(p_company_id uuid, p_payload jsonb, p_route_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid;
  v_existing_client boolean := false;
  v_name text := btrim(coalesce(p_payload->>'name',''));
  v_phone text := regexp_replace(btrim(coalesce(p_payload->>'phone','')), '[^0-9+]', '', 'g');
  v_email text := nullif(btrim(coalesce(p_payload->>'email','')), '');
  v_route_key text := lower(btrim(coalesce(p_route_key,'general')));
  v_assigned_to uuid;
  v_inbound_number text;
  v_requests jsonb;
  v_req jsonb;
  v_first jsonb;
  v_request_count integer := 0;
  v_type text;
  v_budget_min numeric;
  v_budget_max numeric;
  v_score integer;
  v_temp text;
  v_is_buyer boolean := false;
  v_is_seller boolean := false;
  v_is_investor boolean := false;
  v_property_type text;
  v_area text;
  v_property_types_count integer;
  v_areas_count integer;
begin
  if p_company_id is null
     or not exists(select 1 from public.companies c where c.id=p_company_id) then
    raise exception 'Invalid company';
  end if;

  -- Public RPC hardening: reject abnormally large anonymous payloads.
  if p_payload is null or octet_length(p_payload::text) > 50000 then
    raise exception 'Invalid payload size';
  end if;

  if v_route_key not in ('muscat','barka','investment','general') then
    v_route_key := 'general';
  end if;

  if char_length(v_name)<2 or char_length(v_name)>120 then
    raise exception 'Invalid name';
  end if;
  if v_phone !~ '^\+[0-9]{7,15}$' then
    raise exception 'Invalid phone';
  end if;
  if v_email is not null and (char_length(v_email)>254 or v_email not like '%@%') then
    raise exception 'Invalid email';
  end if;

  if jsonb_typeof(p_payload->'requests')='array' then
    v_requests := p_payload->'requests';
  else
    -- Backward compatibility with the current single-request form.
    v_requests := jsonb_build_array(p_payload);
  end if;

  if jsonb_typeof(v_requests) <> 'array'
     or jsonb_array_length(v_requests)<1
     or jsonb_array_length(v_requests)>5 then
    raise exception 'Invalid request count';
  end if;

  v_first := v_requests->0;

  -- Validate every independent request before changing any data.
  for v_req in select value from jsonb_array_elements(v_requests)
  loop
    if jsonb_typeof(v_req) <> 'object' then
      raise exception 'Invalid request';
    end if;

    v_type := lower(btrim(coalesce(v_req->>'request_type',v_req->>'client_type','')));
    if v_type not in ('buyer','seller','tenant','landlord','consultation','investor') then
      raise exception 'Invalid client type';
    end if;

    begin
      v_budget_min := nullif(v_req->>'budget_min','')::numeric;
    exception when others then
      raise exception 'Invalid budget';
    end;
    begin
      v_budget_max := nullif(v_req->>'budget_max','')::numeric;
    exception when others then
      raise exception 'Invalid budget';
    end;

    if v_budget_min is not null and v_budget_min < 0 then raise exception 'Invalid budget'; end if;
    if v_budget_max is not null and v_budget_max < 0 then raise exception 'Invalid budget'; end if;
    if v_budget_min is not null and v_budget_max is not null and v_budget_min>v_budget_max then
      raise exception 'Invalid budget range';
    end if;

    if jsonb_typeof(v_req->'property_types')='array' then
      v_property_types_count := jsonb_array_length(v_req->'property_types');
      if v_property_types_count > 6 then raise exception 'Too many property types'; end if;
    end if;
    if jsonb_typeof(v_req->'preferred_areas')='array' then
      v_areas_count := jsonb_array_length(v_req->'preferred_areas');
      if v_areas_count > 8 then raise exception 'Too many preferred areas'; end if;
    end if;

    v_is_buyer := v_is_buyer or v_type in ('buyer','investor');
    v_is_seller := v_is_seller or v_type='seller';
    v_is_investor := v_is_investor
      or v_type='investor'
      or lower(coalesce(v_req->>'purpose','')) in ('investment','resale');
  end loop;

  -- Request-level routing. General remains intentionally unassigned.
  select r.assigned_to,r.whatsapp_number
  into v_assigned_to,v_inbound_number
  from public.company_lead_routes r
  join public.profiles p
    on p.id=r.assigned_to
   and p.company_id=r.company_id
   and p.is_active is not false
  where r.company_id=p_company_id
    and r.route_key=v_route_key
    and r.is_active=true
  limit 1;

  if v_route_key='general' then v_assigned_to := null; end if;

  -- Find the PERSON by normalized phone. Do not reject an existing person.
  select c.id
  into v_id
  from public.clients c
  where c.company_id=p_company_id
    and regexp_replace(coalesce(c.phone,''), '[^0-9+]', '', 'g')=v_phone
  order by c.created_at asc
  limit 1;

  if v_id is not null then
    v_existing_client := true;

    -- Identity-only refresh. Do NOT steal/reassign the whole person;
    -- ownership/routing belongs to each request in Phase 8.
    update public.clients c
    set
      name = case
        when (c.name is null or btrim(c.name)='' or c.name like 'عميل واتساب %')
          then left(v_name,120)
        else c.name
      end,
      email = case
        when c.email is null or btrim(c.email)='' then v_email
        else c.email
      end,
      last_contact_at = greatest(coalesce(c.last_contact_at,'-infinity'::timestamptz), now()),
      archived=false,
      archived_at=null,
      archived_by=null
    where c.id=v_id;
  else
    -- New person: seed legacy compatibility columns from only the first request.
    v_type := lower(btrim(coalesce(v_first->>'request_type',v_first->>'client_type','consultation')));
    begin v_budget_min := nullif(v_first->>'budget_min','')::numeric; exception when others then v_budget_min := null; end;
    begin v_budget_max := nullif(v_first->>'budget_max','')::numeric; exception when others then v_budget_max := null; end;
    v_property_type := nullif(left(btrim(coalesce(v_first->>'property_type','')),120),'');
    v_area := nullif(left(btrim(coalesce(v_first->>'preferred_area','')),200),'');

    insert into public.clients(
      company_id,name,phone,email,client_type,is_buyer,is_seller,is_investor,
      preferred_area,wilayat,nationality,property_type,budget_min,budget_max,
      payment_method,purchase_timing,purpose,notes,status,lead_temperature,lead_score,
      source,pipeline_stage,assigned_to,lead_route,inbound_number,last_contact_at
    ) values (
      p_company_id,left(v_name,120),v_phone,v_email,v_type,
      v_is_buyer,v_is_seller,v_is_investor,
      v_area,
      nullif(left(btrim(coalesce(v_first->>'wilayat','')),200),''),
      nullif(left(btrim(coalesce(p_payload->>'nationality','')),120),''),
      v_property_type,
      v_budget_min,v_budget_max,
      nullif(left(btrim(coalesce(v_first->>'payment_method','')),120),''),
      nullif(left(btrim(coalesce(v_first->>'purchase_timing','')),120),''),
      nullif(left(btrim(coalesce(v_first->>'purpose','')),120),''),
      nullif(left(coalesce(p_payload->>'notes',v_first->>'notes',''),5000),''),
      'warm','warm',50,'website','new',
      v_assigned_to,v_route_key,v_inbound_number,now()
    ) returning id into v_id;
  end if;

  -- Every submitted need becomes its OWN independent request.
  for v_req in select value from jsonb_array_elements(v_requests)
  loop
    v_type := lower(btrim(coalesce(v_req->>'request_type',v_req->>'client_type','consultation')));
    begin v_budget_min := nullif(v_req->>'budget_min','')::numeric; exception when others then v_budget_min := null; end;
    begin v_budget_max := nullif(v_req->>'budget_max','')::numeric; exception when others then v_budget_max := null; end;
    v_score := public.calc_client_request_score(v_req);
    v_temp := case when v_score>=65 then 'hot' when v_score>=35 then 'warm' else 'cold' end;

    insert into public.client_requests(
      company_id,client_id,request_type,
      property_type,property_types,preferred_area,preferred_areas,wilayat,
      budget_min,budget_max,payment_method,purchase_timing,purpose,
      bedrooms_min,bathrooms_min,
      status,pipeline_stage,source,source_detail,assigned_to,route_key,inbound_number,
      created_via,lead_score,lead_temperature,notes,last_contact_at
    ) values (
      p_company_id,v_id,v_type,
      nullif(left(btrim(coalesce(v_req->>'property_type','')),120),''),
      case
        when jsonb_typeof(v_req->'property_types')='array' then
          array(
            select left(btrim(t.value),120)
            from jsonb_array_elements_text(v_req->'property_types') as t(value)
            where btrim(t.value)<>''
            limit 6
          )
        when nullif(btrim(coalesce(v_req->>'property_type','')),'') is not null then
          array[nullif(left(btrim(v_req->>'property_type'),120),'')]
        else '{}'::text[]
      end,
      nullif(left(btrim(coalesce(v_req->>'preferred_area','')),200),''),
      case
        when jsonb_typeof(v_req->'preferred_areas')='array' then
          array(
            select left(btrim(t.value),200)
            from jsonb_array_elements_text(v_req->'preferred_areas') as t(value)
            where btrim(t.value)<>''
            limit 8
          )
        when nullif(btrim(coalesce(v_req->>'preferred_area','')),'') is not null then
          array[nullif(left(btrim(v_req->>'preferred_area'),200),'')]
        else '{}'::text[]
      end,
      nullif(left(btrim(coalesce(v_req->>'wilayat','')),200),''),
      v_budget_min,v_budget_max,
      nullif(left(btrim(coalesce(v_req->>'payment_method','')),120),''),
      nullif(left(btrim(coalesce(v_req->>'purchase_timing','')),120),''),
      nullif(left(btrim(coalesce(v_req->>'purpose','')),120),''),
      case when coalesce(v_req->>'bedrooms_min','') ~ '^[0-9]+$' then (v_req->>'bedrooms_min')::integer else null end,
      case when coalesce(v_req->>'bathrooms_min','') ~ '^[0-9]+$' then (v_req->>'bathrooms_min')::integer else null end,
      'active','new','website','Public lead form',
      v_assigned_to,v_route_key,v_inbound_number,
      'website',v_score,v_temp,
      nullif(left(coalesce(v_req->>'notes',p_payload->>'notes',''),5000),''),
      now()
    );
    v_request_count := v_request_count+1;
  end loop;

  perform public.refresh_client_request_summary(v_id);

  return jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'existing_client',v_existing_client,
    'route',v_route_key,
    'assigned',v_assigned_to is not null,
    'requests_created',v_request_count
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_client_request_summary(p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_current public.client_requests%rowtype;
  v_max_score integer;
  v_temp text;
  v_is_buyer boolean;
  v_is_seller boolean;
  v_is_investor boolean;
begin
  select r.* into v_current
  from public.client_requests r
  where r.client_id = p_client_id
    and r.status not in ('cancelled','archived')
  order by
    case when r.status = 'active' then 0 when r.status = 'paused' then 1 else 2 end,
    r.priority desc,
    r.updated_at desc
  limit 1;

  if v_current.id is null then
    update public.clients c
    set preferred_area=null,
        wilayat=null,
        property_type=null,
        budget_min=null,
        budget_max=null,
        payment_method=null,
        purchase_timing=null,
        purpose=null
    where c.id=p_client_id;
    return;
  end if;

  -- Roles are historical; lead temperature/score should reflect active work first.
  select
    bool_or(r.request_type in ('buyer','investor')),
    bool_or(r.request_type = 'seller'),
    bool_or(r.request_type = 'investor' or r.purpose in ('investment','resale'))
  into v_is_buyer, v_is_seller, v_is_investor
  from public.client_requests r
  where r.client_id = p_client_id
    and r.status <> 'archived';

  select max(r.lead_score) into v_max_score
  from public.client_requests r
  where r.client_id = p_client_id
    and r.status in ('active','paused');

  if v_max_score is null then v_max_score := coalesce(v_current.lead_score,20); end if;
  v_temp := case when v_max_score >= 65 then 'hot' when v_max_score >= 35 then 'warm' else 'cold' end;

  update public.clients c
  set
    client_type = v_current.request_type,
    is_buyer = coalesce(c.is_buyer,false) or coalesce(v_is_buyer,false),
    is_seller = coalesce(c.is_seller,false) or coalesce(v_is_seller,false),
    is_investor = coalesce(c.is_investor,false) or coalesce(v_is_investor,false),
    preferred_area = v_current.preferred_area,
    wilayat = v_current.wilayat,
    property_type = v_current.property_type,
    budget_min = v_current.budget_min,
    budget_max = v_current.budget_max,
    payment_method = v_current.payment_method,
    purchase_timing = v_current.purchase_timing,
    purpose = v_current.purpose,
    -- Client-level heat is only a summary of the strongest active request.
    lead_score = coalesce(v_max_score,20),
    lead_temperature = v_temp,
    status = v_temp,
    last_contact_at = greatest(
      c.last_contact_at,
      (select max(r.last_contact_at) from public.client_requests r where r.client_id=p_client_id)
    )
  where c.id = p_client_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_whatsapp_client_request(p_company_id uuid, p_client_id uuid, p_action text, p_existing_request_id uuid, p_assigned_to uuid, p_route_key text, p_inbound_number text, p_message_id uuid, p_request jsonb, p_message_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_action text := lower(btrim(coalesce(p_action,'create')));
  v_req_type text := nullif(lower(btrim(coalesce(p_request->>'request_type',''))),'');
  v_property_type text := nullif(left(btrim(coalesce(p_request->>'property_type','')),120),'');
  v_property_types text[] := '{}'::text[];
  v_area text := nullif(left(btrim(coalesce(p_request->>'preferred_area','')),200),'');
  v_areas text[] := '{}'::text[];
  v_wilayat text := nullif(left(btrim(coalesce(p_request->>'wilayat','')),200),'');
  v_payment text := nullif(left(lower(btrim(coalesce(p_request->>'payment_method',''))),120),'');
  v_timing text := nullif(left(lower(btrim(coalesce(p_request->>'purchase_timing',''))),120),'');
  v_purpose text := nullif(left(lower(btrim(coalesce(p_request->>'purpose',''))),120),'');
  v_summary text := nullif(left(btrim(coalesce(p_request->>'request_summary','')),2000),'');
  v_close_reason text := nullif(left(btrim(coalesce(p_request->>'closed_reason','')),1000),'');
  v_close_outcome text := nullif(lower(btrim(coalesce(p_request->>'close_outcome',''))),'');
  v_fields jsonb := coalesce(p_request->'fields_present','[]'::jsonb);
  v_clear jsonb := coalesce(p_request->'clear_fields','[]'::jsonb);
  v_budget_min numeric;
  v_budget_max numeric;
  v_land_min numeric;
  v_land_max numeric;
  v_built_min numeric;
  v_built_max numeric;
  v_bedrooms integer;
  v_bathrooms integer;
  v_furnished boolean;
  v_confidence numeric;
  v_pair_tmp numeric;
  v_review boolean := false;
  v_score integer;
  v_temp text;
  v_request_id uuid;
  v_valid_existing boolean := false;
  v_relation text := 'mentioned';
begin
  if not exists(select 1 from public.clients c where c.id=p_client_id and c.company_id=p_company_id) then
    raise exception 'Invalid client';
  end if;

  if v_action not in ('create','update','close','pause','resume','none') then v_action := 'none'; end if;
  if v_req_type not in ('buyer','seller','tenant','landlord','consultation','investor') then v_req_type := 'consultation'; end if;

  begin v_budget_min := nullif(p_request->>'budget_min','')::numeric; exception when others then v_budget_min := null; end;
  begin v_budget_max := nullif(p_request->>'budget_max','')::numeric; exception when others then v_budget_max := null; end;
  begin v_land_min := nullif(p_request->>'land_size_min','')::numeric; exception when others then v_land_min := null; end;
  begin v_land_max := nullif(p_request->>'land_size_max','')::numeric; exception when others then v_land_max := null; end;
  begin v_built_min := nullif(p_request->>'built_size_min','')::numeric; exception when others then v_built_min := null; end;
  begin v_built_max := nullif(p_request->>'built_size_max','')::numeric; exception when others then v_built_max := null; end;
  begin v_bedrooms := nullif(p_request->>'bedrooms_min','')::integer; exception when others then v_bedrooms := null; end;
  begin v_bathrooms := nullif(p_request->>'bathrooms_min','')::integer; exception when others then v_bathrooms := null; end;
  begin v_furnished := nullif(p_request->>'furnished','')::boolean; exception when others then v_furnished := null; end;
  begin v_confidence := nullif(p_request->>'confidence','')::numeric; exception when others then v_confidence := null; end;
  begin v_review := coalesce((p_request->>'needs_human_review')::boolean,false); exception when others then v_review := true; end;

  -- Defensive normalization: AI/user input should not be able to violate pair constraints.
  if v_budget_min is not null and v_budget_max is not null and v_budget_min > v_budget_max then
    v_pair_tmp := v_budget_min; v_budget_min := v_budget_max; v_budget_max := v_pair_tmp;
    v_review := true;
  end if;
  if v_land_min is not null and v_land_max is not null and v_land_min > v_land_max then
    v_pair_tmp := v_land_min; v_land_min := v_land_max; v_land_max := v_pair_tmp;
    v_review := true;
  end if;
  if v_built_min is not null and v_built_max is not null and v_built_min > v_built_max then
    v_pair_tmp := v_built_min; v_built_min := v_built_max; v_built_max := v_pair_tmp;
    v_review := true;
  end if;

  if jsonb_typeof(p_request->'property_types')='array' then
    select coalesce(array_agg(left(btrim(t.value),120)) filter (where btrim(t.value)<>''), '{}'::text[])
    into v_property_types from jsonb_array_elements_text(p_request->'property_types') as t(value);
  end if;
  if jsonb_typeof(p_request->'preferred_areas')='array' then
    select coalesce(array_agg(left(btrim(t.value),200)) filter (where btrim(t.value)<>''), '{}'::text[])
    into v_areas from jsonb_array_elements_text(p_request->'preferred_areas') as t(value);
  end if;
  if v_property_type is null and cardinality(v_property_types)>0 then v_property_type := v_property_types[1]; end if;
  if v_area is null and cardinality(v_areas)>0 then v_area := v_areas[1]; end if;
  if cardinality(v_property_types)=0 and v_property_type is not null then v_property_types := array[v_property_type]; end if;
  if cardinality(v_areas)=0 and v_area is not null then v_areas := array[v_area]; end if;

  v_score := public.calc_client_request_score(p_request);
  v_temp := case when v_score>=65 then 'hot' when v_score>=35 then 'warm' else 'cold' end;

  if p_existing_request_id is not null then
    select exists(
      select 1 from public.client_requests r
      where r.id=p_existing_request_id and r.client_id=p_client_id and r.company_id=p_company_id
    ) into v_valid_existing;
  end if;

  if v_action='none' then
    return jsonb_build_object('ok',true,'applied',false,'needs_human_review',true,'reason','ambiguous_request');
  end if;

  if v_action='create' then
    insert into public.client_requests(
      company_id,client_id,request_type,property_type,property_types,preferred_area,preferred_areas,wilayat,
      budget_min,budget_max,payment_method,purchase_timing,purpose,
      bedrooms_min,bathrooms_min,land_size_min,land_size_max,built_size_min,built_size_max,furnished,
      status,pipeline_stage,source,source_detail,assigned_to,route_key,inbound_number,
      created_via,origin_whatsapp_message_id,ai_confidence,needs_human_review,ai_extracted,
      lead_score,lead_temperature,notes,last_contact_at
    ) values (
      p_company_id,p_client_id,v_req_type,v_property_type,v_property_types,v_area,v_areas,v_wilayat,
      v_budget_min,v_budget_max,v_payment,v_timing,v_purpose,
      v_bedrooms,v_bathrooms,v_land_min,v_land_max,v_built_min,v_built_max,v_furnished,
      'active','new','whatsapp','WhatsApp AI',
      case when coalesce(p_route_key,'general')='general' then null else p_assigned_to end,
      p_route_key,p_inbound_number,
      'whatsapp',p_message_id,v_confidence,v_review,p_request,
      v_score,v_temp,v_summary,coalesce(p_message_at,now())
    ) returning id into v_request_id;
    v_relation := 'created';

  elsif not v_valid_existing then
    return jsonb_build_object('ok',true,'applied',false,'needs_human_review',true,'reason','invalid_or_missing_existing_request');

  elsif v_action='close' then
    update public.client_requests r
    set
      status = case when v_close_outcome in ('won','lost','cancelled') then v_close_outcome else 'cancelled' end,
      closed_reason = coalesce(v_close_reason,v_summary,r.closed_reason),
      needs_human_review = r.needs_human_review or v_review,
      ai_confidence = coalesce(v_confidence,r.ai_confidence),
      ai_extracted = p_request,
      last_contact_at = coalesce(p_message_at,now()),
      route_key = coalesce(p_route_key,r.route_key),
      inbound_number = coalesce(p_inbound_number,r.inbound_number),
      assigned_to = case when coalesce(p_route_key,'general')<>'general' and p_assigned_to is not null then p_assigned_to else r.assigned_to end
    where r.id=p_existing_request_id
    returning id into v_request_id;
    v_relation := 'closed';

  elsif v_action='pause' then
    update public.client_requests r
    set status='paused',
        needs_human_review=r.needs_human_review or v_review,
        ai_confidence=coalesce(v_confidence,r.ai_confidence),ai_extracted=p_request,
        last_contact_at=coalesce(p_message_at,now()),
        assigned_to=case when coalesce(p_route_key,'general')<>'general' and p_assigned_to is not null then p_assigned_to else r.assigned_to end,
        route_key=coalesce(p_route_key,r.route_key),inbound_number=coalesce(p_inbound_number,r.inbound_number)
    where r.id=p_existing_request_id returning id into v_request_id;
    v_relation := 'updated';

  elsif v_action='resume' then
    update public.client_requests r
    set status='active',
        needs_human_review=r.needs_human_review or v_review,
        ai_confidence=coalesce(v_confidence,r.ai_confidence),ai_extracted=p_request,
        last_contact_at=coalesce(p_message_at,now()),
        assigned_to=case when coalesce(p_route_key,'general')<>'general' and p_assigned_to is not null then p_assigned_to else r.assigned_to end,
        route_key=coalesce(p_route_key,r.route_key),inbound_number=coalesce(p_inbound_number,r.inbound_number)
    where r.id=p_existing_request_id returning id into v_request_id;
    v_relation := 'updated';

  else
    update public.client_requests r
    set
      request_type = case when v_fields ? 'request_type' then v_req_type else r.request_type end,
      property_type = case when (v_clear ? 'property_types') or (v_clear ? 'property_type') then null when (v_fields ? 'property_types') or (v_fields ? 'property_type') then v_property_type else r.property_type end,
      property_types = case when (v_clear ? 'property_types') or (v_clear ? 'property_type') then '{}'::text[] when (v_fields ? 'property_types') or (v_fields ? 'property_type') then v_property_types else r.property_types end,
      preferred_area = case when (v_clear ? 'preferred_areas') or (v_clear ? 'preferred_area') then null when (v_fields ? 'preferred_areas') or (v_fields ? 'preferred_area') then v_area else r.preferred_area end,
      preferred_areas = case when (v_clear ? 'preferred_areas') or (v_clear ? 'preferred_area') then '{}'::text[] when (v_fields ? 'preferred_areas') or (v_fields ? 'preferred_area') then v_areas else r.preferred_areas end,
      wilayat = case when v_clear ? 'wilayat' then null when v_fields ? 'wilayat' then v_wilayat else r.wilayat end,
      budget_min = case when v_clear ? 'budget' then null when v_fields ? 'budget' then v_budget_min else r.budget_min end,
      budget_max = case when v_clear ? 'budget' then null when v_fields ? 'budget' then v_budget_max else r.budget_max end,
      payment_method = case when v_clear ? 'payment_method' then null when v_fields ? 'payment_method' then v_payment else r.payment_method end,
      purchase_timing = case when v_clear ? 'purchase_timing' then null when v_fields ? 'purchase_timing' then v_timing else r.purchase_timing end,
      purpose = case when v_clear ? 'purpose' then null when v_fields ? 'purpose' then v_purpose else r.purpose end,
      bedrooms_min = case when v_clear ? 'bedrooms_min' then null when v_fields ? 'bedrooms_min' then v_bedrooms else r.bedrooms_min end,
      bathrooms_min = case when v_clear ? 'bathrooms_min' then null when v_fields ? 'bathrooms_min' then v_bathrooms else r.bathrooms_min end,
      land_size_min = case when v_clear ? 'land_size' then null when v_fields ? 'land_size' then v_land_min else r.land_size_min end,
      land_size_max = case when v_clear ? 'land_size' then null when v_fields ? 'land_size' then v_land_max else r.land_size_max end,
      built_size_min = case when v_clear ? 'built_size' then null when v_fields ? 'built_size' then v_built_min else r.built_size_min end,
      built_size_max = case when v_clear ? 'built_size' then null when v_fields ? 'built_size' then v_built_max else r.built_size_max end,
      furnished = case when v_clear ? 'furnished' then null when v_fields ? 'furnished' then v_furnished else r.furnished end,
      needs_human_review = r.needs_human_review or v_review,
      ai_confidence = coalesce(v_confidence,r.ai_confidence),
      ai_extracted = p_request,
      lead_score = case when jsonb_array_length(v_fields)>0 then v_score else r.lead_score end,
      lead_temperature = case when jsonb_array_length(v_fields)>0 then v_temp else r.lead_temperature end,
      last_contact_at = coalesce(p_message_at,now()),
      route_key = coalesce(p_route_key,r.route_key),
      inbound_number = coalesce(p_inbound_number,r.inbound_number),
      assigned_to = case when coalesce(p_route_key,'general')<>'general' and p_assigned_to is not null then p_assigned_to else r.assigned_to end
    where r.id=p_existing_request_id
    returning id into v_request_id;
    v_relation := 'updated';
  end if;

  if v_request_id is not null and p_message_id is not null then
    insert into public.whatsapp_message_requests(company_id,message_id,request_id,relation)
    values(p_company_id,p_message_id,v_request_id,v_relation)
    on conflict (message_id,request_id) do update set relation=excluded.relation;
  end if;

  perform public.refresh_client_request_summary(p_client_id);

  return jsonb_build_object(
    'ok',true,'applied',v_request_id is not null,'request_id',v_request_id,
    'relation',v_relation,'needs_human_review',v_review,
    'lead_score',v_score,'lead_temperature',v_temp
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.disable_missing_requirements_auto_reply_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_phone_digits text;
  v_test_allowed boolean := false;
begin
  select right(regexp_replace(coalesce(c.phone_normalized, c.phone, ''), '\D', '', 'g'), 11)
    into v_phone_digits
  from public.clients c
  where c.id = new.client_id and c.company_id = new.company_id;

  select exists (
    select 1
    from public.whatsapp_automation_runtime ar
    where ar.company_id = new.company_id
      and ar.mode = 'test'
      and 'buyer_intake_v1' = any(ar.enabled_scenarios)
      and v_phone_digits = any(ar.allowed_customer_phones)
  ) into v_test_allowed;

  if new.missing_required_fields is not null and not v_test_allowed then
    new.last_requirements_prompt_fields := new.missing_required_fields;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_infer_request_branches(p_route_key text, p_branch_key text, p_wilayat text, p_preferred_area text, p_preferred_areas text[], p_alternative_areas text[])
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  area_text text := lower(concat_ws(' ',coalesce(p_preferred_area,''),array_to_string(coalesce(p_preferred_areas,'{}'::text[]),' '),array_to_string(coalesce(p_alternative_areas,'{}'::text[]),' ')));
  wilayat_text text := lower(coalesce(p_wilayat,''));
  t text;
  has_barka boolean := false;
  has_muscat boolean := false;
begin
  if coalesce(p_route_key,'')='investment' or coalesce(p_branch_key,'')='investment' then
    return array['investment']::text[];
  end if;

  -- Remove relational phrases that mention Muscat as a landmark/proximity rather than a desired market.
  area_text := regexp_replace(area_text,'بنك[[:space:]]*مسقط',' ','g');
  area_text := regexp_replace(area_text,'(بالقرب[[:space:]]+من|قريب[هة]?[[:space:]]+من|قريب[هة]?[[:space:]]+)(مدينة[[:space:]]+)?مسقط',' ','g');
  area_text := regexp_replace(area_text,'منطق[هة][[:space:]]+قريب[هة][[:space:]]+من[[:space:]]+مسقط',' ','g');

  -- Preferred/alternative areas are the strongest signal. Only fall back to legacy wilayat when they do not identify either office market.
  t := area_text;

  has_barka := t ~ '(بركاء|بركا|حي[[:space:]]*عاصم|الهرم|الرميس|رميس|المنومة|المنومه|الشخاخيط|الفليج|الصومحان|صومحان|السوادي|السويادي|السودي|الحرادي|السلاحة|السلاحه|العقدة|العقده|القعدة|القعده|المريصي|المريسي|أبو[[:space:]]*النخيل|ابو[[:space:]]*النخيل|البلة|البله|العامرة)';
  has_muscat := t ~ '(مسقط|muscat|السيب|seeb|الخوض|المعبيل[هة]|المعبيبه|mabaela|maabela|الموالح|الحيل|بوشر|boushar|bawshar|القرم|الانصب|الأنصب|العذيبة|العذيبه|غلا|مدينة[[:space:]]*السلطان[[:space:]]*هيثم|وادي[[:space:]]*زها|العامرات|الجفنين|المسفاة|المسفاه|مرتفعات[[:space:]]*المطار|الموج|الغبرة|الغبره|الخوير|روي|مطرح|muttrah|يتي|قنتب|مدينة[[:space:]]*السلطان[[:space:]]*قابوس|الوطية|الوطيه|دارسيت|سداب|حرامل|البستان|الجصة|الجصه|ينكت|الخيران|السيفة|السيفه|مرتفعات[[:space:]]*مدينة[[:space:]]*الإعلام|مرتفعات[[:space:]]*مدينة[[:space:]]*الاعلام|الصاروج|العوابي|وادي[[:space:]]*الكبير|قريات|quriyat)';

  if not has_barka and not has_muscat then
    t := wilayat_text;
    has_barka := t ~ '(بركاء|بركا|حي[[:space:]]*عاصم|الهرم|الرميس|رميس|المنومة|المنومه|الشخاخيط|الفليج|الصومحان|صومحان|السوادي|السويادي|السودي|الحرادي|السلاحة|السلاحه|العقدة|العقده|القعدة|القعده|المريصي|المريسي|أبو[[:space:]]*النخيل|ابو[[:space:]]*النخيل|البلة|البله|العامرة)';
    has_muscat := t ~ '(مسقط|muscat|السيب|seeb|الخوض|المعبيل[هة]|المعبيبه|mabaela|maabela|الموالح|الحيل|بوشر|boushar|bawshar|القرم|الانصب|الأنصب|العذيبة|العذيبه|غلا|مدينة[[:space:]]*السلطان[[:space:]]*هيثم|وادي[[:space:]]*زها|العامرات|الجفنين|المسفاة|المسفاه|مرتفعات[[:space:]]*المطار|الموج|الغبرة|الغبره|الخوير|روي|مطرح|muttrah|يتي|قنتب|مدينة[[:space:]]*السلطان[[:space:]]*قابوس|الوطية|الوطيه|دارسيت|سداب|حرامل|البستان|الجصة|الجصه|ينكت|الخيران|السيفة|السيفه|مرتفعات[[:space:]]*مدينة[[:space:]]*الإعلام|مرتفعات[[:space:]]*مدينة[[:space:]]*الاعلام|الصاروج|العوابي|وادي[[:space:]]*الكبير|قريات|quriyat)';
  end if;

  if has_barka and has_muscat then return array['muscat','barka']::text[]; end if;
  if has_barka then return array['barka']::text[]; end if;
  if has_muscat then return array['muscat']::text[]; end if;
  return '{}'::text[];
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_whatsapp_client_request_guarded(p_company_id uuid, p_client_id uuid, p_action text, p_existing_request_id uuid, p_assigned_to uuid, p_route_key text, p_inbound_number text, p_message_id uuid, p_request jsonb, p_message_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_action text := lower(btrim(coalesce(p_action,'none')));
  v_review boolean := false;
  v_confidence numeric := null;
  v_fields jsonb :=
    case
      when jsonb_typeof(p_request->'fields_present')='array'
      then p_request->'fields_present'
      else '[]'::jsonb
    end;
  v_clear jsonb :=
    case
      when jsonb_typeof(p_request->'clear_fields')='array'
      then p_request->'clear_fields'
      else '[]'::jsonb
    end;
  v_close_outcome text :=
    nullif(lower(btrim(coalesce(p_request->>'close_outcome',''))),'');
  v_effective_request jsonb := coalesce(p_request,'{}'::jsonb);

  v_existing_status text := null;
  v_valid_existing boolean := false;
  v_result jsonb;
  v_applied boolean := false;
begin

  if v_action not in (
    'create',
    'update',
    'close',
    'pause',
    'resume',
    'none'
  ) then
    v_action := 'none';
  end if;

  begin
    v_review :=
      coalesce(
        (p_request->>'needs_human_review')::boolean,
        false
      );
  exception
    when others then
      v_review := true;
  end;

  begin
    v_confidence :=
      nullif(p_request->>'confidence','')::numeric;
  exception
    when others then
      v_confidence := null;
  end;

  -- New low-confidence requests are retained but flagged.
  if v_action='create'
     and (v_confidence is null or v_confidence < 0.60) then
    v_review := true;
    v_effective_request :=
      v_effective_request ||
      jsonb_build_object(
        'needs_human_review',
        true
      );
  end if;

  if v_action='none' then
    return jsonb_build_object(
      'ok',true,
      'applied',false,
      'needs_human_review',true,
      'reason','ambiguous_request'
    );
  end if;


  -- Read exact existing request + status.
  if p_existing_request_id is not null then
    select r.status
    into v_existing_status
    from public.client_requests r
    where r.id = p_existing_request_id
      and r.client_id = p_client_id
      and r.company_id = p_company_id
    limit 1;
  end if;


  -- Normal mutations only apply to currently active/paused requests.
  if v_action in ('update','close','pause') then

    v_valid_existing :=
      v_existing_status in ('active','paused');

    if not v_valid_existing then
      return jsonb_build_object(
        'ok',true,
        'applied',false,
        'needs_human_review',true,
        'reason','invalid_existing_request_status',
        'existing_status',v_existing_status
      );
    end if;

  end if;


  -- Resume is allowed for a paused OR explicitly cancelled request.
  if v_action='resume' then

    v_valid_existing :=
      v_existing_status in ('paused','cancelled');

    if not v_valid_existing then
      return jsonb_build_object(
        'ok',true,
        'applied',false,
        'needs_human_review',true,
        'reason','request_not_resumable',
        'existing_status',v_existing_status
      );
    end if;

  end if;


  -- Existing request mutations need high confidence.
  if v_action in ('update','close','pause','resume') then

    if p_existing_request_id is null
       or v_existing_status is null then
      return jsonb_build_object(
        'ok',true,
        'applied',false,
        'needs_human_review',true,
        'reason','invalid_or_missing_existing_request'
      );
    end if;

    if v_review
       or v_confidence is null
       or v_confidence < 0.80 then
      return jsonb_build_object(
        'ok',true,
        'applied',false,
        'needs_human_review',true,
        'reason','unsafe_existing_request_change',
        'confidence',v_confidence
      );
    end if;

  end if;


  if v_action='update'
     and jsonb_array_length(v_fields)=0
     and jsonb_array_length(v_clear)=0 then
    return jsonb_build_object(
      'ok',true,
      'applied',false,
      'needs_human_review',true,
      'reason','no_explicit_fields_to_update'
    );
  end if;


  if v_action='close'
     and v_close_outcome not in (
       'won',
       'lost',
       'cancelled'
     ) then
    return jsonb_build_object(
      'ok',true,
      'applied',false,
      'needs_human_review',true,
      'reason','unclear_close_outcome'
    );
  end if;


  -- Use the existing core mutation function.
  v_result :=
    public.apply_whatsapp_client_request(
      p_company_id,
      p_client_id,
      v_action,
      p_existing_request_id,
      p_assigned_to,
      p_route_key,
      p_inbound_number,
      p_message_id,
      v_effective_request,
      p_message_at
    );


  begin
    v_applied :=
      coalesce(
        (v_result->>'applied')::boolean,
        false
      );
  exception
    when others then
      v_applied := false;
  end;


  -- When reopening a cancelled request,
  -- remove the old cancellation reason.
  if v_action='resume'
     and v_applied
     and p_existing_request_id is not null then

    update public.client_requests
    set closed_reason = null
    where id = p_existing_request_id
      and company_id = p_company_id
      and client_id = p_client_id;

  end if;


  return v_result;

end;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_refresh_client_primary_assignment(p_company_id uuid, p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  users uuid[];
  branches text[];
  primary_user uuid;
  primary_route text;
begin
  select array_agg(distinct a.user_id), array_agg(distinct a.branch_key)
    into users,branches
  from public.client_request_assignees a
  join public.client_requests r on r.id=a.request_id
  where a.company_id=p_company_id and r.client_id=p_client_id and r.status in ('active','paused');

  if coalesce(array_length(users,1),0)=0 then return; end if;

  if array_length(users,1)=1 then
    primary_user:=users[1];
    if 'investment'=any(branches) and coalesce(array_length(branches,1),0)=1 then primary_route:='investment';
    elsif 'barka'=any(branches) and not ('muscat'=any(branches)) then primary_route:='barka';
    elsif 'muscat'=any(branches) and not ('barka'=any(branches)) then primary_route:='muscat';
    else primary_route:='general'; end if;
  else
    select c.assigned_to into primary_user from public.clients c where c.id=p_client_id and c.company_id=p_company_id;
    if primary_user is null or not (primary_user=any(users)) then
      select r.assigned_to into primary_user from public.company_lead_routes r where r.company_id=p_company_id and r.route_key='muscat' and r.is_active=true limit 1;
      if primary_user is null or not (primary_user=any(users)) then primary_user:=users[1]; end if;
    end if;
    primary_route:='general';
  end if;

  update public.clients
     set assigned_to=primary_user,
         lead_route=primary_route
   where id=p_client_id and company_id=p_company_id
     and (assigned_to is distinct from primary_user or lead_route is distinct from primary_route);

  -- Physical WhatsApp inbox assignment belongs to its configured line, not request geography.

end;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_crm_phone(p_phone text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE v_input text; v_digits text;
BEGIN
  IF p_phone IS NULL OR btrim(p_phone)='' THEN RETURN NULL; END IF;
  v_input:=translate(btrim(p_phone),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789');
  v_input:=regexp_replace(v_input,'[[:space:]().-]','','g');
  IF v_input !~ '^\+?[0-9]+$' THEN RETURN NULL; END IF;
  v_digits:=ltrim(v_input,'+');
  IF v_digits LIKE '00%' THEN v_digits:=substr(v_digits,3); END IF;
  IF length(v_digits)=8 THEN v_digits:='968'||v_digits; END IF;
  IF length(v_digits)<7 OR length(v_digits)>15 OR v_digits !~ '^[1-9][0-9]+$' THEN RETURN NULL; END IF;
  IF v_digits LIKE '968%' AND length(v_digits)<>11 THEN RETURN NULL; END IF;
  RETURN '+'||v_digits;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_activity_compat_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.type := coalesce(new.type,new.activity_type,'other');
  new.activity_type := coalesce(new.activity_type,new.type,'other');
  new.description := coalesce(new.description,new.activity_text);
  new.activity_text := coalesce(new.activity_text,new.description);
  new.occurred_at := coalesce(new.occurred_at,new.created_at,now());
  new.recorded_at := coalesce(new.recorded_at,now());
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_new_client_phone_duplicate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_normalized text;
begin
  v_normalized := public.normalize_crm_phone(new.phone);
  new.phone_normalized := v_normalized;
  if v_normalized is not null and exists (
    select 1 from public.clients c
    where c.company_id = new.company_id
      and c.phone_normalized = v_normalized
      and c.id <> coalesce(new.id, gen_random_uuid())
  ) then
    raise exception using
      errcode = '23505',
      message = 'Duplicate client phone in this company',
      detail = v_normalized;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_client_phone_normalized()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  new.phone_normalized:=public.normalize_crm_phone(new.phone);
  IF coalesce(btrim(new.phone),'')<>'' AND new.phone_normalized IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='phone_invalid';
  END IF;
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.initialize_property_monitoring()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.performance_tracking_started_at is null then
    new.performance_tracking_started_at := coalesce(new.created_at, now());
  end if;

  -- A newly entered property is not an immediate intervention. Give the team
  -- a full day to finish the record and attach/publish the Instagram Reel.
  if new.photography_status is null or new.photography_status='unknown' then
    new.photography_status := 'needs_initial';
  end if;
  if new.photography_reason is null then
    new.photography_reason := 'new_property';
  end if;
  if new.photography_required_at is null then
    new.photography_required_at := now() + interval '24 hours';
  end if;

  if new.marketing_review_status is null or new.marketing_review_status='healthy' then
    new.marketing_review_status := 'pending';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.capture_request_response_milestones()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op='UPDATE' and new.request_id is not distinct from old.request_id then
    return new;
  end if;
  if new.request_id is null then return new; end if;

  if new.direction='outbound' and new.actor_type='human' then
    update public.client_requests r
    set first_human_response_at=coalesce(r.first_human_response_at,new.message_timestamp,new.created_at),
        last_contact_at=greatest(coalesce(r.last_contact_at,'-infinity'::timestamptz),coalesce(new.message_timestamp,new.created_at))
    where r.id=new.request_id and r.company_id=new.company_id;
  elsif new.direction='inbound' then
    update public.client_requests r
    set first_mutual_dialogue_at = case
          when r.first_human_response_at is not null and r.first_mutual_dialogue_at is null
            and coalesce(new.message_timestamp,new.created_at) >= r.first_human_response_at
          then coalesce(new.message_timestamp,new.created_at)
          else r.first_mutual_dialogue_at end,
        last_mutual_contact_at = case
          when r.first_human_response_at is not null and coalesce(new.message_timestamp,new.created_at) >= r.first_human_response_at
          then greatest(coalesce(r.last_mutual_contact_at,'-infinity'::timestamptz),coalesce(new.message_timestamp,new.created_at))
          else r.last_mutual_contact_at end,
        last_contact_at=greatest(coalesce(r.last_contact_at,'-infinity'::timestamptz),coalesce(new.message_timestamp,new.created_at))
    where r.id=new.request_id and r.company_id=new.company_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.my_company()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT p.company_id FROM public.profiles p
       WHERE p.id = (SELECT auth.uid()) AND p.is_active IS TRUE $function$
;

CREATE OR REPLACE FUNCTION public.my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT p.role FROM public.profiles p
       WHERE p.id = (SELECT auth.uid()) AND p.is_active IS TRUE $function$
;

CREATE OR REPLACE FUNCTION public.crm_funnel_cohort_metrics(p_period_id uuid, p_branch_key text DEFAULT NULL::text, p_assigned_to uuid DEFAULT NULL::uuid, p_request_type text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_new_client boolean DEFAULT NULL::boolean)
 RETURNS TABLE(metric_order integer, metric_key text, metric_label_ar text, metric_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with period as (
  select mp.starts_on,mp.ends_on
  from public.measurement_periods mp
  where mp.id=p_period_id and mp.company_id=(select public.my_company())
), cohort as (
  select r.*
  from public.client_requests r, period p
  where r.company_id=(select public.my_company())
    and r.created_at >= p.starts_on::timestamptz
    and r.created_at < (p.ends_on+1)::timestamptz
    and (p_branch_key is null or r.branch_key=p_branch_key)
    and (p_assigned_to is null or r.assigned_to=p_assigned_to)
    and (p_request_type is null or r.request_type=p_request_type)
    and (p_source is null or r.source=p_source)
    and (p_new_client is null or coalesce(r.is_first_request,false)=p_new_client)
), metrics as (
  select 10 o,'new_clients_unique' k,'العملاء الجدد الفريدون' l,count(distinct client_id) filter(where coalesce(is_first_request,false)) n from cohort
  union all select 20,'new_buyers_unique','عملاء الشراء الجدد الفريدون',count(distinct client_id) filter(where coalesce(is_first_request,false) and request_type in ('buyer','investor')) from cohort
  union all select 30,'new_requests','الطلبات الجديدة',count(*) from cohort
  union all select 40,'human_responded','تم الرد بشريًا',count(*) filter(where first_human_response_at is not null) from cohort
  union all select 50,'mutual_dialogue','حدث حوار متبادل',count(*) filter(where first_mutual_dialogue_at is not null) from cohort
  union all select 60,'requirements_completed','اكتمل جمع الطلب',count(*) filter(where requirements_completed_at is not null) from cohort
  union all select 70,'qualified','طلبات مؤهلة',count(*) filter(where qualified_at is not null) from cohort
  union all select 80,'match_sent','عُرض عقار مطابق',count(*) filter(where first_match_sent_at is not null) from cohort
  union all select 90,'appointment_booked','موعد محجوز',count(*) filter(where first_appointment_booked_at is not null) from cohort
  union all select 100,'appointment_confirmed','موعد مؤكد',count(*) filter(where first_appointment_confirmed_at is not null) from cohort
  union all select 110,'attended','حضور فعلي فريد',count(*) filter(where first_attended_at is not null) from cohort
  union all select 120,'serious_interest','اهتمام جاد',count(*) filter(where serious_interest_at is not null) from cohort
  union all select 130,'opportunity_opened','فرصة بيع',count(*) filter(where opportunity_opened_at is not null) from cohort
  union all select 140,'negotiation_started','تفاوض / تمويل',count(*) filter(where negotiation_started_at is not null) from cohort
  union all select 150,'deposit_paid','عربون',count(*) filter(where deposit_paid_at is not null) from cohort
  union all select 160,'contract_completed','عقد / إجراء نهائي',count(*) filter(where contract_completed_at is not null) from cohort
  union all select 170,'closed_won','صفقة مغلقة',count(*) filter(where closed_won_at is not null) from cohort
  union all select 180,'qualified_no_match','مؤهل بلا عقار مطابق',count(*) filter(where qualified_at is not null and first_match_sent_at is null and status in ('active','paused')) from cohort
)
select o,k,l,n::bigint from metrics order by o;
$function$
;

CREATE OR REPLACE FUNCTION public.record_request_milestone_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.first_human_response_at is null and new.first_human_response_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'human_responded','human_responded','system',new.updated_by,new.first_human_response_at,now(),'أول رد بشري');
  end if;
  if old.first_mutual_dialogue_at is null and new.first_mutual_dialogue_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'mutual_dialogue','mutual_dialogue','system',new.updated_by,new.first_mutual_dialogue_at,now(),'أول حوار متبادل');
  end if;
  if old.requirements_completed_at is null and new.requirements_completed_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'requirements_completed','requirements_completed','system',new.updated_by,new.requirements_completed_at,now(),'اكتمل جمع الطلب');
  end if;
  if old.qualified_at is null and new.qualified_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'qualified','qualified','system',new.updated_by,new.qualified_at,now(),'تم تأهيل الطلب');
  end if;
  if old.first_match_sent_at is null and new.first_match_sent_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'match_sent','match_sent','system',new.updated_by,new.first_match_sent_at,now(),'أول عقار مطابق عُرض');
  end if;
  if old.first_appointment_booked_at is null and new.first_appointment_booked_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'appointment_booked','appointment_booked','system',new.updated_by,new.first_appointment_booked_at,now(),'أول موعد محجوز');
  end if;
  if old.first_appointment_confirmed_at is null and new.first_appointment_confirmed_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'appointment_confirmed','appointment_confirmed','system',new.updated_by,new.first_appointment_confirmed_at,now(),'أول موعد مؤكد');
  end if;
  if old.first_attended_at is null and new.first_attended_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'attended','attended','system',new.updated_by,new.first_attended_at,now(),'أول حضور فعلي');
  end if;
  if old.serious_interest_at is null and new.serious_interest_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'serious_interest','serious_interest','system',new.updated_by,new.serious_interest_at,now(),'اهتمام جاد بعد الزيارة');
  end if;
  if old.opportunity_opened_at is null and new.opportunity_opened_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'opportunity_opened','opportunity_opened','system',new.updated_by,new.opportunity_opened_at,now(),'فُتحت فرصة بيع');
  end if;
  if old.negotiation_started_at is null and new.negotiation_started_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'negotiation_started','negotiation_started','system',new.updated_by,new.negotiation_started_at,now(),'بدأ التفاوض أو التمويل');
  end if;
  if old.deposit_paid_at is null and new.deposit_paid_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'deposit_paid','deposit_paid','system',new.updated_by,new.deposit_paid_at,now(),'تم دفع العربون');
  end if;
  if old.contract_completed_at is null and new.contract_completed_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'contract_completed','contract_completed','system',new.updated_by,new.contract_completed_at,now(),'اكتمل العقد أو الإجراء النهائي');
  end if;
  if old.closed_won_at is null and new.closed_won_at is not null then
    insert into public.client_request_events(company_id,request_id,client_id,event_type,stage,source,actor_id,occurred_at,recorded_at,notes)
    values(new.company_id,new.id,new.client_id,'closed_won','closed_won','system',new.updated_by,new.closed_won_at,now(),'صفقة مغلقة');
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_whatsapp_request_batch_guarded(p_company_id uuid, p_client_id uuid, p_assigned_to uuid, p_route_key text, p_inbound_number text, p_message_id uuid, p_requests jsonb, p_message_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item jsonb;
  v_action text;
  v_existing_request_id uuid;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_applied_count integer := 0;
  v_review_needed boolean := false;
  v_existing_links integer := 0;
  v_applied boolean := false;
  v_item_review boolean := false;
  v_linked_request_id uuid;
  v_distinct_request_count integer := 0;
  v_fields jsonb;
  v_clear jsonb;
  v_sanitized_clear jsonb;
  v_clear_key text;
  v_message_body text := '';
begin
  if p_company_id is null or p_client_id is null or not exists(
    select 1 from public.clients c where c.id=p_client_id and c.company_id=p_company_id
  ) then raise exception 'Invalid client'; end if;

  if p_message_id is null or not exists(
    select 1 from public.whatsapp_messages m
    where m.id=p_message_id and m.company_id=p_company_id and m.client_id=p_client_id
  ) then raise exception 'Invalid WhatsApp message'; end if;

  if jsonb_typeof(p_requests)<>'array' or jsonb_array_length(p_requests)>5 then raise exception 'Invalid request batch'; end if;

  select count(*)::integer into v_existing_links
  from public.whatsapp_message_requests wmr
  where wmr.company_id=p_company_id and wmr.message_id=p_message_id;

  if v_existing_links>0 then
    select count(distinct wmr.request_id), (array_agg(wmr.request_id order by wmr.request_id))[1]
      into v_distinct_request_count,v_linked_request_id
    from public.whatsapp_message_requests wmr
    where wmr.company_id=p_company_id and wmr.message_id=p_message_id;
    if v_distinct_request_count=1 then
      update public.whatsapp_messages set request_id=v_linked_request_id
      where id=p_message_id and company_id=p_company_id and request_id is distinct from v_linked_request_id;
    end if;
    return jsonb_build_object('ok',true,'already_processed',true,'applied_count',v_existing_links,
      'needs_human_review',false,'results','[]'::jsonb,
      'linked_request_id',case when v_distinct_request_count=1 then v_linked_request_id else null end);
  end if;

  select coalesce(m.body,'') into v_message_body
  from public.whatsapp_messages m
  where m.id=p_message_id and m.company_id=p_company_id;

  for v_item in select value from jsonb_array_elements(p_requests)
  loop
    if jsonb_typeof(v_item)<>'object' then raise exception 'Invalid request item'; end if;

    -- If AI emitted the same field in fields_present and clear_fields, the explicit
    -- value/state in fields_present wins. This prevents a valid budget/location from
    -- being erased by a contradictory clear_fields entry.
    v_fields := case when jsonb_typeof(v_item->'fields_present')='array' then v_item->'fields_present' else '[]'::jsonb end;
    v_clear := case when jsonb_typeof(v_item->'clear_fields')='array' then v_item->'clear_fields' else '[]'::jsonb end;
    v_sanitized_clear := '[]'::jsonb;
    for v_clear_key in select value from jsonb_array_elements_text(v_clear)
    loop
      if v_fields ? v_clear_key then continue; end if;
      if v_clear_key in ('property_type','property_types') and ((v_fields ? 'property_type') or (v_fields ? 'property_types')) then continue; end if;
      if v_clear_key in ('preferred_area','preferred_areas') and ((v_fields ? 'preferred_area') or (v_fields ? 'preferred_areas')) then continue; end if;
      v_sanitized_clear := v_sanitized_clear || jsonb_build_array(v_clear_key);
    end loop;
    v_item := jsonb_set(v_item,'{clear_fields}',v_sanitized_clear,true);

    v_action:=lower(btrim(coalesce(v_item->>'action','none')));
    if v_action not in ('create','update','close','pause','resume','none') then v_action:='none'; end if;

    -- Never auto-create an "استشارة" merely because the customer sent a generic
    -- request/greeting. Consultation requires explicit advice/consultation intent.
    if v_action='create'
       and lower(coalesce(v_item->>'request_type',''))='consultation'
       and jsonb_array_length(v_fields)=0
       and coalesce(v_message_body,'') !~* '(استشار|استشارة|مشور|رأي|تقييم|تثمين|consult)' then
      v_action := 'none';
      v_item := jsonb_set(v_item,'{action}','"none"'::jsonb,true);
      v_item := jsonb_set(v_item,'{needs_human_review}','true'::jsonb,true);
    end if;

    begin v_existing_request_id:=nullif(v_item->>'existing_request_id','')::uuid;
    exception when others then v_existing_request_id:=null; end;

    v_result:=public.apply_whatsapp_client_request_guarded(
      p_company_id,p_client_id,v_action,v_existing_request_id,p_assigned_to,p_route_key,
      p_inbound_number,p_message_id,v_item,p_message_at
    );
    v_results:=v_results||jsonb_build_array(v_result);
    begin v_applied:=coalesce((v_result->>'applied')::boolean,false); exception when others then v_applied:=false; end;
    begin v_item_review:=coalesce((v_result->>'needs_human_review')::boolean,false); exception when others then v_item_review:=true; end;
    if v_applied then v_applied_count:=v_applied_count+1; end if;
    if v_item_review or v_action='none' then v_review_needed:=true; end if;
  end loop;

  select count(distinct wmr.request_id), (array_agg(wmr.request_id order by wmr.request_id))[1]
    into v_distinct_request_count,v_linked_request_id
  from public.whatsapp_message_requests wmr
  where wmr.company_id=p_company_id and wmr.message_id=p_message_id;

  if v_distinct_request_count=1 then
    update public.whatsapp_messages
    set request_id=v_linked_request_id,
        actor_type=coalesce(actor_type,'customer'),
        channel_source=coalesce(channel_source,'whatsapp')
    where id=p_message_id and company_id=p_company_id;
  end if;

  return jsonb_build_object('ok',true,'already_processed',false,'applied_count',v_applied_count,
    'needs_human_review',v_review_needed,'results',v_results,
    'linked_request_id',case when v_distinct_request_count=1 then v_linked_request_id else null end);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_activity_metrics(p_start_date date, p_end_date date, p_branch_key text DEFAULT NULL::text, p_assigned_to uuid DEFAULT NULL::uuid)
 RETURNS TABLE(metric_key text, metric_label_ar text, metric_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with ev as (
  select e.event_type,e.request_id
  from public.client_request_events e
  join public.client_requests r on r.id=e.request_id and r.company_id=e.company_id
  where e.company_id=(select public.my_company())
    and e.occurred_at >= p_start_date::timestamptz
    and e.occurred_at < (p_end_date+1)::timestamptz
    and (p_branch_key is null or r.branch_key=p_branch_key)
    and (p_assigned_to is null or r.assigned_to=p_assigned_to)
), a as (
  select 'human_responded' k,'ردود بشرية' l,count(distinct request_id) n from ev where event_type='human_responded'
  union all select 'mutual_dialogue','حوارات متبادلة',count(distinct request_id) from ev where event_type='mutual_dialogue'
  union all select 'qualified','طلبات تأهلت',count(distinct request_id) from ev where event_type='qualified'
  union all select 'match_sent','عقارات مطابقة عُرضت',count(distinct request_id) from ev where event_type='match_sent'
  union all select 'serious_interest','اهتمام جاد',count(distinct request_id) from ev where event_type='serious_interest'
  union all select 'opportunity_opened','فرص بيع فُتحت',count(distinct request_id) from ev where event_type='opportunity_opened'
  union all select 'negotiation_started','مفاوضات بدأت',count(distinct request_id) from ev where event_type='negotiation_started'
  union all select 'deposit_paid','عربون مدفوع',count(distinct request_id) from ev where event_type='deposit_paid'
  union all select 'closed_won','صفقات أغلقت',count(distinct request_id) from ev where event_type='closed_won'
), ap as (
  select
    count(*) filter(where booked_at>=p_start_date::timestamptz and booked_at<(p_end_date+1)::timestamptz) booked,
    count(*) filter(where confirmed_at>=p_start_date::timestamptz and confirmed_at<(p_end_date+1)::timestamptz) confirmed,
    count(*) filter(where attended_at>=p_start_date::timestamptz and attended_at<(p_end_date+1)::timestamptz and status='attended') attended,
    count(*) filter(where status='no_show' and appointment_at>=p_start_date::timestamptz and appointment_at<(p_end_date+1)::timestamptz) no_show
  from public.appointments x
  where x.company_id=(select public.my_company())
    and (p_branch_key is null or x.branch_key=p_branch_key)
    and (p_assigned_to is null or x.agent_id=p_assigned_to)
)
select k,l,n::bigint from a
union all select 'appointments_booked','مواعيد محجوزة',booked::bigint from ap
union all select 'appointments_confirmed','مواعيد مؤكدة',confirmed::bigint from ap
union all select 'appointments_attended','حضور فعلي',attended::bigint from ap
union all select 'appointments_no_show','عدم حضور',no_show::bigint from ap;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_qualified_attendance_opportunity_7d(p_branch_key text DEFAULT NULL::text, p_assigned_to uuid DEFAULT NULL::uuid, p_new_client boolean DEFAULT NULL::boolean)
 RETURNS TABLE(numerator bigint, denominator bigint, conversion_pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with eligible as (
  select r.*
  from public.client_requests r
  where r.company_id=(select public.my_company())
    and r.qualified_at is not null
    and r.first_attended_at is not null
    and r.first_attended_at <= now()-interval '7 days'
    and (p_branch_key is null or r.branch_key=p_branch_key)
    and (p_assigned_to is null or r.assigned_to=p_assigned_to)
    and (p_new_client is null or coalesce(r.is_first_request,false)=p_new_client)
), agg as (
  select count(*)::bigint denominator,
         count(*) filter(where opportunity_opened_at is not null
                           and opportunity_opened_at>=first_attended_at
                           and opportunity_opened_at<=first_attended_at+interval '7 days')::bigint numerator
  from eligible
)
select numerator,denominator,
       case when denominator=0 then null else round(numerator::numeric*100/denominator,2) end
from agg;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_client_request_refs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not exists (
    select 1 from public.clients c where c.id=new.client_id and c.company_id=new.company_id
  ) then
    raise exception 'Client request company mismatch';
  end if;

  if new.assigned_to is not null and not exists (
    select 1 from public.profiles p where p.id=new.assigned_to and p.company_id=new.company_id
  ) then
    raise exception 'Assigned user company mismatch';
  end if;

  if new.subject_property_id is not null and not exists (
    select 1 from public.properties p where p.id=new.subject_property_id and p.company_id=new.company_id
  ) then
    raise exception 'Property company mismatch';
  end if;

  if new.origin_whatsapp_message_id is not null and not exists (
    select 1 from public.whatsapp_messages m where m.id=new.origin_whatsapp_message_id and m.company_id=new.company_id
  ) then
    raise exception 'WhatsApp message company mismatch';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_data_quality_summary()
 RETURNS TABLE(issue_key text, issue_label_ar text, issue_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with c as (select * from public.clients where company_id=(select public.my_company())),
     r as (select * from public.client_requests where company_id=(select public.my_company())),
     ap as (select * from public.appointments where company_id=(select public.my_company())),
     v as (select * from public.viewings where company_id=(select public.my_company())),
     wm as (select * from public.whatsapp_messages where company_id=(select public.my_company()))
select 'clients_missing_phone_normalized','عملاء بلا هاتف موحّد',count(*) from c where phone_normalized is null
union all
select 'duplicate_phone_groups','مجموعات أرقام هاتف مكررة',count(*) from (
  select phone_normalized from c where phone_normalized is not null group by phone_normalized having count(*)>1
) d
union all
select 'requests_missing_core_fields','طلبات غير مكتملة البيانات الأساسية',count(*) from r
where status in ('active','paused') and (
  coalesce(array_length(preferred_areas,1),0)=0 or
  coalesce(array_length(property_types,1),0)=0 or
  (budget_min is null and budget_max is null) or
  payment_method is null or purchase_timing is null or bedrooms_min is null or
  coalesce(array_length(must_haves,1),0)=0 or decision_maker_status is null
)
union all
select 'open_requests_no_next_followup','طلبات مفتوحة بلا متابعة قادمة',count(*) from r where status in ('active','paused') and next_followup is null
union all
select 'appointments_without_result','مواعيد منتهية بلا نتيجة',count(*) from ap where status in ('attended','no_show','cancelled') and result is null
union all
select 'viewings_without_notes','معاينات مكتملة بلا ملاحظات',count(*) from v where status='done' and notes is null and client_feedback is null
union all
select 'closed_requests_without_reason','طلبات مغلقة/خاسرة بلا سبب',count(*) from r where status in ('lost','cancelled') and closed_reason is null
union all
select 'whatsapp_unlinked_to_request','رسائل واتساب غير مرتبطة بطلب',count(*) from wm where direction in ('inbound','outbound') and request_id is null
union all
select 'whatsapp_processing_errors','رسائل واتساب تحتاج مراجعة معالجة',count(*) from wm where processing_error is not null;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_request_from_appointment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_booked timestamptz;
  v_confirmed timestamptz;
  v_attended timestamptz;
begin
  if new.request_id is null then return new; end if;
  v_booked:=coalesce(new.booked_at,new.created_at,now());
  v_confirmed:=case when new.confirmed_at is not null then new.confirmed_at when new.status in ('confirmed','attended') then new.appointment_at else null end;
  v_attended:=case when new.status='attended' then coalesce(new.attended_at,new.appointment_at) else null end;

  update public.client_requests r
  set first_appointment_booked_at=case when r.first_appointment_booked_at is null or v_booked<r.first_appointment_booked_at then v_booked else r.first_appointment_booked_at end,
      first_appointment_confirmed_at=case when v_confirmed is not null and (r.first_appointment_confirmed_at is null or v_confirmed<r.first_appointment_confirmed_at) then v_confirmed else r.first_appointment_confirmed_at end,
      first_attended_at=case when v_attended is not null and (r.first_attended_at is null or v_attended<r.first_attended_at) then v_attended else r.first_attended_at end,
      updated_at=now()
  where r.id=new.request_id and r.company_id=new.company_id;

  if new.status='attended' then
    update public.property_inquiries pi
    set viewing_completed=true,
        status=case when pi.status in ('inquiry','followup','viewing_scheduled') then 'viewed' else pi.status end,
        updated_at=now()
    where pi.company_id=new.company_id and pi.request_id=new.request_id
      and exists(select 1 from public.appointment_properties ap where ap.appointment_id=new.id and ap.property_id=pi.property_id);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_sync_property_status(p_property_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT crm_repair_private.sync_property_status_checked(p_property_id) $function$
;

CREATE OR REPLACE FUNCTION public.sync_request_from_property_inquiry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_at timestamptz:=coalesce(new.last_contact_at,new.updated_at,new.last_inquiry_at,now());
begin
  if new.request_id is null then return new; end if;
  update public.client_requests r
  set first_match_sent_at=case when new.shown_by_agent and new.match_status='matched' and r.first_match_sent_at is null then v_at else r.first_match_sent_at end,
      serious_interest_at=case when lower(coalesce(new.post_visit_interest,'')) in ('serious','high') and r.serious_interest_at is null then v_at else r.serious_interest_at end,
      opportunity_opened_at=case when new.status in ('negotiation','reserved','deal') and r.opportunity_opened_at is null then v_at else r.opportunity_opened_at end,
      negotiation_started_at=case when new.status='negotiation' and r.negotiation_started_at is null then v_at else r.negotiation_started_at end,
      updated_at=now()
  where r.id=new.request_id and r.company_id=new.company_id;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_set_client_followup_state(p_client_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid := (select public.my_company());
  v_now timestamptz := now();
begin
  if not exists(select 1 from public.clients where id=p_client_id and company_id=v_company) then
    raise exception 'client_not_found';
  end if;

  if p_action='contacted' then
    update public.clients set
      human_contact_at=v_now,
      last_contact_at=v_now,
      followup_suppressed=false,
      followup_suppressed_reason=null,
      followup_suppressed_at=null,
      followup_suppressed_by=null,
      updated_at=v_now
    where id=p_client_id and company_id=v_company;
    update public.client_requests set
      first_human_response_at=coalesce(first_human_response_at,v_now),
      last_contact_at=v_now,
      updated_at=v_now,
      updated_by=auth.uid()
    where client_id=p_client_id and company_id=v_company and status='active'
      and (first_human_response_at is null);
  elsif p_action='suppress' then
    if coalesce(trim(p_reason),'')='' then raise exception 'reason_required'; end if;
    update public.clients set
      followup_suppressed=true,
      followup_suppressed_reason=trim(p_reason),
      followup_suppressed_at=v_now,
      followup_suppressed_by=auth.uid(),
      updated_at=v_now
    where id=p_client_id and company_id=v_company;
  elsif p_action='resume' then
    update public.clients set
      followup_suppressed=false,
      followup_suppressed_reason=null,
      followup_suppressed_at=null,
      followup_suppressed_by=null,
      updated_at=v_now
    where id=p_client_id and company_id=v_company;
  else
    raise exception 'invalid_action';
  end if;

  return jsonb_build_object('ok',true,'action',p_action,'client_id',p_client_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_whatsapp_latest_messages(p_conversation_ids uuid[])
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT to_jsonb(latest) FROM (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id,m.request_id,m.direction,m.actor_type,m.body,m.transcript,
      m.message_type,m.message_timestamp,m.delivery_status,m.automation_result
    FROM public.whatsapp_messages m
    JOIN public.whatsapp_conversations c ON c.id=m.conversation_id AND c.company_id=m.company_id
    WHERE m.conversation_id=ANY(p_conversation_ids[1:300]) AND auth.uid() IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active IS TRUE)
    ORDER BY m.conversation_id,m.message_timestamp DESC,m.id DESC
  ) latest;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_request_from_deposit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_request_id uuid; v_paid_at timestamptz;
begin
  if new.status in ('refunded','forfeited') then return new; end if;
  select d.request_id into v_request_id from public.deals d where d.id=new.deal_id and d.company_id=new.company_id;
  if v_request_id is null then return new; end if;
  v_paid_at:=(new.payment_date::timestamp at time zone 'Asia/Muscat');
  update public.client_requests r
  set deposit_paid_at=case when r.deposit_paid_at is null or v_paid_at<r.deposit_paid_at then v_paid_at else r.deposit_paid_at end,
      opportunity_opened_at=coalesce(r.opportunity_opened_at,v_paid_at),updated_at=now()
  where r.id=v_request_id and r.company_id=new.company_id;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_request_from_deal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_at timestamptz:=coalesce(NEW.updated_at,NEW.created_at,now());
BEGIN
 IF NEW.request_id IS NULL THEN RETURN NEW; END IF;
 UPDATE public.client_requests r SET
 opportunity_opened_at=CASE WHEN NEW.entry_mode<>'historical' AND NEW.stage IN('negotiation','deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer') AND r.opportunity_opened_at IS NULL THEN v_at ELSE r.opportunity_opened_at END,
 negotiation_started_at=CASE WHEN NEW.entry_mode<>'historical' AND NEW.stage='negotiation' AND r.negotiation_started_at IS NULL THEN v_at ELSE r.negotiation_started_at END,
 contract_completed_at=CASE WHEN NEW.stage IN('ownership_transfer','closed','commission_collected') AND r.contract_completed_at IS NULL THEN NEW.closed_at ELSE r.contract_completed_at END,
 closed_won_at=CASE WHEN NEW.stage IN('closed','commission_collected') AND r.closed_won_at IS NULL THEN NEW.closed_at ELSE r.closed_won_at END,
 updated_at=now() WHERE r.id=NEW.request_id AND r.company_id=NEW.company_id;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.set_property_marketing_link_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.link_key := public.normalize_property_marketing_link(new.url);
  new.link_provider := public.property_link_provider(new.url);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_property_interest_from_appointment_property()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare a public.appointments%rowtype;
begin
  select * into a from public.appointments where id=new.appointment_id and company_id=new.company_id;
  if not found or a.request_id is null or a.status='cancelled' then return new; end if;

  insert into public.property_inquiries(
    company_id,client_id,property_id,request_id,assigned_to,source,source_detail,status,
    first_inquiry_at,last_inquiry_at,inquiry_count,created_by,created_at,updated_at,
    viewing_booked,viewing_completed,has_inbound_inquiry
  ) values(
    new.company_id,a.client_id,new.property_id,a.request_id,a.agent_id,'other','تم إنشاؤه تلقائياً من المعاينة',
    case when a.status='attended' then 'viewed' else 'viewing_scheduled' end,
    coalesce(a.booked_at,a.created_at,now()),coalesce(a.appointment_at,a.booked_at,now()),1,a.created_by,
    coalesce(new.created_at,now()),now(),true,(a.status='attended'),false
  )
  on conflict (company_id,request_id,property_id) where request_id is not null
  do update set
    viewing_booked=true,
    viewing_completed=public.property_inquiries.viewing_completed or excluded.viewing_completed,
    status=case when excluded.viewing_completed then 'viewed'
                when public.property_inquiries.status in ('inquiry','followup') then 'viewing_scheduled'
                else public.property_inquiries.status end,
    last_inquiry_at=greatest(public.property_inquiries.last_inquiry_at,excluded.last_inquiry_at),
    updated_at=now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.property_link_provider(p_url text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT CASE WHEN public.normalize_property_marketing_link(p_url) LIKE 'instagram%' THEN 'instagram'
 WHEN public.normalize_property_marketing_link(p_url) LIKE 'youtube:%' THEN 'youtube' ELSE NULL END
$function$
;

CREATE OR REPLACE FUNCTION public.crm_client_360(p_client_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with c as (
  select * from public.clients
  where id=p_client_id and company_id=(select my_company())
), req as (
  select * from public.client_requests
  where client_id=p_client_id and company_id=(select my_company())
), pi as (
  select x.*, p.title as property_title, p.area as property_area, p.price as property_price
  from public.property_inquiries x
  join public.crm_properties_access p on p.id=x.property_id
  where x.client_id=p_client_id and x.company_id=(select my_company())
), ap as (
  select * from public.appointments
  where client_id=p_client_id and company_id=(select my_company())
), vw as (
  select v.*, p.title as property_title
  from public.viewings v
  left join public.crm_properties_access p on p.id=v.property_id
  where v.client_id=p_client_id and v.company_id=(select my_company())
), dl as (
  select d.*, p.title as property_title
  from public.crm_deals_access d
  left join public.crm_properties_access p on p.id=d.property_id
  where d.client_id=p_client_id and d.company_id=(select my_company())
), dp as (
  select dep.* from public.deposits dep join dl d on d.id=dep.deal_id
), rr as (
  select r.label_ar, r.code, count(distinct pr.property_id)::bigint as properties_count
  from public.property_rejection_reasons pr
  join public.rejection_reasons r on r.id=pr.reason_id
  where pr.is_primary=true and pr.client_id=p_client_id and pr.company_id=(select my_company())
  group by r.label_ar,r.code
  order by count(distinct pr.property_id) desc, min(r.sort_order)
), wa as (
  select wm.id,wm.direction,wm.message_type,wm.body,wm.message_timestamp,wm.delivery_status,wm.request_id,wm.sent_by_user_id
  from public.whatsapp_messages wm
  where wm.client_id=p_client_id and wm.company_id=(select my_company())
), act as (
  select a.id,a.activity_type,a.activity_text,a.created_at,a.request_id,a.property_id,a.appointment_id,a.deal_id,a.user_id
  from public.activities a
  where a.client_id=p_client_id and a.company_id=(select my_company())
), tsk as (
  select t.id,t.title,t.notes,t.due_date,t.priority,t.done,t.request_id,t.deal_id,t.user_id,t.created_at
  from public.tasks t
  where t.client_id=p_client_id and t.company_id=(select my_company())
)
select jsonb_build_object(
  'client',(select to_jsonb(c.*) from c limit 1),
  'customer_kind',case when (select count(*) from req)>1 then 'returning' else 'new_or_single_request' end,
  'metrics',jsonb_build_object(
    'requests_total',(select count(*) from req),
    'active_requests',(select count(*) from req where status='active'),
    'properties_inquired',(select count(distinct property_id) from pi where has_inbound_inquiry=true),
    'properties_shown',(select count(distinct property_id) from pi where shown_by_agent=true),
    'properties_visited',(select count(distinct property_id) from vw where coalesce(archived,false)=false and status='done'),
    'rejected_properties',(select count(distinct property_id) from pi where status='not_suitable' or outcome='rejected'),
    'appointments_total',(select count(*) from ap),
    'appointments_attended',(select count(*) from ap where status='attended' or attended_at is not null),
    'appointments_no_show',(select count(*) from ap where status='no_show'),
    'negotiations',(select count(*) from dl where stage in ('negotiation','negotiating')),
    'deposits',(select count(*) from dp),
    'closed_deals',(select count(*) from dl where stage in ('closed','commission_collected')),
    'overdue_followups',(select count(*) from req where status='active' and next_followup<current_date),
    'whatsapp_inbound',(select count(*) from wa where direction='inbound'),
    'whatsapp_outbound',(select count(*) from wa where direction='outbound'),
    'activities_total',(select count(*) from act),
    'open_tasks',(select count(*) from tsk where done=false),
    'overdue_tasks',(select count(*) from tsk where done=false and due_date<current_date)
  ),
  'active_request',(select to_jsonb(x.*) from req x where x.status='active' order by x.created_at desc limit 1),
  'last_mutual_contact_at',(select max(last_mutual_contact_at) from req),
  'next_followup',(select min(next_followup) from req where status='active' and next_followup is not null),
  'last_whatsapp_at',(select max(message_timestamp) from wa),
  'requests',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.created_at desc) from req x),'[]'::jsonb),
  'property_journey',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.last_contact_at desc nulls last, x.last_inquiry_at desc) from pi x),'[]'::jsonb),
  'appointments',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.appointment_at desc) from ap x),'[]'::jsonb),
  'viewings',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.viewing_date desc) from vw x),'[]'::jsonb),
  'deals',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.created_at desc) from dl x),'[]'::jsonb),
  'top_rejection_reasons',coalesce((select jsonb_agg(to_jsonb(x.*)) from rr x),'[]'::jsonb),
  'recent_whatsapp',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.message_timestamp desc) from ((select * from wa where direction='inbound' order by message_timestamp desc limit 12) union all (select * from wa where direction='outbound' order by message_timestamp desc limit 12)) x),'[]'::jsonb),
  'recent_activities',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.created_at desc) from (select * from act order by created_at desc limit 20) x),'[]'::jsonb),
  'open_tasks',coalesce((select jsonb_agg(to_jsonb(x.*) order by x.due_date asc nulls last) from (select * from tsk where done=false order by due_date asc nulls last limit 20) x),'[]'::jsonb)
);
$function$
;

CREATE OR REPLACE FUNCTION public.crm_property_performance(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_branch_key text DEFAULT NULL::text)
 RETURNS TABLE(property_id uuid, property_code text, internal_name text, title text, branch_key text, area text, price numeric, unique_inquirers bigint, inquiry_events bigint, appointments_booked bigint, appointments_confirmed bigint, unique_attendees bigint, total_property_viewings bigint, no_shows bigint, rejected_clients bigint, serious_interest bigint, repeat_visit_clients bigint, negotiations bigint, deposits bigint, closed_deals bigint, inquiry_to_attendance_pct numeric, attendance_to_serious_pct numeric, attendance_to_negotiation_pct numeric, attendance_to_deal_pct numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with props as (
  select p.* from public.crm_properties_access p where p.company_id=(select public.my_company()) and (p_branch_key is null or p.branch_key=p_branch_key)
), pi as (
  select i.property_id,
         count(distinct i.client_id) filter(where i.has_inbound_inquiry=true)::bigint unique_inquirers,
         coalesce(sum(i.inquiry_count) filter(where i.has_inbound_inquiry=true),0)::bigint inquiry_events,
         count(distinct i.client_id) filter(where i.status='negotiation')::bigint pi_negotiations,
         count(distinct i.client_id) filter(where lower(coalesce(i.post_visit_interest,'')) in ('serious','high'))::bigint pi_serious
  from public.property_inquiries i
  where i.company_id=(select public.my_company())
    and (p_start_date is null or i.first_inquiry_at>=p_start_date::timestamptz)
    and (p_end_date is null or i.first_inquiry_at<(p_end_date+1)::timestamptz)
  group by i.property_id
), ap as (
  select x.property_id,count(distinct a.id)::bigint appointments_booked,
         count(distinct a.id) filter(where a.confirmed_at is not null or a.status in ('confirmed','attended'))::bigint appointments_confirmed,
         count(distinct a.client_id) filter(where a.status='attended' and a.attended_at is not null)::bigint unique_attendees,
         count(*) filter(where a.status='attended' and a.attended_at is not null)::bigint total_property_viewings,
         count(distinct a.client_id) filter(where a.status='no_show')::bigint no_shows,
         count(distinct a.client_id) filter(where a.status='attended' and x.interest_level='serious')::bigint ap_serious
  from public.appointment_properties x join public.appointments a on a.id=x.appointment_id and a.company_id=x.company_id
  where x.company_id=(select public.my_company())
    and (p_start_date is null or a.appointment_at>=p_start_date::timestamptz)
    and (p_end_date is null or a.appointment_at<(p_end_date+1)::timestamptz)
  group by x.property_id
), repeats as (
  select property_id,count(*)::bigint repeat_visit_clients from (
    select x.property_id,a.client_id from public.appointment_properties x join public.appointments a on a.id=x.appointment_id and a.company_id=x.company_id
    where x.company_id=(select public.my_company()) and a.status='attended' and a.attended_at is not null
      and (p_start_date is null or a.appointment_at>=p_start_date::timestamptz) and (p_end_date is null or a.appointment_at<(p_end_date+1)::timestamptz)
    group by x.property_id,a.client_id having count(*)>1
  ) q group by property_id
), rej as (
  select property_id,count(distinct client_id)::bigint rejected_clients from public.property_rejection_reasons
  where is_primary=true and company_id=(select public.my_company()) and (p_start_date is null or created_at>=p_start_date::timestamptz) and (p_end_date is null or created_at<(p_end_date+1)::timestamptz)
  group by property_id
), dl as (
  select d.property_id,count(distinct d.id) filter(where d.stage in ('negotiation','deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer','closed','commission_collected'))::bigint negotiations,
         count(distinct d.id) filter(where d.stage in ('closed','commission_collected'))::bigint closed_deals
  from public.crm_deals_access d where d.company_id=(select public.my_company()) and (p_start_date is null or d.created_at>=p_start_date::timestamptz) and (p_end_date is null or d.created_at<(p_end_date+1)::timestamptz)
  group by d.property_id
), dp as (
  select d.property_id,count(distinct x.id)::bigint deposits from public.deposits x join public.crm_deals_access d on d.id=x.deal_id and d.company_id=x.company_id
  where x.company_id=(select public.my_company()) and x.status not in ('refunded','forfeited') and (p_start_date is null or x.payment_date>=p_start_date) and (p_end_date is null or x.payment_date<=p_end_date)
  group by d.property_id
)
select p.id,p.property_code,p.internal_name,p.title,p.branch_key,p.area,p.price,coalesce(pi.unique_inquirers,0),coalesce(pi.inquiry_events,0),
       coalesce(ap.appointments_booked,0),coalesce(ap.appointments_confirmed,0),coalesce(ap.unique_attendees,0),coalesce(ap.total_property_viewings,0),coalesce(ap.no_shows,0),
       coalesce(rej.rejected_clients,0),greatest(coalesce(pi.pi_serious,0),coalesce(ap.ap_serious,0)),coalesce(repeats.repeat_visit_clients,0),
       greatest(coalesce(pi.pi_negotiations,0),coalesce(dl.negotiations,0)),coalesce(dp.deposits,0),coalesce(dl.closed_deals,0),
       case when coalesce(pi.unique_inquirers,0)=0 then null else round(coalesce(ap.unique_attendees,0)::numeric*100/pi.unique_inquirers,2) end,
       case when coalesce(ap.unique_attendees,0)=0 then null else round(greatest(coalesce(pi.pi_serious,0),coalesce(ap.ap_serious,0))::numeric*100/ap.unique_attendees,2) end,
       case when coalesce(ap.unique_attendees,0)=0 then null else round(greatest(coalesce(pi.pi_negotiations,0),coalesce(dl.negotiations,0))::numeric*100/ap.unique_attendees,2) end,
       case when coalesce(ap.unique_attendees,0)=0 then null else round(coalesce(dl.closed_deals,0)::numeric*100/ap.unique_attendees,2) end
from props p left join pi on pi.property_id=p.id left join ap on ap.property_id=p.id left join repeats on repeats.property_id=p.id left join rej on rej.property_id=p.id left join dl on dl.property_id=p.id left join dp on dp.property_id=p.id
order by coalesce(ap.unique_attendees,0) desc,coalesce(pi.unique_inquirers,0) desc,p.created_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_due_whatsapp_followups(p_limit integer DEFAULT 50)
 RETURNS TABLE(request_id uuid, company_id uuid, client_id uuid, client_name text, client_phone text, route_key text, assigned_to uuid, property_type text, preferred_area text, preferred_areas text[], wilayat text, conversation_id uuid, conversation_meta_phone_id text, last_inbound_at timestamp with time zone, last_outbound_at timestamp with time zone, last_followup_id uuid, last_followup_step text, last_followup_status text, last_followup_sent_at timestamp with time zone, due_step text, due_reason text, anchor_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with base as (
  select r.id request_id,r.company_id,r.client_id,c.name client_name,c.phone client_phone,
         r.branch_key route_key,r.assigned_to,r.property_type,r.preferred_area,r.preferred_areas,r.wilayat,
         coalesce(r.last_contact_at,c.last_contact_at,r.updated_at,r.created_at) base_anchor,
         oi.consented_at,
         oo.request_id is not null as opted_out
  from public.client_requests r
  join public.clients c on c.id=r.client_id and c.company_id=r.company_id
  left join public.whatsapp_followup_optins oi on oi.client_id=r.client_id and oi.company_id=r.company_id and oi.revoked_at is null
  left join public.whatsapp_followup_optouts oo on oo.request_id=r.id and oo.company_id=r.company_id
  where coalesce(c.archived,false)=false and coalesce(c.followup_suppressed,false)=false
    and r.status='active' and r.branch_key in ('muscat','barka') and coalesce(c.phone,'')<>''
), enriched as (
  select b.*,
         cv.id conversation_id,cv.meta_phone_number_id conversation_meta_phone_id,
         msg.last_inbound_at,msg.last_outbound_at,
         fe.id last_followup_id,fe.step last_followup_step,fe.status last_followup_status,fe.sent_at last_followup_sent_at,fe.created_at last_followup_created_at,
         op.id optin_prompt_id,op.sent_at optin_prompt_sent_at,op.status optin_prompt_status,
         greatest(coalesce(msg.last_inbound_at,'epoch'::timestamptz),coalesce(msg.last_outbound_at,'epoch'::timestamptz),coalesce(b.base_anchor,'epoch'::timestamptz)) anchor_at
  from base b
  left join lateral (
    select wc.id,wc.meta_phone_number_id from public.whatsapp_conversations wc
    where wc.company_id=b.company_id and wc.client_id=b.client_id and wc.route_key=b.route_key
    order by wc.last_message_at desc nulls last,wc.updated_at desc limit 1
  ) cv on true
  left join lateral (
    select max(m.message_timestamp) filter(where m.direction='inbound') last_inbound_at,
           max(m.message_timestamp) filter(where m.direction='outbound') last_outbound_at
    from public.whatsapp_messages m
    join public.whatsapp_conversations wc2 on wc2.id=m.conversation_id
    where m.company_id=b.company_id and m.client_id=b.client_id and wc2.route_key=b.route_key
      and (m.request_id=b.request_id or m.request_id is null)
  ) msg on true
  left join lateral (
    select e.* from public.whatsapp_followup_events e where e.request_id=b.request_id and e.step in ('reminder_1','final_check','paused_no_response') order by e.created_at desc limit 1
  ) fe on true
  left join lateral (
    select e.* from public.whatsapp_followup_events e where e.company_id=b.company_id and e.client_id=b.client_id and e.step='opt_in_request' order by e.created_at desc limit 1
  ) op on true
), due0 as (
  select e.*,
         case
           when e.opted_out then null
           when e.consented_at is null and e.last_inbound_at is not null and e.last_inbound_at>=now()-interval '23 hours'
                and e.optin_prompt_id is null then 'opt_in_request'
           when e.consented_at is null then null
           when e.last_followup_status='template_pending' then e.last_followup_step
           when e.last_followup_status='failed' and e.last_followup_created_at<=now()-interval '24 hours' then e.last_followup_step
           when e.last_followup_step='reminder_1' and e.last_followup_status in ('sent','delivered','read') and e.last_followup_sent_at<=now()-interval '7 days' and (e.last_inbound_at is null or e.last_inbound_at<=e.last_followup_sent_at) then 'final_check'
           when e.last_followup_step='final_check' and e.last_followup_status in ('sent','delivered','read') and e.last_followup_sent_at<=now()-interval '7 days' and (e.last_inbound_at is null or e.last_inbound_at<=e.last_followup_sent_at) then 'paused_no_response'
           when e.last_followup_id is null and e.last_outbound_at is not null and (e.last_inbound_at is null or e.last_outbound_at>e.last_inbound_at) and e.last_outbound_at<=now()-interval '24 hours' then 'reminder_1'
           when e.last_followup_id is null and e.anchor_at<=now()-interval '30 days' then 'reminder_1'
           else null
         end due_step,
         case
           when e.consented_at is null and e.last_inbound_at is not null and e.last_inbound_at>=now()-interval '23 hours' then 'request_explicit_whatsapp_followup_consent'
           when e.last_followup_status='template_pending' then 'template_waiting_approval'
           when e.last_followup_status='failed' then 'retry_after_failure'
           when e.last_followup_step='reminder_1' then 'no_reply_after_first_followup'
           when e.last_followup_step='final_check' then 'no_reply_after_final_check'
           when e.last_followup_id is null and e.last_outbound_at is not null and (e.last_inbound_at is null or e.last_outbound_at>e.last_inbound_at) then 'no_reply_after_contact'
           when e.last_followup_id is null then 'stale_active_request' else null end due_reason
  from enriched e
), ranked as (
  select d.*,row_number() over(partition by d.client_id,d.route_key,d.due_step order by d.anchor_at desc,d.request_id) as same_client_rank
  from due0 d where d.due_step is not null
)
select request_id,company_id,client_id,client_name,client_phone,route_key,assigned_to,property_type,preferred_area,preferred_areas,wilayat,
       conversation_id,conversation_meta_phone_id,last_inbound_at,last_outbound_at,last_followup_id,last_followup_step,last_followup_status,last_followup_sent_at,due_step,due_reason,anchor_at
from ranked
where (due_step<>'opt_in_request' or same_client_rank=1)
  and not (due_step in ('reminder_1','final_check') and exists(
    select 1 from public.whatsapp_followup_events recent
    where recent.client_id=ranked.client_id and recent.route_key=ranked.route_key
      and recent.step in ('reminder_1','final_check') and recent.sent_at>=now()-interval '24 hours'
  ))
order by case due_step when 'opt_in_request' then 1 when 'paused_no_response' then 2 when 'final_check' then 3 else 4 end,anchor_at
limit greatest(1,least(coalesce(p_limit,50),100));
$function$
;

CREATE OR REPLACE FUNCTION public.record_property_link_inquiry_internal(p_company_id uuid, p_client_id uuid, p_property_id uuid, p_marketing_event_id uuid, p_whatsapp_message_id uuid, p_raw_url text, p_link_key text, p_message_at timestamp with time zone, p_manual boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_attr public.property_message_attributions%rowtype; v_inq public.property_inquiries%rowtype;
 v_request uuid; v_assigned uuid; v_source text; v_at timestamptz:=coalesce(p_message_at,now());
BEGIN
 -- Serialize messages from one client without assuming their other requests match this property.
 SELECT assigned_to INTO v_assigned FROM public.clients WHERE id=p_client_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property_id AND company_id=p_company_id)
 OR NOT EXISTS(SELECT 1 FROM public.whatsapp_messages WHERE id=p_whatsapp_message_id AND client_id=p_client_id AND company_id=p_company_id AND direction='inbound')
 THEN RAISE EXCEPTION 'invalid_attribution_relationship'; END IF;
 IF p_marketing_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.property_marketing_events WHERE id=p_marketing_event_id AND company_id=p_company_id AND property_id=p_property_id)
 THEN RAISE EXCEPTION 'invalid_marketing_relationship'; END IF;
 SELECT * INTO v_attr FROM public.property_message_attributions WHERE company_id=p_company_id AND message_id=p_whatsapp_message_id AND property_id=p_property_id;
 IF FOUND THEN RETURN v_attr.inquiry_id; END IF;
 SELECT r.id INTO v_request FROM public.client_requests r WHERE company_id=p_company_id AND client_id=p_client_id AND subject_property_id=p_property_id AND status='active' ORDER BY created_at LIMIT 1;
 SELECT * INTO v_inq FROM public.property_inquiries WHERE company_id=p_company_id AND client_id=p_client_id AND property_id=p_property_id
 AND request_id IS NOT DISTINCT FROM v_request ORDER BY created_at LIMIT 1 FOR UPDATE;
 SELECT CASE channel WHEN 'instagram' THEN 'instagram' WHEN 'youtube' THEN 'youtube' ELSE 'whatsapp' END INTO v_source
 FROM public.property_marketing_events WHERE id=p_marketing_event_id AND company_id=p_company_id;
 v_source:=coalesce(v_source,'whatsapp');
 IF v_inq.id IS NOT NULL THEN
   UPDATE public.property_inquiries SET has_inbound_inquiry=true,
    source=CASE WHEN NOT has_inbound_inquiry OR source='other' THEN v_source ELSE source END,
    source_detail=CASE WHEN p_manual THEN 'تحديد العقار بمراجعة الموظف' ELSE 'استفسار وارد عن عقار محدد' END,
    source_url=p_raw_url,source_whatsapp_message_id=p_whatsapp_message_id,
    marketing_event_id=coalesce(p_marketing_event_id,marketing_event_id),
    last_inquiry_at=greatest(last_inquiry_at,v_at),
    inquiry_count=CASE WHEN has_inbound_inquiry THEN inquiry_count+1 ELSE 1 END,last_message=left(p_raw_url,6000),updated_at=now()
   WHERE id=v_inq.id RETURNING * INTO v_inq;
 ELSE
   INSERT INTO public.property_inquiries(company_id,client_id,property_id,assigned_to,source,source_detail,status,first_inquiry_at,last_inquiry_at,
    inquiry_count,last_message,request_id,is_first_attraction,shown_by_agent,has_inbound_inquiry,marketing_event_id,source_url,source_whatsapp_message_id)
   VALUES(p_company_id,p_client_id,p_property_id,v_assigned,v_source,'استفسار وارد عن عقار محدد','inquiry',v_at,v_at,1,left(p_raw_url,6000),v_request,
    NOT EXISTS(SELECT 1 FROM public.property_inquiries WHERE company_id=p_company_id AND client_id=p_client_id AND has_inbound_inquiry),false,true,p_marketing_event_id,p_raw_url,p_whatsapp_message_id)
   RETURNING * INTO v_inq;
 END IF;
 INSERT INTO public.property_message_attributions(company_id,message_id,client_id,property_id,marketing_event_id,inquiry_id,request_id,evidence_key,source_url,method)
 VALUES(p_company_id,p_whatsapp_message_id,p_client_id,p_property_id,p_marketing_event_id,v_inq.id,v_request,p_link_key,p_raw_url,
 CASE WHEN p_manual THEN 'manual' WHEN p_link_key LIKE 'property-code:%' THEN 'exact_code' WHEN p_link_key LIKE 'ai-property:%' THEN 'ai_verified' ELSE 'exact_link' END);
 RETURN v_inq.id;
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_client_contact_queue(p_limit integer DEFAULT 500)
 RETURNS TABLE(client_id uuid, client_name text, phone text, created_at timestamp with time zone, human_contact_at timestamp with time zone, oldest_pending_at timestamp with time zone, pending_requests integer, assigned_to uuid, lead_temperature text, active_request_id uuid, next_followup date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with base as (
  select c.*
  from public.clients c
  where c.company_id=(select public.my_company())
    and coalesce(c.archived,false)=false
    and coalesce(c.followup_suppressed,false)=false
), req as (
  select r.*,
         case when r.first_human_response_at is null
               and (b.human_contact_at is null or b.human_contact_at<r.created_at)
              then true else false end as unanswered
  from public.client_requests r
  join base b on b.id=r.client_id
  where r.company_id=(select public.my_company()) and r.status='active'
), grouped as (
  select b.id as client_id,
         count(*) filter(where r.unanswered)::int as pending_requests,
         min(r.created_at) filter(where r.unanswered) as oldest_pending_at,
         (array_agg(r.id order by r.created_at asc) filter(where r.unanswered))[1] as active_request_id,
         min(r.next_followup) filter(where r.status='active' and r.next_followup is not null) as next_followup,
         count(r.id)::int as active_requests
  from base b left join req r on r.client_id=b.id
  group by b.id
)
select b.id,b.name,b.phone,b.created_at,b.human_contact_at,
       coalesce(g.oldest_pending_at,b.created_at),
       case when g.pending_requests>0 then g.pending_requests
            when coalesce(g.active_requests,0)=0 and b.human_contact_at is null then 1
            else 0 end,
       b.assigned_to,b.lead_temperature,g.active_request_id,g.next_followup
from base b
join grouped g on g.client_id=b.id
where g.pending_requests>0
   or (coalesce(g.active_requests,0)=0 and b.human_contact_at is null)
order by coalesce(g.oldest_pending_at,b.created_at) asc
limit greatest(1,least(coalesce(p_limit,500),2000));
$function$
;

CREATE OR REPLACE FUNCTION public.sync_deposits_when_deal_closed()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.stage in ('closed','commission_collected')
     and (tg_op = 'INSERT' or old.stage is distinct from new.stage) then
    update public.deposits
       set status = 'applied'
     where deal_id = new.id
       and coalesce(status,'active') not in ('applied','refunded','forfeited');
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_applied_deposit_on_completed_deal()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_stage text;
begin
  if new.deal_id is null then
    return new;
  end if;

  -- Refunded/forfeited are explicit terminal outcomes and must never be overwritten.
  if new.status in ('refunded','forfeited') then
    return new;
  end if;

  select d.stage into v_stage
  from public.deals d
  where d.id = new.deal_id;

  if v_stage in ('closed','commission_collected') then
    new.status := 'applied';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_property_listing_agreement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_days integer;
begin
  if coalesce(new.has_listing_agreement,false) = false then
    new.agreement_start_date := null;
    new.agreement_duration_months := null;
    new.agreement_end_date := null;
    new.agreement_reminder_days := null;
    return new;
  end if;

  if new.agreement_start_date is null then
    new.agreement_start_date := current_date;
  end if;

  if new.agreement_duration_months is null then
    new.agreement_duration_months := 3;
  end if;

  new.agreement_end_date := (new.agreement_start_date + make_interval(months => new.agreement_duration_months))::date;
  v_days := greatest(1, new.agreement_end_date - new.agreement_start_date);
  new.agreement_reminder_days := least(30, greatest(7, ceil(v_days * 0.20)::integer));
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_whatsapp_client_identity(p_company_id uuid, p_phone text, p_customer_name text, p_route_key text, p_assigned_to uuid, p_inbound_number text, p_message_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_client public.clients%rowtype;
  v_client_id uuid;
  v_created boolean := false;
  v_phone text := btrim(coalesce(p_phone,''));
  v_name text := nullif(left(btrim(coalesce(p_customer_name,'')),120),'');
  v_route text := lower(btrim(coalesce(p_route_key,'general')));
  v_effective_assigned uuid;
begin
  if p_company_id is null or not exists (select 1 from public.companies c where c.id=p_company_id) then
    raise exception 'Invalid company';
  end if;
  if v_phone !~ '^\+[0-9]{7,15}$' then
    raise exception 'Invalid WhatsApp phone';
  end if;
  if v_route not in ('muscat','barka','investment','general') then v_route := 'general'; end if;

  select c.* into v_client
  from public.clients c
  where c.company_id=p_company_id
    and regexp_replace(coalesce(c.phone,''), '[^0-9+]', '', 'g')=v_phone
  order by c.created_at asc
  limit 1;

  if v_client.id is null then
    insert into public.clients(
      company_id,name,phone,client_type,is_buyer,is_seller,is_investor,
      notes,status,lead_temperature,lead_score,source,pipeline_stage,
      assigned_to,lead_route,inbound_number,last_contact_at
    ) values (
      p_company_id,
      coalesce(v_name,'عميل واتساب '||right(v_phone,4)),
      v_phone,
      null,false,false,false,
      'عميل وارد تلقائياً من WhatsApp — لم يُحدد نوع الطلب بعد',
      'cold','cold',20,'whatsapp','new',
      case when v_route='general' then null else p_assigned_to end,
      v_route,p_inbound_number,coalesce(p_message_at,now())
    ) returning id,assigned_to into v_client_id,v_effective_assigned;
    v_created := true;
  else
    v_client_id := v_client.id;
    update public.clients c
    set
      name = case
        when v_name is not null and (c.name is null or btrim(c.name)='' or c.name like 'عميل واتساب %')
        then v_name else c.name end,
      assigned_to = case
        when c.assigned_to is null and v_route<>'general' and p_assigned_to is not null then p_assigned_to
        else c.assigned_to end,
      lead_route = coalesce(c.lead_route,v_route),
      inbound_number = coalesce(c.inbound_number,p_inbound_number),
      last_contact_at = greatest(coalesce(c.last_contact_at,'-infinity'::timestamptz),coalesce(p_message_at,now())),
      archived=false,archived_at=null,archived_by=null
    where c.id=v_client_id
    returning assigned_to into v_effective_assigned;
  end if;

  return jsonb_build_object(
    'ok',true,
    'client_id',v_client_id,
    'created',v_created,
    'assigned_to',v_effective_assigned,
    'route_key',v_route
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_client_contact_from_whatsapp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.client_id is null then return new; end if;
  if new.direction='outbound' and coalesce(new.actor_type,'')='human' then
    update public.clients
      set human_contact_at=greatest(coalesce(human_contact_at,'epoch'::timestamptz),coalesce(new.message_timestamp,new.created_at,now())),
          last_contact_at=greatest(coalesce(last_contact_at,'epoch'::timestamptz),coalesce(new.message_timestamp,new.created_at,now())),
          followup_suppressed=false,
          followup_suppressed_reason=null,
          followup_suppressed_at=null,
          followup_suppressed_by=null,
          updated_at=now()
    where id=new.client_id and company_id=new.company_id;
  elsif new.direction='inbound' then
    update public.clients
      set followup_suppressed=false,
          followup_suppressed_reason=null,
          followup_suppressed_at=null,
          followup_suppressed_by=null,
          updated_at=now()
    where id=new.client_id and company_id=new.company_id and followup_suppressed=true;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reset_stale_requirement_prompt_on_new_inbound()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.direction='inbound' and new.client_id is not null then
    update public.client_requests
    set last_requirements_prompt_fields='{}'::text[]
    where company_id=new.company_id
      and client_id=new.client_id
      and status in ('active','paused')
      and last_requirements_prompt_at is not null
      and last_requirements_prompt_at < now()-interval '24 hours';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_deal_stage_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF TG_OP='INSERT' OR OLD.stage IS DISTINCT FROM NEW.stage THEN
  INSERT INTO public.deal_stage_history(company_id,deal_id,client_id,property_id,from_stage,to_stage,reason_id,note,changed_by,changed_at)
  VALUES(NEW.company_id,NEW.id,NEW.client_id,NEW.property_id,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.stage END,
   NEW.stage,NEW.lost_reason_id,CASE WHEN NEW.stage='lost' THEN nullif(btrim(NEW.lost_reason_note),'') END,auth.uid(),now());
 END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.sync_viewing_to_crm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request_id uuid;
  v_inquiry_id uuid;
  v_deal_id uuid;
  v_current_stage text;
  v_target_stage text;
  v_price numeric;
  v_reason_code text;
  v_reason_id uuid;
  v_inquiry_status text;
  v_final boolean;
  v_candidate_count integer;
  v_workflow_context boolean:=false;
begin
  if coalesce(new.archived,false)=true or new.client_id is null or new.property_id is null then return new; end if;

  v_request_id:=new.request_id;
  if v_request_id is null then
    select count(distinct pi.request_id), min(pi.request_id::text)::uuid into v_candidate_count,v_request_id
    from public.property_inquiries pi
    where pi.company_id=new.company_id and pi.client_id=new.client_id
      and pi.property_id=new.property_id and pi.request_id is not null;
    if v_candidate_count>1 then
      raise exception using errcode='22023',message='viewing_request_ambiguous';
    end if;
  end if;
  if v_request_id is null then
    select count(*),min(cr.id::text)::uuid into v_candidate_count,v_request_id
    from public.client_requests cr
    where cr.company_id=new.company_id and cr.client_id=new.client_id and cr.status='active';
    if v_candidate_count>1 then
      raise exception using errcode='22023',message='viewing_request_ambiguous';
    end if;
  end if;
  if new.request_id is null and v_request_id is not null then
    update public.viewings set request_id=v_request_id where id=new.id and request_id is null;
  end if;

  if new.status='done' then
    if new.pipeline_outcome='lost' or (new.pipeline_outcome is null and new.client_feedback='disliked') then
      v_target_stage:='lost'; v_inquiry_status:='not_suitable';
    elsif new.pipeline_outcome='negotiation' or (new.pipeline_outcome is null and new.client_feedback='wants_negotiate') then
      v_target_stage:='negotiation'; v_inquiry_status:='negotiation';
    else
      v_target_stage:='visit'; v_inquiry_status:='viewed';
    end if;
  elsif new.status='postponed' then
    v_target_stage:='viewing_postponed'; v_inquiry_status:='followup';
  elsif new.status='no_show' then
    v_target_stage:='viewing_no_show'; v_inquiry_status:='followup';
  elsif new.status='cancelled' then
    v_target_stage:='viewing_cancelled'; v_inquiry_status:='followup';
  else
    v_target_stage:='viewing_scheduled'; v_inquiry_status:='viewing_scheduled';
  end if;

  select pi.id into v_inquiry_id
  from public.property_inquiries pi
  where pi.company_id=new.company_id and pi.client_id=new.client_id and pi.property_id=new.property_id
    and pi.request_id IS NOT DISTINCT FROM v_request_id
  order by case when pi.request_id=v_request_id then 0 else 1 end,pi.updated_at desc nulls last,pi.created_at desc
  limit 1;

  if v_inquiry_id is null and new.status<>'cancelled' then
    insert into public.property_inquiries(
      company_id,client_id,property_id,assigned_to,source,source_detail,status,
      first_inquiry_at,last_inquiry_at,inquiry_count,created_by,request_id,
      shown_by_agent,match_status,viewing_booked,viewing_completed,post_visit_interest,outcome,
      rejection_reason,rejection_notes,last_contact_at,followup_note,next_followup,has_inbound_inquiry
    ) values (
      new.company_id,new.client_id,new.property_id,new.agent_id,'other','زيارة/معاينة مسجلة في CRM',v_inquiry_status,
      coalesce(new.created_at,now()),now(),1,new.created_by,v_request_id,
      true,'matched',true,(new.status='done'),new.client_feedback,
      case when v_target_stage='lost' then 'rejected' when v_target_stage='negotiation' then 'interested' else null end,
      new.rejection_reason,nullif(btrim(new.outcome_note),''),now(),new.next_step,new.followup_date,false
    ) returning id into v_inquiry_id;
  elsif v_inquiry_id is not null then
    update public.property_inquiries set
      status=v_inquiry_status,
      assigned_to=coalesce(new.agent_id,assigned_to),
      request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,
      shown_by_agent=true,
      match_status='matched',
      viewing_booked=true,
      viewing_completed=exists(select 1 from public.viewings vx where vx.company_id=new.company_id and vx.client_id=new.client_id and vx.property_id=new.property_id and vx.archived=false and vx.status='done' and vx.request_id IS NOT DISTINCT FROM v_request_id),
      post_visit_interest=new.client_feedback,
      outcome=case when v_target_stage='lost' then 'rejected' when v_target_stage='negotiation' then 'interested' else outcome end,
      rejection_reason=case when v_target_stage='lost' then new.rejection_reason else rejection_reason end,
      rejection_notes=case when v_target_stage='lost' then nullif(btrim(new.outcome_note),'') else rejection_notes end,
      last_contact_at=now(),
      followup_note=coalesce(new.next_step,followup_note),
      next_followup=coalesce(new.followup_date,next_followup),
      updated_at=now()
    where id=v_inquiry_id;
  end if;

  v_reason_code:=case coalesce(new.rejection_reason,'')
    when 'price' then 'price_value_mismatch'
    when 'location' then 'location'
    when 'area' then 'built_size'
    when 'room_layout' then 'layout'
    when 'design' then 'layout'
    when 'finishing' then 'finishing'
    when 'parking' then 'yard_parking'
    when 'financing' then 'finance_not_ready'
    when 'found_other' then 'chose_other_property'
    when 'no_response' then 'no_response_after_visit'
    when 'not_serious' then 'client_not_ready'
    when 'not_interested' then 'not_interested'
    when 'other' then 'no_clear_reason'
    when 'no_clear_reason' then 'no_clear_reason'
    else null end;
  select id into v_reason_id from public.rejection_reasons where code=v_reason_code and company_id=new.company_id and is_active=true;

  if v_target_stage='lost' and v_reason_id is not null then
    perform crm_repair_private.set_primary_rejection(
      new.company_id,new.client_id,new.property_id,v_request_id,v_inquiry_id,
      v_reason_id,new.outcome_note,'post_visit',new.created_by);
  end if;

  -- Only the already-authorized atomic deal save can populate this private transaction context.
  -- It preserves an existing card's identity while a new real visit resolves its previously missing request.
  select d.id,d.stage into v_deal_id,v_current_stage
  from crm_repair_private.deal_workflow_context ctx
  join public.deals d on d.id=ctx.deal_id and d.company_id=ctx.company_id
   and d.client_id=ctx.client_id and d.property_id=ctx.property_id
  where ctx.transaction_id=txid_current() and ctx.user_id=auth.uid()
   and ctx.company_id=new.company_id and ctx.client_id=new.client_id and ctx.property_id=new.property_id;
  v_workflow_context:=v_deal_id is not null;
  if not v_workflow_context then
  select d.id,d.stage into v_deal_id,v_current_stage
  from public.deals d
  where d.company_id=new.company_id and d.client_id=new.client_id and d.property_id=new.property_id
    and d.request_id IS NOT DISTINCT FROM v_request_id
  order by case when d.stage in ('closed','commission_collected') then 2 when d.stage='lost' then 1 else 0 end,
           d.updated_at desc nulls last,d.created_at desc
  limit 1;
  end if;
  select price into v_price from public.properties where id=new.property_id;

  if v_deal_id is null then
    insert into public.deals(
      company_id,client_id,property_id,agent_id,stage,deal_value,notes,request_id,viewing_id,
      lost_reason_id,lost_reason_note,lost_from_stage,lost_at
    ) values (
      new.company_id,new.client_id,new.property_id,new.agent_id,v_target_stage,v_price,
      'بطاقة Pipeline مرتبطة بزيارة CRM',v_request_id,new.id,
      case when v_target_stage='lost' then v_reason_id end,
      case when v_target_stage='lost' then nullif(btrim(new.outcome_note),'') end,
      case when v_target_stage='lost' then 'visit' end,
      case when v_target_stage='lost' then now() end
    );
  else
    v_final:=v_current_stage in ('closed','commission_collected');
    if not v_final then
      if v_target_stage='lost' then
        update public.deals set
          stage='lost',viewing_id=new.id,request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,agent_id=coalesce(new.agent_id,agent_id),
          lost_reason_id=v_reason_id,lost_reason_note=nullif(btrim(new.outcome_note),''),
          lost_from_stage=case when v_current_stage='lost' then coalesce(lost_from_stage,'visit') else v_current_stage end,
          lost_at=now(),closed_at=now(),updated_at=now()
        where id=v_deal_id;
      elsif v_current_stage='lost' then
        update public.deals set
          stage=v_target_stage,viewing_id=new.id,request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,agent_id=coalesce(new.agent_id,agent_id),
          lost_reason_id=null,lost_reason_note=null,lost_from_stage=null,lost_at=null,closed_at=null,updated_at=now()
        where id=v_deal_id;
      else
        update public.deals set
          stage=case
            when v_target_stage='negotiation' then 'negotiation'
            when v_target_stage='visit' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed','visit') then 'visit'
            when v_target_stage='viewing_postponed' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_postponed'
            when v_target_stage='viewing_no_show' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_no_show'
            when v_target_stage='viewing_cancelled' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_cancelled'
            when v_target_stage='viewing_scheduled' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_scheduled'
            else v_current_stage end,
          viewing_id=new.id,
          request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,
          agent_id=coalesce(new.agent_id,agent_id),
          updated_at=now()
        where id=v_deal_id;
      end if;
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_followup_delivery_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.delivery_status is distinct from old.delivery_status and new.whatsapp_message_id is not null then
    update public.whatsapp_followup_events
    set status=case
      when new.delivery_status in ('delivered','read','failed') then new.delivery_status
      else status
    end,
    error=case when new.delivery_status='failed' then coalesce(new.processing_error,error) else error end,
    updated_at=now()
    where meta_message_id=new.whatsapp_message_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.exclude_internal_numbers_from_followups()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_phone text;
  v_digits text;
begin
  select c.phone into v_phone from public.clients c where c.id=new.client_id and c.company_id=new.company_id;
  v_digits:=right(regexp_replace(coalesce(v_phone,''),'\D','','g'),8);
  if length(v_digits)=8 and (
    exists(select 1 from public.profiles p where p.company_id=new.company_id and p.is_active=true and right(regexp_replace(coalesce(p.phone,''),'\D','','g'),8)=v_digits)
    or exists(select 1 from public.company_lead_routes r where r.company_id=new.company_id and r.is_active=true and right(regexp_replace(coalesce(r.whatsapp_number,''),'\D','','g'),8)=v_digits)
  ) then
    insert into public.whatsapp_followup_optouts(request_id,company_id,client_id,reason)
    values(new.id,new.company_id,new.client_id,'internal_staff_or_office_number')
    on conflict(request_id) do update set reason='internal_staff_or_office_number';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_property_monitoring_from_marketing_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_at timestamptz := coalesce(new.published_at,new.created_at,now());
  v_is_instagram boolean := (
    new.channel='instagram'
    or new.link_provider='instagram'
    or public.normalize_property_marketing_link(new.url) like 'instagram:%'
    or public.normalize_property_marketing_link(new.url) like 'instagram-share:%'
  );
begin
  if new.event_type='publish' then
    update public.properties p
    set performance_tracking_started_at=v_at,
        marketing_status='advertised',
        marketing_review_status='healthy',
        marketing_reviewed_at=null,
        marketing_review_note=null,
        photography_status=case when v_is_instagram then 'completed' else p.photography_status end,
        photography_reason=case when v_is_instagram then 'instagram_published' else p.photography_reason end,
        photography_completed_at=case when v_is_instagram then v_at else p.photography_completed_at end,
        photography_required_at=case when v_is_instagram then null else p.photography_required_at end,
        updated_at=now()
    where p.id=new.property_id and p.company_id=new.company_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_property_action_queue(p_branch_key text DEFAULT NULL::text)
 RETURNS TABLE(property_id uuid, title text, property_code text, internal_name text, branch_key text, area text, property_status text, photography_status text, photography_reason text, created_at timestamp with time zone, tracking_started_at timestamp with time zone, last_inquiry_at timestamp with time zone, days_without_inquiry integer, unique_inquirers bigint, inquiry_events bigint, completed_viewings bigint, unique_visitors bigint, rejected_clients bigint, negotiations bigint, closed_deals bigint, last_marketing_at timestamp with time zone, top_rejection_code text, top_rejection_label text, top_rejection_category text, top_rejection_clients bigint, alert_type text, alert_priority text, recommendation_rule jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with marketing_stats as (
  select pm.property_id,
         max(coalesce(pm.published_at,pm.created_at)) filter(where pm.event_type='publish') as last_marketing_at,
         max(coalesce(pm.published_at,pm.created_at)) filter(
           where pm.event_type='publish' and (
             pm.channel='instagram' or pm.link_provider='instagram'
             or public.normalize_property_marketing_link(pm.url) like 'instagram:%'
             or public.normalize_property_marketing_link(pm.url) like 'instagram-share:%'
           )
         ) as last_instagram_publish_at
  from public.property_marketing_events pm
  group by pm.property_id
), prop_base as (
  select p.*,m.last_marketing_at,m.last_instagram_publish_at
  from public.crm_properties_access p
  left join marketing_stats m on m.property_id=p.id
  where p.company_id=(select public.my_company())
    and coalesce(p.archived,false)=false
    and coalesce(p.status,'available') not in ('sold','not_available')
    and (p_branch_key is null or p.branch_key=p_branch_key)
), inquiry_stats as (
  select pi.property_id,
         max(pi.last_inquiry_at) filter(where pi.has_inbound_inquiry=true) as last_inquiry_at,
         count(distinct pi.client_id) filter(where pi.has_inbound_inquiry=true) as unique_inquirers,
         coalesce(sum(pi.inquiry_count) filter(where pi.has_inbound_inquiry=true),0)::bigint as inquiry_events,
         count(distinct pi.client_id) filter(where pi.status='not_suitable' or pi.outcome='rejected') as rejected_clients,
         count(distinct pi.client_id) filter(where pi.status='negotiation' or pi.outcome='negotiation') as negotiations
  from public.property_inquiries pi
  join prop_base p on p.id=pi.property_id
  group by pi.property_id
), viewing_stats as (
  select v.property_id,
         count(*) filter(where coalesce(v.archived,false)=false and v.status='done') as completed_viewings,
         count(distinct v.client_id) filter(where coalesce(v.archived,false)=false and v.status='done') as unique_visitors
  from public.viewings v join prop_base p on p.id=v.property_id
  group by v.property_id
), deal_stats as (
  select d.property_id,count(*) filter(where d.stage in ('closed','commission_collected')) as closed_deals
  from public.crm_deals_access d join prop_base p on p.id=d.property_id
  group by d.property_id
), rejection_ranked as (
  select pr.property_id,rr.code,rr.label_ar,rr.category,count(distinct pr.client_id)::bigint as client_count,
         row_number() over(partition by pr.property_id order by count(distinct pr.client_id) desc,min(rr.sort_order),rr.code) as rn
  from public.property_rejection_reasons pr
  join public.rejection_reasons rr on rr.id=pr.reason_id
  join prop_base p on p.id=pr.property_id
  where pr.is_primary=true and pr.created_at >= coalesce(p.last_marketing_at,p.performance_tracking_started_at,p.created_at)
  group by pr.property_id,rr.code,rr.label_ar,rr.category
), base as (
  select p.*,i.last_inquiry_at,coalesce(i.unique_inquirers,0)::bigint unique_inquirers,
         coalesce(i.inquiry_events,0)::bigint inquiry_events,coalesce(i.rejected_clients,0)::bigint rejected_clients,
         coalesce(i.negotiations,0)::bigint negotiations,coalesce(v.completed_viewings,0)::bigint completed_viewings,
         coalesce(v.unique_visitors,0)::bigint unique_visitors,coalesce(d.closed_deals,0)::bigint closed_deals,
         r.code top_rejection_code,r.label_ar top_rejection_label,r.category top_rejection_category,
         coalesce(r.client_count,0)::bigint top_rejection_clients,
         case when p.last_marketing_at is null then null
              else greatest(coalesce(i.last_inquiry_at,p.last_marketing_at),p.last_marketing_at)
         end as tracking_anchor
  from prop_base p
  left join inquiry_stats i on i.property_id=p.id
  left join viewing_stats v on v.property_id=p.id
  left join deal_stats d on d.property_id=p.id
  left join rejection_ranked r on r.property_id=p.id and r.rn=1
), scored as (
  select b.*,case when b.tracking_anchor is null then null else greatest(0,floor(extract(epoch from (now()-b.tracking_anchor))/86400)::int) end as days_without_inquiry
  from base b
)
select b.id,b.title,b.property_code,b.internal_name,b.branch_key,b.area,b.status,b.photography_status,b.photography_reason,
       b.created_at,b.performance_tracking_started_at,b.last_inquiry_at,b.days_without_inquiry,b.unique_inquirers,b.inquiry_events,
       b.completed_viewings,b.unique_visitors,b.rejected_clients,b.negotiations,b.closed_deals,b.last_marketing_at,
       b.top_rejection_code,b.top_rejection_label,b.top_rejection_category,b.top_rejection_clients,
       case
         when b.photography_status='needs_initial' and b.last_instagram_publish_at is null
              and coalesce(b.photography_required_at,b.created_at,now())<=now() then 'new_needs_photography'
         when b.last_marketing_at is not null and b.days_without_inquiry>=5 then 'no_inquiry_5d'
         when b.top_rejection_clients>=2 then 'repeated_obstacle'
         when b.photography_status='needs_refresh' then 'photography_refresh_required'
         else 'healthy'
       end,
       case
         when b.photography_status='needs_initial' and b.last_instagram_publish_at is null
              and coalesce(b.photography_required_at,b.created_at,now())<=now() then 'urgent'
         when b.last_marketing_at is not null and b.days_without_inquiry>=10 then 'urgent'
         when b.last_marketing_at is not null and b.days_without_inquiry>=5 then 'high'
         when b.top_rejection_clients>=2 then 'high'
         when b.photography_status='needs_refresh' then 'medium'
         else 'info'
       end,
       case
         when b.photography_status='needs_initial' and b.last_instagram_publish_at is null
              and coalesce(b.photography_required_at,b.created_at,now())<=now() then
           jsonb_build_object('title','لم يُسجل Reel إنستغرام للعقار خلال 24 ساعة من إدخاله','steps',jsonb_build_array('تحقق هل تم تصوير ونشر Reel للعقار','إذا نُشر، أضف رابط Instagram في التسويق','إذا لم يُنشر، جهز Reel ثم سجّل الرابط بعد النشر'))
         when b.last_marketing_at is not null and b.days_without_inquiry>=5 then
           jsonb_build_object('title','مرّت 5 أيام أو أكثر دون استفسار جديد','steps',jsonb_build_array('راجع السعر والغلاف والعنوان والوصف والجمهور','راجع أداء الإعلان أو الـReel قبل اتخاذ قرار إعادة التصوير','نفّذ التعديل المناسب ثم سجّل إعادة الإطلاق ليبدأ قياس 5 أيام جديد'))
         when b.top_rejection_clients>=2 and b.top_rejection_category='price' then
           jsonb_build_object('title','اعتراض سعري متكرر من عملاء مختلفين','steps',jsonb_build_array('راجع اعتراضات السعر المسجلة','قارن السعر بالقيمة الفعلية للعقار قبل مناقشة المالك','لا تخفض السعر تلقائياً؛ اتخذ القرار بعد مراجعة الأدلة'))
         when b.top_rejection_clients>=2 then
           jsonb_build_object('title','عقبة واحدة تكررت من عميلين مختلفين أو أكثر','steps',jsonb_build_array('راجع الملاحظات المسجلة للعملاء','حدد هل المشكلة في العقار أو السعر أو طريقة العرض','نفّذ الإجراء المناسب ثم أعد القياس'))
         when b.photography_status='needs_refresh' then
           jsonb_build_object('title','تم تحديد حاجة فعلية لإعادة التصوير','steps',jsonb_build_array('راجع سبب إعادة التصوير المسجل','جهز اللقطات المطلوبة فقط','سجّل النشر الجديد بعد اكتمال التحديث'))
         else jsonb_build_object('title','الأداء طبيعي حالياً','steps',jsonb_build_array('استمر بالمراقبة'))
       end
from scored b
where (b.photography_status='needs_initial' and b.last_instagram_publish_at is null and coalesce(b.photography_required_at,b.created_at,now())<=now())
   or (b.last_marketing_at is not null and b.days_without_inquiry>=5)
   or b.top_rejection_clients>=2
   or b.photography_status='needs_refresh'
order by
  case
    when b.photography_status='needs_initial' and b.last_instagram_publish_at is null and coalesce(b.photography_required_at,b.created_at,now())<=now() then 1
    when b.last_marketing_at is not null and b.days_without_inquiry>=10 then 2
    when b.last_marketing_at is not null and b.days_without_inquiry>=5 then 3
    when b.top_rejection_clients>=2 then 4
    else 5
  end,
  b.days_without_inquiry desc nulls last,b.created_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.process_followup_reply_from_whatsapp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_event public.whatsapp_followup_events%rowtype;
  v_body text:=lower(trim(coalesce(new.body,new.transcript,'')));
  v_at timestamptz:=coalesce(new.message_timestamp,new.created_at,now());
begin
  if new.direction<>'inbound' or new.client_id is null then return new; end if;

  select e.* into v_event
  from public.whatsapp_followup_events e
  where e.company_id=new.company_id and e.client_id=new.client_id
    and e.status in ('sent','delivered','read') and e.sent_at is not null and e.sent_at<=v_at
    and e.sent_at>=v_at-interval '30 days'
  order by e.sent_at desc limit 1;
  if not found then return new; end if;

  update public.whatsapp_followup_events
  set status='responded',responded_at=v_at,updated_at=now()
  where id=v_event.id;

  update public.client_requests
  set last_contact_at=v_at,last_mutual_contact_at=coalesce(last_mutual_contact_at,v_at),updated_at=now()
  where id=v_event.request_id and company_id=new.company_id;

  -- Explicit global stop / unsubscribe.
  if v_body ~ '(توقف|وقف المتابعة|ايقاف المتابعة|إيقاف المتابعة|لا اريد المتابعة|لا أريد المتابعة|لا ترسل|لا تراسل|stop|unsubscribe)' then
    insert into public.whatsapp_followup_optouts(request_id,company_id,client_id,reason,source_message_id)
    select r.id,new.company_id,new.client_id,'customer_opt_out',new.id
    from public.client_requests r
    where r.company_id=new.company_id and r.client_id=new.client_id and r.status in ('active','paused')
    on conflict(request_id) do update set reason='customer_opt_out',source_message_id=excluded.source_message_id,created_at=now();
    update public.whatsapp_followup_optins set revoked_at=v_at,updated_at=now()
    where client_id=new.client_id and company_id=new.company_id and revoked_at is null;
    update public.client_requests set next_action='أوقف العميل المتابعة التلقائية',updated_at=now()
    where company_id=new.company_id and client_id=new.client_id and status in ('active','paused');

  -- The consent prompt explicitly says the customer may answer فقط "لا". Respect it and do not ask again.
  elsif v_event.step='opt_in_request' and v_body ~ '^(لا|لا شكرا|لا شكر[اآ]?)$' then
    insert into public.whatsapp_followup_optouts(request_id,company_id,client_id,reason,source_message_id)
    select r.id,new.company_id,new.client_id,'declined_followup_opt_in',new.id
    from public.client_requests r
    where r.company_id=new.company_id and r.client_id=new.client_id and r.status in ('active','paused')
    on conflict(request_id) do update set reason='declined_followup_opt_in',source_message_id=excluded.source_message_id,created_at=now();
    update public.client_requests set next_action='رفض العميل المتابعة التلقائية',updated_at=now()
    where company_id=new.company_id and client_id=new.client_id and status in ('active','paused');

  elsif v_event.step='opt_in_request' and v_body ~ '(^|[[:space:]])(نعم|اي|أيوه|ايوه|هيه|موافق|موافقه|اوكي|أوكي|ok|yes)([[:space:]]|$)' then
    insert into public.whatsapp_followup_optins(client_id,company_id,consent_category,consent_text,source_message_id,source_conversation_id,consented_at,revoked_at)
    values(new.client_id,new.company_id,'property_request_followup','وافق العميل صراحة على تلقي متابعات طلبه العقاري عبر واتساب من أبناء حبيب للعقارات',new.id,new.conversation_id,v_at,null)
    on conflict(client_id) do update set consent_text=excluded.consent_text,source_message_id=excluded.source_message_id,source_conversation_id=excluded.source_conversation_id,consented_at=excluded.consented_at,revoked_at=null,updated_at=now();
    delete from public.whatsapp_followup_optouts where company_id=new.company_id and client_id=new.client_id;
    update public.client_requests set next_action='المتابعة التلقائية مفعلة',updated_at=now()
    where company_id=new.company_id and client_id=new.client_id and status in ('active','paused');

  -- Customer confirms they already found/bought a property.
  elsif v_body ~ '(حصلت|اشتريت|شريت|لقيت|وجدت).{0,20}(عقار|بيت|منزل|فيلا|شقة|ارض|أرض)|تم الشراء|خلاص اشتريت|خلاص شريت|انتهى البحث' then
    update public.client_requests
    set status='lost',search_status='bought_elsewhere',closed_reason='client_found_property',closed_at=v_at,
        next_action='إغلاق الطلب — العميل وجد عقاراً',updated_at=now()
    where id=v_event.request_id and company_id=new.company_id and status in ('active','paused');

  -- Customer is no longer searching, but did not say they bought elsewhere.
  elsif v_body ~ '(ما عاد ابحث|ما عاد أبحث|مو مهتم|غير مهتم|ما مهتم|وقفت البحث|أوقفت البحث|الغيت البحث|ألغيت البحث|خلاص ما اريد|خلاص ما أريد)' then
    update public.client_requests
    set status='paused',search_status='stopped',next_action='توقف العميل عن البحث',next_followup=null,updated_at=now()
    where id=v_event.request_id and company_id=new.company_id and status in ('active','paused');

  -- Positive reply means keep the request active.
  elsif v_event.step<>'opt_in_request' and v_body ~ '(^|[[:space:]])(نعم|اي|أيوه|ايوه|هيه|بعدني|ما زلت|لازلت|لسه|مهتم|ابحث|أبحث|ادور|أدور|مستمر)([[:space:]]|$)' then
    update public.client_requests
    set status='active',search_status='active',next_action='متابعة البحث للعميل',updated_at=now()
    where id=v_event.request_id and company_id=new.company_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_property_source_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actor_role text;
begin
  if auth.uid() is null then return new; end if;
  select role into actor_role from public.profiles where id=auth.uid() and company_id=new.company_id and is_active=true;
  if actor_role is null then raise exception 'property_source_unauthorized'; end if;
  if tg_op='INSERT' then
    if actor_role <> 'owner' then new.sourced_by:=auth.uid(); end if;
    if new.sourced_by is null then new.sourced_by:=auth.uid(); end if;
  elsif actor_role <> 'owner' and new.sourced_by is distinct from old.sourced_by then
    raise exception 'property_source_owner_only';
  end if;
  if new.sourced_by is not null and not exists(select 1 from public.profiles p where p.id=new.sourced_by and p.company_id=new.company_id) then
    raise exception 'property_source_wrong_company';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.normalize_property_marketing_link(p_url text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE u text:=trim(coalesce(p_url,'')); m text[];
BEGIN
 u:=regexp_replace(replace(u,'&amp;','&'),'[\]\)\}>,.;!؟،]+$','','g');
 -- Host is insensitive, shortcodes and video IDs are case sensitive.
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?(?:instagram\.com|instagr\.am)/(?:reel|reels|p|tv)/([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'instagram:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?instagram\.com/share/(?:reel|p)/([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'instagram-share:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?youtu\.be/([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'youtube:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?youtube\.com/shorts/([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'youtube:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?youtube\.com/watch\?[^#]*\mv=([A-Za-z0-9_-]+)','i');
 IF m IS NOT NULL THEN RETURN 'youtube:'||m[1]; END IF;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.process_property_links_from_whatsapp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r text[]; v_url text; v_key text; v_provider text; v_marketing record; v_property uuid;
 v_matched int:=0; v_unmatched int:=0; v_first_property uuid; v_first_marketing uuid; v_seen text[]:='{}'; v_evidence text;
BEGIN
 IF new.direction<>'inbound' OR new.client_id IS NULL THEN RETURN new; END IF;
 -- Preserve both pasted URLs and authenticated Meta click-to-WhatsApp referral URLs.
 v_evidence:=coalesce(new.body,'')||' '||coalesce(new.raw_payload->'referral'->>'source_url','');
 FOR r IN SELECT regexp_matches(v_evidence,'((?:https?://|www\.)[^[:space:]<>"'']+)','gi') LOOP
  v_url:=r[1]; v_key:=public.normalize_property_marketing_link(v_url);
  IF v_key IS NULL OR v_key=ANY(v_seen) THEN CONTINUE; END IF;
  v_seen:=array_append(v_seen,v_key); v_provider:=public.property_link_provider(v_url);
  SELECT m.id,m.property_id INTO v_marketing FROM public.property_marketing_events m
  WHERE m.company_id=new.company_id AND m.link_key=v_key LIMIT 1;
  IF v_marketing.id IS NOT NULL THEN
   PERFORM public.record_property_link_inquiry_internal(new.company_id,new.client_id,v_marketing.property_id,v_marketing.id,new.id,v_url,v_key,coalesce(new.message_timestamp,new.created_at),false);
   v_matched:=v_matched+1; v_first_property:=coalesce(v_first_property,v_marketing.property_id); v_first_marketing:=coalesce(v_first_marketing,v_marketing.id);
  ELSE
   INSERT INTO public.unmatched_property_links(company_id,client_id,conversation_id,whatsapp_message_id,inbound_number,raw_url,link_key,provider,status,first_seen_at,last_seen_at)
   VALUES(new.company_id,new.client_id,new.conversation_id,new.id,new.recipient_wa_id,v_url,v_key,v_provider,'pending',coalesce(new.message_timestamp,now()),coalesce(new.message_timestamp,now()))
   ON CONFLICT(company_id,whatsapp_message_id,link_key) DO NOTHING;
   v_unmatched:=v_unmatched+1;
  END IF;
 END LOOP;
 FOR r IN SELECT regexp_matches(v_evidence,'(?:property-code:|رمز[[:space:]]+العقار[[:space:]:]+)([A-Za-z0-9_-]{3,80})','gi') LOOP
  v_key:='property-code:'||r[1];
  IF v_key=ANY(v_seen) THEN CONTINUE; END IF; v_seen:=array_append(v_seen,v_key);
  SELECT CASE WHEN count(*)=1 THEN (array_agg(id))[1] ELSE NULL END INTO v_property FROM public.properties
  WHERE company_id=new.company_id AND (lower(property_code)=lower(r[1]) OR id::text=lower(r[1]));
  IF v_property IS NOT NULL THEN
   PERFORM public.record_property_link_inquiry_internal(new.company_id,new.client_id,v_property,NULL,new.id,v_key,v_key,coalesce(new.message_timestamp,new.created_at),false);
   v_matched:=v_matched+1; v_first_property:=coalesce(v_first_property,v_property);
  ELSE
   INSERT INTO public.unmatched_property_links(company_id,client_id,conversation_id,whatsapp_message_id,raw_url,link_key,provider,status)
   VALUES(new.company_id,new.client_id,new.conversation_id,new.id,v_key,v_key,'other','pending') ON CONFLICT(company_id,whatsapp_message_id,link_key) DO NOTHING;
   v_unmatched:=v_unmatched+1;
  END IF;
 END LOOP;
 -- A photo or an underspecified 'this property' is reviewable evidence, never a guessed property identity.
 IF v_matched=0 AND v_unmatched=0 AND (new.message_type='image' OR coalesce(new.body,'') ~ '(هذا|هذي|هاذي|هذه).{0,15}(العقار|البيت|الفيلا)|تفاصيل.{0,15}(العقار|البيت|الفيلا)') THEN
  v_key:=CASE WHEN new.message_type='image' THEN 'image:' ELSE 'text:' END||new.id::text;
  INSERT INTO public.unmatched_property_links(company_id,client_id,conversation_id,whatsapp_message_id,raw_url,link_key,provider,status)
  VALUES(new.company_id,new.client_id,new.conversation_id,new.id,coalesce(nullif(new.body,''),'صورة واردة تحتاج تحديد العقار'),v_key,'other','pending')
  ON CONFLICT(company_id,whatsapp_message_id,link_key) DO NOTHING;
  v_unmatched:=1;
 END IF;
 IF v_matched>0 OR v_unmatched>0 THEN
  UPDATE public.whatsapp_messages SET matched_property_id=v_first_property,matched_marketing_event_id=v_first_marketing,
   property_match_status=CASE WHEN v_matched>0 AND v_unmatched>0 THEN 'partial_match' WHEN v_matched>1 THEN 'multiple_matched' WHEN v_matched=1 THEN 'auto_matched' ELSE 'pending_manual' END,
   property_link_key=CASE WHEN cardinality(v_seen)=1 THEN v_seen[1] ELSE NULL END WHERE id=new.id;
 END IF;
 RETURN new;
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_finalize_property_message(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE m public.whatsapp_messages%rowtype; a public.property_message_attributions%rowtype;
 p public.properties%rowtype; c public.clients%rowtype; v_req uuid; v_reqcount int; v_propcount int; v_inq uuid; v_n int:=0; v_type text;
BEGIN
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND direction='inbound';
 IF NOT FOUND THEN RAISE EXCEPTION 'inbound_message_required'; END IF;
 SELECT * INTO c FROM public.clients WHERE id=m.client_id AND company_id=m.company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_message_client'; END IF;
 SELECT count(*) INTO v_propcount FROM public.property_message_attributions WHERE message_id=m.id AND company_id=m.company_id;
 FOR a IN SELECT * FROM public.property_message_attributions WHERE message_id=m.id AND company_id=m.company_id ORDER BY property_id LOOP
  IF a.request_id IS NOT NULL THEN CONTINUE; END IF;
  SELECT * INTO p FROM public.properties WHERE id=a.property_id AND company_id=m.company_id;
  SELECT id INTO v_req FROM public.client_requests WHERE company_id=m.company_id AND client_id=m.client_id AND subject_property_id=p.id AND status='active' ORDER BY created_at LIMIT 1;
  IF v_req IS NULL AND v_propcount=1 THEN
   SELECT count(*),(array_agg(r.id))[1] INTO v_reqcount,v_req FROM public.client_requests r JOIN public.whatsapp_message_requests w ON w.request_id=r.id
   WHERE w.message_id=m.id AND w.company_id=m.company_id AND r.client_id=m.client_id AND r.company_id=m.company_id AND r.status='active'
    AND r.request_type IN ('buyer','tenant','investor') AND (r.subject_property_id IS NULL OR r.subject_property_id=p.id);
   IF v_reqcount<>1 THEN v_req:=NULL; END IF;
  END IF;
  IF v_req IS NULL THEN
   -- Do not infer financing, budget, readiness or bedrooms from a listing's price/specification.
   v_type:=CASE WHEN coalesce(m.body,'') ~ '(استئجار|للايجار|للإيجار|rent)' THEN 'tenant' ELSE 'buyer' END;
   INSERT INTO public.client_requests(company_id,client_id,request_type,property_type,property_types,preferred_area,preferred_areas,subject_property_id,
    assigned_to,route_key,branch_key,inbound_number,source,source_detail,created_via,origin_whatsapp_message_id,needs_human_review,next_action,notes)
   VALUES(m.company_id,m.client_id,v_type,p.type,CASE WHEN p.type IS NULL THEN '{}'::text[] ELSE ARRAY[p.type] END,p.area,ARRAY[p.area],p.id,
    c.assigned_to,coalesce(p.branch_key,c.lead_route,'general'),coalesce(p.branch_key,c.lead_route,'general'),m.recipient_wa_id,
    CASE WHEN a.evidence_key LIKE 'instagram%' THEN 'instagram' ELSE 'whatsapp' END,'استفسار عن عقار محدد عبر واتساب','whatsapp',m.id,true,
    'مراجعة الاستفسار وتأكيد نوع الطلب والميزانية والتوقيت','تم تحديد العقار من دليل الرسالة؛ لا تعتبر بيانات الإعلان متطلبات صرح بها العميل') RETURNING id INTO v_req;
  ELSE
   UPDATE public.client_requests SET subject_property_id=coalesce(subject_property_id,p.id) WHERE id=v_req AND company_id=m.company_id;
  END IF;
  -- Reuse the inquiry already belonging to the selected request; preserve legacy rows and their history.
  SELECT id INTO v_inq FROM public.property_inquiries WHERE company_id=m.company_id AND request_id=v_req AND property_id=p.id LIMIT 1;
  IF v_inq IS NULL THEN
   UPDATE public.property_inquiries SET request_id=v_req WHERE id=a.inquiry_id AND company_id=m.company_id AND request_id IS NULL RETURNING id INTO v_inq;
  END IF;
  UPDATE public.property_message_attributions SET request_id=v_req,inquiry_id=coalesce(v_inq,inquiry_id) WHERE id=a.id;
  INSERT INTO public.whatsapp_message_requests(company_id,message_id,request_id,relation) VALUES(m.company_id,m.id,v_req,'mentioned') ON CONFLICT(message_id,request_id) DO NOTHING;
  v_n:=v_n+1;
 END LOOP;
 SELECT count(DISTINCT request_id),(array_agg(DISTINCT request_id))[1] INTO v_reqcount,v_req FROM public.whatsapp_message_requests WHERE message_id=m.id AND company_id=m.company_id;
 IF v_reqcount=1 THEN UPDATE public.whatsapp_messages SET request_id=v_req WHERE id=m.id; END IF;
 RETURN jsonb_build_object('ok',true,'linked_count',v_n,'property_count',v_propcount);
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_replace_rejection_reasons(p_inquiry_id uuid, p_reason_ids uuid[], p_primary_id uuid, p_phase text, p_note text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 SELECT crm_repair_private.replace_primary_rejection(p_inquiry_id,p_reason_ids,p_primary_id,p_phase,p_note)
$function$
;

CREATE OR REPLACE FUNCTION public.crm_set_request_geography()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  branches text[];
  logical_route text;
  primary_route text;
  primary_user uuid;
  physical_route text;
begin
  branches := public.crm_infer_request_branches(new.route_key,new.branch_key,new.wilayat,new.preferred_area,new.preferred_areas,new.alternative_areas);

  if array_length(branches,1) is null then
    -- A manual assignee/property-specific request remains independent of inbox routing.
    if new.manual_assigned_to is null and new.subject_property_id is null then
      physical_route:=crm_repair_private.whatsapp_request_physical_branch(
        new.company_id,new.client_id,new.origin_whatsapp_message_id,new.inbound_number);
    end if;
    logical_route := coalesce(physical_route,'general');
    primary_route := coalesce(physical_route,'muscat');
  elsif array_length(branches,1)=1 then
    logical_route := branches[1];
    primary_route := branches[1];
  else
    logical_route := 'general';
    primary_route := 'muscat';
  end if;

  select r.assigned_to into primary_user
  from public.company_lead_routes r
  where r.company_id=new.company_id and r.route_key=primary_route and r.is_active=true
  limit 1;

  new.branch_key := logical_route;
  new.route_key := logical_route;
  IF new.manual_assigned_to IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=new.manual_assigned_to
      AND p.company_id=new.company_id AND p.is_active IS TRUE AND p.role IN('owner','manager','agent')) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='manual_assignee_not_active_in_company';
    END IF;
    new.assigned_to:=new.manual_assigned_to;
  ELSIF primary_user IS NOT NULL THEN new.assigned_to:=primary_user;
  END IF;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ignore_unmatched_property_link(p_unmatched_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u public.unmatched_property_links%rowtype; v_company uuid:=public.my_company();
BEGIN
 IF v_company IS NULL OR public.my_role() NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT * INTO u FROM public.unmatched_property_links WHERE id=p_unmatched_id AND company_id=v_company AND status='pending' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT crm_repair_private.can_access_whatsapp_conversation(v_company,u.conversation_id) THEN RAISE EXCEPTION 'not_assigned'; END IF;
 UPDATE public.unmatched_property_links SET status='ignored',resolved_by=auth.uid(),resolved_at=now(),updated_at=now() WHERE id=u.id;
 RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_save_viewing_atomic(p_payload jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_company uuid:=public.my_company(); v_user uuid:=auth.uid(); v_role text:=public.my_role();
  v_old public.viewings%rowtype; v_new public.viewings%rowtype; v_saved public.viewings%rowtype;
  v_op crm_repair_private.viewing_save_operations%rowtype;
  v_hash text; v_id uuid; v_task uuid; v_appointment uuid; v_appointment_at timestamptz;
  v_appointment_status text; v_request_branch text; v_warnings jsonb:='[]'::jsonb;
  v_existing_time timestamptz; v_property_title text; v_expected bigint;
  v_property_branch text; v_property_type text; v_property_area text; v_property_wilayat text;
  v_request_type text; v_request_subject uuid; v_request_status text; v_request_count integer;
  v_property_price numeric; v_property_bedrooms integer; v_property_bathrooms integer;
  v_property_land numeric; v_property_built numeric; v_date_only_completed boolean:=false;
BEGIN
  IF v_user IS NULL OR v_company IS NULL OR v_role NOT IN('owner','manager','agent') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not_allowed';
  END IF;
  IF p_idempotency_key IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_payload_and_operation_key_required';
  END IF;
  IF p_payload ? 'company_id' AND (p_payload->>'company_id')::uuid IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='company_mismatch';
  END IF;
  v_hash:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text||':'||p_idempotency_key::text,0));
  SELECT * INTO v_op FROM crm_repair_private.viewing_save_operations
    WHERE user_id=v_user AND operation_key=p_idempotency_key;
  IF FOUND THEN
    IF v_op.payload_hash<>v_hash THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='idempotency_key_reused_with_different_payload'; END IF;
    SELECT * INTO v_saved FROM public.viewings WHERE id=v_op.viewing_id AND company_id=v_company;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='saved_viewing_no_longer_available'; END IF;
    RETURN jsonb_build_object('ok',true,'viewing_id',v_saved.id,'appointment_id',v_op.appointment_id,
      'followup_task_id',v_op.followup_task_id,'viewing',to_jsonb(v_saved),'warnings',v_op.warnings,'replayed',true);
  END IF;

  v_id:=nullif(p_payload->>'id','')::uuid;
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.viewings WHERE id=v_id AND company_id=v_company FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_not_found_or_not_allowed'; END IF;
    IF v_old.archived IS TRUE THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='archived_viewing_restore_before_edit';
    END IF;
    v_expected:=nullif(p_payload->>'expected_version','')::bigint;
    IF v_expected IS NULL OR v_expected<>v_old.row_version THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='viewing_changed_reload_before_saving';
    END IF;
  END IF;
  v_new:=jsonb_populate_record(v_old,p_payload-'expected_version'-'request_type'-'time_unknown');
  v_new.id:=coalesce(v_id,gen_random_uuid()); v_new.company_id:=v_company;
  v_new.agent_id:=coalesce(v_new.agent_id,v_user);
  v_new.created_by:=coalesce(v_old.created_by,v_user);
  v_new.created_at:=coalesce(v_old.created_at,now());
  v_new.created_via:=coalesce(v_old.created_via,'manual');
  v_new.status:=coalesce(v_new.status,'scheduled');
  v_new.duration_minutes:=coalesce(v_new.duration_minutes,60);
  v_new.archived:=coalesce(v_old.archived,false);
  IF v_new.client_id IS NULL OR v_new.property_id IS NULL OR v_new.viewing_date IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_client_property_date_required';
  END IF;
  v_date_only_completed:=v_new.status='done' AND v_new.viewing_time IS NULL AND coalesce((p_payload->>'time_unknown')::boolean,false) AND v_old.appointment_id IS NULL AND v_old.viewing_time IS NULL;
  IF v_id IS NULL AND v_new.viewing_time IS NULL AND NOT v_date_only_completed THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_time_required';
  END IF;
  IF v_id IS NOT NULL AND (v_new.client_id IS DISTINCT FROM v_old.client_id
    OR v_new.property_id IS DISTINCT FROM v_old.property_id
    OR (v_old.request_id IS NOT NULL AND v_new.request_id IS DISTINCT FROM v_old.request_id)) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_identity_change_requires_new_record';
  END IF;
  IF v_new.status NOT IN('scheduled','confirmed','done','cancelled','no_show','postponed') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_viewing_status';
  END IF;
  IF v_new.status='done' AND v_new.pipeline_outcome IS NULL AND NOT v_date_only_completed THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_outcome_required';
  END IF;
  IF v_new.status='done' AND v_new.pipeline_outcome='lost' AND
    nullif(btrim(v_new.rejection_reason),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_rejection_reason_required';
  END IF;
  IF NOT crm_repair_private.can_access_client(v_company,v_new.client_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_client_not_allowed';
  END IF;
  -- Read only non-financial property fields; invoker RLS remains authoritative.
  SELECT title,coalesce(branch_key,'general'),type,area,wilayat,price,bedrooms,bathrooms,land_size,built_size
    INTO v_property_title,v_property_branch,v_property_type,v_property_area,v_property_wilayat,v_property_price,v_property_bedrooms,v_property_bathrooms,v_property_land,v_property_built
    FROM public.properties WHERE id=v_new.property_id AND company_id=v_company;
  IF NOT FOUND OR NOT crm_repair_private.staff_can_access_branch(v_company,v_property_branch) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_property_not_allowed';
  END IF;
  v_request_type:=coalesce(nullif(p_payload->>'request_type',''),'buyer');
  IF v_request_type NOT IN ('buyer','tenant','investor') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_invalid_request_type';
  END IF;
  IF v_new.request_id IS NULL THEN
    -- Client row serialization also coordinates with inbound property-request creation.
    -- Advisory lock covers two different operation keys or employees visiting the same listing.
    PERFORM 1 FROM public.clients WHERE id=v_new.client_id AND company_id=v_company FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_client_not_allowed'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('viewing-request:'||v_company::text||':'||v_new.client_id::text||':'||v_new.property_id::text||':'||v_request_type,0));
    SELECT r.id INTO v_new.request_id FROM public.client_requests r
      WHERE r.company_id=v_company AND r.client_id=v_new.client_id
        AND r.subject_property_id=v_new.property_id AND r.status IN ('active','paused')
        AND r.request_type=v_request_type AND coalesce(r.branch_key,r.route_key,'general')=v_property_branch
        AND crm_repair_private.can_access_request(v_company,r.id)
      ORDER BY (r.status='active') DESC,r.created_at,r.id LIMIT 1;
    IF v_new.request_id IS NULL THEN
      -- A single compatible general request may serve the visit, without altering its scope.
      -- Multiple candidates remain independent: create an exact property request instead of guessing.
      SELECT count(*),(array_agg(r.id ORDER BY r.created_at,r.id))[1] INTO v_request_count,v_new.request_id
      FROM public.client_requests r
      WHERE r.company_id=v_company AND r.client_id=v_new.client_id
        AND r.subject_property_id IS NULL AND r.status IN ('active','paused')
        AND r.request_type=v_request_type AND coalesce(r.branch_key,r.route_key,'general')=v_property_branch
        AND (coalesce(cardinality(r.property_types),0)=0 AND (r.property_type IS NULL OR r.property_type=v_property_type)
          OR v_property_type=ANY(r.property_types))
        AND (coalesce(cardinality(r.preferred_areas),0)=0 AND (r.preferred_area IS NULL OR r.preferred_area=v_property_area)
          OR v_property_area=ANY(r.preferred_areas))
        AND (r.wilayat IS NULL OR r.wilayat=v_property_wilayat)
        AND (r.budget_min IS NULL OR v_property_price>=r.budget_min)
        AND (r.budget_max IS NULL OR v_property_price<=r.budget_max)
        AND (r.bedrooms_min IS NULL OR v_property_bedrooms>=r.bedrooms_min)
        AND (r.bathrooms_min IS NULL OR v_property_bathrooms>=r.bathrooms_min)
        AND (r.land_size_min IS NULL OR v_property_land>=r.land_size_min)
        AND (r.land_size_max IS NULL OR v_property_land<=r.land_size_max)
        AND (r.built_size_min IS NULL OR v_property_built>=r.built_size_min)
        AND (r.built_size_max IS NULL OR v_property_built<=r.built_size_max)
        AND r.furnished IS NULL -- listing schema has no furnishing evidence
        AND crm_repair_private.can_access_request(v_company,r.id);
      IF v_request_count<>1 THEN v_new.request_id:=NULL; END IF;
    END IF;
    IF v_new.request_id IS NULL THEN
      INSERT INTO public.client_requests(company_id,client_id,request_type,subject_property_id,
        branch_key,route_key,assigned_to,property_type,property_types,preferred_area,preferred_areas,wilayat,
        status,pipeline_stage,created_via,source,source_detail,created_by,updated_by)
      VALUES(v_company,v_new.client_id,v_request_type,v_new.property_id,v_property_branch,v_property_branch,
        v_new.agent_id,v_property_type,CASE WHEN v_property_type IS NULL THEN '{}'::text[] ELSE ARRAY[v_property_type] END,
        v_property_area,CASE WHEN v_property_area IS NULL THEN '{}'::text[] ELSE ARRAY[v_property_area] END,v_property_wilayat,
        'active','new','manual','viewing','طلب مرتبط بالعقار أنشئ أثناء تسجيل الزيارة',v_user,v_user)
      RETURNING id INTO v_new.request_id;
    END IF;
  END IF;
  IF NOT crm_repair_private.can_access_request(v_company,v_new.request_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_request_not_allowed';
  END IF;
  SELECT coalesce(branch_key,route_key,'general'),request_type,subject_property_id,status
    INTO v_request_branch,v_request_type,v_request_subject,v_request_status
    FROM public.client_requests WHERE id=v_new.request_id AND company_id=v_company AND client_id=v_new.client_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_request_client_mismatch'; END IF;
  -- Old visits keep their existing journey. New links must fit this property, branch and purpose.
  IF v_old.request_id IS NULL AND (v_request_branch<>v_property_branch
    OR v_request_subject IS NOT NULL AND v_request_subject<>v_new.property_id
    OR v_request_type<>coalesce(nullif(p_payload->>'request_type',''),'buyer')
    OR v_request_status NOT IN ('active','paused')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_request_property_or_type_mismatch';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_new.agent_id AND company_id=v_company AND is_active IS TRUE
    AND role IN('owner','manager','agent')) OR (v_role='agent' AND v_new.agent_id<>v_user) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_agent_not_allowed';
  END IF;

  -- A genuinely completed, date-only visit may have no appointment or invented time.
  -- Known appointment times still follow normal edit validation and remain protected.
  IF NOT v_date_only_completed THEN
  -- Each timed manual visit has one appointment. Do not edit a shared appointment.
  v_appointment:=v_old.appointment_id;
  IF v_appointment IS NOT NULL THEN
    SELECT appointment_at INTO v_existing_time FROM public.appointments
      WHERE id=v_appointment AND company_id=v_company AND client_id=v_new.client_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_appointment_not_allowed'; END IF;
    IF EXISTS(SELECT 1 FROM public.viewings WHERE appointment_id=v_appointment AND id<>v_new.id) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='shared_appointment_requires_separate_review';
    END IF;
  END IF;
  IF v_new.viewing_time IS NULL THEN
    IF v_id IS NULL OR v_old.viewing_time IS NOT NULL OR v_new.viewing_date<>v_old.viewing_date THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_time_required';
    END IF;
    v_appointment_at:=v_existing_time;
  ELSE
    v_appointment_at:=(v_new.viewing_date+v_new.viewing_time) AT TIME ZONE 'Asia/Muscat';
  END IF;
  IF v_appointment_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_time_required'; END IF;
  v_appointment_status:=CASE v_new.status WHEN 'done' THEN 'attended' WHEN 'postponed' THEN 'rescheduled' ELSE v_new.status END;
  IF v_appointment IS NULL THEN
    INSERT INTO public.appointments(company_id,client_id,request_id,branch_key,agent_id,appointment_at,status,
      confirmed_at,attended_at,visit_notes,result,next_action,next_followup,created_by)
    VALUES(v_company,v_new.client_id,v_new.request_id,v_request_branch,v_new.agent_id,v_appointment_at,v_appointment_status,
      CASE WHEN v_new.status IN('confirmed','done') THEN v_appointment_at END,
      CASE WHEN v_new.status='done' THEN v_appointment_at END,v_new.notes,v_new.pipeline_outcome,v_new.next_step,v_new.followup_date,v_user)
    RETURNING id INTO v_appointment;
  ELSE
    UPDATE public.appointments SET request_id=v_new.request_id,branch_key=v_request_branch,agent_id=v_new.agent_id,
      appointment_at=v_appointment_at,status=v_appointment_status,
      confirmed_at=CASE WHEN v_new.status IN('confirmed','done') THEN coalesce(confirmed_at,v_appointment_at) ELSE confirmed_at END,
      attended_at=CASE WHEN v_new.status='done' THEN coalesce(attended_at,v_appointment_at) ELSE attended_at END,
      visit_notes=v_new.notes,result=v_new.pipeline_outcome,next_action=v_new.next_step,next_followup=v_new.followup_date,updated_at=now()
    WHERE id=v_appointment AND company_id=v_company;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='appointment_update_not_allowed'; END IF;
  END IF;
  INSERT INTO public.appointment_properties(company_id,appointment_id,property_id)
    VALUES(v_company,v_appointment,v_new.property_id)
    ON CONFLICT(company_id,appointment_id,property_id) DO NOTHING;
  END IF; -- timed visit appointment
  v_new.appointment_id:=v_appointment;
  IF v_id IS NULL THEN
    INSERT INTO public.viewings(id,company_id,client_id,property_id,agent_id,request_id,appointment_id,viewing_date,
      viewing_time,duration_minutes,location,status,attendance,client_feedback,rejection_reason,pipeline_outcome,
      outcome_note,next_step,followup_date,notes,archived,created_by,created_via)
    VALUES(v_new.id,v_company,v_new.client_id,v_new.property_id,v_new.agent_id,v_new.request_id,v_appointment,
      v_new.viewing_date,v_new.viewing_time,v_new.duration_minutes,v_new.location,v_new.status,v_new.attendance,
      v_new.client_feedback,v_new.rejection_reason,v_new.pipeline_outcome,v_new.outcome_note,v_new.next_step,
      v_new.followup_date,v_new.notes,false,v_user,'manual');
  ELSE
    UPDATE public.viewings SET agent_id=v_new.agent_id,request_id=v_new.request_id,appointment_id=v_appointment,
      viewing_date=v_new.viewing_date,viewing_time=v_new.viewing_time,duration_minutes=v_new.duration_minutes,
      location=v_new.location,status=v_new.status,attendance=v_new.attendance,client_feedback=v_new.client_feedback,
      rejection_reason=v_new.rejection_reason,pipeline_outcome=v_new.pipeline_outcome,outcome_note=v_new.outcome_note,
      next_step=v_new.next_step,followup_date=v_new.followup_date,notes=v_new.notes
    WHERE id=v_new.id AND company_id=v_company AND row_version=v_expected;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='viewing_changed_or_update_not_allowed'; END IF;
  END IF;

  SELECT id INTO v_task FROM public.tasks WHERE company_id=v_company AND viewing_id=v_new.id AND done IS FALSE FOR UPDATE;
  IF v_new.followup_date IS NOT NULL THEN
    IF v_task IS NULL THEN
      INSERT INTO public.tasks(company_id,user_id,client_id,request_id,viewing_id,title,notes,due_date,priority,done)
      VALUES(v_company,v_new.agent_id,v_new.client_id,v_new.request_id,v_new.id,
        'متابعة نتيجة الزيارة: '||coalesce(v_property_title,'العقار'),v_new.next_step,v_new.followup_date,'high',false)
      RETURNING id INTO v_task;
    ELSE
      UPDATE public.tasks SET user_id=v_new.agent_id,request_id=v_new.request_id,due_date=v_new.followup_date,
        notes=v_new.next_step,priority='high' WHERE id=v_task;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='followup_task_update_not_allowed'; END IF;
    END IF;
  ELSIF v_task IS NOT NULL THEN
    v_warnings:=jsonb_build_array('existing_followup_task_retained');
  END IF;
  INSERT INTO public.activities(company_id,user_id,client_id,property_id,request_id,appointment_id,
    type,description,activity_type,activity_text,channel,direction,actor_type,after_data)
  VALUES(v_company,v_user,v_new.client_id,v_new.property_id,v_new.request_id,v_appointment,
    'system','حفظ زيارة','system','حفظ زيارة','system','internal','human',
    jsonb_build_object('entity_type','viewing','entity_id',v_new.id,'operation_key',p_idempotency_key));
  SELECT * INTO v_saved FROM public.viewings WHERE id=v_new.id AND company_id=v_company;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='saved_viewing_not_readable'; END IF;
  INSERT INTO crm_repair_private.viewing_save_operations(operation_key,user_id,company_id,payload_hash,
    viewing_id,appointment_id,followup_task_id,warnings)
  VALUES(p_idempotency_key,v_user,v_company,v_hash,v_saved.id,v_appointment,v_task,v_warnings);
  RETURN jsonb_build_object('ok',true,'viewing_id',v_saved.id,'appointment_id',v_appointment,
    'followup_task_id',v_task,'viewing',to_jsonb(v_saved),'warnings',v_warnings,'replayed',false);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_delete_deal_atomic(p_deal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_company uuid:=public.my_company(); v_property uuid; v_stage text; v_status text;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL OR public.my_role() NOT IN('owner','manager') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not_allowed';
  END IF;
  SELECT property_id,stage INTO v_property,v_stage FROM public.deals WHERE id=p_deal_id AND company_id=v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='deal_not_found_or_not_allowed'; END IF;
  IF v_stage IN('closed','commission_collected') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='completed_deal_requires_explicit_reversal';
  END IF;
  IF EXISTS(SELECT 1 FROM public.deposits WHERE deal_id=p_deal_id AND company_id=v_company) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='deal_has_deposits_cannot_delete';
  END IF;
  DELETE FROM public.deals WHERE id=p_deal_id AND company_id=v_company;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='deal_delete_not_allowed'; END IF;
  SELECT status INTO v_status FROM public.properties WHERE id=v_property AND company_id=v_company;
  RETURN jsonb_build_object('ok',true,'deal_id',p_deal_id,'property_id',v_property,'property_status',v_status);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_verify_followup_cron_secret(p_secret text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_secret IS NOT NULL AND length(p_secret)>0 AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name='crm_followup_cron_secret' AND s.decrypted_secret=p_secret
  );
$function$
;

CREATE OR REPLACE FUNCTION public.crm_add_property_marketing_links(p_property_id uuid, p_urls text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p record; u text; k text; e public.property_marketing_events%rowtype; n int:=0; old int:=0;
BEGIN
 IF public.my_role() NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT id,company_id INTO p FROM public.properties WHERE id=p_property_id AND company_id=public.my_company() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'property_not_found'; END IF;
 IF cardinality(p_urls) IS NULL OR cardinality(p_urls)<1 OR cardinality(p_urls)>50 THEN RAISE EXCEPTION 'one_to_fifty_links_required'; END IF;
 FOREACH u IN ARRAY p_urls LOOP
  u:=trim(u); k:=public.normalize_property_marketing_link(u);
  IF k IS NULL OR k NOT LIKE 'instagram:%' THEN RAISE EXCEPTION 'instagram_post_or_reel_link_required'; END IF;
  SELECT * INTO e FROM public.property_marketing_events WHERE company_id=p.company_id AND link_key=k;
  IF FOUND THEN
   IF e.property_id<>p.id THEN RAISE EXCEPTION 'link_already_mapped_to_another_property'; END IF;
   old:=old+1; CONTINUE;
  END IF;
  INSERT INTO public.property_marketing_events(company_id,property_id,channel,event_type,url,created_by,auto_sync,sync_status)
  VALUES(p.company_id,p.id,'instagram','publish',u,auth.uid(),true,'pending'); n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'inserted_count',n,'existing_count',old);
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_guard_instagram_conversation_counters()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF new.last_message_seq=old.last_message_seq THEN
  new.last_message_at:=old.last_message_at;
  new.last_inbound_at:=old.last_inbound_at;
  new.last_outbound_at:=old.last_outbound_at;
  IF new.read_through_seq<=old.read_through_seq THEN new.unread_count:=old.unread_count; END IF;
 END IF;
 RETURN new;
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_get_deal_workflow(p_deal_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 SELECT crm_repair_private.get_deal_workflow(p_deal_id)
$function$
;

CREATE OR REPLACE FUNCTION public.crm_apply_property_image_evidence(p_message_id uuid, p_evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE m public.whatsapp_messages%rowtype; token text; k text; v_prop uuid; v_event uuid; n int:=0;
BEGIN
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND direction='inbound' AND message_type='image';
 IF NOT FOUND THEN RAISE EXCEPTION 'image_message_required'; END IF;
 -- Keep the same client-before-message lock order as the finalizer on retries.
 PERFORM 1 FROM public.clients WHERE id=m.client_id AND company_id=m.company_id FOR UPDATE;
 IF jsonb_typeof(p_evidence)<>'object' THEN RAISE EXCEPTION 'invalid_evidence'; END IF;
 IF coalesce(jsonb_array_length(p_evidence->'urls'),0)+coalesce(jsonb_array_length(p_evidence->'property_codes'),0)>1 THEN
  UPDATE public.whatsapp_messages SET property_image_analysis=p_evidence||jsonb_build_object('status','review_required','reason','تحتوي الصورة أكثر من مرجع ويجب تأكيد العقار المقصود') WHERE id=m.id;
  RETURN jsonb_build_object('ok',true,'matched_count',0,'needs_human_review',true,'reason','multiple_image_references');
 END IF;
 -- Only literal, high confidence identifiers are eligible. Similarity/title/price is never sufficient.
 IF coalesce((p_evidence->>'confidence')::numeric,0)>=0.95 AND coalesce((p_evidence->>'has_literal_reference')::boolean,false) THEN
  FOR token IN SELECT value FROM jsonb_array_elements_text(coalesce(p_evidence->'urls','[]'::jsonb)) LIMIT 5 LOOP
   k:=public.normalize_property_marketing_link(token);
   IF k IS NULL THEN CONTINUE; END IF;
   SELECT id,property_id INTO v_event,v_prop FROM public.property_marketing_events WHERE company_id=m.company_id AND link_key=k;
   IF v_prop IS NOT NULL THEN
    PERFORM public.record_property_link_inquiry_internal(m.company_id,m.client_id,v_prop,v_event,m.id,token,k,coalesce(m.message_timestamp,m.created_at),false); n:=n+1;
   END IF;
  END LOOP;
  FOR token IN SELECT value FROM jsonb_array_elements_text(coalesce(p_evidence->'property_codes','[]'::jsonb)) LIMIT 5 LOOP
   SELECT CASE WHEN count(*)=1 THEN (array_agg(id))[1] ELSE NULL END INTO v_prop FROM public.properties
   WHERE company_id=m.company_id AND (lower(property_code)=lower(trim(token)) OR id::text=lower(trim(token)));
   IF v_prop IS NOT NULL THEN
    k:='property-code:'||trim(token);
    PERFORM public.record_property_link_inquiry_internal(m.company_id,m.client_id,v_prop,NULL,m.id,k,k,coalesce(m.message_timestamp,m.created_at),false); n:=n+1;
   END IF;
  END LOOP;
 END IF;
 UPDATE public.whatsapp_messages SET property_image_analysis=p_evidence WHERE id=m.id;
 IF n>0 THEN
  SELECT a.property_id,a.marketing_event_id INTO v_prop,v_event FROM public.property_message_attributions a WHERE a.message_id=m.id ORDER BY a.created_at LIMIT 1;
  UPDATE public.whatsapp_messages SET matched_property_id=v_prop,matched_marketing_event_id=v_event,
   property_match_status=CASE WHEN (SELECT count(*) FROM public.property_message_attributions WHERE message_id=m.id)>1 THEN 'multiple_matched' ELSE 'auto_matched' END WHERE id=m.id;
  UPDATE public.unmatched_property_links SET status='resolved',property_id=v_prop,marketing_event_id=v_event,resolved_at=now(),updated_at=now()
   WHERE whatsapp_message_id=m.id AND link_key='image:'||m.id::text AND status='pending';
  PERFORM public.crm_finalize_property_message(m.id);
 END IF;
 RETURN jsonb_build_object('ok',true,'matched_count',n,'needs_human_review',n=0);
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_touch_whatsapp_conversation(p_conversation_id uuid, p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c public.whatsapp_conversations%rowtype; m public.whatsapp_messages%rowtype; v_unread boolean;
BEGIN
 SELECT * INTO c FROM public.whatsapp_conversations WHERE id=p_conversation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND conversation_id=c.id AND company_id=c.company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found'; END IF;
 IF m.conversation_touched_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'duplicate',true,'unread_count',c.unread_count); END IF;
 v_unread:=m.direction='inbound';
 UPDATE public.whatsapp_conversations SET
  last_message_at=greatest(last_message_at,coalesce(m.message_timestamp,m.created_at)),
  last_inbound_at=CASE WHEN m.direction='inbound' THEN greatest(last_inbound_at,coalesce(m.message_timestamp,m.created_at)) ELSE last_inbound_at END,
  last_outbound_at=CASE WHEN m.direction='outbound' THEN greatest(last_outbound_at,coalesce(m.message_timestamp,m.created_at)) ELSE last_outbound_at END,
  last_message_seq=last_message_seq+1,unread_count=coalesce(unread_count,0)+CASE WHEN v_unread THEN 1 ELSE 0 END,updated_at=now()
 WHERE id=c.id RETURNING * INTO c;
 UPDATE public.whatsapp_messages SET conversation_touched_at=now(),ingestion_seq=c.last_message_seq WHERE id=m.id;
 RETURN jsonb_build_object('ok',true,'unread_count',c.unread_count);
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_touch_whatsapp_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF new.direction IN ('inbound','outbound') THEN PERFORM public.crm_touch_whatsapp_conversation(new.conversation_id,new.id); END IF;
 RETURN new;
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_mark_whatsapp_read(p_conversation_id uuid, p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c public.whatsapp_conversations%rowtype; m public.whatsapp_messages%rowtype; n int;
BEGIN
 IF public.my_company() IS NULL OR public.my_role() NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 IF NOT crm_repair_private.can_access_whatsapp_conversation(public.my_company(),p_conversation_id) THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 SELECT * INTO c FROM public.whatsapp_conversations WHERE id=p_conversation_id AND company_id=public.my_company() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND conversation_id=c.id AND company_id=c.company_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found'; END IF;
 c.read_through_seq:=greatest(c.read_through_seq,coalesce(m.ingestion_seq,0));
 SELECT count(*)::int INTO n FROM public.whatsapp_messages WHERE conversation_id=c.id AND company_id=c.company_id AND direction='inbound'
 AND ingestion_seq>c.read_through_seq;
 UPDATE public.whatsapp_conversations SET unread_count=n,read_through_seq=c.read_through_seq,updated_at=now() WHERE id=c.id;
 RETURN jsonb_build_object('ok',true,'unread_count',n);
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_touch_instagram_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_seq bigint;
BEGIN
 UPDATE public.instagram_conversations SET
  last_message_at=greatest(last_message_at,coalesce(new.message_timestamp,new.created_at)),
  last_inbound_at=CASE WHEN new.direction='inbound' THEN greatest(last_inbound_at,coalesce(new.message_timestamp,new.created_at)) ELSE last_inbound_at END,
  last_outbound_at=CASE WHEN new.direction='outbound' THEN greatest(last_outbound_at,coalesce(new.message_timestamp,new.created_at)) ELSE last_outbound_at END,
  last_message_seq=last_message_seq+1,unread_count=coalesce(unread_count,0)+CASE WHEN new.direction='inbound' THEN 1 ELSE 0 END,
  updated_at=now() WHERE id=new.conversation_id AND company_id=new.company_id RETURNING last_message_seq INTO v_seq;
 UPDATE public.instagram_messages SET ingestion_seq=v_seq WHERE id=new.id;
 RETURN new;
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_mark_instagram_read(p_conversation_id uuid, p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c public.instagram_conversations%rowtype; m public.instagram_messages%rowtype; n int;
 v_company uuid:=public.my_company(); v_role text:=public.my_role();
BEGIN
 IF v_company IS NULL OR v_role NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT * INTO c FROM public.instagram_conversations WHERE id=p_conversation_id AND company_id=v_company
  AND (v_role IN ('owner','manager') OR assigned_to=auth.uid() OR EXISTS(SELECT 1 FROM public.clients cc WHERE cc.id=client_id AND cc.company_id=v_company AND cc.assigned_to=auth.uid())) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 SELECT * INTO m FROM public.instagram_messages WHERE id=p_message_id AND conversation_id=c.id AND company_id=v_company;
 IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found'; END IF;
 c.read_through_seq:=greatest(c.read_through_seq,coalesce(m.ingestion_seq,0));
 SELECT count(*)::int INTO n FROM public.instagram_messages WHERE conversation_id=c.id AND company_id=v_company AND direction='inbound' AND ingestion_seq>c.read_through_seq;
 UPDATE public.instagram_conversations SET unread_count=n,read_through_seq=c.read_through_seq,updated_at=now() WHERE id=c.id;
 RETURN jsonb_build_object('ok',true,'unread_count',n);
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_claim_instagram_send(p_company_id uuid, p_operation_id uuid, p_conversation_id uuid, p_actor_id uuid, p_body_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.instagram_outbound_operations%rowtype; fresh boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.instagram_conversations WHERE id=p_conversation_id AND company_id=p_company_id)
 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND company_id=p_company_id AND is_active IS TRUE AND role IN ('owner','manager','agent'))
 THEN RAISE EXCEPTION 'not_allowed'; END IF;
 INSERT INTO public.instagram_outbound_operations(company_id,operation_id,conversation_id,actor_id,body_sha256)
 VALUES(p_company_id,p_operation_id,p_conversation_id,p_actor_id,p_body_sha256) ON CONFLICT(company_id,operation_id) DO NOTHING RETURNING * INTO r;
 fresh:=FOUND;
 IF NOT fresh THEN
  SELECT * INTO r FROM public.instagram_outbound_operations WHERE company_id=p_company_id AND operation_id=p_operation_id;
  IF r.conversation_id<>p_conversation_id OR r.actor_id<>p_actor_id OR r.body_sha256<>p_body_sha256 THEN RAISE EXCEPTION 'operation_key_reused'; END IF;
 END IF;
 RETURN jsonb_build_object('claimed',fresh,'status',r.status,'message_id',r.instagram_message_id,'recorded',r.recorded);
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_property_acquisition_funnel(p_property_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH props AS (
 SELECT p.id,p.title,p.property_code,p.branch_key FROM public.properties p
 WHERE p.company_id=(SELECT public.my_company()) AND (p_property_id IS NULL OR p.id=p_property_id) AND NOT coalesce(p.archived,false)
), media AS (
 SELECT DISTINCT ON (e.property_id,coalesce(e.instagram_media_id,e.link_key,e.id::text))
 e.* FROM public.property_marketing_events e JOIN props p ON p.id=e.property_id
 WHERE e.company_id=(SELECT public.my_company()) AND e.channel='instagram'
 ORDER BY e.property_id,coalesce(e.instagram_media_id,e.link_key,e.id::text),e.last_synced_at DESC NULLS LAST,e.created_at DESC
), cohorts AS (
 SELECT DISTINCT i.property_id,i.request_id FROM public.property_inquiries i JOIN props p ON p.id=i.property_id
 JOIN public.client_requests r ON r.id=i.request_id AND r.company_id=i.company_id AND r.client_id=i.client_id
 WHERE i.company_id=(SELECT public.my_company()) AND i.has_inbound_inquiry AND i.request_id IS NOT NULL
), rows AS (
 SELECT p.id,p.title,p.property_code,p.branch_key,
  (SELECT count(*) FROM media m WHERE m.property_id=p.id) media_count,
  (SELECT sum(views) FROM media m WHERE m.property_id=p.id) views,
  (SELECT sum(reach) FROM media m WHERE m.property_id=p.id) reach_non_unique,
  (SELECT sum(total_interactions) FROM media m WHERE m.property_id=p.id) interactions,
  (SELECT max(last_synced_at) FROM media m WHERE m.property_id=p.id) latest_synced_at,
  (SELECT count(*) FROM media m WHERE m.property_id=p.id AND (m.sync_status<>'synced' OR m.views IS NULL)) unavailable_media_count,
  (SELECT count(DISTINCT client_id) FROM public.property_inquiries i WHERE i.property_id=p.id AND i.company_id=public.my_company() AND has_inbound_inquiry) attributed_clients,
  (SELECT count(*) FROM cohorts c WHERE c.property_id=p.id) attributed_requests,
  (SELECT count(*) FROM public.property_inquiries i WHERE i.property_id=p.id AND i.company_id=public.my_company() AND i.has_inbound_inquiry AND i.request_id IS NULL) legacy_inquiries_without_request,
  (SELECT count(DISTINCT client_id) FROM public.property_message_attributions a WHERE a.property_id=p.id AND a.company_id=public.my_company()) whatsapp_attributed_clients,
  (SELECT count(DISTINCT request_id) FROM public.property_message_attributions a WHERE a.property_id=p.id AND a.company_id=public.my_company()) whatsapp_attributed_requests,
  (SELECT count(DISTINCT client_id) FROM public.property_message_attributions a WHERE a.property_id=p.id AND a.company_id=public.my_company() AND a.evidence_key LIKE 'instagram%') instagram_attributed_clients,
  (SELECT count(DISTINCT request_id) FROM public.property_message_attributions a WHERE a.property_id=p.id AND a.company_id=public.my_company() AND a.evidence_key LIKE 'instagram%') instagram_attributed_requests,
  (SELECT count(*) FROM public.viewings v WHERE v.property_id=p.id AND v.company_id=public.my_company() AND NOT coalesce(v.archived,false) AND coalesce(v.status,'') NOT IN ('cancelled','no_show')) booked_visits,
  (SELECT count(*) FROM public.viewings v WHERE v.property_id=p.id AND v.company_id=public.my_company() AND NOT coalesce(v.archived,false) AND v.status IN ('done','completed') AND coalesce(v.attendance,'') NOT IN ('no_show','absent')) completed_visits,
  (SELECT count(*) FROM public.deals d WHERE d.property_id=p.id AND d.company_id=public.my_company() AND d.stage IN ('closed','commission_collected')) closed_deals,
  (SELECT count(*) FROM public.unmatched_property_links u WHERE u.company_id=public.my_company() AND u.status='pending' AND u.property_id=p.id) unresolved_count,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'url',m.url,'media_id',m.instagram_media_id,'views',m.views,'reach',m.reach,'total_interactions',m.total_interactions,'sync_status',m.sync_status,'last_synced_at',m.last_synced_at) ORDER BY m.created_at DESC) FROM media m WHERE m.property_id=p.id),'[]'::jsonb) media,
  (SELECT jsonb_build_object(
    'attributed_request_count',count(*),
    'qualified_request_count',count(*) FILTER(WHERE r.qualified_at IS NOT NULL),
    'requests_with_booked_visit',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.viewings v WHERE v.request_id=r.id AND v.property_id=p.id AND v.company_id=r.company_id AND NOT coalesce(v.archived,false) AND coalesce(v.status,'') NOT IN ('cancelled','no_show'))),
    'requests_with_completed_visit',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.viewings v WHERE v.request_id=r.id AND v.property_id=p.id AND v.company_id=r.company_id AND NOT coalesce(v.archived,false) AND v.status IN ('done','completed') AND coalesce(v.attendance,'') NOT IN ('no_show','absent'))),
    'requests_with_closed_deal',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.deals d WHERE d.request_id=r.id AND d.property_id=p.id AND d.company_id=r.company_id AND d.stage IN ('closed','commission_collected'))))
   FROM cohorts c JOIN public.client_requests r ON r.id=c.request_id WHERE c.property_id=p.id) conversion_cohort
 FROM props p
)
SELECT jsonb_build_object('properties',coalesce(jsonb_agg(to_jsonb(rows)-'id'||jsonb_build_object('property_id',id) ORDER BY title),'[]'::jsonb),
 'reach_is_additive',false,'unresolved_total',(SELECT count(*) FROM public.unmatched_property_links WHERE company_id=public.my_company() AND status='pending'),
 'attribution_note','المشاهدات والتفاعل من المنشورات المرتبطة؛ مجموع الوصول ليس عدد أشخاص فريدين. لا تكشف Meta هوية كل مشاهد. الإسناد مؤكد فقط عند وجود رابط أو رمز في رسالة واردة أو تأكيد موظف. مراحل العمل تشمل تاريخ العقار، ولا تمثل التحويل من نفس مجموعة المشاهدين.') FROM rows;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_public_business_routes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb; v_company uuid:=public.my_company(); v_role text:=public.my_role();
BEGIN
 IF v_company IS NULL OR v_role NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('route_key',route_key,'label',label,'whatsapp_number',whatsapp_number) ORDER BY route_key),'[]'::jsonb) INTO result
 FROM public.company_lead_routes WHERE company_id=v_company AND is_active AND nullif(trim(whatsapp_number),'') IS NOT NULL
 AND (v_role IN ('owner','manager') OR NOT coalesce(owner_only_inbox,false));
 RETURN result;
END $function$
;

CREATE OR REPLACE FUNCTION public.resolve_unmatched_property_link(p_unmatched_id uuid, p_property_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u public.unmatched_property_links%rowtype; v_company uuid:=public.my_company(); v_role text:=public.my_role();
 v_marketing uuid; v_existing uuid; v_linkkey text;
BEGIN
 IF v_company IS NULL OR v_role NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT * INTO u FROM public.unmatched_property_links WHERE id=p_unmatched_id AND company_id=v_company AND status='pending' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'pending_link_not_found'; END IF;
 -- Authorize the exact conversation, including owner-only channels. A resolution affects only this occurrence.
 IF NOT crm_repair_private.can_access_whatsapp_conversation(v_company,u.conversation_id) THEN RAISE EXCEPTION 'not_assigned'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property_id AND company_id=v_company AND crm_repair_private.staff_can_access_branch(company_id,branch_key)) THEN RAISE EXCEPTION 'invalid_property'; END IF;
 v_linkkey:=public.normalize_property_marketing_link(u.raw_url);
 IF v_linkkey IS NOT NULL THEN
  SELECT id,property_id INTO v_marketing,v_existing FROM public.property_marketing_events WHERE company_id=v_company AND link_key=v_linkkey;
  IF v_existing IS NOT NULL AND v_existing<>p_property_id THEN RAISE EXCEPTION 'link_already_mapped_to_another_property'; END IF;
  IF v_marketing IS NULL THEN
   INSERT INTO public.property_marketing_events(company_id,property_id,channel,event_type,url,notes,created_by,auto_sync,sync_status)
   VALUES(v_company,p_property_id,coalesce(public.property_link_provider(u.raw_url),'other'),'publish',u.raw_url,'تم تأكيد الرابط بواسطة موظف',auth.uid(),false,'manual') RETURNING id INTO v_marketing;
  END IF;
 END IF;
 PERFORM public.record_property_link_inquiry_internal(v_company,u.client_id,p_property_id,v_marketing,u.whatsapp_message_id,u.raw_url,u.link_key,u.first_seen_at,true);
 PERFORM public.crm_finalize_property_message(u.whatsapp_message_id);
 UPDATE public.whatsapp_messages SET matched_property_id=p_property_id,matched_marketing_event_id=v_marketing,property_match_status='resolved_manual',property_link_key=u.link_key WHERE id=u.whatsapp_message_id AND company_id=v_company;
 UPDATE public.unmatched_property_links SET status='resolved',property_id=p_property_id,marketing_event_id=v_marketing,resolved_by=auth.uid(),resolved_at=now(),updated_at=now() WHERE id=u.id;
 RETURN jsonb_build_object('ok',true,'property_id',p_property_id,'marketing_event_id',v_marketing,'resolved_occurrences',1,'link_key',u.link_key);
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_guard_whatsapp_conversation_counters()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF new.last_message_seq=old.last_message_seq THEN
  new.last_message_at:=old.last_message_at;
  new.last_inbound_at:=old.last_inbound_at;
  new.last_outbound_at:=old.last_outbound_at;
  IF new.read_through_seq<=old.read_through_seq THEN new.unread_count:=old.unread_count; END IF;
 END IF;
 RETURN new;
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_save_deal_workflow(p_payload jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 SELECT crm_repair_private.save_deal_workflow(p_payload,p_idempotency_key)
$function$
;

CREATE OR REPLACE FUNCTION public.crm_sync_request_assignees()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  branches text[];
  b text;
  uid uuid;
  physical_route text;
begin
  delete from public.client_request_assignees where request_id=new.id;

  if new.status in ('active','paused') then
    IF new.manual_assigned_to IS NOT NULL THEN
      insert into public.client_request_assignees(request_id,company_id,user_id,branch_key)
      values(new.id,new.company_id,new.manual_assigned_to,coalesce(new.branch_key,'general'))
      on conflict do nothing;
      perform public.crm_refresh_client_primary_assignment(new.company_id,new.client_id);
      return new;
    END IF;
    branches := public.crm_infer_request_branches(new.route_key,new.branch_key,new.wilayat,new.preferred_area,new.preferred_areas,new.alternative_areas);
    if array_length(branches,1) is null then
      if new.subject_property_id is null then
        physical_route:=crm_repair_private.whatsapp_request_physical_branch(
          new.company_id,new.client_id,new.origin_whatsapp_message_id,new.inbound_number);
      end if;
      branches:=array[coalesce(physical_route,'muscat')]::text[];
    end if;

    foreach b in array branches loop
      select r.assigned_to into uid
      from public.company_lead_routes r
      where r.company_id=new.company_id and r.route_key=b and r.is_active=true
      limit 1;
      if uid is not null then
        insert into public.client_request_assignees(request_id,company_id,user_id,branch_key)
        values(new.id,new.company_id,uid,b)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  perform public.crm_refresh_client_primary_assignment(new.company_id,new.client_id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_request_branch_when_location_missing()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE physical_muscat boolean:=false;
BEGIN
  IF new.route_key IS DISTINCT FROM 'investment'
    AND 'location'=ANY(coalesce(new.missing_required_fields,'{}'::text[]))
    AND new.branch_key='muscat' THEN
    -- Keep this trigger invoker-only. The evidence lookup obeys the caller's RLS.
    -- The privileged ingestion path can see the same verified evidence as the private helper.
    IF new.manual_assigned_to IS NULL AND new.subject_property_id IS NULL THEN
      IF new.origin_whatsapp_message_id IS NOT NULL THEN
        SELECT EXISTS(
          SELECT 1 FROM public.whatsapp_messages m
          JOIN public.whatsapp_conversations w ON w.id=m.conversation_id
            AND w.company_id=m.company_id AND w.client_id=m.client_id
          WHERE m.id=new.origin_whatsapp_message_id AND m.company_id=new.company_id AND m.client_id=new.client_id
            AND m.direction='inbound' AND w.route_key='muscat'
            AND EXISTS(SELECT 1 FROM public.company_lead_routes lr WHERE lr.company_id=new.company_id
              AND lr.route_key=w.route_key AND lr.is_active IS TRUE)
        ) INTO physical_muscat;
      ELSIF nullif(btrim(new.inbound_number),'') IS NOT NULL THEN
        SELECT coalesce(min(lr.route_key)='muscat' AND count(DISTINCT lr.route_key)=1,false)
          INTO physical_muscat
        FROM public.company_lead_routes lr
        WHERE lr.company_id=new.company_id AND lr.is_active IS TRUE AND lr.route_key IN('muscat','barka','investment')
          AND public.normalize_crm_phone(lr.whatsapp_number)=public.normalize_crm_phone(new.inbound_number);
      END IF;
    END IF;
    IF NOT physical_muscat THEN new.branch_key:='general';END IF;
  END IF;
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.staff_can_access_branch(p_company uuid, p_branch text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(
   select 1 from public.profiles p
   where p.id=(select auth.uid()) and p.company_id=p_company and p.is_active
     and (p.role in ('owner','manager','viewer')
       or (p.role='agent' and exists(
         select 1 from public.company_lead_routes r
         where r.company_id=p_company and r.assigned_to=p.id
           and r.route_key=p_branch and r.owner_only_inbox is false)))
 );
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_property_branch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_role text:=public.my_role();
begin
 if new.branch_key is null then
  new.branch_key:=case when new.wilayat='بركاء' or new.area like 'بركاء%' then 'barka'
   when new.wilayat in ('مسقط','السيب') then 'muscat' else null end;
 end if;
 if v_role='agent' and (new.branch_key is null or
    not crm_repair_private.staff_can_access_branch(new.company_id,new.branch_key)
    or (tg_op='UPDATE' and new.branch_key is distinct from old.branch_key)) then
   raise exception using errcode='42501',message='property_branch_not_allowed';
 end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.apply_property_branch_employee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE employee uuid;
BEGIN
 SELECT o.employee_id INTO employee FROM crm_repair_private.branch_performance_owners o
 JOIN public.profiles e ON e.id=o.employee_id AND e.company_id=o.company_id AND e.role='agent' AND e.is_active
 WHERE o.company_id=NEW.company_id AND o.branch_key=NEW.branch_key;
 IF employee IS NOT NULL THEN NEW.sourced_by:=employee;END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_request(p_company_id uuid, p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.client_requests r ON r.company_id=p.company_id AND r.id=p_request_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND (p.role IN ('owner','manager','viewer') OR (p.role='agent' AND
        ((coalesce(r.branch_key,r.route_key,'general')='general' OR crm_repair_private.staff_can_access_branch(p_company_id,coalesce(r.branch_key,r.route_key))) AND (r.assigned_to=p.id OR EXISTS(SELECT 1 FROM public.client_request_assignees a
          WHERE a.company_id=p.company_id AND a.request_id=r.id AND a.user_id=p.id)))))
  )
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.stamp_first_client_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Serialize first-request decisions for this one client, including server ingestion.
  PERFORM 1 FROM public.clients c WHERE c.id=new.client_id AND c.company_id=new.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='request_client_company_mismatch'; END IF;
  new.is_first_request:=NOT EXISTS(SELECT 1 FROM public.client_requests r
    WHERE r.client_id=new.client_id AND r.company_id=new.company_id);
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_whatsapp_conversation(p_company_id uuid, p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(
 select 1 from public.profiles p join public.whatsapp_conversations c
   on c.company_id=p.company_id and c.id=p_conversation_id
 where p.id=(select auth.uid()) and p.is_active and p.company_id=p_company_id
 and (p.role='owner' or
   (p.role='manager' and exists(select 1 from public.company_lead_routes r
      where r.company_id=p_company_id and r.route_key=c.route_key and r.owner_only_inbox is false))
   or (p.role='agent' and exists(select 1 from public.company_lead_routes r
      where r.company_id=p_company_id and r.route_key=c.route_key
        and r.assigned_to=p.id and r.owner_only_inbox is false)))
 ) $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_client(p_company_id uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.clients c ON c.company_id=p.company_id AND c.id=p_client_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND (p.role IN ('owner','manager','viewer') OR (p.role='agent' AND
        ((coalesce(c.lead_route,'general')='general' OR crm_repair_private.staff_can_access_branch(p_company_id,c.lead_route)) AND (c.assigned_to=p.id OR EXISTS(SELECT 1 FROM public.client_requests r
          WHERE r.company_id=p.company_id AND r.client_id=c.id AND
            ((r.assigned_to=p.id AND r.status<>'archived') OR
              (r.status IN ('active','paused') AND EXISTS(
                SELECT 1 FROM public.client_request_assignees a
                WHERE a.company_id=p.company_id AND a.request_id=r.id AND a.user_id=p.id))))))))
  )
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_property_deal_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF new.status IS DISTINCT FROM old.status AND new.status<>'sold' AND
    EXISTS(SELECT 1 FROM public.deals d WHERE d.property_id=new.id AND d.company_id=new.company_id
      AND d.stage IN('closed','commission_collected')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='property_has_completed_deal';
  END IF;
  IF new.status='available' AND EXISTS(SELECT 1 FROM public.deals d
    WHERE d.property_id=new.id AND d.company_id=new.company_id
      AND d.stage IN('deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='property_has_active_reservation';
  END IF;
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.sync_property_after_deal_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    IF old.property_id IS NOT NULL THEN PERFORM crm_repair_private.sync_property_status_internal(old.property_id); END IF;
    RETURN old;
  END IF;
  IF new.property_id IS NOT NULL THEN PERFORM crm_repair_private.sync_property_status_internal(new.property_id); END IF;
  IF TG_OP='UPDATE' AND old.property_id IS DISTINCT FROM new.property_id AND old.property_id IS NOT NULL THEN
    PERFORM crm_repair_private.sync_property_status_internal(old.property_id);
  END IF;
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.performance_employee(p_company uuid, p_branch text, p_at timestamp with time zone, p_original uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT coalesce((
  SELECT o.employee_id FROM crm_repair_private.branch_performance_owners o
  JOIN public.profiles e ON e.id=o.employee_id AND e.company_id=o.company_id AND e.is_active AND e.role='agent'
  WHERE o.company_id=p_company AND o.branch_key=p_branch
   AND p_at>=o.effective_from::timestamp AT TIME ZONE 'Asia/Muscat'
 ),p_original)
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_request_manual_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (TG_OP='INSERT' AND new.manual_assigned_to IS NOT NULL) OR
     (TG_OP='UPDATE' AND new.manual_assigned_to IS DISTINCT FROM old.manual_assigned_to) THEN
    IF auth.uid() IS NOT NULL AND (public.my_company() IS DISTINCT FROM new.company_id
      OR public.my_role() NOT IN('owner','manager')) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='manual_assignment_requires_manager';
    END IF;
    IF auth.uid() IS NULL AND current_user NOT IN('postgres','service_role','supabase_admin') THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='manual_assignment_requires_manager';
    END IF;
  END IF;
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.property_image_draft_target_available(p_property_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.profiles p
   WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE
     AND p.company_id IS NOT NULL AND p.role IN('owner','manager','agent'))
   AND p_property_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id::text=p_property_id);
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.validate_viewing_refs_and_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='UPDATE' AND coalesce(old.archived,false)=false AND new.archived IS TRUE
    AND new.status NOT IN('done','cancelled','no_show') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_cancel_or_complete_before_archive';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=new.client_id AND c.company_id=new.company_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_client_company_mismatch';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id=new.property_id AND p.company_id=new.company_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_property_company_mismatch';
  END IF;
  IF new.agent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=new.agent_id AND p.company_id=new.company_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_agent_company_mismatch';
  END IF;
  IF new.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.client_requests r
    WHERE r.id=new.request_id AND r.company_id=new.company_id AND r.client_id=new.client_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_request_client_mismatch';
  END IF;
  IF new.appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.appointments a
    WHERE a.id=new.appointment_id AND a.company_id=new.company_id AND a.client_id=new.client_id
      AND (a.request_id IS NULL OR a.request_id IS NOT DISTINCT FROM new.request_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_appointment_mismatch';
  END IF;
  IF TG_OP='UPDATE' THEN new.row_version:=old.row_version+1; END IF;
  new.updated_at:=now();
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.sync_property_status_internal(p_property_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid; v_current text; v_status text;
BEGIN
  SELECT company_id,status INTO v_company,v_current FROM public.properties WHERE id=p_property_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.deals WHERE company_id=v_company AND property_id=p_property_id
    AND stage IN('closed','commission_collected')) THEN v_status:='sold';
  ELSIF EXISTS(SELECT 1 FROM public.deals WHERE company_id=v_company AND property_id=p_property_id
    AND stage IN('deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer')) THEN v_status:='reserved';
  ELSE
    -- Never release a manually blocked/sold/reserved listing merely because another deal is lost.
    -- A manual release remains an explicit property edit after checking all active deals.
    v_status:=v_current;
  END IF;
  IF v_status IS DISTINCT FROM v_current THEN
    UPDATE public.properties SET status=v_status,updated_at=now() WHERE id=p_property_id;
  END IF;
  RETURN v_status;
END;
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.sync_property_status_checked(p_property_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid:=public.my_company(); v_status text;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL OR public.my_role() NOT IN('owner','manager','agent')
    OR NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property_id AND company_id=v_company) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='property_not_allowed';
  END IF;
  v_status:=crm_repair_private.sync_property_status_internal(p_property_id);
  RETURN jsonb_build_object('ok',true,'property_id',p_property_id,'status',v_status);
END;
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_property_image(p_name text, p_owner_id text, p_operation text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT COALESCE(public.my_company() IS NOT NULL
   AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid())
     AND p.is_active IS TRUE AND p.company_id=public.my_company()
     AND p.role IN('owner','manager','agent','viewer'))
   AND p_operation IN('select','insert','delete')
   AND split_part(p_name,'/',1)=public.my_company()::text
   AND p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif)$'
   AND (p_operation='select' OR public.my_role() IN('owner','manager','agent'))
   -- Storage supplies owner_id from the JWT, never from user-defined metadata.
   AND (p_operation<>'insert' OR p_owner_id=(SELECT auth.uid())::text)
   AND (
     -- This SELECT is invoker-scoped: a hidden existing property is never a draft.
     -- Current properties UPDATE roles are owner/manager/agent within the same company.
     EXISTS(SELECT 1 FROM public.properties p WHERE p.id::text=split_part(p_name,'/',2)
       AND p.company_id=public.my_company()
       AND (p_operation<>'insert' OR p.archived IS NOT TRUE))
     OR (p_owner_id=(SELECT auth.uid())::text
       AND crm_repair_private.property_image_draft_target_available(split_part(p_name,'/',2)))
   ),false);
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.get_deal_workflow(p_deal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.deals%rowtype; v jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT crm_repair_private.can_access_deal_workflow(p_deal_id) THEN RAISE EXCEPTION 'deal_not_allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.deals WHERE id=p_deal_id;
 v:=jsonb_build_object('id',d.id,'company_id',d.company_id,'client_id',d.client_id,'property_id',d.property_id,
 'agent_id',d.agent_id,'stage',d.stage,'deal_value',d.deal_value,'notes',d.notes,'closed_at',d.closed_at,
 'created_at',d.created_at,'updated_at',d.updated_at,'request_id',d.request_id,'viewing_id',d.viewing_id,
 'lost_reason_id',d.lost_reason_id,'lost_reason_note',d.lost_reason_note,'lost_from_stage',d.lost_from_stage,
 'lost_at',d.lost_at,'entry_mode',d.entry_mode);
 IF public.my_role()='owner' THEN v:=v||jsonb_build_object('commission_total',d.commission_total,'broker_id',d.broker_id,
 'broker_commission',d.broker_commission,'company_share',d.company_share,'agent_share',d.agent_share,
 'commission_status',d.commission_status,'commission_received_at',d.commission_received_at,
 'employee_commission_percent',d.employee_commission_percent); END IF;
 RETURN jsonb_build_object('deal',v);
END $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_properties_financial_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF current_user IN ('authenticated','anon') AND COALESCE(public.my_role(),'') <> 'owner' THEN
  IF (TG_OP='INSERT' AND ((NEW."owner_net" IS NOT NULL) OR (NEW."expected_commission" IS NOT NULL))) OR (TG_OP='UPDATE' AND ((NEW."owner_net" IS DISTINCT FROM OLD."owner_net") OR (NEW."expected_commission" IS DISTINCT FROM OLD."expected_commission"))) THEN
   RAISE EXCEPTION 'المعلومات المالية متاحة لصاحب الشركة فقط' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_deals_financial_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF current_user IN ('authenticated','anon') AND COALESCE(public.my_role(),'') <> 'owner' THEN
  IF (TG_OP='INSERT' AND NEW.stage='commission_collected') OR (TG_OP='UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage AND (NEW.stage='commission_collected' OR OLD.stage='commission_collected')) THEN
   RAISE EXCEPTION 'تأكيد تحصيل العمولة أو تغييره متاح لصاحب الشركة فقط' USING ERRCODE='42501';
  END IF;
  IF (TG_OP='INSERT' AND ((NEW."company_commission" IS NOT NULL) OR (NEW."agent_commission" IS NOT NULL) OR (NEW."commission_total" IS NOT NULL) OR (NEW."company_share" IS NOT NULL) OR (NEW."agent_share" IS NOT NULL) OR (NEW."commission_status" IS NOT NULL AND NEW."commission_status" <> 'pending') OR (NEW."broker_commission" IS NOT NULL))) OR (TG_OP='UPDATE' AND ((NEW."company_commission" IS DISTINCT FROM OLD."company_commission") OR (NEW."agent_commission" IS DISTINCT FROM OLD."agent_commission") OR (NEW."commission_total" IS DISTINCT FROM OLD."commission_total") OR (NEW."company_share" IS DISTINCT FROM OLD."company_share") OR (NEW."agent_share" IS DISTINCT FROM OLD."agent_share") OR (NEW."commission_status" IS DISTINCT FROM OLD."commission_status") OR (NEW."broker_commission" IS DISTINCT FROM OLD."broker_commission"))) THEN
   RAISE EXCEPTION 'المعلومات المالية متاحة لصاحب الشركة فقط' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.link_viewing_interest()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_inquiry uuid; v_time timestamptz; v_branch text;
begin
 if new.archived is true or new.status='cancelled' then return new; end if;
 select p.branch_key into v_branch from public.properties p
  where p.id=new.property_id and p.company_id=new.company_id;
 if v_branch is null then return new; end if;
 if auth.uid() is not null and not crm_repair_private.staff_can_access_branch(new.company_id,v_branch) then
  raise exception using errcode='42501',message='viewing_property_branch_not_allowed';
 end if;
 v_time:=coalesce(new.created_at,now());
 select id into v_inquiry from public.property_inquiries
  where company_id=new.company_id and client_id=new.client_id and property_id=new.property_id
    and request_id IS NOT DISTINCT FROM new.request_id
  order by created_at limit 1 for update;
 if v_inquiry is null then
  insert into public.property_inquiries(company_id,client_id,property_id,request_id,assigned_to,
   source,source_detail,status,first_inquiry_at,last_inquiry_at,inquiry_count,created_by,
   has_inbound_inquiry,viewing_booked,viewing_completed,match_status)
  values(new.company_id,new.client_id,new.property_id,new.request_id,new.agent_id,
   'other','زيارة مسجلة في CRM','viewing_scheduled',v_time,v_time,1,
   coalesce(new.created_by,new.agent_id),false,true,new.status='done','matched')
  on conflict do nothing;
 else
  update public.property_inquiries set viewing_booked=true,
   viewing_completed=(viewing_completed or new.status='done'),
   status=case when status in ('inquiry','followup','viewing_scheduled') and new.status='done' then 'viewed'
    when status in ('inquiry','followup') then 'viewing_scheduled' else status end,
   updated_at=now()
  where id=v_inquiry;
 end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_deal_workflow(p_deal_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.deals d JOIN public.profiles u ON u.company_id=d.company_id
 WHERE d.id=p_deal_id AND u.id=auth.uid() AND u.is_active IS TRUE AND
 (u.role IN('owner','manager') OR (u.role='agent' AND d.agent_id=u.id
 AND (d.client_id IS NULL OR crm_repair_private.can_access_client(d.company_id,d.client_id))
 AND (d.request_id IS NULL OR crm_repair_private.can_access_request(d.company_id,d.request_id))
 AND (d.property_id IS NULL OR EXISTS(SELECT 1 FROM public.properties p WHERE p.id=d.property_id AND p.company_id=d.company_id
 AND crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))))))
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_deal_workflow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE completed boolean; was_completed boolean:=false; vd date; finance_changed boolean;
BEGIN
 IF TG_OP='INSERT' AND NEW.entry_mode='legacy' THEN NEW.entry_mode:='current'; END IF;
 IF TG_OP='UPDATE' AND NEW.entry_mode='legacy' AND OLD.entry_mode<>'legacy' THEN RAISE EXCEPTION 'cannot_downgrade_deal_to_legacy' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' THEN was_completed:=OLD.stage IN('closed','commission_collected'); END IF;
 completed:=NEW.stage IN('closed','commission_collected');
 IF TG_OP='UPDATE' AND NEW.entry_mode='legacy' AND completed AND NOT was_completed THEN NEW.entry_mode:='current'; END IF;
 IF NEW.entry_mode<>'legacy' AND completed THEN
  IF NEW.closed_at IS NULL THEN RAISE EXCEPTION 'sale_date_required' USING ERRCODE='22023'; END IF;

  IF NEW.entry_mode='current' AND NOT EXISTS(SELECT 1 FROM public.viewings v WHERE v.id=NEW.viewing_id
   AND v.company_id=NEW.company_id AND v.client_id=NEW.client_id AND v.property_id=NEW.property_id AND v.status='done' AND coalesce(v.archived,false)=false) THEN
   RAISE EXCEPTION 'completed_visit_required_for_current_deal' USING ERRCODE='22023';
  END IF;
  IF NEW.viewing_id IS NOT NULL THEN
   SELECT viewing_date INTO vd FROM public.viewings WHERE id=NEW.viewing_id AND company_id=NEW.company_id AND client_id=NEW.client_id AND property_id=NEW.property_id AND status='done';
   IF vd IS NULL OR vd>(NEW.closed_at AT TIME ZONE 'Asia/Muscat')::date THEN RAISE EXCEPTION 'visit_must_precede_sale' USING ERRCODE='22023'; END IF;
  END IF;
 END IF;
 IF NEW.closed_at IS NOT NULL AND (NEW.entry_mode<>'legacy' OR (TG_OP='UPDATE' AND NEW.closed_at IS DISTINCT FROM OLD.closed_at)) AND (NEW.closed_at AT TIME ZONE 'Asia/Muscat')::date>(now() AT TIME ZONE 'Asia/Muscat')::date THEN RAISE EXCEPTION 'sale_date_cannot_be_future' USING ERRCODE='22023'; END IF;
 IF NEW.entry_mode='current' AND (NEW.commission_status='received' OR NEW.stage='commission_collected') AND NEW.commission_received_at IS NULL THEN
  RAISE EXCEPTION 'commission_received_date_required' USING ERRCODE='22023';
 END IF;
 IF (NEW.entry_mode<>'legacy' OR (TG_OP='UPDATE' AND (NEW.commission_received_at IS DISTINCT FROM OLD.commission_received_at OR NEW.closed_at IS DISTINCT FROM OLD.closed_at))) AND NEW.commission_received_at IS NOT NULL AND (NEW.closed_at IS NULL OR
 (NEW.commission_received_at AT TIME ZONE 'Asia/Muscat')::date<(NEW.closed_at AT TIME ZONE 'Asia/Muscat')::date OR
 (NEW.commission_received_at AT TIME ZONE 'Asia/Muscat')::date>(now() AT TIME ZONE 'Asia/Muscat')::date) THEN
  RAISE EXCEPTION 'commission_date_must_follow_sale' USING ERRCODE='22023';
 END IF;
 IF auth.uid() IS NOT NULL AND coalesce(public.my_role(),'')<>'owner' THEN
  IF TG_OP='INSERT' THEN finance_changed:= NEW.stage='commission_collected' OR NEW.commission_total IS NOT NULL OR NEW.broker_commission IS NOT NULL OR NEW.agent_share IS NOT NULL OR NEW.company_share IS NOT NULL OR NEW.employee_commission_percent IS NOT NULL OR NEW.commission_received_at IS NOT NULL OR coalesce(NEW.commission_status,'pending')<>'pending';
  ELSE finance_changed:=NEW.stage IS DISTINCT FROM OLD.stage AND (NEW.stage='commission_collected' OR OLD.stage='commission_collected')
   OR NEW.commission_total IS DISTINCT FROM OLD.commission_total OR NEW.broker_commission IS DISTINCT FROM OLD.broker_commission
   OR NEW.agent_share IS DISTINCT FROM OLD.agent_share OR NEW.company_share IS DISTINCT FROM OLD.company_share
   OR NEW.employee_commission_percent IS DISTINCT FROM OLD.employee_commission_percent OR NEW.commission_received_at IS DISTINCT FROM OLD.commission_received_at
   OR NEW.commission_status IS DISTINCT FROM OLD.commission_status; END IF;
  IF finance_changed THEN RAISE EXCEPTION 'owner_only_financial_fields' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.save_deal_workflow(p_payload jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 u uuid:=auth.uid(); c uuid:=public.my_company(); role_name text:=public.my_role(); dp jsonb:=p_payload->'deal'; f jsonb;
 old_d public.deals%rowtype; d public.deals%rowtype; op crm_repair_private.deal_save_operations%rowtype;
 pid uuid; cid uuid; oid uuid; vid uuid; rid uuid; aid uuid; branch text; prop_owner uuid; ph text; phone_value text;
 request_kind text; req_count integer; visit_result jsonb; generated_id uuid; actual_visit date; sale_day date; result jsonb; is_new boolean;
BEGIN
 IF u IS NULL OR c IS NULL OR coalesce(role_name,'') NOT IN('owner','manager','agent') OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=u AND company_id=c AND is_active IS TRUE) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE='42501'; END IF;
 IF p_idempotency_key IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR jsonb_typeof(dp) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'deal_payload_and_operation_key_required' USING ERRCODE='22023'; END IF;
 ph:=md5(p_payload::text);
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text||':deal:'||p_idempotency_key::text,0));
 SELECT * INTO op FROM crm_repair_private.deal_save_operations WHERE user_id=u AND operation_key=p_idempotency_key;
 IF FOUND THEN
  IF op.payload_hash<>ph THEN RAISE EXCEPTION 'idempotency_key_reused_with_different_payload' USING ERRCODE='22023'; END IF;
  IF NOT crm_repair_private.can_access_deal_workflow(op.deal_id) THEN RAISE EXCEPTION 'deal_not_allowed' USING ERRCODE='42501'; END IF;
  RETURN op.result||jsonb_build_object('replayed',true);
 END IF;
 d.id:=nullif(dp->>'id','')::uuid; is_new:=d.id IS NULL;
 IF NOT is_new THEN
  IF NOT crm_repair_private.can_access_deal_workflow(d.id) THEN RAISE EXCEPTION 'deal_not_allowed' USING ERRCODE='42501'; END IF;
  SELECT * INTO old_d FROM public.deals WHERE id=d.id AND company_id=c FOR UPDATE;
  IF nullif(dp->>'expected_updated_at','')::timestamptz IS DISTINCT FROM old_d.updated_at THEN RAISE EXCEPTION 'deal_changed_reload_before_saving' USING ERRCODE='40001'; END IF;
  d:=old_d;
 END IF;
 d.id:=coalesce(d.id,gen_random_uuid()); d.company_id:=c;
 d.entry_mode:=coalesce(nullif(dp->>'entry_mode',''),d.entry_mode,'current');
 IF NOT is_new AND d.entry_mode='legacy' AND old_d.entry_mode<>'legacy' THEN RAISE EXCEPTION 'cannot_downgrade_deal_to_legacy' USING ERRCODE='22023'; END IF;
 IF d.entry_mode NOT IN('current','historical','legacy') OR (is_new AND d.entry_mode='legacy') THEN RAISE EXCEPTION 'invalid_deal_entry_mode' USING ERRCODE='22023'; END IF;
 d.stage:=coalesce(nullif(dp->>'stage',''),d.stage,'new');
 IF d.stage NOT IN('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed','visit','negotiation','deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer','closed','commission_collected','lost') THEN RAISE EXCEPTION 'invalid_deal_stage' USING ERRCODE='22023'; END IF;
 f:=dp->'financials';
 IF f IS NOT NULL AND f<>'null'::jsonb AND role_name<>'owner' THEN RAISE EXCEPTION 'owner_only_financial_fields' USING ERRCODE='42501'; END IF;
 IF role_name<>'owner' AND d.stage='commission_collected' AND (is_new OR old_d.stage IS DISTINCT FROM d.stage) THEN RAISE EXCEPTION 'owner_only_financial_fields' USING ERRCODE='42501'; END IF;
 pid:=nullif(p_payload#>>'{property,id}','')::uuid;
 IF pid IS NOT NULL THEN
  SELECT branch_key,owner_id INTO branch,prop_owner FROM public.properties WHERE id=pid AND company_id=c FOR UPDATE;
  IF NOT FOUND OR NOT crm_repair_private.staff_can_access_branch(c,branch) THEN RAISE EXCEPTION 'property_not_allowed' USING ERRCODE='42501'; END IF;
 ELSE
  branch:=nullif(p_payload#>>'{property,branch_key}','');
  IF NOT crm_repair_private.staff_can_access_branch(c,branch) THEN RAISE EXCEPTION 'property_branch_not_allowed' USING ERRCODE='42501'; END IF;
  IF nullif(btrim(p_payload#>>'{property,title}'),'') IS NULL OR nullif(btrim(p_payload#>>'{property,area}'),'') IS NULL OR nullif(p_payload#>>'{property,price}','') IS NULL THEN RAISE EXCEPTION 'property_title_area_price_required' USING ERRCODE='22023'; END IF;
 END IF;
 cid:=nullif(p_payload#>>'{client,id}','')::uuid;
 IF NOT is_new AND (cid IS DISTINCT FROM old_d.client_id OR pid IS DISTINCT FROM old_d.property_id) THEN RAISE EXCEPTION 'deal_identity_change_requires_new_record' USING ERRCODE='22023'; END IF;
 aid:=coalesce(nullif(dp->>'agent_id','')::uuid,d.agent_id,u);
 IF role_name='agent' AND aid<>u THEN RAISE EXCEPTION 'deal_agent_not_allowed' USING ERRCODE='42501'; END IF;
 IF (is_new OR aid IS DISTINCT FROM old_d.agent_id) AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=aid AND p.company_id=c AND p.is_active IS TRUE AND (p.role IN('owner','manager') OR (p.role='agent' AND EXISTS(SELECT 1 FROM public.company_lead_routes lr WHERE lr.company_id=c AND lr.assigned_to=aid AND lr.route_key=branch AND lr.owner_only_inbox IS FALSE)))) THEN RAISE EXCEPTION 'deal_agent_not_allowed' USING ERRCODE='42501'; END IF;
 IF cid IS NOT NULL THEN
  IF NOT crm_repair_private.can_access_client(c,cid) THEN RAISE EXCEPTION 'client_not_allowed' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.clients WHERE id=cid AND company_id=c FOR UPDATE;
 ELSE
  IF nullif(btrim(p_payload#>>'{client,name}'),'') IS NULL OR nullif(btrim(p_payload#>>'{client,phone}'),'') IS NULL THEN RAISE EXCEPTION 'client_name_phone_required' USING ERRCODE='22023'; END IF;
  phone_value:=regexp_replace(p_payload#>>'{client,phone}','[^0-9]','','g');
  PERFORM pg_advisory_xact_lock(hashtextextended(c::text||':clientphone:'||phone_value,0));
  IF EXISTS(SELECT 1 FROM public.clients WHERE company_id=c AND regexp_replace(coalesce(phone,''),'[^0-9]','','g')=phone_value) THEN RAISE EXCEPTION 'client_phone_exists_select_existing' USING ERRCODE='22023'; END IF;
  INSERT INTO public.clients(company_id,assigned_to,name,phone,client_type,is_buyer,lead_route,source)
  VALUES(c,aid,btrim(p_payload#>>'{client,name}'),btrim(p_payload#>>'{client,phone}'),'buyer',true,branch,'manual') RETURNING id INTO cid;
 END IF;
 oid:=nullif(p_payload#>>'{owner,id}','')::uuid;
 IF oid IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.owners o WHERE o.id=oid AND o.company_id=c AND (role_name IN('owner','manager') OR o.added_by=u OR EXISTS(SELECT 1 FROM public.properties p WHERE p.company_id=c AND p.owner_id=o.id AND crm_repair_private.staff_can_access_branch(c,p.branch_key)))) THEN RAISE EXCEPTION 'owner_not_allowed' USING ERRCODE='42501'; END IF;
 ELSIF nullif(btrim(p_payload#>>'{owner,name}'),'') IS NOT NULL THEN
  IF nullif(btrim(p_payload#>>'{owner,phone}'),'') IS NULL THEN RAISE EXCEPTION 'owner_phone_required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.owners(company_id,added_by,name,phone) VALUES(c,u,btrim(p_payload#>>'{owner,name}'),btrim(p_payload#>>'{owner,phone}')) RETURNING id INTO oid;
 END IF;
 IF pid IS NULL THEN
  INSERT INTO public.properties(company_id,added_by,title,type,area,price,branch_key,owner_id)
  VALUES(c,u,btrim(p_payload#>>'{property,title}'),coalesce(nullif(p_payload#>>'{property,type}',''),'villa'),btrim(p_payload#>>'{property,area}'),(p_payload#>>'{property,price}')::numeric,branch,oid) RETURNING id INTO pid;
 ELSIF oid IS NOT NULL THEN
  IF prop_owner IS NOT NULL AND prop_owner<>oid THEN RAISE EXCEPTION 'property_owner_already_linked' USING ERRCODE='22023'; END IF;
  UPDATE public.properties SET owner_id=oid WHERE id=pid AND owner_id IS NULL;
 END IF;
 d.client_id:=cid; d.property_id:=pid; d.agent_id:=aid;
 IF dp ? 'deal_value' THEN d.deal_value:=nullif(dp->>'deal_value','')::numeric; END IF;
 IF dp ? 'notes' THEN d.notes:=nullif(btrim(dp->>'notes'),''); END IF;
 IF dp ? 'closed_on' THEN
  sale_day:=nullif(dp->>'closed_on','')::date;
  IF sale_day IS DISTINCT FROM (old_d.closed_at AT TIME ZONE 'Asia/Muscat')::date THEN d.closed_at:=(sale_day+time '12:00') AT TIME ZONE 'Asia/Muscat'; END IF;
 END IF;
 -- Business dates are never stored in created_at. Original authorship/date survive edits.
 d.created_at:=coalesce(d.created_at,now()); d.updated_at:=clock_timestamp();
 actual_visit:=nullif(dp->>'visit_date','')::date;
 vid:=CASE WHEN actual_visit IS NOT NULL AND nullif(dp->>'viewing_id','') IS NULL THEN NULL ELSE coalesce(nullif(dp->>'viewing_id','')::uuid,d.viewing_id) END;
 IF vid IS NOT NULL THEN
  SELECT request_id INTO rid FROM public.viewings v WHERE v.id=vid AND v.company_id=c AND v.client_id=cid AND v.property_id=pid AND (v.status='done' OR (vid=old_d.viewing_id AND (d.stage NOT IN('closed','commission_collected') OR (d.entry_mode='legacy' AND old_d.stage IN('closed','commission_collected')))))
   AND (role_name IN('owner','manager') OR v.agent_id=u) AND (v.request_id IS NULL OR crm_repair_private.can_access_request(c,v.request_id));
  IF NOT FOUND THEN RAISE EXCEPTION 'completed_viewing_not_allowed' USING ERRCODE='42501'; END IF;
 ELSIF actual_visit IS NOT NULL THEN
  IF actual_visit>(now() AT TIME ZONE 'Asia/Muscat')::date THEN RAISE EXCEPTION 'completed_visit_cannot_be_future' USING ERRCODE='22023'; END IF;
  IF NOT is_new THEN
   INSERT INTO crm_repair_private.deal_workflow_context(transaction_id,user_id,company_id,client_id,property_id,deal_id)
   VALUES(txid_current(),u,c,cid,pid,d.id);
  END IF;
  visit_result:=public.crm_save_viewing_atomic(jsonb_build_object('client_id',cid,'property_id',pid,'agent_id',aid,
   'viewing_date',actual_visit,'viewing_time',NULL,'status','done','time_unknown',true,'pipeline_outcome',NULL),p_idempotency_key);
  DELETE FROM crm_repair_private.deal_workflow_context WHERE transaction_id=txid_current() AND user_id=u;
  vid:=(visit_result->>'viewing_id')::uuid; rid:=(visit_result#>>'{viewing,request_id}')::uuid;
 END IF;
 -- A visit already has a pipeline card. Reuse it rather than creating a second sale journey.
 IF is_new AND vid IS NOT NULL THEN
  SELECT id INTO generated_id FROM public.deals WHERE company_id=c AND viewing_id=vid ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF generated_id IS NOT NULL THEN
   IF NOT crm_repair_private.can_access_deal_workflow(generated_id) THEN RAISE EXCEPTION 'deal_not_allowed' USING ERRCODE='42501'; END IF;
   SELECT * INTO old_d FROM public.deals WHERE id=generated_id FOR UPDATE;
   IF old_d.stage IN('closed','commission_collected') THEN RAISE EXCEPTION 'visit_deal_already_completed_open_existing' USING ERRCODE='22023'; END IF;
   d.id:=generated_id; d.created_at:=old_d.created_at; is_new:=false;
   d.agent_id:=coalesce(nullif(dp->>'agent_id','')::uuid,old_d.agent_id,aid); aid:=d.agent_id;
   d.notes:=CASE WHEN nullif(btrim(d.notes),'') IS NULL THEN old_d.notes WHEN old_d.notes IS NULL THEN d.notes ELSE old_d.notes||E'\n'||d.notes END;
   d.deal_value:=coalesce(d.deal_value,old_d.deal_value);
   d.commission_total:=old_d.commission_total; d.broker_id:=old_d.broker_id; d.broker_commission:=old_d.broker_commission;
   d.company_share:=old_d.company_share; d.agent_share:=old_d.agent_share; d.commission_status:=old_d.commission_status;
   d.commission_received_at:=old_d.commission_received_at; d.employee_commission_percent:=old_d.employee_commission_percent;
   -- Blank fields on a new-entry screen are not an instruction to erase an existing card's finance.
   f:=jsonb_strip_nulls(f);
  END IF;
 END IF;
 d.viewing_id:=vid; d.request_id:=CASE WHEN vid IS DISTINCT FROM old_d.viewing_id AND rid IS NOT NULL THEN rid ELSE coalesce(d.request_id,rid) END;
 IF d.stage='lost' THEN
  d.lost_reason_id:=coalesce(nullif(dp->>'lost_reason_id','')::uuid,d.lost_reason_id);
  IF (is_new OR old_d.stage IS DISTINCT FROM 'lost') AND d.lost_reason_id IS NULL THEN RAISE EXCEPTION 'main_loss_reason_required' USING ERRCODE='22023'; END IF;
  IF d.lost_reason_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.rejection_reasons WHERE id=d.lost_reason_id AND (company_id IS NULL OR company_id=c) AND (is_active IS TRUE OR id=old_d.lost_reason_id)) THEN RAISE EXCEPTION 'loss_reason_not_allowed' USING ERRCODE='22023'; END IF;
  IF dp ? 'lost_reason_note' THEN d.lost_reason_note:=nullif(btrim(dp->>'lost_reason_note'),''); END IF;
  d.lost_from_stage:=coalesce(d.lost_from_stage,old_d.stage,'new'); d.lost_at:=coalesce(d.lost_at,now());
 ELSE
  d.lost_reason_id:=NULL;d.lost_reason_note:=NULL;d.lost_from_stage:=NULL;d.lost_at:=NULL;
 END IF;
 IF f IS NOT NULL AND f<>'null'::jsonb THEN
  IF d.stage='lost' THEN RAISE EXCEPTION 'loss_finance_edit_not_allowed' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(f)<>'object' THEN RAISE EXCEPTION 'invalid_financial_payload' USING ERRCODE='22023'; END IF;
  IF f ? 'commission_total' THEN d.commission_total:=nullif(f->>'commission_total','')::numeric; END IF;
  IF f ? 'broker_commission' THEN d.broker_commission:=nullif(f->>'broker_commission','')::numeric; END IF;
  IF f ? 'employee_commission_percent' THEN d.employee_commission_percent:=nullif(f->>'employee_commission_percent','')::numeric; END IF;
  IF f ? 'broker_id' THEN d.broker_id:=nullif(f->>'broker_id','')::uuid; END IF;
  IF d.broker_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.owners WHERE id=d.broker_id AND company_id=c) THEN RAISE EXCEPTION 'broker_not_allowed' USING ERRCODE='42501'; END IF;
  IF d.employee_commission_percent IS NOT NULL THEN
   d.agent_share:=round((coalesce(d.commission_total,0)-coalesce(d.broker_commission,0))*d.employee_commission_percent/100,2);
  ELSIF f ? 'agent_share' THEN d.agent_share:=nullif(f->>'agent_share','')::numeric; END IF;
  IF f ? 'commission_total' OR f ? 'broker_commission' OR f ? 'employee_commission_percent' OR f ? 'agent_share' THEN
   d.company_share:=CASE WHEN d.commission_total IS NULL THEN NULL ELSE d.commission_total-coalesce(d.broker_commission,0)-coalesce(d.agent_share,0) END;
  END IF;
  IF coalesce(d.commission_total,0)<0 OR coalesce(d.broker_commission,0)<0 OR coalesce(d.agent_share,0)<0 OR coalesce(d.company_share,0)<0 OR coalesce(d.broker_commission,0)+coalesce(d.agent_share,0)>coalesce(d.commission_total,0) THEN RAISE EXCEPTION 'invalid_commission_amounts' USING ERRCODE='22023'; END IF;
  IF f ? 'commission_status' THEN d.commission_status:=f->>'commission_status'; END IF;
  IF f ? 'commission_received_on' THEN
   IF nullif(f->>'commission_received_on','')::date IS DISTINCT FROM (old_d.commission_received_at AT TIME ZONE 'Asia/Muscat')::date THEN d.commission_received_at:=(nullif(f->>'commission_received_on','')::date+time '12:00') AT TIME ZONE 'Asia/Muscat'; END IF;
  END IF;
 END IF;
 d.commission_status:=coalesce(d.commission_status,'pending');
 IF d.stage='commission_collected' THEN d.commission_status:='received'; END IF;
 IF d.commission_status NOT IN('pending','received') THEN RAISE EXCEPTION 'invalid_commission_status' USING ERRCODE='22023'; END IF;
 IF is_new THEN
  INSERT INTO public.deals(id,company_id,client_id,property_id,agent_id,stage,deal_value,notes,closed_at,created_at,updated_at,request_id,viewing_id,lost_reason_id,lost_reason_note,lost_from_stage,lost_at,entry_mode,commission_total,broker_id,broker_commission,company_share,agent_share,commission_status,commission_received_at,employee_commission_percent)
  VALUES(d.id,c,cid,pid,aid,d.stage,d.deal_value,d.notes,d.closed_at,d.created_at,d.updated_at,d.request_id,d.viewing_id,d.lost_reason_id,d.lost_reason_note,d.lost_from_stage,d.lost_at,d.entry_mode,d.commission_total,d.broker_id,d.broker_commission,d.company_share,d.agent_share,d.commission_status,d.commission_received_at,d.employee_commission_percent);
 ELSE
  UPDATE public.deals SET stage=d.stage,agent_id=d.agent_id,deal_value=d.deal_value,notes=d.notes,closed_at=d.closed_at,updated_at=d.updated_at,request_id=d.request_id,viewing_id=d.viewing_id,lost_reason_id=d.lost_reason_id,lost_reason_note=d.lost_reason_note,lost_from_stage=d.lost_from_stage,lost_at=d.lost_at,entry_mode=d.entry_mode,commission_total=d.commission_total,broker_id=d.broker_id,broker_commission=d.broker_commission,company_share=d.company_share,agent_share=d.agent_share,commission_status=d.commission_status,commission_received_at=d.commission_received_at,employee_commission_percent=d.employee_commission_percent WHERE id=d.id;
 END IF;
 SELECT updated_at INTO d.updated_at FROM public.deals WHERE id=d.id;
 result:=jsonb_build_object('ok',true,'deal_id',d.id,'client_id',cid,'property_id',pid,'viewing_id',vid,'updated_at',d.updated_at,'replayed',false);
 INSERT INTO crm_repair_private.deal_save_operations(user_id,operation_key,company_id,payload_hash,deal_id,result) VALUES(u,p_idempotency_key,c,ph,d.id,result);
 RETURN result;
END $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.audit_rejection_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE before_value jsonb; after_value jsonb;
BEGIN
 IF TG_TABLE_NAME='deals' THEN
  IF TG_OP='UPDATE' THEN before_value:=jsonb_build_object('reason_id',OLD.lost_reason_id,'note',OLD.lost_reason_note); END IF;
  after_value:=jsonb_build_object('reason_id',NEW.lost_reason_id,'note',NEW.lost_reason_note);
 ELSE
  IF TG_OP='UPDATE' THEN before_value:=jsonb_build_object('reason_id',OLD.reason_id,'note',OLD.note,'is_primary',OLD.is_primary); END IF;
  after_value:=jsonb_build_object('reason_id',NEW.reason_id,'note',NEW.note,'is_primary',NEW.is_primary);
 END IF;
 IF before_value IS DISTINCT FROM after_value AND NEW.client_id IS NOT NULL AND NEW.property_id IS NOT NULL THEN
  INSERT INTO crm_repair_private.rejection_change_audit(company_id,source_table,source_id,client_id,property_id,request_id,before_data,after_data,changed_by)
  VALUES(NEW.company_id,TG_TABLE_NAME,NEW.id,NEW.client_id,NEW.property_id,NEW.request_id,before_value,after_value,auth.uid());
 END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.set_primary_rejection(p_company uuid, p_client uuid, p_property uuid, p_request uuid, p_inquiry uuid, p_reason uuid, p_note text, p_phase text, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE existing_id uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=p_client AND company_id=p_company)
 OR NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property AND company_id=p_company)
 OR (p_request IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.client_requests WHERE id=p_request AND company_id=p_company AND client_id=p_client))
 OR NOT EXISTS(SELECT 1 FROM public.rejection_reasons WHERE id=p_reason AND (company_id=p_company OR company_id IS NULL))
 OR (p_inquiry IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.property_inquiries WHERE id=p_inquiry AND company_id=p_company AND client_id=p_client AND property_id=p_property AND request_id IS NOT DISTINCT FROM p_request))
 THEN RAISE EXCEPTION 'rejection_references_not_allowed' USING ERRCODE='42501'; END IF;
 IF auth.uid() IS NOT NULL AND (public.my_company() IS DISTINCT FROM p_company OR coalesce(public.my_role(),'') NOT IN('owner','manager','agent')
 OR NOT crm_repair_private.can_access_client(p_company,p_client)
 OR (p_request IS NOT NULL AND NOT crm_repair_private.can_access_request(p_company,p_request))
 OR NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id=p_property AND p.company_id=p_company AND crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key)))
 THEN RAISE EXCEPTION 'rejection_journey_not_allowed' USING ERRCODE='42501'; END IF;
 IF p_phase NOT IN('pre_visit','post_visit','unknown') THEN RAISE EXCEPTION 'invalid_rejection_phase' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_company::text||':rejection:'||p_client::text||':'||p_property::text||':'||coalesce(p_request::text,'legacy'),0));
 SELECT id INTO existing_id FROM public.property_rejection_reasons
 WHERE company_id=p_company AND client_id=p_client AND property_id=p_property AND request_id IS NOT DISTINCT FROM p_request AND reason_id=p_reason
 ORDER BY is_primary DESC,created_at DESC,id LIMIT 1 FOR UPDATE;
 UPDATE public.property_rejection_reasons SET is_primary=false
 WHERE company_id=p_company AND client_id=p_client AND property_id=p_property AND request_id IS NOT DISTINCT FROM p_request
 AND is_primary AND id IS DISTINCT FROM existing_id;
 IF existing_id IS NOT NULL THEN
  UPDATE public.property_rejection_reasons SET is_primary=true,phase=p_phase,note=nullif(btrim(p_note),'') WHERE id=existing_id;
 ELSE
  INSERT INTO public.property_rejection_reasons(company_id,property_inquiry_id,client_id,request_id,property_id,reason_id,is_primary,phase,note,created_by)
  VALUES(p_company,p_inquiry,p_client,p_request,p_property,p_reason,true,p_phase,nullif(btrim(p_note),''),p_actor);
 END IF;
END $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.sync_deal_primary_rejection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE inquiry_id uuid; reason_code text; had_visit boolean;
BEGIN
 IF NEW.stage<>'lost' OR NEW.lost_reason_id IS NULL OR NEW.client_id IS NULL OR NEW.property_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.stage IS NOT DISTINCT FROM OLD.stage AND NEW.lost_reason_id IS NOT DISTINCT FROM OLD.lost_reason_id
 AND NEW.lost_reason_note IS NOT DISTINCT FROM OLD.lost_reason_note AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id THEN RETURN NEW; END IF;
 SELECT code INTO reason_code FROM public.rejection_reasons WHERE id=NEW.lost_reason_id AND (company_id=NEW.company_id OR company_id IS NULL)
 AND (is_active IS TRUE OR (TG_OP='UPDATE' AND OLD.stage='lost' AND OLD.lost_reason_id=NEW.lost_reason_id));
 IF reason_code IS NULL THEN RAISE EXCEPTION 'rejection_reason_not_allowed' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text||':rejection:'||NEW.client_id::text||':'||NEW.property_id::text||':'||coalesce(NEW.request_id::text,'legacy'),0));
 SELECT id INTO inquiry_id FROM public.property_inquiries WHERE company_id=NEW.company_id AND client_id=NEW.client_id
 AND property_id=NEW.property_id AND request_id IS NOT DISTINCT FROM NEW.request_id FOR UPDATE;
 had_visit:=EXISTS(SELECT 1 FROM public.viewings v WHERE v.id=NEW.viewing_id AND v.company_id=NEW.company_id
 AND v.client_id=NEW.client_id AND v.property_id=NEW.property_id AND v.request_id IS NOT DISTINCT FROM NEW.request_id AND v.status='done' AND coalesce(v.archived,false)=false);
 IF inquiry_id IS NULL THEN
  INSERT INTO public.property_inquiries(company_id,client_id,property_id,request_id,assigned_to,source,source_detail,status,
   created_by,has_inbound_inquiry,viewing_booked,viewing_completed,outcome,rejection_reason,rejection_notes)
  VALUES(NEW.company_id,NEW.client_id,NEW.property_id,NEW.request_id,NEW.agent_id,'other','اهتمام مرتبط بصفقة CRM','not_suitable',
   auth.uid(),false,had_visit,had_visit,'rejected',reason_code,nullif(btrim(NEW.lost_reason_note),'')) RETURNING id INTO inquiry_id;
 ELSE
  UPDATE public.property_inquiries SET status='not_suitable',outcome='rejected',rejection_reason=reason_code,
   rejection_notes=nullif(btrim(NEW.lost_reason_note),''),updated_at=now() WHERE id=inquiry_id;
 END IF;
 PERFORM crm_repair_private.set_primary_rejection(NEW.company_id,NEW.client_id,NEW.property_id,NEW.request_id,inquiry_id,
  NEW.lost_reason_id,NEW.lost_reason_note,CASE WHEN had_visit THEN 'post_visit' ELSE 'unknown' END,auth.uid());
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.replace_primary_rejection(p_inquiry_id uuid, p_reason_ids uuid[], p_primary_id uuid, p_phase text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE q public.property_inquiries%rowtype; ids uuid[]; chosen uuid;
BEGIN
 IF auth.uid() IS NULL OR public.my_company() IS NULL OR coalesce(public.my_role(),'') NOT IN('owner','manager','agent') THEN
  RAISE EXCEPTION 'not_allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO q FROM public.property_inquiries WHERE id=p_inquiry_id AND company_id=public.my_company() FOR UPDATE;
 IF NOT FOUND OR NOT crm_repair_private.can_access_client(q.company_id,q.client_id)
 OR (q.request_id IS NOT NULL AND NOT crm_repair_private.can_access_request(q.company_id,q.request_id))
 OR NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id=q.property_id AND p.company_id=q.company_id AND crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))
 OR (public.my_role()='agent' AND q.assigned_to IS DISTINCT FROM auth.uid()) THEN
  RAISE EXCEPTION 'inquiry_not_found_or_not_allowed' USING ERRCODE='42501'; END IF;
 SELECT coalesce(array_agg(DISTINCT x),'{}'::uuid[]) INTO ids FROM unnest(coalesce(p_reason_ids,'{}'::uuid[])) x WHERE x IS NOT NULL;
 IF cardinality(ids)>1 THEN RAISE EXCEPTION 'choose_one_primary_reason' USING ERRCODE='22023'; END IF;
 chosen:=coalesce(p_primary_id,ids[1]);
 IF chosen IS NOT NULL AND NOT chosen=ANY(ids) THEN RAISE EXCEPTION 'primary_reason_must_be_selected' USING ERRCODE='22023'; END IF;
 IF chosen IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.rejection_reasons WHERE id=chosen AND (company_id=q.company_id OR company_id IS NULL) AND is_active IS TRUE) THEN
   RAISE EXCEPTION 'rejection_reason_not_allowed' USING ERRCODE='42501'; END IF;
  PERFORM crm_repair_private.set_primary_rejection(q.company_id,q.client_id,q.property_id,q.request_id,q.id,chosen,p_note,coalesce(p_phase,'unknown'),auth.uid());
 ELSE
  PERFORM pg_advisory_xact_lock(hashtextextended(q.company_id::text||':rejection:'||q.client_id::text||':'||q.property_id::text||':'||coalesce(q.request_id::text,'legacy'),0));
  UPDATE public.property_rejection_reasons SET is_primary=false WHERE company_id=q.company_id AND client_id=q.client_id
   AND property_id=q.property_id AND request_id IS NOT DISTINCT FROM q.request_id AND is_primary;
 END IF;
 UPDATE public.property_inquiries SET rejection_reason=(SELECT code FROM public.rejection_reasons WHERE id=chosen),
 rejection_notes=CASE WHEN chosen IS NOT NULL THEN nullif(btrim(p_note),'') END,updated_at=now() WHERE id=q.id;
 RETURN jsonb_build_object('ok',true,'count',cardinality(ids),'inquiry_id',p_inquiry_id);
END $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.whatsapp_request_physical_branch(p_company_id uuid, p_client_id uuid, p_origin_message_id uuid, p_inbound_number text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE v_route text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=p_client_id AND c.company_id=p_company_id) THEN RETURN NULL;END IF;
  IF p_origin_message_id IS NOT NULL THEN
    SELECT w.route_key INTO v_route
    FROM public.whatsapp_messages m
    JOIN public.whatsapp_conversations w ON w.id=m.conversation_id
      AND w.company_id=m.company_id AND w.client_id=m.client_id
    WHERE m.id=p_origin_message_id AND m.company_id=p_company_id AND m.client_id=p_client_id
      AND m.direction='inbound' AND w.route_key IN('muscat','barka','investment')
      AND EXISTS(SELECT 1 FROM public.company_lead_routes lr WHERE lr.company_id=p_company_id
        AND lr.route_key=w.route_key AND lr.is_active IS TRUE);
    RETURN v_route;
  END IF;
  IF nullif(btrim(p_inbound_number),'') IS NULL THEN RETURN NULL;END IF;
  SELECT min(lr.route_key) INTO v_route FROM public.company_lead_routes lr
  WHERE lr.company_id=p_company_id AND lr.is_active IS TRUE AND lr.route_key IN('muscat','barka','investment')
    AND public.normalize_crm_phone(lr.whatsapp_number)=public.normalize_crm_phone(p_inbound_number)
  HAVING count(DISTINCT lr.route_key)=1;
  RETURN v_route;
END $function$
;

ALTER TABLE public."events" ADD CONSTRAINT "events_pkey" PRIMARY KEY (id);

ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);

ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text, 'viewer'::text])));

ALTER TABLE public."companies" ADD CONSTRAINT "companies_pkey" PRIMARY KEY (id);

ALTER TABLE public."deals" ADD CONSTRAINT "deals_employee_commission_percent_check" CHECK (((employee_commission_percent >= (0)::numeric) AND (employee_commission_percent <= (100)::numeric)));

ALTER TABLE public."deals" ADD CONSTRAINT "deals_entry_mode_check" CHECK ((entry_mode = ANY (ARRAY['legacy'::text, 'current'::text, 'historical'::text])));

ALTER TABLE public."deals" ADD CONSTRAINT "deals_pkey" PRIMARY KEY (id);

ALTER TABLE public."deals" ADD CONSTRAINT "deals_stage_check" CHECK ((stage = ANY (ARRAY['new'::text, 'viewing_scheduled'::text, 'viewing_no_show'::text, 'viewing_cancelled'::text, 'viewing_postponed'::text, 'visit'::text, 'negotiation'::text, 'deposit'::text, 'awaiting_finance'::text, 'finance_approved'::text, 'awaiting_clearance'::text, 'ownership_transfer'::text, 'closed'::text, 'commission_collected'::text, 'lost'::text])));

ALTER TABLE public."notifications" ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (id);

ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_pkey" PRIMARY KEY (id);

ALTER TABLE public."owners" ADD CONSTRAINT "owners_pkey" PRIMARY KEY (id);

ALTER TABLE public."company_lead_routes" ADD CONSTRAINT "company_lead_routes_company_id_route_key_key" UNIQUE (company_id, route_key);

ALTER TABLE public."company_lead_routes" ADD CONSTRAINT "company_lead_routes_key_check" CHECK ((route_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text, 'general'::text])));

ALTER TABLE public."company_lead_routes" ADD CONSTRAINT "company_lead_routes_pkey" PRIMARY KEY (id);

ALTER TABLE public."deposits" ADD CONSTRAINT "deposits_pkey" PRIMARY KEY (id);

ALTER TABLE public."viewings" ADD CONSTRAINT "crm_viewings_duration_valid" CHECK (((duration_minutes IS NULL) OR ((duration_minutes >= 1) AND (duration_minutes <= 1440))));

ALTER TABLE public."viewings" ADD CONSTRAINT "crm_viewings_required_refs" CHECK (((company_id IS NOT NULL) AND (client_id IS NOT NULL) AND (property_id IS NOT NULL)));

ALTER TABLE public."viewings" ADD CONSTRAINT "crm_viewings_status_valid" CHECK (((status IS NOT NULL) AND (status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'done'::text, 'cancelled'::text, 'no_show'::text, 'postponed'::text]))));

ALTER TABLE public."viewings" ADD CONSTRAINT "viewings_auto_confidence_chk" CHECK (((auto_confidence IS NULL) OR ((auto_confidence >= (0)::numeric) AND (auto_confidence <= (1)::numeric))));

ALTER TABLE public."viewings" ADD CONSTRAINT "viewings_created_via_chk" CHECK ((created_via = ANY (ARRAY['manual'::text, 'whatsapp_ai'::text, 'system'::text])));

ALTER TABLE public."viewings" ADD CONSTRAINT "viewings_pipeline_outcome_check" CHECK (((pipeline_outcome IS NULL) OR (pipeline_outcome = ANY (ARRAY['followup'::text, 'negotiation'::text, 'lost'::text]))));

ALTER TABLE public."viewings" ADD CONSTRAINT "viewings_pkey" PRIMARY KEY (id);

ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_pkey" PRIMARY KEY (id);

ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_priority_check" CHECK ((priority = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])));

ALTER TABLE public."clients" ADD CONSTRAINT "clients_client_type_check" CHECK ((client_type = ANY (ARRAY['buyer'::text, 'seller'::text, 'investor'::text, 'tenant'::text, 'landlord'::text, 'consultation'::text])));

ALTER TABLE public."clients" ADD CONSTRAINT "clients_pkey" PRIMARY KEY (id);

ALTER TABLE public."clients" ADD CONSTRAINT "clients_status_check" CHECK ((status = ANY (ARRAY['hot'::text, 'warm'::text, 'cold'::text, 'inactive'::text])));

ALTER TABLE public."clients" ADD CONSTRAINT "crm_clients_budget_valid" CHECK ((((budget_min IS NULL) OR (budget_min >= (0)::numeric)) AND ((budget_max IS NULL) OR (budget_max >= (0)::numeric)) AND ((budget_min IS NULL) OR (budget_max IS NULL) OR (budget_min <= budget_max))));

ALTER TABLE public."company_invites" ADD CONSTRAINT "company_invites_pkey" PRIMARY KEY (id);

ALTER TABLE public."company_invites" ADD CONSTRAINT "company_invites_role_check" CHECK ((role = ANY (ARRAY['manager'::text, 'agent'::text, 'viewer'::text])));

ALTER TABLE public."company_invites" ADD CONSTRAINT "company_invites_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'used'::text, 'revoked'::text])));

ALTER TABLE public."company_invites" ADD CONSTRAINT "company_invites_token_key" UNIQUE (token);

ALTER TABLE public."property_marketing_events" ADD CONSTRAINT "property_marketing_events_channel_check" CHECK ((channel = ANY (ARRAY['instagram'::text, 'oman_reel'::text, 'youtube'::text, 'signboard'::text, 'referral'::text, 'other'::text])));

ALTER TABLE public."property_marketing_events" ADD CONSTRAINT "property_marketing_events_event_type_check" CHECK ((event_type = ANY (ARRAY['publish'::text, 'update'::text, 'install'::text, 'remove'::text, 'other'::text])));

ALTER TABLE public."property_marketing_events" ADD CONSTRAINT "property_marketing_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."property_marketing_events" ADD CONSTRAINT "property_marketing_events_views_check" CHECK (((views IS NULL) OR (views >= 0)));

ALTER TABLE public."property_marketing_events" ADD CONSTRAINT "property_marketing_sync_status_check" CHECK ((sync_status = ANY (ARRAY['manual'::text, 'pending'::text, 'synced'::text, 'error'::text, 'disabled'::text])));

ALTER TABLE public."whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_company_id_meta_phone_number_id_cust_key" UNIQUE (company_id, meta_phone_number_id, customer_wa_id);

ALTER TABLE public."whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY (id);

ALTER TABLE public."whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_route_check" CHECK ((route_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text, 'general'::text])));

ALTER TABLE public."whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'waiting'::text, 'closed'::text, 'blocked'::text])));

ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_actor_type_check" CHECK (((actor_type IS NULL) OR (actor_type = ANY (ARRAY['customer'::text, 'human'::text, 'automated'::text, 'system'::text]))));

ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_direction_check" CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text, 'status'::text])));

ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY (id);

ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_property_match_status_chk" CHECK (((property_match_status IS NULL) OR (property_match_status = ANY (ARRAY['auto_matched'::text, 'pending_manual'::text, 'resolved_manual'::text, 'multiple_matched'::text, 'partial_match'::text]))));

ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_transcription_status_chk" CHECK (((transcription_status IS NULL) OR (transcription_status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'not_applicable'::text]))));

ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_whatsapp_message_id_key" UNIQUE (whatsapp_message_id);

ALTER TABLE public."whatsapp_webhook_events" ADD CONSTRAINT "whatsapp_webhook_events_attempt_count_check" CHECK ((attempt_count >= 0));

ALTER TABLE public."whatsapp_webhook_events" ADD CONSTRAINT "whatsapp_webhook_events_event_key_key" UNIQUE (event_key);

ALTER TABLE public."whatsapp_webhook_events" ADD CONSTRAINT "whatsapp_webhook_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."whatsapp_message_requests" ADD CONSTRAINT "whatsapp_message_requests_pkey" PRIMARY KEY (message_id, request_id);

ALTER TABLE public."whatsapp_message_requests" ADD CONSTRAINT "whatsapp_message_requests_relation_check" CHECK ((relation = ANY (ARRAY['created'::text, 'updated'::text, 'closed'::text, 'mentioned'::text, 'unclear'::text])));

ALTER TABLE public."client_request_events" ADD CONSTRAINT "client_request_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_ai_confidence_check" CHECK (((ai_confidence IS NULL) OR ((ai_confidence >= (0)::numeric) AND (ai_confidence <= (1)::numeric))));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_bathrooms_min_check" CHECK (((bathrooms_min IS NULL) OR (bathrooms_min >= 0)));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_bedrooms_min_check" CHECK (((bedrooms_min IS NULL) OR (bedrooms_min >= 0)));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_branch_key_check" CHECK (((branch_key IS NULL) OR (branch_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text, 'general'::text]))));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_budget_max_check" CHECK (((budget_max IS NULL) OR (budget_max >= (0)::numeric)));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_budget_min_check" CHECK (((budget_min IS NULL) OR (budget_min >= (0)::numeric)));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_budget_pair_check" CHECK (((budget_min IS NULL) OR (budget_max IS NULL) OR (budget_min <= budget_max)));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_built_size_max_check" CHECK (((built_size_max IS NULL) OR (built_size_max >= (0)::numeric)));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_built_size_min_check" CHECK (((built_size_min IS NULL) OR (built_size_min >= (0)::numeric)));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_built_size_pair_check" CHECK (((built_size_min IS NULL) OR (built_size_max IS NULL) OR (built_size_min <= built_size_max)));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_created_via_check" CHECK ((created_via = ANY (ARRAY['manual'::text, 'website'::text, 'whatsapp'::text, 'legacy'::text, 'import'::text, 'ai'::text])));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_decision_maker_status_check" CHECK (((decision_maker_status IS NULL) OR (decision_maker_status = ANY (ARRAY['self'::text, 'joint_family'::text, 'not_decision_maker'::text, 'unknown'::text]))));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_financing_readiness_check" CHECK (((financing_readiness IS NULL) OR (financing_readiness = ANY (ARRAY['cash_confirmed'::text, 'preapproved'::text, 'in_progress'::text, 'not_started'::text, 'rejected'::text, 'unknown'::text]))));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_land_size_max_check" CHECK (((land_size_max IS NULL) OR (land_size_max >= (0)::numeric)));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_land_size_min_check" CHECK (((land_size_min IS NULL) OR (land_size_min >= (0)::numeric)));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_land_size_pair_check" CHECK (((land_size_min IS NULL) OR (land_size_max IS NULL) OR (land_size_min <= land_size_max)));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_lead_score_check" CHECK (((lead_score >= 0) AND (lead_score <= 100)));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_lead_temperature_check" CHECK ((lead_temperature = ANY (ARRAY['hot'::text, 'warm'::text, 'cold'::text])));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_pkey" PRIMARY KEY (id);

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_priority_check" CHECK (((priority >= 1) AND (priority <= 3)));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_request_type_check" CHECK ((request_type = ANY (ARRAY['buyer'::text, 'seller'::text, 'tenant'::text, 'landlord'::text, 'consultation'::text, 'investor'::text])));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_search_status_check" CHECK ((search_status = ANY (ARRAY['active'::text, 'active_no_match'::text, 'waiting_new_property'::text, 'financing_in_progress'::text, 'not_ready'::text, 'deferred'::text, 'stopped'::text, 'bought_with_us'::text, 'bought_elsewhere'::text, 'no_response'::text, 'unknown'::text])));

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'won'::text, 'lost'::text, 'cancelled'::text, 'archived'::text])));

ALTER TABLE public."property_inquiries" ADD CONSTRAINT "property_inquiries_inquiry_count_check" CHECK ((inquiry_count >= 1));

ALTER TABLE public."property_inquiries" ADD CONSTRAINT "property_inquiries_match_status_check" CHECK (((match_status IS NULL) OR (match_status = ANY (ARRAY['matched'::text, 'not_matched'::text, 'incomplete'::text, 'near_match'::text]))));

ALTER TABLE public."property_inquiries" ADD CONSTRAINT "property_inquiries_pkey" PRIMARY KEY (id);

ALTER TABLE public."property_inquiries" ADD CONSTRAINT "property_inquiries_source_check" CHECK ((source = ANY (ARRAY['whatsapp'::text, 'instagram'::text, 'oman_reel'::text, 'youtube'::text, 'signboard'::text, 'referral'::text, 'website'::text, 'other'::text])));

ALTER TABLE public."property_inquiries" ADD CONSTRAINT "property_inquiries_status_check" CHECK ((status = ANY (ARRAY['inquiry'::text, 'followup'::text, 'viewing_scheduled'::text, 'viewed'::text, 'negotiation'::text, 'reserved'::text, 'deal'::text, 'not_suitable'::text, 'no_response'::text, 'closed'::text])));

ALTER TABLE public."appointments" ADD CONSTRAINT "appointments_branch_check" CHECK (((branch_key IS NULL) OR (branch_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text, 'general'::text]))));

ALTER TABLE public."appointments" ADD CONSTRAINT "appointments_pkey" PRIMARY KEY (id);

ALTER TABLE public."appointments" ADD CONSTRAINT "appointments_status_check" CHECK ((status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'attended'::text, 'no_show'::text, 'cancelled'::text, 'rescheduled'::text])));

ALTER TABLE public."appointment_properties" ADD CONSTRAINT "appointment_properties_company_id_appointment_id_property_i_key" UNIQUE (company_id, appointment_id, property_id);

ALTER TABLE public."appointment_properties" ADD CONSTRAINT "appointment_properties_interest_check" CHECK (((interest_level IS NULL) OR (interest_level = ANY (ARRAY['none'::text, 'low'::text, 'medium'::text, 'high'::text, 'serious'::text]))));

ALTER TABLE public."appointment_properties" ADD CONSTRAINT "appointment_properties_pkey" PRIMARY KEY (id);

ALTER TABLE public."activities" ADD CONSTRAINT "activities_actor_type_check" CHECK (((actor_type IS NULL) OR (actor_type = ANY (ARRAY['human'::text, 'automated'::text, 'system'::text]))));

ALTER TABLE public."activities" ADD CONSTRAINT "activities_direction_check" CHECK (((direction IS NULL) OR (direction = ANY (ARRAY['inbound'::text, 'outbound'::text, 'internal'::text]))));

ALTER TABLE public."activities" ADD CONSTRAINT "activities_pkey" PRIMARY KEY (id);

ALTER TABLE public."rejection_reasons" ADD CONSTRAINT "rejection_reasons_company_id_code_key" UNIQUE (company_id, code);

ALTER TABLE public."rejection_reasons" ADD CONSTRAINT "rejection_reasons_pkey" PRIMARY KEY (id);

ALTER TABLE public."property_rejection_reasons" ADD CONSTRAINT "property_rejection_phase_check" CHECK ((phase = ANY (ARRAY['pre_visit'::text, 'post_visit'::text, 'unknown'::text])));

ALTER TABLE public."property_rejection_reasons" ADD CONSTRAINT "property_rejection_reasons_company_id_property_inquiry_id_r_key" UNIQUE (company_id, property_inquiry_id, reason_id);

ALTER TABLE public."property_rejection_reasons" ADD CONSTRAINT "property_rejection_reasons_pkey" PRIMARY KEY (id);

ALTER TABLE public."property_action_reviews" ADD CONSTRAINT "property_action_reviews_pkey" PRIMARY KEY (id);

ALTER TABLE public."property_action_reviews" ADD CONSTRAINT "property_action_reviews_severity_chk" CHECK ((severity = ANY (ARRAY['info'::text, 'medium'::text, 'high'::text, 'urgent'::text])));

ALTER TABLE public."property_action_reviews" ADD CONSTRAINT "property_action_reviews_status_chk" CHECK ((status = ANY (ARRAY['open'::text, 'in_review'::text, 'actioned'::text, 'dismissed'::text])));

ALTER TABLE public."measurement_periods" ADD CONSTRAINT "measurement_period_dates" CHECK ((ends_on >= starts_on));

ALTER TABLE public."measurement_periods" ADD CONSTRAINT "measurement_period_status" CHECK ((status = ANY (ARRAY['setup'::text, 'active'::text, 'completed'::text])));

ALTER TABLE public."measurement_periods" ADD CONSTRAINT "measurement_periods_pkey" PRIMARY KEY (id);

ALTER TABLE public."measurement_targets" ADD CONSTRAINT "measurement_targets_period_id_branch_key_metric_key_key" UNIQUE (period_id, branch_key, metric_key);

ALTER TABLE public."measurement_targets" ADD CONSTRAINT "measurement_targets_pkey" PRIMARY KEY (id);

ALTER TABLE public."whatsapp_onboarding_events" ADD CONSTRAINT "whatsapp_onboarding_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."whatsapp_onboarding_events" ADD CONSTRAINT "whatsapp_onboarding_events_route_check" CHECK ((route_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text, 'general'::text])));

ALTER TABLE public."whatsapp_onboarding_events" ADD CONSTRAINT "whatsapp_onboarding_events_status_check" CHECK ((status = ANY (ARRAY['started'::text, 'completed'::text, 'failed'::text])));

ALTER TABLE public."deal_stage_history" ADD CONSTRAINT "deal_stage_history_pkey" PRIMARY KEY (id);

ALTER TABLE public."properties" ADD CONSTRAINT "crm_properties_numbers_valid" CHECK ((((price IS NULL) OR (price >= (0)::numeric)) AND ((owner_net IS NULL) OR (owner_net >= (0)::numeric)) AND ((land_size IS NULL) OR (land_size >= (0)::numeric)) AND ((built_size IS NULL) OR (built_size >= (0)::numeric)) AND ((bedrooms IS NULL) OR (bedrooms >= 0)) AND ((bathrooms IS NULL) OR (bathrooms >= 0))));

ALTER TABLE public."properties" ADD CONSTRAINT "properties_agreement_duration_months_check" CHECK (((agreement_duration_months IS NULL) OR ((agreement_duration_months >= 1) AND (agreement_duration_months <= 60))));

ALTER TABLE public."properties" ADD CONSTRAINT "properties_agreement_reminder_days_check" CHECK (((agreement_reminder_days IS NULL) OR ((agreement_reminder_days >= 1) AND (agreement_reminder_days <= 90))));

ALTER TABLE public."properties" ADD CONSTRAINT "properties_branch_key_check" CHECK (((branch_key IS NULL) OR (branch_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text, 'general'::text]))));

ALTER TABLE public."properties" ADD CONSTRAINT "properties_marketing_review_status_chk" CHECK ((marketing_review_status = ANY (ARRAY['healthy'::text, 'pending'::text, 'reviewing'::text, 'actioned'::text])));

ALTER TABLE public."properties" ADD CONSTRAINT "properties_photography_status_chk" CHECK ((photography_status = ANY (ARRAY['unknown'::text, 'needs_initial'::text, 'scheduled'::text, 'completed'::text, 'needs_refresh'::text, 'not_required'::text])));

ALTER TABLE public."properties" ADD CONSTRAINT "properties_pkey" PRIMARY KEY (id);

ALTER TABLE public."properties" ADD CONSTRAINT "properties_status_check" CHECK ((status = ANY (ARRAY['available'::text, 'reserved'::text, 'deposit'::text, 'negotiating'::text, 'sold'::text, 'not_available'::text, 'withdrawn'::text])));

ALTER TABLE public."properties" ADD CONSTRAINT "properties_type_check" CHECK ((type = ANY (ARRAY['villa'::text, 'house'::text, 'twin_villa'::text, 'townhouse'::text, 'apartment'::text, 'penthouse'::text, 'building'::text, 'residential_building'::text, 'commercial_building'::text, 'income_property'::text, 'land'::text, 'land_residential'::text, 'land_commercial'::text, 'land_mixed'::text, 'farm'::text, 'resthouse'::text, 'chalet'::text, 'office'::text, 'shop'::text, 'warehouse'::text])));

ALTER TABLE public."whatsapp_automation_events" ADD CONSTRAINT "whatsapp_automation_events_confidence_chk" CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))));

ALTER TABLE public."whatsapp_automation_events" ADD CONSTRAINT "whatsapp_automation_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."whatsapp_automation_events" ADD CONSTRAINT "whatsapp_automation_events_status_chk" CHECK ((status = ANY (ARRAY['detected'::text, 'applied'::text, 'pending_review'::text, 'skipped'::text, 'failed'::text])));

ALTER TABLE public."unmatched_property_links" ADD CONSTRAINT "unmatched_property_links_occurrence_count_check" CHECK ((occurrence_count >= 1));

ALTER TABLE public."unmatched_property_links" ADD CONSTRAINT "unmatched_property_links_pkey" PRIMARY KEY (id);

ALTER TABLE public."unmatched_property_links" ADD CONSTRAINT "unmatched_property_links_status_chk" CHECK ((status = ANY (ARRAY['pending'::text, 'resolved'::text, 'ignored'::text])));

ALTER TABLE public."whatsapp_route_credentials" ADD CONSTRAINT "whatsapp_route_credentials_pkey" PRIMARY KEY (company_id, route_key);

ALTER TABLE public."client_request_assignees" ADD CONSTRAINT "client_request_assignees_branch_key_check" CHECK ((branch_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text, 'general'::text])));

ALTER TABLE public."client_request_assignees" ADD CONSTRAINT "client_request_assignees_pkey" PRIMARY KEY (request_id, user_id, branch_key);

ALTER TABLE public."instagram_outbound_operations" ADD CONSTRAINT "instagram_outbound_operations_pkey" PRIMARY KEY (company_id, operation_id);

ALTER TABLE public."instagram_outbound_operations" ADD CONSTRAINT "instagram_outbound_operations_status_check" CHECK ((status = ANY (ARRAY['claimed'::text, 'sent'::text, 'uncertain'::text, 'failed'::text])));

ALTER TABLE public."employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_commission_target_check" CHECK ((commission_target >= (0)::numeric));

ALTER TABLE public."employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_inquiries_target_check" CHECK ((inquiries_target >= 0));

ALTER TABLE public."employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_inventory_target_check" CHECK (((inventory_target >= 0) AND (inventory_target <= 1000)));

ALTER TABLE public."employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_new_properties_target_check" CHECK (((new_properties_target >= 0) AND (new_properties_target <= 1000)));

ALTER TABLE public."employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_pkey" PRIMARY KEY (company_id, employee_id, month_start);

ALTER TABLE public."employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_sold_target_check" CHECK (((sold_target >= 0) AND (sold_target <= 1000)));

ALTER TABLE public."employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_visits_target_check" CHECK ((visits_target >= 0));

ALTER TABLE public."employee_monthly_targets" ADD CONSTRAINT "month_start_first_day" CHECK ((EXTRACT(day FROM month_start) = (1)::numeric));

ALTER TABLE public."whatsapp_followup_optouts" ADD CONSTRAINT "whatsapp_followup_optouts_pkey" PRIMARY KEY (request_id);

ALTER TABLE public."whatsapp_template_registry" ADD CONSTRAINT "whatsapp_template_registry_company_id_route_key_template_na_key" UNIQUE (company_id, route_key, template_name, language);

ALTER TABLE public."whatsapp_template_registry" ADD CONSTRAINT "whatsapp_template_registry_pkey" PRIMARY KEY (id);

ALTER TABLE public."whatsapp_template_registry" ADD CONSTRAINT "whatsapp_template_registry_route_key_check" CHECK ((route_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text])));

ALTER TABLE public."whatsapp_followup_events" ADD CONSTRAINT "whatsapp_followup_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."whatsapp_followup_events" ADD CONSTRAINT "whatsapp_followup_events_route_key_check" CHECK ((route_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text])));

ALTER TABLE public."whatsapp_followup_events" ADD CONSTRAINT "whatsapp_followup_events_send_mode_check" CHECK ((send_mode = ANY (ARRAY['service'::text, 'template'::text, 'none'::text])));

ALTER TABLE public."whatsapp_followup_events" ADD CONSTRAINT "whatsapp_followup_events_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text, 'template_pending'::text, 'skipped'::text, 'responded'::text])));

ALTER TABLE public."whatsapp_followup_events" ADD CONSTRAINT "whatsapp_followup_events_step_check" CHECK ((step = ANY (ARRAY['opt_in_request'::text, 'reminder_1'::text, 'final_check'::text, 'paused_no_response'::text])));

ALTER TABLE public."whatsapp_followup_optins" ADD CONSTRAINT "whatsapp_followup_optins_pkey" PRIMARY KEY (client_id);

ALTER TABLE public."whatsapp_automation_runtime" ADD CONSTRAINT "whatsapp_automation_runtime_max_requirements_prompts_check" CHECK (((max_requirements_prompts >= 0) AND (max_requirements_prompts <= 5)));

ALTER TABLE public."whatsapp_automation_runtime" ADD CONSTRAINT "whatsapp_automation_runtime_mode_check" CHECK ((mode = ANY (ARRAY['off'::text, 'test'::text, 'live'::text])));

ALTER TABLE public."whatsapp_automation_runtime" ADD CONSTRAINT "whatsapp_automation_runtime_pkey" PRIMARY KEY (company_id);

ALTER TABLE public."instagram_accounts" ADD CONSTRAINT "instagram_accounts_company_id_instagram_user_id_key" UNIQUE (company_id, instagram_user_id);

ALTER TABLE public."instagram_accounts" ADD CONSTRAINT "instagram_accounts_connection_status_check" CHECK ((connection_status = ANY (ARRAY['connected'::text, 'expired'::text, 'error'::text, 'disconnected'::text])));

ALTER TABLE public."instagram_accounts" ADD CONSTRAINT "instagram_accounts_pkey" PRIMARY KEY (id);

ALTER TABLE public."instagram_account_credentials" ADD CONSTRAINT "instagram_account_credentials_pkey" PRIMARY KEY (account_id);

ALTER TABLE public."instagram_webhook_events" ADD CONSTRAINT "instagram_webhook_events_event_key_key" UNIQUE (event_key);

ALTER TABLE public."instagram_webhook_events" ADD CONSTRAINT "instagram_webhook_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."instagram_conversations" ADD CONSTRAINT "instagram_conversations_account_id_participant_id_key" UNIQUE (account_id, participant_id);

ALTER TABLE public."instagram_conversations" ADD CONSTRAINT "instagram_conversations_pkey" PRIMARY KEY (id);

ALTER TABLE public."instagram_conversations" ADD CONSTRAINT "instagram_conversations_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));

ALTER TABLE public."instagram_messages" ADD CONSTRAINT "instagram_messages_company_id_instagram_message_id_key" UNIQUE (company_id, instagram_message_id);

ALTER TABLE public."instagram_messages" ADD CONSTRAINT "instagram_messages_direction_check" CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])));

ALTER TABLE public."instagram_messages" ADD CONSTRAINT "instagram_messages_pkey" PRIMARY KEY (id);

ALTER TABLE public."whatsapp_send_operations" ADD CONSTRAINT "whatsapp_send_operations_payload_hash_check" CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text));

ALTER TABLE public."whatsapp_send_operations" ADD CONSTRAINT "whatsapp_send_operations_pkey" PRIMARY KEY (company_id, user_id, operation_key);

ALTER TABLE public."whatsapp_send_operations" ADD CONSTRAINT "whatsapp_send_operations_status_check" CHECK ((status = ANY (ARRAY['processing'::text, 'sent'::text, 'failed'::text, 'unknown'::text])));

ALTER TABLE public."property_message_attributions" ADD CONSTRAINT "property_message_attributions_company_id_message_id_propert_key" UNIQUE (company_id, message_id, property_id);

ALTER TABLE public."property_message_attributions" ADD CONSTRAINT "property_message_attributions_method_check" CHECK ((method = ANY (ARRAY['exact_link'::text, 'exact_code'::text, 'manual'::text])));

ALTER TABLE public."property_message_attributions" ADD CONSTRAINT "property_message_attributions_pkey" PRIMARY KEY (id);

ALTER TABLE public."events" ADD CONSTRAINT "events_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE public."events" ADD CONSTRAINT "events_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."events" ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);

ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."deals" ADD CONSTRAINT "deals_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."deals" ADD CONSTRAINT "deals_broker_id_fkey" FOREIGN KEY (broker_id) REFERENCES owners(id) ON DELETE SET NULL;

ALTER TABLE public."deals" ADD CONSTRAINT "deals_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id);

ALTER TABLE public."deals" ADD CONSTRAINT "deals_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);

ALTER TABLE public."deals" ADD CONSTRAINT "deals_lost_reason_id_fkey" FOREIGN KEY (lost_reason_id) REFERENCES rejection_reasons(id) ON DELETE SET NULL;

ALTER TABLE public."deals" ADD CONSTRAINT "deals_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;

ALTER TABLE public."deals" ADD CONSTRAINT "deals_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE SET NULL;

ALTER TABLE public."deals" ADD CONSTRAINT "deals_viewing_id_fkey" FOREIGN KEY (viewing_id) REFERENCES viewings(id) ON DELETE SET NULL;

ALTER TABLE public."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id);

ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."owners" ADD CONSTRAINT "owners_added_by_fkey" FOREIGN KEY (added_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."owners" ADD CONSTRAINT "owners_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."company_lead_routes" ADD CONSTRAINT "company_lead_routes_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."company_lead_routes" ADD CONSTRAINT "company_lead_routes_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."deposits" ADD CONSTRAINT "deposits_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id);

ALTER TABLE public."deposits" ADD CONSTRAINT "deposits_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."deposits" ADD CONSTRAINT "deposits_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;

ALTER TABLE public."deposits" ADD CONSTRAINT "deposits_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

ALTER TABLE public."viewings" ADD CONSTRAINT "viewings_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."viewings" ADD CONSTRAINT "viewings_appointment_id_fkey" FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;

ALTER TABLE public."viewings" ADD CONSTRAINT "viewings_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE public."viewings" ADD CONSTRAINT "viewings_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."viewings" ADD CONSTRAINT "viewings_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id);

ALTER TABLE public."viewings" ADD CONSTRAINT "viewings_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

ALTER TABLE public."viewings" ADD CONSTRAINT "viewings_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE SET NULL;

ALTER TABLE public."viewings" ADD CONSTRAINT "viewings_source_whatsapp_message_id_fkey" FOREIGN KEY (source_whatsapp_message_id) REFERENCES whatsapp_messages(id) ON DELETE SET NULL;

ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL;

ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE SET NULL;

ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_viewing_id_fkey" FOREIGN KEY (viewing_id) REFERENCES viewings(id) ON DELETE SET NULL;

ALTER TABLE public."clients" ADD CONSTRAINT "clients_archived_by_fkey" FOREIGN KEY (archived_by) REFERENCES profiles(id);

ALTER TABLE public."clients" ADD CONSTRAINT "clients_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."clients" ADD CONSTRAINT "clients_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);

ALTER TABLE public."clients" ADD CONSTRAINT "clients_followup_suppressed_by_fkey" FOREIGN KEY (followup_suppressed_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."company_invites" ADD CONSTRAINT "company_invites_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."company_invites" ADD CONSTRAINT "company_invites_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."company_invites" ADD CONSTRAINT "company_invites_used_by_fkey" FOREIGN KEY (used_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."property_marketing_events" ADD CONSTRAINT "property_marketing_events_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."property_marketing_events" ADD CONSTRAINT "property_marketing_events_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."property_marketing_events" ADD CONSTRAINT "property_marketing_events_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES whatsapp_conversations(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_matched_marketing_event_id_fkey" FOREIGN KEY (matched_marketing_event_id) REFERENCES property_marketing_events(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_matched_property_id_fkey" FOREIGN KEY (matched_property_id) REFERENCES properties(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_sent_by_user_id_fkey" FOREIGN KEY (sent_by_user_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_webhook_events" ADD CONSTRAINT "whatsapp_webhook_events_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_message_requests" ADD CONSTRAINT "whatsapp_message_requests_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_message_requests" ADD CONSTRAINT "whatsapp_message_requests_message_id_fkey" FOREIGN KEY (message_id) REFERENCES whatsapp_messages(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_message_requests" ADD CONSTRAINT "whatsapp_message_requests_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE CASCADE;

ALTER TABLE public."client_request_events" ADD CONSTRAINT "client_request_events_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."client_request_events" ADD CONSTRAINT "client_request_events_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE public."client_request_events" ADD CONSTRAINT "client_request_events_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."client_request_events" ADD CONSTRAINT "client_request_events_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE CASCADE;

ALTER TABLE public."client_request_events" ADD CONSTRAINT "client_request_events_whatsapp_message_id_fkey" FOREIGN KEY (whatsapp_message_id) REFERENCES whatsapp_messages(id) ON DELETE SET NULL;

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_manual_assigned_to_fkey" FOREIGN KEY (manual_assigned_to) REFERENCES profiles(id);

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_origin_whatsapp_message_id_fkey" FOREIGN KEY (origin_whatsapp_message_id) REFERENCES whatsapp_messages(id) ON DELETE SET NULL;

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_subject_property_id_fkey" FOREIGN KEY (subject_property_id) REFERENCES properties(id) ON DELETE SET NULL;

ALTER TABLE public."client_requests" ADD CONSTRAINT "client_requests_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."property_inquiries" ADD CONSTRAINT "property_inquiries_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."property_inquiries" ADD CONSTRAINT "property_inquiries_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE public."property_inquiries" ADD CONSTRAINT "property_inquiries_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."property_inquiries" ADD CONSTRAINT "property_inquiries_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."property_inquiries" ADD CONSTRAINT "property_inquiries_marketing_event_id_fkey" FOREIGN KEY (marketing_event_id) REFERENCES property_marketing_events(id) ON DELETE SET NULL;

ALTER TABLE public."property_inquiries" ADD CONSTRAINT "property_inquiries_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

ALTER TABLE public."property_inquiries" ADD CONSTRAINT "property_inquiries_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE SET NULL;

ALTER TABLE public."property_inquiries" ADD CONSTRAINT "property_inquiries_source_whatsapp_message_id_fkey" FOREIGN KEY (source_whatsapp_message_id) REFERENCES whatsapp_messages(id) ON DELETE SET NULL;

ALTER TABLE public."appointments" ADD CONSTRAINT "appointments_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."appointments" ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE public."appointments" ADD CONSTRAINT "appointments_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."appointments" ADD CONSTRAINT "appointments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."appointments" ADD CONSTRAINT "appointments_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE SET NULL;

ALTER TABLE public."appointment_properties" ADD CONSTRAINT "appointment_properties_appointment_id_fkey" FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE;

ALTER TABLE public."appointment_properties" ADD CONSTRAINT "appointment_properties_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."appointment_properties" ADD CONSTRAINT "appointment_properties_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

ALTER TABLE public."activities" ADD CONSTRAINT "activities_appointment_id_fkey" FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;

ALTER TABLE public."activities" ADD CONSTRAINT "activities_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id);

ALTER TABLE public."activities" ADD CONSTRAINT "activities_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);

ALTER TABLE public."activities" ADD CONSTRAINT "activities_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id);

ALTER TABLE public."activities" ADD CONSTRAINT "activities_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

ALTER TABLE public."activities" ADD CONSTRAINT "activities_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE SET NULL;

ALTER TABLE public."activities" ADD CONSTRAINT "activities_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."rejection_reasons" ADD CONSTRAINT "rejection_reasons_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."property_rejection_reasons" ADD CONSTRAINT "property_rejection_reasons_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE public."property_rejection_reasons" ADD CONSTRAINT "property_rejection_reasons_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."property_rejection_reasons" ADD CONSTRAINT "property_rejection_reasons_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."property_rejection_reasons" ADD CONSTRAINT "property_rejection_reasons_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

ALTER TABLE public."property_rejection_reasons" ADD CONSTRAINT "property_rejection_reasons_property_inquiry_id_fkey" FOREIGN KEY (property_inquiry_id) REFERENCES property_inquiries(id) ON DELETE CASCADE;

ALTER TABLE public."property_rejection_reasons" ADD CONSTRAINT "property_rejection_reasons_reason_id_fkey" FOREIGN KEY (reason_id) REFERENCES rejection_reasons(id) ON DELETE RESTRICT;

ALTER TABLE public."property_rejection_reasons" ADD CONSTRAINT "property_rejection_reasons_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE CASCADE;

ALTER TABLE public."property_action_reviews" ADD CONSTRAINT "property_action_reviews_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."property_action_reviews" ADD CONSTRAINT "property_action_reviews_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."property_action_reviews" ADD CONSTRAINT "property_action_reviews_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

ALTER TABLE public."property_action_reviews" ADD CONSTRAINT "property_action_reviews_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."measurement_periods" ADD CONSTRAINT "measurement_periods_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."measurement_periods" ADD CONSTRAINT "measurement_periods_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."measurement_targets" ADD CONSTRAINT "measurement_targets_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."measurement_targets" ADD CONSTRAINT "measurement_targets_period_id_fkey" FOREIGN KEY (period_id) REFERENCES measurement_periods(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_onboarding_events" ADD CONSTRAINT "whatsapp_onboarding_events_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_onboarding_events" ADD CONSTRAINT "whatsapp_onboarding_events_initiated_by_fkey" FOREIGN KEY (initiated_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."deal_stage_history" ADD CONSTRAINT "deal_stage_history_changed_by_fkey" FOREIGN KEY (changed_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."deal_stage_history" ADD CONSTRAINT "deal_stage_history_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE public."deal_stage_history" ADD CONSTRAINT "deal_stage_history_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."deal_stage_history" ADD CONSTRAINT "deal_stage_history_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;

ALTER TABLE public."deal_stage_history" ADD CONSTRAINT "deal_stage_history_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;

ALTER TABLE public."deal_stage_history" ADD CONSTRAINT "deal_stage_history_reason_id_fkey" FOREIGN KEY (reason_id) REFERENCES rejection_reasons(id) ON DELETE SET NULL;

ALTER TABLE public."properties" ADD CONSTRAINT "properties_added_by_fkey" FOREIGN KEY (added_by) REFERENCES profiles(id);

ALTER TABLE public."properties" ADD CONSTRAINT "properties_archived_by_fkey" FOREIGN KEY (archived_by) REFERENCES profiles(id);

ALTER TABLE public."properties" ADD CONSTRAINT "properties_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);

ALTER TABLE public."properties" ADD CONSTRAINT "properties_owner_client_id_fkey" FOREIGN KEY (owner_client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE public."properties" ADD CONSTRAINT "properties_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL;

ALTER TABLE public."properties" ADD CONSTRAINT "properties_sourced_by_fkey" FOREIGN KEY (sourced_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_automation_events" ADD CONSTRAINT "whatsapp_automation_events_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_automation_events" ADD CONSTRAINT "whatsapp_automation_events_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_automation_events" ADD CONSTRAINT "whatsapp_automation_events_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES whatsapp_conversations(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_automation_events" ADD CONSTRAINT "whatsapp_automation_events_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_automation_events" ADD CONSTRAINT "whatsapp_automation_events_message_id_fkey" FOREIGN KEY (message_id) REFERENCES whatsapp_messages(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_automation_events" ADD CONSTRAINT "whatsapp_automation_events_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_automation_events" ADD CONSTRAINT "whatsapp_automation_events_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_automation_events" ADD CONSTRAINT "whatsapp_automation_events_viewing_id_fkey" FOREIGN KEY (viewing_id) REFERENCES viewings(id) ON DELETE SET NULL;

ALTER TABLE public."unmatched_property_links" ADD CONSTRAINT "unmatched_property_links_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE public."unmatched_property_links" ADD CONSTRAINT "unmatched_property_links_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."unmatched_property_links" ADD CONSTRAINT "unmatched_property_links_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES whatsapp_conversations(id) ON DELETE CASCADE;

ALTER TABLE public."unmatched_property_links" ADD CONSTRAINT "unmatched_property_links_marketing_event_id_fkey" FOREIGN KEY (marketing_event_id) REFERENCES property_marketing_events(id) ON DELETE SET NULL;

ALTER TABLE public."unmatched_property_links" ADD CONSTRAINT "unmatched_property_links_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;

ALTER TABLE public."unmatched_property_links" ADD CONSTRAINT "unmatched_property_links_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE public."unmatched_property_links" ADD CONSTRAINT "unmatched_property_links_whatsapp_message_id_fkey" FOREIGN KEY (whatsapp_message_id) REFERENCES whatsapp_messages(id) ON DELETE CASCADE;

ALTER TABLE public."client_request_assignees" ADD CONSTRAINT "client_request_assignees_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE CASCADE;

ALTER TABLE public."client_request_assignees" ADD CONSTRAINT "client_request_assignees_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE public."instagram_outbound_operations" ADD CONSTRAINT "instagram_outbound_operations_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES profiles(id);

ALTER TABLE public."instagram_outbound_operations" ADD CONSTRAINT "instagram_outbound_operations_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."instagram_outbound_operations" ADD CONSTRAINT "instagram_outbound_operations_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES instagram_conversations(id) ON DELETE CASCADE;

ALTER TABLE public."employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."employee_monthly_targets" ADD CONSTRAINT "employee_monthly_targets_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_followup_optouts" ADD CONSTRAINT "whatsapp_followup_optouts_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_followup_optouts" ADD CONSTRAINT "whatsapp_followup_optouts_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_followup_optouts" ADD CONSTRAINT "whatsapp_followup_optouts_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_followup_optouts" ADD CONSTRAINT "whatsapp_followup_optouts_source_message_id_fkey" FOREIGN KEY (source_message_id) REFERENCES whatsapp_messages(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_template_registry" ADD CONSTRAINT "whatsapp_template_registry_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_followup_events" ADD CONSTRAINT "whatsapp_followup_events_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_followup_events" ADD CONSTRAINT "whatsapp_followup_events_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_followup_events" ADD CONSTRAINT "whatsapp_followup_events_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES whatsapp_conversations(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_followup_events" ADD CONSTRAINT "whatsapp_followup_events_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_followup_optins" ADD CONSTRAINT "whatsapp_followup_optins_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_followup_optins" ADD CONSTRAINT "whatsapp_followup_optins_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."whatsapp_followup_optins" ADD CONSTRAINT "whatsapp_followup_optins_source_conversation_id_fkey" FOREIGN KEY (source_conversation_id) REFERENCES whatsapp_conversations(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_followup_optins" ADD CONSTRAINT "whatsapp_followup_optins_source_message_id_fkey" FOREIGN KEY (source_message_id) REFERENCES whatsapp_messages(id) ON DELETE SET NULL;

ALTER TABLE public."whatsapp_automation_runtime" ADD CONSTRAINT "whatsapp_automation_runtime_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."instagram_accounts" ADD CONSTRAINT "instagram_accounts_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."instagram_accounts" ADD CONSTRAINT "instagram_accounts_connected_by_fkey" FOREIGN KEY (connected_by) REFERENCES auth.users(id);

ALTER TABLE public."instagram_account_credentials" ADD CONSTRAINT "instagram_account_credentials_account_id_fkey" FOREIGN KEY (account_id) REFERENCES instagram_accounts(id) ON DELETE CASCADE;

ALTER TABLE public."instagram_account_credentials" ADD CONSTRAINT "instagram_account_credentials_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."instagram_webhook_events" ADD CONSTRAINT "instagram_webhook_events_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."instagram_conversations" ADD CONSTRAINT "instagram_conversations_account_id_fkey" FOREIGN KEY (account_id) REFERENCES instagram_accounts(id) ON DELETE CASCADE;

ALTER TABLE public."instagram_conversations" ADD CONSTRAINT "instagram_conversations_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."instagram_conversations" ADD CONSTRAINT "instagram_conversations_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE public."instagram_conversations" ADD CONSTRAINT "instagram_conversations_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."instagram_messages" ADD CONSTRAINT "instagram_messages_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE public."instagram_messages" ADD CONSTRAINT "instagram_messages_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."instagram_messages" ADD CONSTRAINT "instagram_messages_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES instagram_conversations(id) ON DELETE CASCADE;

ALTER TABLE public."instagram_messages" ADD CONSTRAINT "instagram_messages_sent_by_user_id_fkey" FOREIGN KEY (sent_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."property_message_attributions" ADD CONSTRAINT "property_message_attributions_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE public."property_message_attributions" ADD CONSTRAINT "property_message_attributions_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE public."property_message_attributions" ADD CONSTRAINT "property_message_attributions_inquiry_id_fkey" FOREIGN KEY (inquiry_id) REFERENCES property_inquiries(id) ON DELETE SET NULL;

ALTER TABLE public."property_message_attributions" ADD CONSTRAINT "property_message_attributions_marketing_event_id_fkey" FOREIGN KEY (marketing_event_id) REFERENCES property_marketing_events(id) ON DELETE SET NULL;

ALTER TABLE public."property_message_attributions" ADD CONSTRAINT "property_message_attributions_message_id_fkey" FOREIGN KEY (message_id) REFERENCES whatsapp_messages(id) ON DELETE CASCADE;

ALTER TABLE public."property_message_attributions" ADD CONSTRAINT "property_message_attributions_property_id_fkey" FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

ALTER TABLE public."property_message_attributions" ADD CONSTRAINT "property_message_attributions_request_id_fkey" FOREIGN KEY (request_id) REFERENCES client_requests(id) ON DELETE SET NULL;

ALTER TABLE crm_repair_private."branch_performance_owners" ADD CONSTRAINT "branch_performance_owners_branch_key_check" CHECK ((branch_key = ANY (ARRAY['muscat'::text, 'barka'::text])));

ALTER TABLE crm_repair_private."branch_performance_owners" ADD CONSTRAINT "branch_performance_owners_pkey" PRIMARY KEY (company_id, branch_key);

ALTER TABLE crm_repair_private."deal_save_operations" ADD CONSTRAINT "deal_save_operations_pkey" PRIMARY KEY (user_id, operation_key);

ALTER TABLE crm_repair_private."deal_workflow_context" ADD CONSTRAINT "deal_workflow_context_pkey" PRIMARY KEY (transaction_id, user_id);

ALTER TABLE crm_repair_private."rejection_change_audit" ADD CONSTRAINT "rejection_change_audit_pkey" PRIMARY KEY (id);

ALTER TABLE crm_repair_private."viewing_save_operations" ADD CONSTRAINT "viewing_save_operations_pkey" PRIMARY KEY (user_id, operation_key);

ALTER TABLE crm_repair_private."branch_performance_owners" ADD CONSTRAINT "branch_performance_owners_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);

ALTER TABLE crm_repair_private."branch_performance_owners" ADD CONSTRAINT "branch_performance_owners_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES profiles(id);

ALTER TABLE crm_repair_private."deal_save_operations" ADD CONSTRAINT "deal_save_operations_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);

ALTER TABLE crm_repair_private."deal_save_operations" ADD CONSTRAINT "deal_save_operations_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id);

ALTER TABLE crm_repair_private."deal_save_operations" ADD CONSTRAINT "deal_save_operations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id);

ALTER TABLE crm_repair_private."deal_workflow_context" ADD CONSTRAINT "deal_workflow_context_deal_id_fkey" FOREIGN KEY (deal_id) REFERENCES deals(id);

ALTER TABLE crm_repair_private."viewing_save_operations" ADD CONSTRAINT "viewing_save_operations_appointment_id_fkey" FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;

ALTER TABLE crm_repair_private."viewing_save_operations" ADD CONSTRAINT "viewing_save_operations_company_id_fkey" FOREIGN KEY (company_id) REFERENCES companies(id);

ALTER TABLE crm_repair_private."viewing_save_operations" ADD CONSTRAINT "viewing_save_operations_followup_task_id_fkey" FOREIGN KEY (followup_task_id) REFERENCES tasks(id) ON DELETE SET NULL;

ALTER TABLE crm_repair_private."viewing_save_operations" ADD CONSTRAINT "viewing_save_operations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id);

ALTER TABLE crm_repair_private."viewing_save_operations" ADD CONSTRAINT "viewing_save_operations_viewing_id_fkey" FOREIGN KEY (viewing_id) REFERENCES viewings(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX company_lead_routes_meta_phone_uidx ON public.company_lead_routes USING btree (company_id, meta_phone_number_id) WHERE ((meta_phone_number_id IS NOT NULL) AND (is_active = true));

CREATE UNIQUE INDEX crm_one_open_viewing_followup ON public.tasks USING btree (company_id, viewing_id) WHERE ((viewing_id IS NOT NULL) AND (done IS FALSE));

CREATE UNIQUE INDEX clients_company_instagram_participant_uidx ON public.clients USING btree (company_id, instagram_participant_id) WHERE (instagram_participant_id IS NOT NULL);

CREATE UNIQUE INDEX clients_company_phone_normalized_uidx ON public.clients USING btree (company_id, phone_normalized) WHERE (phone_normalized IS NOT NULL);

CREATE UNIQUE INDEX company_invites_pending_email ON public.company_invites USING btree (company_id, lower(email)) WHERE (status = 'pending'::text);

CREATE UNIQUE INDEX property_marketing_instagram_media_unique ON public.property_marketing_events USING btree (company_id, instagram_media_id) WHERE (instagram_media_id IS NOT NULL);

CREATE UNIQUE INDEX property_marketing_link_key_unique ON public.property_marketing_events USING btree (company_id, link_key) WHERE (link_key IS NOT NULL);

CREATE UNIQUE INDEX property_inquiries_request_property_uidx ON public.property_inquiries USING btree (company_id, request_id, property_id) WHERE (request_id IS NOT NULL);

CREATE UNIQUE INDEX property_inquiries_legacy_client_property_uidx ON public.property_inquiries USING btree (company_id, client_id, property_id) WHERE (request_id IS NULL);

CREATE UNIQUE INDEX properties_company_code_uidx ON public.properties USING btree (company_id, property_code) WHERE (property_code IS NOT NULL);

CREATE UNIQUE INDEX unmatched_property_links_message_key_uidx ON public.unmatched_property_links USING btree (company_id, whatsapp_message_id, link_key);

CREATE UNIQUE INDEX whatsapp_followup_events_meta_message_uidx ON public.whatsapp_followup_events USING btree (meta_message_id) WHERE (meta_message_id IS NOT NULL);

ALTER TABLE public."events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."profiles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."companies" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."deals" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."notifications" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."expenses" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."owners" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."company_lead_routes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."deposits" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."viewings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."tasks" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."clients" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."company_invites" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."property_marketing_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."whatsapp_conversations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."whatsapp_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."whatsapp_webhook_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."whatsapp_message_requests" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."client_request_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."client_requests" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."property_inquiries" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."appointments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."appointment_properties" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."activities" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."rejection_reasons" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."property_rejection_reasons" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."property_action_reviews" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."measurement_periods" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."measurement_targets" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."whatsapp_onboarding_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."deal_stage_history" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."properties" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."whatsapp_automation_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."unmatched_property_links" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."whatsapp_route_credentials" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."client_request_assignees" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."instagram_outbound_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."employee_monthly_targets" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."whatsapp_followup_optouts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."whatsapp_template_registry" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."whatsapp_followup_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."whatsapp_followup_optins" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."whatsapp_automation_runtime" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."instagram_accounts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."instagram_account_credentials" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."instagram_webhook_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."instagram_conversations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."instagram_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."whatsapp_send_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."property_message_attributions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_delete_allowed" ON public."events" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (user_id = auth.uid())))));

CREATE POLICY "events_insert_allowed" ON public."events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = my_company()) AND (user_id = auth.uid()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text]))));

CREATE POLICY "events_select_allowed" ON public."events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR (user_id = auth.uid()))));

CREATE POLICY "events_update_allowed" ON public."events" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (user_id = auth.uid()))))) WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (user_id = auth.uid())))));

CREATE POLICY "profiles_owner_manage_company" ON public."profiles" AS PERMISSIVE FOR ALL TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'owner'::text))) WITH CHECK (((company_id = my_company()) AND (my_role() = 'owner'::text)));

CREATE POLICY "profiles_select_same_company" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((id = auth.uid()) OR (company_id = my_company())));

CREATE POLICY "profiles_update_own_basic" ON public."profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((id = auth.uid())) WITH CHECK (((id = auth.uid()) AND (company_id = my_company())));

CREATE POLICY "companies_owner_update" ON public."companies" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((id = my_company()) AND (my_role() = 'owner'::text))) WITH CHECK (((id = my_company()) AND (my_role() = 'owner'::text)));

CREATE POLICY "companies_select_own_company" ON public."companies" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((id = my_company()));

CREATE POLICY "deals_delete_admin" ON public."deals" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "deals_insert_staff" ON public."deals" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (agent_id = auth.uid())))));

CREATE POLICY "deals_related_branch_boundary" ON public."deals" AS RESTRICTIVE FOR ALL TO "authenticated" USING (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((property_id IS NULL) OR (EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = deals.property_id) AND (p.company_id = deals.company_id) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)))))))) WITH CHECK (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((property_id IS NULL) OR (EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = deals.property_id) AND (p.company_id = deals.company_id) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key))))))));

CREATE POLICY "deals_select_by_role" ON public."deals" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((my_role() = 'agent'::text) AND (agent_id = auth.uid())))));

CREATE POLICY "deals_update_allowed" ON public."deals" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (agent_id = auth.uid()))))) WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (agent_id = auth.uid())))));

CREATE POLICY "Own notifications only" ON public."notifications" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT my_company() AS my_company) IS NOT NULL)));

CREATE POLICY "Update own notifications" ON public."notifications" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT my_company() AS my_company) IS NOT NULL))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT my_company() AS my_company) IS NOT NULL)));

CREATE POLICY "notifications_insert_own" ON public."notifications" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (( SELECT my_company() AS my_company) IS NOT NULL)));

CREATE POLICY "expenses_owner_delete" ON public."expenses" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'owner'::text)));

CREATE POLICY "expenses_owner_insert" ON public."expenses" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = my_company()) AND (my_role() = 'owner'::text)));

CREATE POLICY "expenses_owner_select" ON public."expenses" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'owner'::text)));

CREATE POLICY "expenses_owner_update" ON public."expenses" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'owner'::text))) WITH CHECK (((company_id = my_company()) AND (my_role() = 'owner'::text)));

CREATE POLICY "owners_delete_admin" ON public."owners" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "owners_insert_staff" ON public."owners" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text]))));

CREATE POLICY "owners_select_company" ON public."owners" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((company_id = my_company()));

CREATE POLICY "owners_update_staff" ON public."owners" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text])))) WITH CHECK (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text]))));

CREATE POLICY "lead_routes_owner_manage" ON public."company_lead_routes" AS PERMISSIVE FOR ALL TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'owner'::text))) WITH CHECK (((company_id = my_company()) AND (my_role() = 'owner'::text) AND ((assigned_to IS NULL) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = company_lead_routes.assigned_to) AND (p.company_id = my_company()) AND (p.is_active IS NOT FALSE)))))));

CREATE POLICY "lead_routes_select_company" ON public."company_lead_routes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "deposits_delete_admin" ON public."deposits" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "deposits_insert_staff" ON public."deposits" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = deposits.deal_id) AND (d.company_id = my_company()) AND (d.agent_id = auth.uid()))))))));

CREATE POLICY "deposits_select_by_role" ON public."deposits" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = deposits.deal_id) AND (d.company_id = my_company()) AND (d.agent_id = auth.uid()))))))));

CREATE POLICY "deposits_update_allowed" ON public."deposits" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = deposits.deal_id) AND (d.company_id = my_company()) AND (d.agent_id = auth.uid())))))))) WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = deposits.deal_id) AND (d.company_id = my_company()) AND (d.agent_id = auth.uid()))))))));

CREATE POLICY "viewings_delete_admin" ON public."viewings" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "viewings_insert_staff" ON public."viewings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND (agent_id = ( SELECT auth.uid() AS uid)) AND crm_repair_private.can_access_client(company_id, client_id)))));

CREATE POLICY "viewings_related_branch_boundary" ON public."viewings" AS RESTRICTIVE FOR ALL TO "authenticated" USING (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((property_id IS NULL) OR (EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = viewings.property_id) AND (p.company_id = viewings.company_id) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)))))))) WITH CHECK (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((property_id IS NULL) OR (EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = viewings.property_id) AND (p.company_id = viewings.company_id) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key))))))));

CREATE POLICY "viewings_select_company" ON public."viewings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND crm_repair_private.can_access_client(company_id, client_id)))));

CREATE POLICY "viewings_update_staff" ON public."viewings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND (agent_id = ( SELECT auth.uid() AS uid)) AND crm_repair_private.can_access_client(company_id, client_id))))) WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND (agent_id = ( SELECT auth.uid() AS uid)) AND crm_repair_private.can_access_client(company_id, client_id)))));

CREATE POLICY "tasks_delete_allowed" ON public."tasks" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (user_id = auth.uid())))));

CREATE POLICY "tasks_insert_allowed" ON public."tasks" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (user_id = auth.uid())))));

CREATE POLICY "tasks_related_branch_boundary" ON public."tasks" AS RESTRICTIVE FOR ALL TO "authenticated" USING (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((deal_id IS NULL) OR (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = tasks.deal_id) AND (d.company_id = tasks.company_id))))) AND ((viewing_id IS NULL) OR (EXISTS ( SELECT 1
   FROM viewings v
  WHERE ((v.id = tasks.viewing_id) AND (v.company_id = tasks.company_id)))))))) WITH CHECK (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((deal_id IS NULL) OR (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = tasks.deal_id) AND (d.company_id = tasks.company_id))))) AND ((viewing_id IS NULL) OR (EXISTS ( SELECT 1
   FROM viewings v
  WHERE ((v.id = tasks.viewing_id) AND (v.company_id = tasks.company_id))))))));

CREATE POLICY "tasks_select_allowed" ON public."tasks" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR (user_id = auth.uid()))));

CREATE POLICY "tasks_update_allowed" ON public."tasks" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (user_id = auth.uid()))))) WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (user_id = auth.uid())))));

CREATE POLICY "clients_branch_boundary" ON public."clients" AS RESTRICTIVE FOR ALL TO "authenticated" USING (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (COALESCE(lead_route, 'general'::text) = 'general'::text) OR crm_repair_private.staff_can_access_branch(company_id, lead_route))) WITH CHECK (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (COALESCE(lead_route, 'general'::text) = 'general'::text) OR crm_repair_private.staff_can_access_branch(company_id, lead_route)));

CREATE POLICY "clients_delete_admin" ON public."clients" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "clients_insert_staff" ON public."clients" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid())))));

CREATE POLICY "clients_select_by_role" ON public."clients" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid())))));

CREATE POLICY "clients_select_via_assigned_request" ON public."clients" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM client_requests r
  WHERE ((r.client_id = clients.id) AND (r.company_id = my_company()) AND (r.assigned_to = auth.uid()) AND (r.status <> 'archived'::text))))));

CREATE POLICY "clients_select_via_request_team" ON public."clients" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM (client_requests r
     JOIN client_request_assignees a ON ((a.request_id = r.id)))
  WHERE ((r.client_id = clients.id) AND (r.company_id = my_company()) AND (r.status = ANY (ARRAY['active'::text, 'paused'::text])) AND (a.user_id = auth.uid()))))));

CREATE POLICY "clients_update_allowed" ON public."clients" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid()))))) WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid())))));

CREATE POLICY "clients_update_via_request_team" ON public."clients" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM (client_requests r
     JOIN client_request_assignees a ON ((a.request_id = r.id)))
  WHERE ((r.client_id = clients.id) AND (r.company_id = my_company()) AND (r.status = ANY (ARRAY['active'::text, 'paused'::text])) AND (a.user_id = auth.uid())))))) WITH CHECK ((company_id = my_company()));

CREATE POLICY "company_invites_owner_delete" ON public."company_invites" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_company_owner(company_id));

CREATE POLICY "company_invites_owner_insert" ON public."company_invites" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_company_owner(company_id) AND (created_by = auth.uid())));

CREATE POLICY "company_invites_owner_select" ON public."company_invites" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_company_owner(company_id));

CREATE POLICY "company_invites_owner_update" ON public."company_invites" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_company_owner(company_id)) WITH CHECK (is_company_owner(company_id));

CREATE POLICY "property_marketing_branch_boundary" ON public."property_marketing_events" AS RESTRICTIVE FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = property_marketing_events.property_id) AND (p.company_id = p.company_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = property_marketing_events.property_id) AND (p.company_id = p.company_id)))));

CREATE POLICY "property_marketing_delete_admin" ON public."property_marketing_events" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "property_marketing_insert_staff" ON public."property_marketing_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text])) AND (created_by = auth.uid())));

CREATE POLICY "property_marketing_select_company" ON public."property_marketing_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((company_id = my_company()));

CREATE POLICY "property_marketing_update_admin" ON public."property_marketing_events" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text])))) WITH CHECK (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "whatsapp_conversations_select_by_role" ON public."whatsapp_conversations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (crm_repair_private.can_access_whatsapp_conversation(company_id, id));

CREATE POLICY "whatsapp_messages_select_by_role" ON public."whatsapp_messages" AS PERMISSIVE FOR SELECT TO "authenticated" USING (crm_repair_private.can_access_whatsapp_conversation(company_id, conversation_id));

CREATE POLICY "whatsapp_webhook_events_owner_select" ON public."whatsapp_webhook_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'owner'::text)));

CREATE POLICY "whatsapp_message_requests_select_allowed" ON public."whatsapp_message_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND crm_repair_private.can_access_request(company_id, request_id)));

CREATE POLICY "client_request_events_select_allowed" ON public."client_request_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND crm_repair_private.can_access_request(company_id, request_id)));

CREATE POLICY "client_requests_delete_admin" ON public."client_requests" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "client_requests_insert_staff" ON public."client_requests" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid())))));

CREATE POLICY "client_requests_select_allowed" ON public."client_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid())))));

CREATE POLICY "client_requests_select_via_team" ON public."client_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM client_request_assignees a
  WHERE ((a.request_id = client_requests.id) AND (a.company_id = my_company()) AND (a.user_id = auth.uid()))))));

CREATE POLICY "client_requests_update_allowed" ON public."client_requests" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid()))))) WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid())))));

CREATE POLICY "client_requests_update_via_team" ON public."client_requests" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM client_request_assignees a
  WHERE ((a.request_id = client_requests.id) AND (a.company_id = my_company()) AND (a.user_id = auth.uid())))))) WITH CHECK ((company_id = my_company()));

CREATE POLICY "requests_branch_boundary" ON public."client_requests" AS RESTRICTIVE FOR ALL TO "authenticated" USING (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (COALESCE(branch_key, route_key, 'general'::text) = 'general'::text) OR crm_repair_private.staff_can_access_branch(company_id, COALESCE(branch_key, route_key)))) WITH CHECK (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (COALESCE(branch_key, route_key, 'general'::text) = 'general'::text) OR crm_repair_private.staff_can_access_branch(company_id, COALESCE(branch_key, route_key))));

CREATE POLICY "property_inquiries_branch_boundary" ON public."property_inquiries" AS RESTRICTIVE FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = property_inquiries.property_id) AND (p.company_id = p.company_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = property_inquiries.property_id) AND (p.company_id = p.company_id)))));

CREATE POLICY "property_inquiries_delete_admin" ON public."property_inquiries" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "property_inquiries_insert_staff" ON public."property_inquiries" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text])) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR (assigned_to = auth.uid()))));

CREATE POLICY "property_inquiries_select_allowed" ON public."property_inquiries" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((my_role() = 'agent'::text) AND ((assigned_to = auth.uid()) OR (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = property_inquiries.client_id) AND (c.company_id = my_company()) AND (c.assigned_to = auth.uid())))))))));

CREATE POLICY "property_inquiries_update_allowed" ON public."property_inquiries" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid()))))) WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid())))));

CREATE POLICY "appointments_delete_admin" ON public."appointments" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "appointments_insert_allowed" ON public."appointments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND (agent_id = ( SELECT auth.uid() AS uid)) AND crm_repair_private.can_access_client(company_id, client_id)))));

CREATE POLICY "appointments_related_branch_boundary" ON public."appointments" AS RESTRICTIVE FOR ALL TO "authenticated" USING (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((COALESCE(branch_key, 'general'::text) = 'general'::text) OR crm_repair_private.staff_can_access_branch(company_id, branch_key))))) WITH CHECK (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((COALESCE(branch_key, 'general'::text) = 'general'::text) OR crm_repair_private.staff_can_access_branch(company_id, branch_key)))));

CREATE POLICY "appointments_select_allowed" ON public."appointments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND crm_repair_private.can_access_client(company_id, client_id)))));

CREATE POLICY "appointments_update_allowed" ON public."appointments" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND (agent_id = ( SELECT auth.uid() AS uid)) AND crm_repair_private.can_access_client(company_id, client_id))))) WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND (agent_id = ( SELECT auth.uid() AS uid)) AND crm_repair_private.can_access_client(company_id, client_id)))));

CREATE POLICY "appointment_properties_delete_admin" ON public."appointment_properties" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "appointment_properties_insert_allowed" ON public."appointment_properties" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND (EXISTS ( SELECT 1
   FROM appointments a
  WHERE ((a.id = appointment_properties.appointment_id) AND (a.company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR (a.agent_id = ( SELECT auth.uid() AS uid))))))));

CREATE POLICY "appointment_properties_select_allowed" ON public."appointment_properties" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND (EXISTS ( SELECT 1
   FROM appointments a
  WHERE ((a.id = appointment_properties.appointment_id) AND (a.company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (a.agent_id = ( SELECT auth.uid() AS uid))))))));

CREATE POLICY "appointment_properties_update_allowed" ON public."appointment_properties" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND (EXISTS ( SELECT 1
   FROM appointments a
  WHERE ((a.id = appointment_properties.appointment_id) AND (a.company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR (a.agent_id = ( SELECT auth.uid() AS uid)))))))) WITH CHECK ((company_id = ( SELECT my_company() AS my_company)));

CREATE POLICY "activities_delete_admin" ON public."activities" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "activities_insert_staff" ON public."activities" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = my_company()) AND (user_id = auth.uid()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text]))));

CREATE POLICY "activities_related_branch_boundary" ON public."activities" AS RESTRICTIVE FOR ALL TO "authenticated" USING (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((property_id IS NULL) OR (EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = activities.property_id) AND (p.company_id = activities.company_id) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key))))) AND ((deal_id IS NULL) OR (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = activities.deal_id) AND (d.company_id = activities.company_id))))) AND ((appointment_id IS NULL) OR (EXISTS ( SELECT 1
   FROM appointments a
  WHERE ((a.id = activities.appointment_id) AND (a.company_id = activities.company_id)))))))) WITH CHECK (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((property_id IS NULL) OR (EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = activities.property_id) AND (p.company_id = activities.company_id) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key))))) AND ((deal_id IS NULL) OR (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = activities.deal_id) AND (d.company_id = activities.company_id))))) AND ((appointment_id IS NULL) OR (EXISTS ( SELECT 1
   FROM appointments a
  WHERE ((a.id = activities.appointment_id) AND (a.company_id = activities.company_id))))))));

CREATE POLICY "activities_select_allowed" ON public."activities" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (user_id = auth.uid()) OR ((my_role() = 'agent'::text) AND (client_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = activities.client_id) AND (c.company_id = my_company()) AND (c.assigned_to = auth.uid()))))) OR ((my_role() = 'agent'::text) AND (deal_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = activities.deal_id) AND (d.company_id = my_company()) AND (d.agent_id = auth.uid()))))))));

CREATE POLICY "rejection_reasons_manage" ON public."rejection_reasons" AS PERMISSIVE FOR ALL TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])))) WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "rejection_reasons_select" ON public."rejection_reasons" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((company_id = ( SELECT my_company() AS my_company)));

CREATE POLICY "property_rejections_delete" ON public."property_rejection_reasons" AS PERMISSIVE FOR DELETE TO PUBLIC USING (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND ((EXISTS ( SELECT 1
   FROM client_requests r
  WHERE ((r.id = property_rejection_reasons.request_id) AND (r.company_id = ( SELECT my_company() AS my_company)) AND (r.assigned_to = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM property_inquiries pi
  WHERE ((pi.id = property_rejection_reasons.property_inquiry_id) AND (pi.company_id = ( SELECT my_company() AS my_company)) AND (pi.assigned_to = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = property_rejection_reasons.client_id) AND (c.company_id = ( SELECT my_company() AS my_company)) AND (c.assigned_to = ( SELECT auth.uid() AS uid))))))))));

CREATE POLICY "property_rejections_insert" ON public."property_rejection_reasons" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND ((EXISTS ( SELECT 1
   FROM client_requests r
  WHERE ((r.id = property_rejection_reasons.request_id) AND (r.company_id = ( SELECT my_company() AS my_company)) AND (r.assigned_to = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM property_inquiries pi
  WHERE ((pi.id = property_rejection_reasons.property_inquiry_id) AND (pi.company_id = ( SELECT my_company() AS my_company)) AND (pi.assigned_to = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = property_rejection_reasons.client_id) AND (c.company_id = ( SELECT my_company() AS my_company)) AND (c.assigned_to = ( SELECT auth.uid() AS uid))))))))));

CREATE POLICY "property_rejections_select" ON public."property_rejection_reasons" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND ((EXISTS ( SELECT 1
   FROM client_requests r
  WHERE ((r.id = property_rejection_reasons.request_id) AND (r.company_id = ( SELECT my_company() AS my_company)) AND (r.assigned_to = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM property_inquiries pi
  WHERE ((pi.id = property_rejection_reasons.property_inquiry_id) AND (pi.company_id = ( SELECT my_company() AS my_company)) AND (pi.assigned_to = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = property_rejection_reasons.client_id) AND (c.company_id = ( SELECT my_company() AS my_company)) AND (c.assigned_to = ( SELECT auth.uid() AS uid))))))))));

CREATE POLICY "property_rejections_update" ON public."property_rejection_reasons" AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND ((EXISTS ( SELECT 1
   FROM client_requests r
  WHERE ((r.id = property_rejection_reasons.request_id) AND (r.company_id = ( SELECT my_company() AS my_company)) AND (r.assigned_to = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM property_inquiries pi
  WHERE ((pi.id = property_rejection_reasons.property_inquiry_id) AND (pi.company_id = ( SELECT my_company() AS my_company)) AND (pi.assigned_to = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = property_rejection_reasons.client_id) AND (c.company_id = ( SELECT my_company() AS my_company)) AND (c.assigned_to = ( SELECT auth.uid() AS uid)))))))))) WITH CHECK ((company_id = ( SELECT my_company() AS my_company)));

CREATE POLICY "property_action_reviews_delete" ON public."property_action_reviews" AS PERMISSIVE FOR DELETE TO PUBLIC USING (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "property_action_reviews_insert" ON public."property_action_reviews" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text]))));

CREATE POLICY "property_action_reviews_select" ON public."property_action_reviews" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text, 'viewer'::text]))));

CREATE POLICY "property_action_reviews_update" ON public."property_action_reviews" AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text])))) WITH CHECK ((company_id = ( SELECT my_company() AS my_company)));

CREATE POLICY "measurement_periods_manage" ON public."measurement_periods" AS PERMISSIVE FOR ALL TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])))) WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "measurement_periods_select" ON public."measurement_periods" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((company_id = ( SELECT my_company() AS my_company)));

CREATE POLICY "measurement_targets_manage" ON public."measurement_targets" AS PERMISSIVE FOR ALL TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])))) WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "measurement_targets_select" ON public."measurement_targets" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((company_id = ( SELECT my_company() AS my_company)));

CREATE POLICY "whatsapp_onboarding_events_select" ON public."whatsapp_onboarding_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "deal_stage_history_select_company" ON public."deal_stage_history" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = deal_stage_history.deal_id) AND (d.company_id = deal_stage_history.company_id))))));

CREATE POLICY "properties_delete_admin" ON public."properties" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "properties_insert_branch" ON public."properties" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text])) AND crm_repair_private.staff_can_access_branch(company_id, branch_key)));

CREATE POLICY "properties_select_branch" ON public."properties" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND crm_repair_private.staff_can_access_branch(company_id, branch_key)));

CREATE POLICY "properties_update_branch" ON public."properties" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text])) AND crm_repair_private.staff_can_access_branch(company_id, branch_key))) WITH CHECK (((company_id = my_company()) AND crm_repair_private.staff_can_access_branch(company_id, branch_key)));

CREATE POLICY "whatsapp_automation_events_insert" ON public."whatsapp_automation_events" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text]))));

CREATE POLICY "whatsapp_automation_events_select" ON public."whatsapp_automation_events" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text, 'viewer'::text]))));

CREATE POLICY "whatsapp_automation_events_update" ON public."whatsapp_automation_events" AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text])))) WITH CHECK ((company_id = ( SELECT my_company() AS my_company)));

CREATE POLICY "unmatched_property_links_select" ON public."unmatched_property_links" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND (EXISTS ( SELECT 1
   FROM whatsapp_messages m
  WHERE ((m.id = unmatched_property_links.whatsapp_message_id) AND (m.company_id = unmatched_property_links.company_id))))));

CREATE POLICY "unmatched_property_links_update" ON public."unmatched_property_links" AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = unmatched_property_links.client_id) AND (c.company_id = ( SELECT my_company() AS my_company)) AND (c.assigned_to = ( SELECT auth.uid() AS uid))))))))) WITH CHECK ((company_id = ( SELECT my_company() AS my_company)));

CREATE POLICY "client_request_assignees_manage" ON public."client_request_assignees" AS PERMISSIVE FOR ALL TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text])))) WITH CHECK (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "client_request_assignees_select" ON public."client_request_assignees" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (user_id = auth.uid()))));

CREATE POLICY "employee_targets_owner_manage" ON public."employee_monthly_targets" AS PERMISSIVE FOR ALL TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.company_id = employee_monthly_targets.company_id) AND (p.role = 'owner'::text) AND (p.is_active = true)))))) WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.company_id = employee_monthly_targets.company_id) AND (p.role = 'owner'::text) AND (p.is_active = true)))) AND (EXISTS ( SELECT 1
   FROM profiles e
  WHERE ((e.id = employee_monthly_targets.employee_id) AND (e.company_id = employee_monthly_targets.company_id) AND (e.role = 'agent'::text) AND (e.is_active = true))))));

CREATE POLICY "employee_targets_staff_read" ON public."employee_monthly_targets" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND (employee_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.is_active = true))))));

CREATE POLICY "whatsapp_followup_optouts_manage_owner" ON public."whatsapp_followup_optouts" AS PERMISSIVE FOR ALL TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'owner'::text))) WITH CHECK (((company_id = my_company()) AND (my_role() = 'owner'::text)));

CREATE POLICY "whatsapp_followup_optouts_select_admin" ON public."whatsapp_followup_optouts" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "whatsapp_template_registry_manage_owner" ON public."whatsapp_template_registry" AS PERMISSIVE FOR ALL TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'owner'::text))) WITH CHECK (((company_id = my_company()) AND (my_role() = 'owner'::text)));

CREATE POLICY "whatsapp_template_registry_select_admin" ON public."whatsapp_template_registry" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "whatsapp_followup_events_manage_owner" ON public."whatsapp_followup_events" AS PERMISSIVE FOR ALL TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'owner'::text))) WITH CHECK (((company_id = my_company()) AND (my_role() = 'owner'::text)));

CREATE POLICY "whatsapp_followup_events_select_admin" ON public."whatsapp_followup_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "whatsapp_followup_optins_manage_owner" ON public."whatsapp_followup_optins" AS PERMISSIVE FOR ALL TO "authenticated" USING (((company_id = my_company()) AND (my_role() = 'owner'::text))) WITH CHECK (((company_id = my_company()) AND (my_role() = 'owner'::text)));

CREATE POLICY "whatsapp_followup_optins_select_admin" ON public."whatsapp_followup_optins" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY "instagram_accounts_select_company" ON public."instagram_accounts" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((company_id = my_company()));

CREATE POLICY "instagram_conversations_select_company" ON public."instagram_conversations" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND ((assigned_to = auth.uid()) OR (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = instagram_conversations.client_id) AND (c.company_id = my_company()) AND (c.assigned_to = auth.uid())))))))));

CREATE POLICY "instagram_messages_select_company" ON public."instagram_messages" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((company_id = my_company()) AND (EXISTS ( SELECT 1
   FROM instagram_conversations ic
  WHERE ((ic.id = instagram_messages.conversation_id) AND (ic.company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND ((ic.assigned_to = auth.uid()) OR (EXISTS ( SELECT 1
           FROM clients c
          WHERE ((c.id = ic.client_id) AND (c.company_id = my_company()) AND (c.assigned_to = auth.uid()))))))))))));

CREATE POLICY "property_message_attributions_read" ON public."property_message_attributions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((company_id = ( SELECT my_company() AS my_company)) AND (EXISTS ( SELECT 1
   FROM whatsapp_messages wm
  WHERE ((wm.id = property_message_attributions.message_id) AND (wm.company_id = property_message_attributions.company_id))))));

CREATE VIEW public."crm_monthly_automation_cost_monitor" WITH (security_invoker=true) AS  WITH months AS (
         SELECT date_trunc('month'::text, now())::date AS month_start
        ), wa AS (
         SELECT date_trunc('month'::text, m.message_timestamp)::date AS month_start,
            count(*) FILTER (WHERE m.direction = 'inbound'::text) AS inbound_messages,
            count(*) FILTER (WHERE m.direction = 'outbound'::text) AS outbound_messages,
            count(*) FILTER (WHERE m.direction = 'outbound'::text AND m.actor_type = 'automated'::text) AS automated_outbound_messages,
            count(*) FILTER (WHERE m.direction = 'outbound'::text AND m.channel_source = 'crm_followup'::text AND m.message_type = 'template'::text AND (COALESCE(m.delivery_status, 'sent'::text) = ANY (ARRAY['sent'::text, 'delivered'::text, 'read'::text]))) AS followup_template_messages,
            count(*) FILTER (WHERE m.direction = 'outbound'::text AND m.channel_source = 'crm_followup'::text AND m.message_type <> 'template'::text) AS followup_service_messages,
            count(*) FILTER (WHERE m.ai_processed_at IS NOT NULL) AS ai_processed_messages,
            count(*) FILTER (WHERE m.transcription_status = 'completed'::text) AS transcribed_audio_messages
           FROM whatsapp_messages m
          WHERE m.company_id = (( SELECT my_company() AS my_company))
          GROUP BY (date_trunc('month'::text, m.message_timestamp)::date)
        ), fu AS (
         SELECT date_trunc('month'::text, COALESCE(e.sent_at, e.created_at))::date AS month_start,
            count(*) FILTER (WHERE e.status = ANY (ARRAY['sent'::text, 'delivered'::text, 'read'::text, 'responded'::text])) AS followup_events_sent,
            count(*) FILTER (WHERE e.send_mode = 'template'::text AND (e.status = ANY (ARRAY['sent'::text, 'delivered'::text, 'read'::text, 'responded'::text]))) AS paid_template_events,
            count(*) FILTER (WHERE e.send_mode = 'service'::text AND (e.status = ANY (ARRAY['sent'::text, 'delivered'::text, 'read'::text, 'responded'::text]))) AS service_followup_events
           FROM whatsapp_followup_events e
          WHERE e.company_id = (( SELECT my_company() AS my_company))
          GROUP BY (date_trunc('month'::text, COALESCE(e.sent_at, e.created_at))::date)
        )
 SELECT COALESCE(wa.month_start, fu.month_start, months.month_start) AS month_start,
    COALESCE(wa.inbound_messages, 0::bigint) AS inbound_messages,
    COALESCE(wa.outbound_messages, 0::bigint) AS outbound_messages,
    COALESCE(wa.automated_outbound_messages, 0::bigint) AS automated_outbound_messages,
    COALESCE(wa.followup_template_messages, 0::bigint) AS followup_template_messages,
    COALESCE(wa.followup_service_messages, 0::bigint) AS followup_service_messages,
    COALESCE(fu.followup_events_sent, 0::bigint) AS followup_events_sent,
    COALESCE(fu.paid_template_events, 0::bigint) AS paid_template_events,
    COALESCE(fu.service_followup_events, 0::bigint) AS service_followup_events,
    COALESCE(wa.ai_processed_messages, 0::bigint) AS ai_processed_messages,
    COALESCE(wa.transcribed_audio_messages, 0::bigint) AS transcribed_audio_messages,
    round(COALESCE(fu.paid_template_events, 0::bigint)::numeric * 0.0341, 4) AS estimated_whatsapp_usd_current_rate,
    round(COALESCE(fu.paid_template_events, 0::bigint)::numeric * 0.0341 * 0.3845, 4) AS estimated_whatsapp_omr_current_rate,
    'WhatsApp estimate uses Oman marketing rate $0.0341 per delivered template message as of 2026-09-16. Service messages are treated as $0 for the current September rate period. OpenAI exact token cost is read from the OpenAI API billing/usage dashboard; ai_processed_messages is a CRM activity count, not token billing.'::text AS pricing_note
   FROM months
     FULL JOIN wa ON wa.month_start = months.month_start
     FULL JOIN fu ON fu.month_start = COALESCE(months.month_start, wa.month_start);

CREATE VIEW public."property_instagram_analytics" WITH (security_invoker=true) AS  SELECT company_id,
    property_id,
    count(*)::integer AS link_count,
    count(*) FILTER (WHERE sync_status = 'synced'::text)::integer AS synced_link_count,
    count(*) FILTER (WHERE sync_status = 'error'::text)::integer AS failed_link_count,
    sum(COALESCE(views, plays)) AS total_views,
    COALESCE(sum(COALESCE(plays, 0)), 0::bigint) AS total_plays,
    COALESCE(sum(COALESCE(reach, 0)), 0::bigint) AS total_reach,
    COALESCE(sum(COALESCE(likes, 0)), 0::bigint) AS total_likes,
    COALESCE(sum(COALESCE(comments, 0)), 0::bigint) AS total_comments,
    COALESCE(sum(COALESCE(shares, 0)), 0::bigint) AS total_shares,
    COALESCE(sum(COALESCE(saves, 0)), 0::bigint) AS total_saves,
    COALESCE(sum(COALESCE(total_interactions, 0)), 0::bigint) AS total_interactions,
    COALESCE(sum(COALESCE(watch_time_ms, 0::bigint)), 0::numeric)::bigint AS total_watch_time_ms,
    COALESCE(sum(COALESCE(replays, 0)), 0::bigint) AS total_replays,
    max(last_synced_at) AS last_synced_at,
    jsonb_agg(jsonb_build_object('event_id', id, 'url', url, 'shortcode', link_key, 'media_id', instagram_media_id, 'published_at', published_at, 'views', COALESCE(views, plays), 'plays', plays, 'reach', reach, 'likes', likes, 'comments', comments, 'shares', shares, 'saves', saves, 'interactions', total_interactions, 'watch_time_ms', watch_time_ms, 'avg_watch_time_ms', avg_watch_time_ms, 'replays', replays, 'sync_status', sync_status, 'sync_error', sync_error, 'last_synced_at', last_synced_at) ORDER BY published_at DESC NULLS LAST, created_at DESC) AS links
   FROM property_marketing_events
  WHERE channel = 'instagram'::text AND url IS NOT NULL
  GROUP BY company_id, property_id;

CREATE VIEW public."crm_properties_access" WITH (security_barrier=true) AS  SELECT id,
    company_id,
    added_by,
    title,
    type,
    area,
    price,
    bedrooms,
    bathrooms,
    land_size,
    built_size,
    status,
    description,
    images,
    views_count,
    inquiries_count,
    created_at,
    updated_at,
    owner_client_id,
    archived,
    archived_at,
    archived_by,
    owner_id,
        CASE
            WHEN my_role() = 'owner'::text THEN owner_net
            ELSE NULL::numeric
        END AS owner_net,
    wilayat,
    source_type,
    marketing_status,
        CASE
            WHEN my_role() = 'owner'::text THEN expected_commission
            ELSE NULL::numeric
        END AS expected_commission,
    property_code,
    internal_name,
    branch_key,
    availability_checked_at,
    performance_tracking_started_at,
    photography_status,
    photography_reason,
    photography_required_at,
    photography_completed_at,
    marketing_review_status,
    marketing_reviewed_at,
    marketing_review_note,
    last_ai_recommendation,
    last_ai_recommendation_at,
    public_details,
    map_url,
    has_listing_agreement,
    agreement_start_date,
    agreement_duration_months,
    agreement_end_date,
    agreement_reminder_days,
    sourced_by
   FROM properties t
  WHERE company_id = my_company() AND crm_repair_private.staff_can_access_branch(company_id, branch_key);

CREATE VIEW public."crm_deals_access" WITH (security_barrier=true) AS  SELECT id,
    company_id,
    client_id,
    property_id,
    agent_id,
    stage,
    deal_value,
    deposit_amount,
    closing_probability,
    expected_close_date,
    bank_financing,
    notes,
    closed_at,
        CASE
            WHEN my_role() = 'owner'::text THEN company_commission
            ELSE NULL::numeric
        END AS company_commission,
        CASE
            WHEN my_role() = 'owner'::text THEN agent_commission
            ELSE NULL::numeric
        END AS agent_commission,
    created_at,
    updated_at,
        CASE
            WHEN my_role() = 'owner'::text THEN commission_total
            ELSE NULL::numeric
        END AS commission_total,
        CASE
            WHEN my_role() = 'owner'::text THEN company_share
            ELSE NULL::numeric
        END AS company_share,
        CASE
            WHEN my_role() = 'owner'::text THEN agent_share
            ELSE NULL::numeric
        END AS agent_share,
        CASE
            WHEN my_role() = 'owner'::text THEN commission_status
            ELSE NULL::text
        END AS commission_status,
    broker_id,
        CASE
            WHEN my_role() = 'owner'::text THEN broker_commission
            ELSE NULL::numeric
        END AS broker_commission,
    request_id,
    viewing_id,
    lost_reason_id,
    lost_reason_note,
    lost_from_stage,
    lost_at,
    entry_mode,
        CASE
            WHEN my_role() = 'owner'::text THEN commission_received_at
            ELSE NULL::timestamp with time zone
        END AS commission_received_at,
        CASE
            WHEN my_role() = 'owner'::text THEN employee_commission_percent
            ELSE NULL::numeric
        END AS employee_commission_percent
   FROM deals t
  WHERE company_id = my_company() AND (property_id IS NULL OR (EXISTS ( SELECT 1
           FROM properties p
          WHERE p.id = t.property_id AND p.company_id = t.company_id AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)))) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR my_role() = 'agent'::text AND agent_id = auth.uid()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (client_id IS NULL OR crm_repair_private.can_access_client(company_id, client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id, request_id)));

GRANT INSERT ON public."events" TO "anon";

GRANT SELECT ON public."events" TO "anon";

GRANT UPDATE ON public."events" TO "anon";

GRANT DELETE ON public."events" TO "anon";

GRANT TRUNCATE ON public."events" TO "anon";

GRANT REFERENCES ON public."events" TO "anon";

GRANT TRIGGER ON public."events" TO "anon";

GRANT INSERT ON public."events" TO "authenticated";

GRANT SELECT ON public."events" TO "authenticated";

GRANT UPDATE ON public."events" TO "authenticated";

GRANT DELETE ON public."events" TO "authenticated";

GRANT TRUNCATE ON public."events" TO "authenticated";

GRANT REFERENCES ON public."events" TO "authenticated";

GRANT TRIGGER ON public."events" TO "authenticated";

GRANT INSERT ON public."events" TO "service_role";

GRANT SELECT ON public."events" TO "service_role";

GRANT UPDATE ON public."events" TO "service_role";

GRANT DELETE ON public."events" TO "service_role";

GRANT TRUNCATE ON public."events" TO "service_role";

GRANT REFERENCES ON public."events" TO "service_role";

GRANT TRIGGER ON public."events" TO "service_role";

GRANT INSERT ON public."profiles" TO "anon";

GRANT SELECT ON public."profiles" TO "anon";

GRANT UPDATE ON public."profiles" TO "anon";

GRANT DELETE ON public."profiles" TO "anon";

GRANT TRUNCATE ON public."profiles" TO "anon";

GRANT REFERENCES ON public."profiles" TO "anon";

GRANT TRIGGER ON public."profiles" TO "anon";

GRANT INSERT ON public."profiles" TO "authenticated";

GRANT SELECT ON public."profiles" TO "authenticated";

GRANT UPDATE ON public."profiles" TO "authenticated";

GRANT DELETE ON public."profiles" TO "authenticated";

GRANT TRUNCATE ON public."profiles" TO "authenticated";

GRANT REFERENCES ON public."profiles" TO "authenticated";

GRANT TRIGGER ON public."profiles" TO "authenticated";

GRANT INSERT ON public."profiles" TO "service_role";

GRANT SELECT ON public."profiles" TO "service_role";

GRANT UPDATE ON public."profiles" TO "service_role";

GRANT DELETE ON public."profiles" TO "service_role";

GRANT TRUNCATE ON public."profiles" TO "service_role";

GRANT REFERENCES ON public."profiles" TO "service_role";

GRANT TRIGGER ON public."profiles" TO "service_role";

GRANT INSERT ON public."companies" TO "anon";

GRANT SELECT ON public."companies" TO "anon";

GRANT UPDATE ON public."companies" TO "anon";

GRANT DELETE ON public."companies" TO "anon";

GRANT TRUNCATE ON public."companies" TO "anon";

GRANT REFERENCES ON public."companies" TO "anon";

GRANT TRIGGER ON public."companies" TO "anon";

GRANT INSERT ON public."companies" TO "authenticated";

GRANT SELECT ON public."companies" TO "authenticated";

GRANT UPDATE ON public."companies" TO "authenticated";

GRANT DELETE ON public."companies" TO "authenticated";

GRANT TRUNCATE ON public."companies" TO "authenticated";

GRANT REFERENCES ON public."companies" TO "authenticated";

GRANT TRIGGER ON public."companies" TO "authenticated";

GRANT INSERT ON public."companies" TO "service_role";

GRANT SELECT ON public."companies" TO "service_role";

GRANT UPDATE ON public."companies" TO "service_role";

GRANT DELETE ON public."companies" TO "service_role";

GRANT TRUNCATE ON public."companies" TO "service_role";

GRANT REFERENCES ON public."companies" TO "service_role";

GRANT TRIGGER ON public."companies" TO "service_role";

GRANT INSERT ON public."deals" TO "anon";

GRANT UPDATE ON public."deals" TO "anon";

GRANT DELETE ON public."deals" TO "anon";

GRANT TRUNCATE ON public."deals" TO "anon";

GRANT REFERENCES ON public."deals" TO "anon";

GRANT TRIGGER ON public."deals" TO "anon";

GRANT INSERT ON public."deals" TO "authenticated";

GRANT UPDATE ON public."deals" TO "authenticated";

GRANT DELETE ON public."deals" TO "authenticated";

GRANT TRUNCATE ON public."deals" TO "authenticated";

GRANT REFERENCES ON public."deals" TO "authenticated";

GRANT TRIGGER ON public."deals" TO "authenticated";

GRANT INSERT ON public."deals" TO "service_role";

GRANT SELECT ON public."deals" TO "service_role";

GRANT UPDATE ON public."deals" TO "service_role";

GRANT DELETE ON public."deals" TO "service_role";

GRANT TRUNCATE ON public."deals" TO "service_role";

GRANT REFERENCES ON public."deals" TO "service_role";

GRANT TRIGGER ON public."deals" TO "service_role";

GRANT INSERT ON public."notifications" TO "anon";

GRANT SELECT ON public."notifications" TO "anon";

GRANT UPDATE ON public."notifications" TO "anon";

GRANT DELETE ON public."notifications" TO "anon";

GRANT TRUNCATE ON public."notifications" TO "anon";

GRANT REFERENCES ON public."notifications" TO "anon";

GRANT TRIGGER ON public."notifications" TO "anon";

GRANT INSERT ON public."notifications" TO "authenticated";

GRANT SELECT ON public."notifications" TO "authenticated";

GRANT UPDATE ON public."notifications" TO "authenticated";

GRANT DELETE ON public."notifications" TO "authenticated";

GRANT TRUNCATE ON public."notifications" TO "authenticated";

GRANT REFERENCES ON public."notifications" TO "authenticated";

GRANT TRIGGER ON public."notifications" TO "authenticated";

GRANT INSERT ON public."notifications" TO "service_role";

GRANT SELECT ON public."notifications" TO "service_role";

GRANT UPDATE ON public."notifications" TO "service_role";

GRANT DELETE ON public."notifications" TO "service_role";

GRANT TRUNCATE ON public."notifications" TO "service_role";

GRANT REFERENCES ON public."notifications" TO "service_role";

GRANT TRIGGER ON public."notifications" TO "service_role";

GRANT INSERT ON public."expenses" TO "anon";

GRANT SELECT ON public."expenses" TO "anon";

GRANT UPDATE ON public."expenses" TO "anon";

GRANT DELETE ON public."expenses" TO "anon";

GRANT TRUNCATE ON public."expenses" TO "anon";

GRANT REFERENCES ON public."expenses" TO "anon";

GRANT TRIGGER ON public."expenses" TO "anon";

GRANT INSERT ON public."expenses" TO "authenticated";

GRANT SELECT ON public."expenses" TO "authenticated";

GRANT UPDATE ON public."expenses" TO "authenticated";

GRANT DELETE ON public."expenses" TO "authenticated";

GRANT TRUNCATE ON public."expenses" TO "authenticated";

GRANT REFERENCES ON public."expenses" TO "authenticated";

GRANT TRIGGER ON public."expenses" TO "authenticated";

GRANT INSERT ON public."expenses" TO "service_role";

GRANT SELECT ON public."expenses" TO "service_role";

GRANT UPDATE ON public."expenses" TO "service_role";

GRANT DELETE ON public."expenses" TO "service_role";

GRANT TRUNCATE ON public."expenses" TO "service_role";

GRANT REFERENCES ON public."expenses" TO "service_role";

GRANT TRIGGER ON public."expenses" TO "service_role";

GRANT INSERT ON public."owners" TO "anon";

GRANT SELECT ON public."owners" TO "anon";

GRANT UPDATE ON public."owners" TO "anon";

GRANT DELETE ON public."owners" TO "anon";

GRANT TRUNCATE ON public."owners" TO "anon";

GRANT REFERENCES ON public."owners" TO "anon";

GRANT TRIGGER ON public."owners" TO "anon";

GRANT INSERT ON public."owners" TO "authenticated";

GRANT SELECT ON public."owners" TO "authenticated";

GRANT UPDATE ON public."owners" TO "authenticated";

GRANT DELETE ON public."owners" TO "authenticated";

GRANT TRUNCATE ON public."owners" TO "authenticated";

GRANT REFERENCES ON public."owners" TO "authenticated";

GRANT TRIGGER ON public."owners" TO "authenticated";

GRANT INSERT ON public."owners" TO "service_role";

GRANT SELECT ON public."owners" TO "service_role";

GRANT UPDATE ON public."owners" TO "service_role";

GRANT DELETE ON public."owners" TO "service_role";

GRANT TRUNCATE ON public."owners" TO "service_role";

GRANT REFERENCES ON public."owners" TO "service_role";

GRANT TRIGGER ON public."owners" TO "service_role";

GRANT INSERT ON public."company_lead_routes" TO "anon";

GRANT SELECT ON public."company_lead_routes" TO "anon";

GRANT UPDATE ON public."company_lead_routes" TO "anon";

GRANT DELETE ON public."company_lead_routes" TO "anon";

GRANT TRUNCATE ON public."company_lead_routes" TO "anon";

GRANT REFERENCES ON public."company_lead_routes" TO "anon";

GRANT TRIGGER ON public."company_lead_routes" TO "anon";

GRANT INSERT ON public."company_lead_routes" TO "authenticated";

GRANT SELECT ON public."company_lead_routes" TO "authenticated";

GRANT UPDATE ON public."company_lead_routes" TO "authenticated";

GRANT DELETE ON public."company_lead_routes" TO "authenticated";

GRANT TRUNCATE ON public."company_lead_routes" TO "authenticated";

GRANT REFERENCES ON public."company_lead_routes" TO "authenticated";

GRANT TRIGGER ON public."company_lead_routes" TO "authenticated";

GRANT INSERT ON public."company_lead_routes" TO "service_role";

GRANT SELECT ON public."company_lead_routes" TO "service_role";

GRANT UPDATE ON public."company_lead_routes" TO "service_role";

GRANT DELETE ON public."company_lead_routes" TO "service_role";

GRANT TRUNCATE ON public."company_lead_routes" TO "service_role";

GRANT REFERENCES ON public."company_lead_routes" TO "service_role";

GRANT TRIGGER ON public."company_lead_routes" TO "service_role";

GRANT INSERT ON public."deposits" TO "anon";

GRANT SELECT ON public."deposits" TO "anon";

GRANT UPDATE ON public."deposits" TO "anon";

GRANT DELETE ON public."deposits" TO "anon";

GRANT TRUNCATE ON public."deposits" TO "anon";

GRANT REFERENCES ON public."deposits" TO "anon";

GRANT TRIGGER ON public."deposits" TO "anon";

GRANT INSERT ON public."deposits" TO "authenticated";

GRANT SELECT ON public."deposits" TO "authenticated";

GRANT UPDATE ON public."deposits" TO "authenticated";

GRANT DELETE ON public."deposits" TO "authenticated";

GRANT TRUNCATE ON public."deposits" TO "authenticated";

GRANT REFERENCES ON public."deposits" TO "authenticated";

GRANT TRIGGER ON public."deposits" TO "authenticated";

GRANT INSERT ON public."deposits" TO "service_role";

GRANT SELECT ON public."deposits" TO "service_role";

GRANT UPDATE ON public."deposits" TO "service_role";

GRANT DELETE ON public."deposits" TO "service_role";

GRANT TRUNCATE ON public."deposits" TO "service_role";

GRANT REFERENCES ON public."deposits" TO "service_role";

GRANT TRIGGER ON public."deposits" TO "service_role";

GRANT INSERT ON public."viewings" TO "anon";

GRANT SELECT ON public."viewings" TO "anon";

GRANT UPDATE ON public."viewings" TO "anon";

GRANT DELETE ON public."viewings" TO "anon";

GRANT TRUNCATE ON public."viewings" TO "anon";

GRANT REFERENCES ON public."viewings" TO "anon";

GRANT TRIGGER ON public."viewings" TO "anon";

GRANT INSERT ON public."viewings" TO "authenticated";

GRANT SELECT ON public."viewings" TO "authenticated";

GRANT UPDATE ON public."viewings" TO "authenticated";

GRANT DELETE ON public."viewings" TO "authenticated";

GRANT TRUNCATE ON public."viewings" TO "authenticated";

GRANT REFERENCES ON public."viewings" TO "authenticated";

GRANT TRIGGER ON public."viewings" TO "authenticated";

GRANT INSERT ON public."viewings" TO "service_role";

GRANT SELECT ON public."viewings" TO "service_role";

GRANT UPDATE ON public."viewings" TO "service_role";

GRANT DELETE ON public."viewings" TO "service_role";

GRANT TRUNCATE ON public."viewings" TO "service_role";

GRANT REFERENCES ON public."viewings" TO "service_role";

GRANT TRIGGER ON public."viewings" TO "service_role";

GRANT INSERT ON public."tasks" TO "anon";

GRANT SELECT ON public."tasks" TO "anon";

GRANT UPDATE ON public."tasks" TO "anon";

GRANT DELETE ON public."tasks" TO "anon";

GRANT TRUNCATE ON public."tasks" TO "anon";

GRANT REFERENCES ON public."tasks" TO "anon";

GRANT TRIGGER ON public."tasks" TO "anon";

GRANT INSERT ON public."tasks" TO "authenticated";

GRANT SELECT ON public."tasks" TO "authenticated";

GRANT UPDATE ON public."tasks" TO "authenticated";

GRANT DELETE ON public."tasks" TO "authenticated";

GRANT TRUNCATE ON public."tasks" TO "authenticated";

GRANT REFERENCES ON public."tasks" TO "authenticated";

GRANT TRIGGER ON public."tasks" TO "authenticated";

GRANT INSERT ON public."tasks" TO "service_role";

GRANT SELECT ON public."tasks" TO "service_role";

GRANT UPDATE ON public."tasks" TO "service_role";

GRANT DELETE ON public."tasks" TO "service_role";

GRANT TRUNCATE ON public."tasks" TO "service_role";

GRANT REFERENCES ON public."tasks" TO "service_role";

GRANT TRIGGER ON public."tasks" TO "service_role";

GRANT INSERT ON public."clients" TO "anon";

GRANT SELECT ON public."clients" TO "anon";

GRANT UPDATE ON public."clients" TO "anon";

GRANT DELETE ON public."clients" TO "anon";

GRANT TRUNCATE ON public."clients" TO "anon";

GRANT REFERENCES ON public."clients" TO "anon";

GRANT TRIGGER ON public."clients" TO "anon";

GRANT INSERT ON public."clients" TO "authenticated";

GRANT SELECT ON public."clients" TO "authenticated";

GRANT UPDATE ON public."clients" TO "authenticated";

GRANT DELETE ON public."clients" TO "authenticated";

GRANT TRUNCATE ON public."clients" TO "authenticated";

GRANT REFERENCES ON public."clients" TO "authenticated";

GRANT TRIGGER ON public."clients" TO "authenticated";

GRANT INSERT ON public."clients" TO "service_role";

GRANT SELECT ON public."clients" TO "service_role";

GRANT UPDATE ON public."clients" TO "service_role";

GRANT DELETE ON public."clients" TO "service_role";

GRANT TRUNCATE ON public."clients" TO "service_role";

GRANT REFERENCES ON public."clients" TO "service_role";

GRANT TRIGGER ON public."clients" TO "service_role";

GRANT INSERT ON public."company_invites" TO "anon";

GRANT SELECT ON public."company_invites" TO "anon";

GRANT UPDATE ON public."company_invites" TO "anon";

GRANT DELETE ON public."company_invites" TO "anon";

GRANT TRUNCATE ON public."company_invites" TO "anon";

GRANT REFERENCES ON public."company_invites" TO "anon";

GRANT TRIGGER ON public."company_invites" TO "anon";

GRANT INSERT ON public."company_invites" TO "authenticated";

GRANT SELECT ON public."company_invites" TO "authenticated";

GRANT UPDATE ON public."company_invites" TO "authenticated";

GRANT DELETE ON public."company_invites" TO "authenticated";

GRANT TRUNCATE ON public."company_invites" TO "authenticated";

GRANT REFERENCES ON public."company_invites" TO "authenticated";

GRANT TRIGGER ON public."company_invites" TO "authenticated";

GRANT INSERT ON public."company_invites" TO "service_role";

GRANT SELECT ON public."company_invites" TO "service_role";

GRANT UPDATE ON public."company_invites" TO "service_role";

GRANT DELETE ON public."company_invites" TO "service_role";

GRANT TRUNCATE ON public."company_invites" TO "service_role";

GRANT REFERENCES ON public."company_invites" TO "service_role";

GRANT TRIGGER ON public."company_invites" TO "service_role";

GRANT INSERT ON public."property_marketing_events" TO "anon";

GRANT SELECT ON public."property_marketing_events" TO "anon";

GRANT UPDATE ON public."property_marketing_events" TO "anon";

GRANT DELETE ON public."property_marketing_events" TO "anon";

GRANT TRUNCATE ON public."property_marketing_events" TO "anon";

GRANT REFERENCES ON public."property_marketing_events" TO "anon";

GRANT TRIGGER ON public."property_marketing_events" TO "anon";

GRANT INSERT ON public."property_marketing_events" TO "authenticated";

GRANT SELECT ON public."property_marketing_events" TO "authenticated";

GRANT UPDATE ON public."property_marketing_events" TO "authenticated";

GRANT DELETE ON public."property_marketing_events" TO "authenticated";

GRANT TRUNCATE ON public."property_marketing_events" TO "authenticated";

GRANT REFERENCES ON public."property_marketing_events" TO "authenticated";

GRANT TRIGGER ON public."property_marketing_events" TO "authenticated";

GRANT INSERT ON public."property_marketing_events" TO "service_role";

GRANT SELECT ON public."property_marketing_events" TO "service_role";

GRANT UPDATE ON public."property_marketing_events" TO "service_role";

GRANT DELETE ON public."property_marketing_events" TO "service_role";

GRANT TRUNCATE ON public."property_marketing_events" TO "service_role";

GRANT REFERENCES ON public."property_marketing_events" TO "service_role";

GRANT TRIGGER ON public."property_marketing_events" TO "service_role";

GRANT INSERT ON public."whatsapp_conversations" TO "anon";

GRANT SELECT ON public."whatsapp_conversations" TO "anon";

GRANT UPDATE ON public."whatsapp_conversations" TO "anon";

GRANT DELETE ON public."whatsapp_conversations" TO "anon";

GRANT TRUNCATE ON public."whatsapp_conversations" TO "anon";

GRANT REFERENCES ON public."whatsapp_conversations" TO "anon";

GRANT TRIGGER ON public."whatsapp_conversations" TO "anon";

GRANT INSERT ON public."whatsapp_conversations" TO "authenticated";

GRANT SELECT ON public."whatsapp_conversations" TO "authenticated";

GRANT UPDATE ON public."whatsapp_conversations" TO "authenticated";

GRANT DELETE ON public."whatsapp_conversations" TO "authenticated";

GRANT TRUNCATE ON public."whatsapp_conversations" TO "authenticated";

GRANT REFERENCES ON public."whatsapp_conversations" TO "authenticated";

GRANT TRIGGER ON public."whatsapp_conversations" TO "authenticated";

GRANT INSERT ON public."whatsapp_conversations" TO "service_role";

GRANT SELECT ON public."whatsapp_conversations" TO "service_role";

GRANT UPDATE ON public."whatsapp_conversations" TO "service_role";

GRANT DELETE ON public."whatsapp_conversations" TO "service_role";

GRANT TRUNCATE ON public."whatsapp_conversations" TO "service_role";

GRANT REFERENCES ON public."whatsapp_conversations" TO "service_role";

GRANT TRIGGER ON public."whatsapp_conversations" TO "service_role";

GRANT INSERT ON public."whatsapp_messages" TO "anon";

GRANT SELECT ON public."whatsapp_messages" TO "anon";

GRANT UPDATE ON public."whatsapp_messages" TO "anon";

GRANT DELETE ON public."whatsapp_messages" TO "anon";

GRANT TRUNCATE ON public."whatsapp_messages" TO "anon";

GRANT REFERENCES ON public."whatsapp_messages" TO "anon";

GRANT TRIGGER ON public."whatsapp_messages" TO "anon";

GRANT INSERT ON public."whatsapp_messages" TO "authenticated";

GRANT SELECT ON public."whatsapp_messages" TO "authenticated";

GRANT UPDATE ON public."whatsapp_messages" TO "authenticated";

GRANT DELETE ON public."whatsapp_messages" TO "authenticated";

GRANT TRUNCATE ON public."whatsapp_messages" TO "authenticated";

GRANT REFERENCES ON public."whatsapp_messages" TO "authenticated";

GRANT TRIGGER ON public."whatsapp_messages" TO "authenticated";

GRANT INSERT ON public."whatsapp_messages" TO "service_role";

GRANT SELECT ON public."whatsapp_messages" TO "service_role";

GRANT UPDATE ON public."whatsapp_messages" TO "service_role";

GRANT DELETE ON public."whatsapp_messages" TO "service_role";

GRANT TRUNCATE ON public."whatsapp_messages" TO "service_role";

GRANT REFERENCES ON public."whatsapp_messages" TO "service_role";

GRANT TRIGGER ON public."whatsapp_messages" TO "service_role";

GRANT INSERT ON public."whatsapp_webhook_events" TO "anon";

GRANT SELECT ON public."whatsapp_webhook_events" TO "anon";

GRANT UPDATE ON public."whatsapp_webhook_events" TO "anon";

GRANT DELETE ON public."whatsapp_webhook_events" TO "anon";

GRANT TRUNCATE ON public."whatsapp_webhook_events" TO "anon";

GRANT REFERENCES ON public."whatsapp_webhook_events" TO "anon";

GRANT TRIGGER ON public."whatsapp_webhook_events" TO "anon";

GRANT INSERT ON public."whatsapp_webhook_events" TO "authenticated";

GRANT SELECT ON public."whatsapp_webhook_events" TO "authenticated";

GRANT UPDATE ON public."whatsapp_webhook_events" TO "authenticated";

GRANT DELETE ON public."whatsapp_webhook_events" TO "authenticated";

GRANT TRUNCATE ON public."whatsapp_webhook_events" TO "authenticated";

GRANT REFERENCES ON public."whatsapp_webhook_events" TO "authenticated";

GRANT TRIGGER ON public."whatsapp_webhook_events" TO "authenticated";

GRANT INSERT ON public."whatsapp_webhook_events" TO "service_role";

GRANT SELECT ON public."whatsapp_webhook_events" TO "service_role";

GRANT UPDATE ON public."whatsapp_webhook_events" TO "service_role";

GRANT DELETE ON public."whatsapp_webhook_events" TO "service_role";

GRANT TRUNCATE ON public."whatsapp_webhook_events" TO "service_role";

GRANT REFERENCES ON public."whatsapp_webhook_events" TO "service_role";

GRANT TRIGGER ON public."whatsapp_webhook_events" TO "service_role";

GRANT INSERT ON public."whatsapp_message_requests" TO "anon";

GRANT SELECT ON public."whatsapp_message_requests" TO "anon";

GRANT UPDATE ON public."whatsapp_message_requests" TO "anon";

GRANT DELETE ON public."whatsapp_message_requests" TO "anon";

GRANT TRUNCATE ON public."whatsapp_message_requests" TO "anon";

GRANT REFERENCES ON public."whatsapp_message_requests" TO "anon";

GRANT TRIGGER ON public."whatsapp_message_requests" TO "anon";

GRANT INSERT ON public."whatsapp_message_requests" TO "authenticated";

GRANT SELECT ON public."whatsapp_message_requests" TO "authenticated";

GRANT UPDATE ON public."whatsapp_message_requests" TO "authenticated";

GRANT DELETE ON public."whatsapp_message_requests" TO "authenticated";

GRANT TRUNCATE ON public."whatsapp_message_requests" TO "authenticated";

GRANT REFERENCES ON public."whatsapp_message_requests" TO "authenticated";

GRANT TRIGGER ON public."whatsapp_message_requests" TO "authenticated";

GRANT INSERT ON public."whatsapp_message_requests" TO "service_role";

GRANT SELECT ON public."whatsapp_message_requests" TO "service_role";

GRANT UPDATE ON public."whatsapp_message_requests" TO "service_role";

GRANT DELETE ON public."whatsapp_message_requests" TO "service_role";

GRANT TRUNCATE ON public."whatsapp_message_requests" TO "service_role";

GRANT REFERENCES ON public."whatsapp_message_requests" TO "service_role";

GRANT TRIGGER ON public."whatsapp_message_requests" TO "service_role";

GRANT INSERT ON public."client_request_events" TO "anon";

GRANT SELECT ON public."client_request_events" TO "anon";

GRANT UPDATE ON public."client_request_events" TO "anon";

GRANT DELETE ON public."client_request_events" TO "anon";

GRANT TRUNCATE ON public."client_request_events" TO "anon";

GRANT REFERENCES ON public."client_request_events" TO "anon";

GRANT TRIGGER ON public."client_request_events" TO "anon";

GRANT INSERT ON public."client_request_events" TO "authenticated";

GRANT SELECT ON public."client_request_events" TO "authenticated";

GRANT UPDATE ON public."client_request_events" TO "authenticated";

GRANT DELETE ON public."client_request_events" TO "authenticated";

GRANT TRUNCATE ON public."client_request_events" TO "authenticated";

GRANT REFERENCES ON public."client_request_events" TO "authenticated";

GRANT TRIGGER ON public."client_request_events" TO "authenticated";

GRANT INSERT ON public."client_request_events" TO "service_role";

GRANT SELECT ON public."client_request_events" TO "service_role";

GRANT UPDATE ON public."client_request_events" TO "service_role";

GRANT DELETE ON public."client_request_events" TO "service_role";

GRANT TRUNCATE ON public."client_request_events" TO "service_role";

GRANT REFERENCES ON public."client_request_events" TO "service_role";

GRANT TRIGGER ON public."client_request_events" TO "service_role";

GRANT INSERT ON public."client_requests" TO "anon";

GRANT SELECT ON public."client_requests" TO "anon";

GRANT UPDATE ON public."client_requests" TO "anon";

GRANT DELETE ON public."client_requests" TO "anon";

GRANT TRUNCATE ON public."client_requests" TO "anon";

GRANT REFERENCES ON public."client_requests" TO "anon";

GRANT TRIGGER ON public."client_requests" TO "anon";

GRANT INSERT ON public."client_requests" TO "authenticated";

GRANT SELECT ON public."client_requests" TO "authenticated";

GRANT UPDATE ON public."client_requests" TO "authenticated";

GRANT DELETE ON public."client_requests" TO "authenticated";

GRANT TRUNCATE ON public."client_requests" TO "authenticated";

GRANT REFERENCES ON public."client_requests" TO "authenticated";

GRANT TRIGGER ON public."client_requests" TO "authenticated";

GRANT INSERT ON public."client_requests" TO "service_role";

GRANT SELECT ON public."client_requests" TO "service_role";

GRANT UPDATE ON public."client_requests" TO "service_role";

GRANT DELETE ON public."client_requests" TO "service_role";

GRANT TRUNCATE ON public."client_requests" TO "service_role";

GRANT REFERENCES ON public."client_requests" TO "service_role";

GRANT TRIGGER ON public."client_requests" TO "service_role";

GRANT INSERT ON public."property_inquiries" TO "anon";

GRANT SELECT ON public."property_inquiries" TO "anon";

GRANT UPDATE ON public."property_inquiries" TO "anon";

GRANT DELETE ON public."property_inquiries" TO "anon";

GRANT TRUNCATE ON public."property_inquiries" TO "anon";

GRANT REFERENCES ON public."property_inquiries" TO "anon";

GRANT TRIGGER ON public."property_inquiries" TO "anon";

GRANT INSERT ON public."property_inquiries" TO "authenticated";

GRANT SELECT ON public."property_inquiries" TO "authenticated";

GRANT UPDATE ON public."property_inquiries" TO "authenticated";

GRANT DELETE ON public."property_inquiries" TO "authenticated";

GRANT TRUNCATE ON public."property_inquiries" TO "authenticated";

GRANT REFERENCES ON public."property_inquiries" TO "authenticated";

GRANT TRIGGER ON public."property_inquiries" TO "authenticated";

GRANT INSERT ON public."property_inquiries" TO "service_role";

GRANT SELECT ON public."property_inquiries" TO "service_role";

GRANT UPDATE ON public."property_inquiries" TO "service_role";

GRANT DELETE ON public."property_inquiries" TO "service_role";

GRANT TRUNCATE ON public."property_inquiries" TO "service_role";

GRANT REFERENCES ON public."property_inquiries" TO "service_role";

GRANT TRIGGER ON public."property_inquiries" TO "service_role";

GRANT INSERT ON public."appointments" TO "authenticated";

GRANT SELECT ON public."appointments" TO "authenticated";

GRANT UPDATE ON public."appointments" TO "authenticated";

GRANT DELETE ON public."appointments" TO "authenticated";

GRANT TRUNCATE ON public."appointments" TO "authenticated";

GRANT REFERENCES ON public."appointments" TO "authenticated";

GRANT TRIGGER ON public."appointments" TO "authenticated";

GRANT INSERT ON public."appointments" TO "service_role";

GRANT SELECT ON public."appointments" TO "service_role";

GRANT UPDATE ON public."appointments" TO "service_role";

GRANT DELETE ON public."appointments" TO "service_role";

GRANT TRUNCATE ON public."appointments" TO "service_role";

GRANT REFERENCES ON public."appointments" TO "service_role";

GRANT TRIGGER ON public."appointments" TO "service_role";

GRANT INSERT ON public."appointment_properties" TO "authenticated";

GRANT SELECT ON public."appointment_properties" TO "authenticated";

GRANT UPDATE ON public."appointment_properties" TO "authenticated";

GRANT DELETE ON public."appointment_properties" TO "authenticated";

GRANT TRUNCATE ON public."appointment_properties" TO "authenticated";

GRANT REFERENCES ON public."appointment_properties" TO "authenticated";

GRANT TRIGGER ON public."appointment_properties" TO "authenticated";

GRANT INSERT ON public."appointment_properties" TO "service_role";

GRANT SELECT ON public."appointment_properties" TO "service_role";

GRANT UPDATE ON public."appointment_properties" TO "service_role";

GRANT DELETE ON public."appointment_properties" TO "service_role";

GRANT TRUNCATE ON public."appointment_properties" TO "service_role";

GRANT REFERENCES ON public."appointment_properties" TO "service_role";

GRANT TRIGGER ON public."appointment_properties" TO "service_role";

GRANT INSERT ON public."activities" TO "anon";

GRANT SELECT ON public."activities" TO "anon";

GRANT UPDATE ON public."activities" TO "anon";

GRANT DELETE ON public."activities" TO "anon";

GRANT TRUNCATE ON public."activities" TO "anon";

GRANT REFERENCES ON public."activities" TO "anon";

GRANT TRIGGER ON public."activities" TO "anon";

GRANT INSERT ON public."activities" TO "authenticated";

GRANT SELECT ON public."activities" TO "authenticated";

GRANT UPDATE ON public."activities" TO "authenticated";

GRANT DELETE ON public."activities" TO "authenticated";

GRANT TRUNCATE ON public."activities" TO "authenticated";

GRANT REFERENCES ON public."activities" TO "authenticated";

GRANT TRIGGER ON public."activities" TO "authenticated";

GRANT INSERT ON public."activities" TO "service_role";

GRANT SELECT ON public."activities" TO "service_role";

GRANT UPDATE ON public."activities" TO "service_role";

GRANT DELETE ON public."activities" TO "service_role";

GRANT TRUNCATE ON public."activities" TO "service_role";

GRANT REFERENCES ON public."activities" TO "service_role";

GRANT TRIGGER ON public."activities" TO "service_role";

GRANT INSERT ON public."rejection_reasons" TO "authenticated";

GRANT SELECT ON public."rejection_reasons" TO "authenticated";

GRANT UPDATE ON public."rejection_reasons" TO "authenticated";

GRANT DELETE ON public."rejection_reasons" TO "authenticated";

GRANT TRUNCATE ON public."rejection_reasons" TO "authenticated";

GRANT REFERENCES ON public."rejection_reasons" TO "authenticated";

GRANT TRIGGER ON public."rejection_reasons" TO "authenticated";

GRANT INSERT ON public."rejection_reasons" TO "service_role";

GRANT SELECT ON public."rejection_reasons" TO "service_role";

GRANT UPDATE ON public."rejection_reasons" TO "service_role";

GRANT DELETE ON public."rejection_reasons" TO "service_role";

GRANT TRUNCATE ON public."rejection_reasons" TO "service_role";

GRANT REFERENCES ON public."rejection_reasons" TO "service_role";

GRANT TRIGGER ON public."rejection_reasons" TO "service_role";

GRANT INSERT ON public."property_rejection_reasons" TO "authenticated";

GRANT SELECT ON public."property_rejection_reasons" TO "authenticated";

GRANT UPDATE ON public."property_rejection_reasons" TO "authenticated";

GRANT DELETE ON public."property_rejection_reasons" TO "authenticated";

GRANT TRUNCATE ON public."property_rejection_reasons" TO "authenticated";

GRANT REFERENCES ON public."property_rejection_reasons" TO "authenticated";

GRANT TRIGGER ON public."property_rejection_reasons" TO "authenticated";

GRANT INSERT ON public."property_rejection_reasons" TO "service_role";

GRANT SELECT ON public."property_rejection_reasons" TO "service_role";

GRANT UPDATE ON public."property_rejection_reasons" TO "service_role";

GRANT DELETE ON public."property_rejection_reasons" TO "service_role";

GRANT TRUNCATE ON public."property_rejection_reasons" TO "service_role";

GRANT REFERENCES ON public."property_rejection_reasons" TO "service_role";

GRANT TRIGGER ON public."property_rejection_reasons" TO "service_role";

GRANT INSERT ON public."property_action_reviews" TO "anon";

GRANT SELECT ON public."property_action_reviews" TO "anon";

GRANT UPDATE ON public."property_action_reviews" TO "anon";

GRANT DELETE ON public."property_action_reviews" TO "anon";

GRANT TRUNCATE ON public."property_action_reviews" TO "anon";

GRANT REFERENCES ON public."property_action_reviews" TO "anon";

GRANT TRIGGER ON public."property_action_reviews" TO "anon";

GRANT INSERT ON public."property_action_reviews" TO "authenticated";

GRANT SELECT ON public."property_action_reviews" TO "authenticated";

GRANT UPDATE ON public."property_action_reviews" TO "authenticated";

GRANT DELETE ON public."property_action_reviews" TO "authenticated";

GRANT TRUNCATE ON public."property_action_reviews" TO "authenticated";

GRANT REFERENCES ON public."property_action_reviews" TO "authenticated";

GRANT TRIGGER ON public."property_action_reviews" TO "authenticated";

GRANT INSERT ON public."property_action_reviews" TO "service_role";

GRANT SELECT ON public."property_action_reviews" TO "service_role";

GRANT UPDATE ON public."property_action_reviews" TO "service_role";

GRANT DELETE ON public."property_action_reviews" TO "service_role";

GRANT TRUNCATE ON public."property_action_reviews" TO "service_role";

GRANT REFERENCES ON public."property_action_reviews" TO "service_role";

GRANT TRIGGER ON public."property_action_reviews" TO "service_role";

GRANT INSERT ON public."measurement_periods" TO "authenticated";

GRANT SELECT ON public."measurement_periods" TO "authenticated";

GRANT UPDATE ON public."measurement_periods" TO "authenticated";

GRANT DELETE ON public."measurement_periods" TO "authenticated";

GRANT TRUNCATE ON public."measurement_periods" TO "authenticated";

GRANT REFERENCES ON public."measurement_periods" TO "authenticated";

GRANT TRIGGER ON public."measurement_periods" TO "authenticated";

GRANT INSERT ON public."measurement_periods" TO "service_role";

GRANT SELECT ON public."measurement_periods" TO "service_role";

GRANT UPDATE ON public."measurement_periods" TO "service_role";

GRANT DELETE ON public."measurement_periods" TO "service_role";

GRANT TRUNCATE ON public."measurement_periods" TO "service_role";

GRANT REFERENCES ON public."measurement_periods" TO "service_role";

GRANT TRIGGER ON public."measurement_periods" TO "service_role";

GRANT INSERT ON public."measurement_targets" TO "authenticated";

GRANT SELECT ON public."measurement_targets" TO "authenticated";

GRANT UPDATE ON public."measurement_targets" TO "authenticated";

GRANT DELETE ON public."measurement_targets" TO "authenticated";

GRANT TRUNCATE ON public."measurement_targets" TO "authenticated";

GRANT REFERENCES ON public."measurement_targets" TO "authenticated";

GRANT TRIGGER ON public."measurement_targets" TO "authenticated";

GRANT INSERT ON public."measurement_targets" TO "service_role";

GRANT SELECT ON public."measurement_targets" TO "service_role";

GRANT UPDATE ON public."measurement_targets" TO "service_role";

GRANT DELETE ON public."measurement_targets" TO "service_role";

GRANT TRUNCATE ON public."measurement_targets" TO "service_role";

GRANT REFERENCES ON public."measurement_targets" TO "service_role";

GRANT TRIGGER ON public."measurement_targets" TO "service_role";

GRANT INSERT ON public."whatsapp_onboarding_events" TO "authenticated";

GRANT SELECT ON public."whatsapp_onboarding_events" TO "authenticated";

GRANT UPDATE ON public."whatsapp_onboarding_events" TO "authenticated";

GRANT DELETE ON public."whatsapp_onboarding_events" TO "authenticated";

GRANT TRUNCATE ON public."whatsapp_onboarding_events" TO "authenticated";

GRANT REFERENCES ON public."whatsapp_onboarding_events" TO "authenticated";

GRANT TRIGGER ON public."whatsapp_onboarding_events" TO "authenticated";

GRANT INSERT ON public."whatsapp_onboarding_events" TO "service_role";

GRANT SELECT ON public."whatsapp_onboarding_events" TO "service_role";

GRANT UPDATE ON public."whatsapp_onboarding_events" TO "service_role";

GRANT DELETE ON public."whatsapp_onboarding_events" TO "service_role";

GRANT TRUNCATE ON public."whatsapp_onboarding_events" TO "service_role";

GRANT REFERENCES ON public."whatsapp_onboarding_events" TO "service_role";

GRANT TRIGGER ON public."whatsapp_onboarding_events" TO "service_role";

GRANT SELECT ON public."deal_stage_history" TO "anon";

GRANT TRUNCATE ON public."deal_stage_history" TO "anon";

GRANT REFERENCES ON public."deal_stage_history" TO "anon";

GRANT TRIGGER ON public."deal_stage_history" TO "anon";

GRANT SELECT ON public."deal_stage_history" TO "authenticated";

GRANT TRUNCATE ON public."deal_stage_history" TO "authenticated";

GRANT REFERENCES ON public."deal_stage_history" TO "authenticated";

GRANT TRIGGER ON public."deal_stage_history" TO "authenticated";

GRANT INSERT ON public."deal_stage_history" TO "service_role";

GRANT SELECT ON public."deal_stage_history" TO "service_role";

GRANT UPDATE ON public."deal_stage_history" TO "service_role";

GRANT DELETE ON public."deal_stage_history" TO "service_role";

GRANT TRUNCATE ON public."deal_stage_history" TO "service_role";

GRANT REFERENCES ON public."deal_stage_history" TO "service_role";

GRANT TRIGGER ON public."deal_stage_history" TO "service_role";

GRANT INSERT ON public."properties" TO "anon";

GRANT UPDATE ON public."properties" TO "anon";

GRANT DELETE ON public."properties" TO "anon";

GRANT TRUNCATE ON public."properties" TO "anon";

GRANT REFERENCES ON public."properties" TO "anon";

GRANT TRIGGER ON public."properties" TO "anon";

GRANT INSERT ON public."properties" TO "authenticated";

GRANT UPDATE ON public."properties" TO "authenticated";

GRANT DELETE ON public."properties" TO "authenticated";

GRANT TRUNCATE ON public."properties" TO "authenticated";

GRANT REFERENCES ON public."properties" TO "authenticated";

GRANT TRIGGER ON public."properties" TO "authenticated";

GRANT INSERT ON public."properties" TO "service_role";

GRANT SELECT ON public."properties" TO "service_role";

GRANT UPDATE ON public."properties" TO "service_role";

GRANT DELETE ON public."properties" TO "service_role";

GRANT TRUNCATE ON public."properties" TO "service_role";

GRANT REFERENCES ON public."properties" TO "service_role";

GRANT TRIGGER ON public."properties" TO "service_role";

GRANT INSERT ON public."whatsapp_automation_events" TO "anon";

GRANT SELECT ON public."whatsapp_automation_events" TO "anon";

GRANT UPDATE ON public."whatsapp_automation_events" TO "anon";

GRANT DELETE ON public."whatsapp_automation_events" TO "anon";

GRANT TRUNCATE ON public."whatsapp_automation_events" TO "anon";

GRANT REFERENCES ON public."whatsapp_automation_events" TO "anon";

GRANT TRIGGER ON public."whatsapp_automation_events" TO "anon";

GRANT INSERT ON public."whatsapp_automation_events" TO "authenticated";

GRANT SELECT ON public."whatsapp_automation_events" TO "authenticated";

GRANT UPDATE ON public."whatsapp_automation_events" TO "authenticated";

GRANT DELETE ON public."whatsapp_automation_events" TO "authenticated";

GRANT TRUNCATE ON public."whatsapp_automation_events" TO "authenticated";

GRANT REFERENCES ON public."whatsapp_automation_events" TO "authenticated";

GRANT TRIGGER ON public."whatsapp_automation_events" TO "authenticated";

GRANT INSERT ON public."whatsapp_automation_events" TO "service_role";

GRANT SELECT ON public."whatsapp_automation_events" TO "service_role";

GRANT UPDATE ON public."whatsapp_automation_events" TO "service_role";

GRANT DELETE ON public."whatsapp_automation_events" TO "service_role";

GRANT TRUNCATE ON public."whatsapp_automation_events" TO "service_role";

GRANT REFERENCES ON public."whatsapp_automation_events" TO "service_role";

GRANT TRIGGER ON public."whatsapp_automation_events" TO "service_role";

GRANT INSERT ON public."unmatched_property_links" TO "anon";

GRANT SELECT ON public."unmatched_property_links" TO "anon";

GRANT DELETE ON public."unmatched_property_links" TO "anon";

GRANT TRUNCATE ON public."unmatched_property_links" TO "anon";

GRANT REFERENCES ON public."unmatched_property_links" TO "anon";

GRANT TRIGGER ON public."unmatched_property_links" TO "anon";

GRANT INSERT ON public."unmatched_property_links" TO "authenticated";

GRANT SELECT ON public."unmatched_property_links" TO "authenticated";

GRANT DELETE ON public."unmatched_property_links" TO "authenticated";

GRANT TRUNCATE ON public."unmatched_property_links" TO "authenticated";

GRANT REFERENCES ON public."unmatched_property_links" TO "authenticated";

GRANT TRIGGER ON public."unmatched_property_links" TO "authenticated";

GRANT INSERT ON public."unmatched_property_links" TO "service_role";

GRANT SELECT ON public."unmatched_property_links" TO "service_role";

GRANT UPDATE ON public."unmatched_property_links" TO "service_role";

GRANT DELETE ON public."unmatched_property_links" TO "service_role";

GRANT TRUNCATE ON public."unmatched_property_links" TO "service_role";

GRANT REFERENCES ON public."unmatched_property_links" TO "service_role";

GRANT TRIGGER ON public."unmatched_property_links" TO "service_role";

GRANT INSERT ON public."whatsapp_route_credentials" TO "service_role";

GRANT SELECT ON public."whatsapp_route_credentials" TO "service_role";

GRANT UPDATE ON public."whatsapp_route_credentials" TO "service_role";

GRANT DELETE ON public."whatsapp_route_credentials" TO "service_role";

GRANT TRUNCATE ON public."whatsapp_route_credentials" TO "service_role";

GRANT REFERENCES ON public."whatsapp_route_credentials" TO "service_role";

GRANT TRIGGER ON public."whatsapp_route_credentials" TO "service_role";

GRANT INSERT ON public."client_request_assignees" TO "anon";

GRANT SELECT ON public."client_request_assignees" TO "anon";

GRANT UPDATE ON public."client_request_assignees" TO "anon";

GRANT DELETE ON public."client_request_assignees" TO "anon";

GRANT TRUNCATE ON public."client_request_assignees" TO "anon";

GRANT REFERENCES ON public."client_request_assignees" TO "anon";

GRANT TRIGGER ON public."client_request_assignees" TO "anon";

GRANT INSERT ON public."client_request_assignees" TO "authenticated";

GRANT SELECT ON public."client_request_assignees" TO "authenticated";

GRANT UPDATE ON public."client_request_assignees" TO "authenticated";

GRANT DELETE ON public."client_request_assignees" TO "authenticated";

GRANT TRUNCATE ON public."client_request_assignees" TO "authenticated";

GRANT REFERENCES ON public."client_request_assignees" TO "authenticated";

GRANT TRIGGER ON public."client_request_assignees" TO "authenticated";

GRANT INSERT ON public."client_request_assignees" TO "service_role";

GRANT SELECT ON public."client_request_assignees" TO "service_role";

GRANT UPDATE ON public."client_request_assignees" TO "service_role";

GRANT DELETE ON public."client_request_assignees" TO "service_role";

GRANT TRUNCATE ON public."client_request_assignees" TO "service_role";

GRANT REFERENCES ON public."client_request_assignees" TO "service_role";

GRANT TRIGGER ON public."client_request_assignees" TO "service_role";

GRANT INSERT ON public."instagram_outbound_operations" TO "service_role";

GRANT SELECT ON public."instagram_outbound_operations" TO "service_role";

GRANT UPDATE ON public."instagram_outbound_operations" TO "service_role";

GRANT DELETE ON public."instagram_outbound_operations" TO "service_role";

GRANT TRUNCATE ON public."instagram_outbound_operations" TO "service_role";

GRANT REFERENCES ON public."instagram_outbound_operations" TO "service_role";

GRANT TRIGGER ON public."instagram_outbound_operations" TO "service_role";

GRANT INSERT ON public."employee_monthly_targets" TO "anon";

GRANT SELECT ON public."employee_monthly_targets" TO "anon";

GRANT UPDATE ON public."employee_monthly_targets" TO "anon";

GRANT DELETE ON public."employee_monthly_targets" TO "anon";

GRANT TRUNCATE ON public."employee_monthly_targets" TO "anon";

GRANT REFERENCES ON public."employee_monthly_targets" TO "anon";

GRANT TRIGGER ON public."employee_monthly_targets" TO "anon";

GRANT INSERT ON public."employee_monthly_targets" TO "authenticated";

GRANT SELECT ON public."employee_monthly_targets" TO "authenticated";

GRANT UPDATE ON public."employee_monthly_targets" TO "authenticated";

GRANT DELETE ON public."employee_monthly_targets" TO "authenticated";

GRANT TRUNCATE ON public."employee_monthly_targets" TO "authenticated";

GRANT REFERENCES ON public."employee_monthly_targets" TO "authenticated";

GRANT TRIGGER ON public."employee_monthly_targets" TO "authenticated";

GRANT INSERT ON public."employee_monthly_targets" TO "service_role";

GRANT SELECT ON public."employee_monthly_targets" TO "service_role";

GRANT UPDATE ON public."employee_monthly_targets" TO "service_role";

GRANT DELETE ON public."employee_monthly_targets" TO "service_role";

GRANT TRUNCATE ON public."employee_monthly_targets" TO "service_role";

GRANT REFERENCES ON public."employee_monthly_targets" TO "service_role";

GRANT TRIGGER ON public."employee_monthly_targets" TO "service_role";

GRANT INSERT ON public."whatsapp_followup_optouts" TO "anon";

GRANT SELECT ON public."whatsapp_followup_optouts" TO "anon";

GRANT UPDATE ON public."whatsapp_followup_optouts" TO "anon";

GRANT DELETE ON public."whatsapp_followup_optouts" TO "anon";

GRANT TRUNCATE ON public."whatsapp_followup_optouts" TO "anon";

GRANT REFERENCES ON public."whatsapp_followup_optouts" TO "anon";

GRANT TRIGGER ON public."whatsapp_followup_optouts" TO "anon";

GRANT INSERT ON public."whatsapp_followup_optouts" TO "authenticated";

GRANT SELECT ON public."whatsapp_followup_optouts" TO "authenticated";

GRANT UPDATE ON public."whatsapp_followup_optouts" TO "authenticated";

GRANT DELETE ON public."whatsapp_followup_optouts" TO "authenticated";

GRANT TRUNCATE ON public."whatsapp_followup_optouts" TO "authenticated";

GRANT REFERENCES ON public."whatsapp_followup_optouts" TO "authenticated";

GRANT TRIGGER ON public."whatsapp_followup_optouts" TO "authenticated";

GRANT INSERT ON public."whatsapp_followup_optouts" TO "service_role";

GRANT SELECT ON public."whatsapp_followup_optouts" TO "service_role";

GRANT UPDATE ON public."whatsapp_followup_optouts" TO "service_role";

GRANT DELETE ON public."whatsapp_followup_optouts" TO "service_role";

GRANT TRUNCATE ON public."whatsapp_followup_optouts" TO "service_role";

GRANT REFERENCES ON public."whatsapp_followup_optouts" TO "service_role";

GRANT TRIGGER ON public."whatsapp_followup_optouts" TO "service_role";

GRANT INSERT ON public."whatsapp_template_registry" TO "anon";

GRANT SELECT ON public."whatsapp_template_registry" TO "anon";

GRANT UPDATE ON public."whatsapp_template_registry" TO "anon";

GRANT DELETE ON public."whatsapp_template_registry" TO "anon";

GRANT TRUNCATE ON public."whatsapp_template_registry" TO "anon";

GRANT REFERENCES ON public."whatsapp_template_registry" TO "anon";

GRANT TRIGGER ON public."whatsapp_template_registry" TO "anon";

GRANT INSERT ON public."whatsapp_template_registry" TO "authenticated";

GRANT SELECT ON public."whatsapp_template_registry" TO "authenticated";

GRANT UPDATE ON public."whatsapp_template_registry" TO "authenticated";

GRANT DELETE ON public."whatsapp_template_registry" TO "authenticated";

GRANT TRUNCATE ON public."whatsapp_template_registry" TO "authenticated";

GRANT REFERENCES ON public."whatsapp_template_registry" TO "authenticated";

GRANT TRIGGER ON public."whatsapp_template_registry" TO "authenticated";

GRANT INSERT ON public."whatsapp_template_registry" TO "service_role";

GRANT SELECT ON public."whatsapp_template_registry" TO "service_role";

GRANT UPDATE ON public."whatsapp_template_registry" TO "service_role";

GRANT DELETE ON public."whatsapp_template_registry" TO "service_role";

GRANT TRUNCATE ON public."whatsapp_template_registry" TO "service_role";

GRANT REFERENCES ON public."whatsapp_template_registry" TO "service_role";

GRANT TRIGGER ON public."whatsapp_template_registry" TO "service_role";

GRANT INSERT ON public."whatsapp_followup_events" TO "anon";

GRANT SELECT ON public."whatsapp_followup_events" TO "anon";

GRANT UPDATE ON public."whatsapp_followup_events" TO "anon";

GRANT DELETE ON public."whatsapp_followup_events" TO "anon";

GRANT TRUNCATE ON public."whatsapp_followup_events" TO "anon";

GRANT REFERENCES ON public."whatsapp_followup_events" TO "anon";

GRANT TRIGGER ON public."whatsapp_followup_events" TO "anon";

GRANT INSERT ON public."whatsapp_followup_events" TO "authenticated";

GRANT SELECT ON public."whatsapp_followup_events" TO "authenticated";

GRANT UPDATE ON public."whatsapp_followup_events" TO "authenticated";

GRANT DELETE ON public."whatsapp_followup_events" TO "authenticated";

GRANT TRUNCATE ON public."whatsapp_followup_events" TO "authenticated";

GRANT REFERENCES ON public."whatsapp_followup_events" TO "authenticated";

GRANT TRIGGER ON public."whatsapp_followup_events" TO "authenticated";

GRANT INSERT ON public."whatsapp_followup_events" TO "service_role";

GRANT SELECT ON public."whatsapp_followup_events" TO "service_role";

GRANT UPDATE ON public."whatsapp_followup_events" TO "service_role";

GRANT DELETE ON public."whatsapp_followup_events" TO "service_role";

GRANT TRUNCATE ON public."whatsapp_followup_events" TO "service_role";

GRANT REFERENCES ON public."whatsapp_followup_events" TO "service_role";

GRANT TRIGGER ON public."whatsapp_followup_events" TO "service_role";

GRANT INSERT ON public."whatsapp_followup_optins" TO "anon";

GRANT SELECT ON public."whatsapp_followup_optins" TO "anon";

GRANT UPDATE ON public."whatsapp_followup_optins" TO "anon";

GRANT DELETE ON public."whatsapp_followup_optins" TO "anon";

GRANT TRUNCATE ON public."whatsapp_followup_optins" TO "anon";

GRANT REFERENCES ON public."whatsapp_followup_optins" TO "anon";

GRANT TRIGGER ON public."whatsapp_followup_optins" TO "anon";

GRANT INSERT ON public."whatsapp_followup_optins" TO "authenticated";

GRANT SELECT ON public."whatsapp_followup_optins" TO "authenticated";

GRANT UPDATE ON public."whatsapp_followup_optins" TO "authenticated";

GRANT DELETE ON public."whatsapp_followup_optins" TO "authenticated";

GRANT TRUNCATE ON public."whatsapp_followup_optins" TO "authenticated";

GRANT REFERENCES ON public."whatsapp_followup_optins" TO "authenticated";

GRANT TRIGGER ON public."whatsapp_followup_optins" TO "authenticated";

GRANT INSERT ON public."whatsapp_followup_optins" TO "service_role";

GRANT SELECT ON public."whatsapp_followup_optins" TO "service_role";

GRANT UPDATE ON public."whatsapp_followup_optins" TO "service_role";

GRANT DELETE ON public."whatsapp_followup_optins" TO "service_role";

GRANT TRUNCATE ON public."whatsapp_followup_optins" TO "service_role";

GRANT REFERENCES ON public."whatsapp_followup_optins" TO "service_role";

GRANT TRIGGER ON public."whatsapp_followup_optins" TO "service_role";

GRANT INSERT ON public."crm_monthly_automation_cost_monitor" TO "anon";

GRANT SELECT ON public."crm_monthly_automation_cost_monitor" TO "anon";

GRANT UPDATE ON public."crm_monthly_automation_cost_monitor" TO "anon";

GRANT DELETE ON public."crm_monthly_automation_cost_monitor" TO "anon";

GRANT TRUNCATE ON public."crm_monthly_automation_cost_monitor" TO "anon";

GRANT REFERENCES ON public."crm_monthly_automation_cost_monitor" TO "anon";

GRANT TRIGGER ON public."crm_monthly_automation_cost_monitor" TO "anon";

GRANT INSERT ON public."crm_monthly_automation_cost_monitor" TO "authenticated";

GRANT SELECT ON public."crm_monthly_automation_cost_monitor" TO "authenticated";

GRANT UPDATE ON public."crm_monthly_automation_cost_monitor" TO "authenticated";

GRANT DELETE ON public."crm_monthly_automation_cost_monitor" TO "authenticated";

GRANT TRUNCATE ON public."crm_monthly_automation_cost_monitor" TO "authenticated";

GRANT REFERENCES ON public."crm_monthly_automation_cost_monitor" TO "authenticated";

GRANT TRIGGER ON public."crm_monthly_automation_cost_monitor" TO "authenticated";

GRANT INSERT ON public."crm_monthly_automation_cost_monitor" TO "service_role";

GRANT SELECT ON public."crm_monthly_automation_cost_monitor" TO "service_role";

GRANT UPDATE ON public."crm_monthly_automation_cost_monitor" TO "service_role";

GRANT DELETE ON public."crm_monthly_automation_cost_monitor" TO "service_role";

GRANT TRUNCATE ON public."crm_monthly_automation_cost_monitor" TO "service_role";

GRANT REFERENCES ON public."crm_monthly_automation_cost_monitor" TO "service_role";

GRANT TRIGGER ON public."crm_monthly_automation_cost_monitor" TO "service_role";

GRANT INSERT ON public."whatsapp_automation_runtime" TO "service_role";

GRANT SELECT ON public."whatsapp_automation_runtime" TO "service_role";

GRANT UPDATE ON public."whatsapp_automation_runtime" TO "service_role";

GRANT DELETE ON public."whatsapp_automation_runtime" TO "service_role";

GRANT TRUNCATE ON public."whatsapp_automation_runtime" TO "service_role";

GRANT REFERENCES ON public."whatsapp_automation_runtime" TO "service_role";

GRANT TRIGGER ON public."whatsapp_automation_runtime" TO "service_role";

GRANT INSERT ON public."instagram_accounts" TO "anon";

GRANT SELECT ON public."instagram_accounts" TO "anon";

GRANT UPDATE ON public."instagram_accounts" TO "anon";

GRANT DELETE ON public."instagram_accounts" TO "anon";

GRANT TRUNCATE ON public."instagram_accounts" TO "anon";

GRANT REFERENCES ON public."instagram_accounts" TO "anon";

GRANT TRIGGER ON public."instagram_accounts" TO "anon";

GRANT INSERT ON public."instagram_accounts" TO "authenticated";

GRANT SELECT ON public."instagram_accounts" TO "authenticated";

GRANT UPDATE ON public."instagram_accounts" TO "authenticated";

GRANT DELETE ON public."instagram_accounts" TO "authenticated";

GRANT TRUNCATE ON public."instagram_accounts" TO "authenticated";

GRANT REFERENCES ON public."instagram_accounts" TO "authenticated";

GRANT TRIGGER ON public."instagram_accounts" TO "authenticated";

GRANT INSERT ON public."instagram_accounts" TO "service_role";

GRANT SELECT ON public."instagram_accounts" TO "service_role";

GRANT UPDATE ON public."instagram_accounts" TO "service_role";

GRANT DELETE ON public."instagram_accounts" TO "service_role";

GRANT TRUNCATE ON public."instagram_accounts" TO "service_role";

GRANT REFERENCES ON public."instagram_accounts" TO "service_role";

GRANT TRIGGER ON public."instagram_accounts" TO "service_role";

GRANT INSERT ON public."instagram_account_credentials" TO "anon";

GRANT SELECT ON public."instagram_account_credentials" TO "anon";

GRANT UPDATE ON public."instagram_account_credentials" TO "anon";

GRANT DELETE ON public."instagram_account_credentials" TO "anon";

GRANT TRUNCATE ON public."instagram_account_credentials" TO "anon";

GRANT REFERENCES ON public."instagram_account_credentials" TO "anon";

GRANT TRIGGER ON public."instagram_account_credentials" TO "anon";

GRANT INSERT ON public."instagram_account_credentials" TO "authenticated";

GRANT SELECT ON public."instagram_account_credentials" TO "authenticated";

GRANT UPDATE ON public."instagram_account_credentials" TO "authenticated";

GRANT DELETE ON public."instagram_account_credentials" TO "authenticated";

GRANT TRUNCATE ON public."instagram_account_credentials" TO "authenticated";

GRANT REFERENCES ON public."instagram_account_credentials" TO "authenticated";

GRANT TRIGGER ON public."instagram_account_credentials" TO "authenticated";

GRANT INSERT ON public."instagram_account_credentials" TO "service_role";

GRANT SELECT ON public."instagram_account_credentials" TO "service_role";

GRANT UPDATE ON public."instagram_account_credentials" TO "service_role";

GRANT DELETE ON public."instagram_account_credentials" TO "service_role";

GRANT TRUNCATE ON public."instagram_account_credentials" TO "service_role";

GRANT REFERENCES ON public."instagram_account_credentials" TO "service_role";

GRANT TRIGGER ON public."instagram_account_credentials" TO "service_role";

GRANT INSERT ON public."instagram_webhook_events" TO "anon";

GRANT SELECT ON public."instagram_webhook_events" TO "anon";

GRANT UPDATE ON public."instagram_webhook_events" TO "anon";

GRANT DELETE ON public."instagram_webhook_events" TO "anon";

GRANT TRUNCATE ON public."instagram_webhook_events" TO "anon";

GRANT REFERENCES ON public."instagram_webhook_events" TO "anon";

GRANT TRIGGER ON public."instagram_webhook_events" TO "anon";

GRANT INSERT ON public."instagram_webhook_events" TO "authenticated";

GRANT SELECT ON public."instagram_webhook_events" TO "authenticated";

GRANT UPDATE ON public."instagram_webhook_events" TO "authenticated";

GRANT DELETE ON public."instagram_webhook_events" TO "authenticated";

GRANT TRUNCATE ON public."instagram_webhook_events" TO "authenticated";

GRANT REFERENCES ON public."instagram_webhook_events" TO "authenticated";

GRANT TRIGGER ON public."instagram_webhook_events" TO "authenticated";

GRANT INSERT ON public."instagram_webhook_events" TO "service_role";

GRANT SELECT ON public."instagram_webhook_events" TO "service_role";

GRANT UPDATE ON public."instagram_webhook_events" TO "service_role";

GRANT DELETE ON public."instagram_webhook_events" TO "service_role";

GRANT TRUNCATE ON public."instagram_webhook_events" TO "service_role";

GRANT REFERENCES ON public."instagram_webhook_events" TO "service_role";

GRANT TRIGGER ON public."instagram_webhook_events" TO "service_role";

GRANT INSERT ON public."instagram_conversations" TO "anon";

GRANT SELECT ON public."instagram_conversations" TO "anon";

GRANT UPDATE ON public."instagram_conversations" TO "anon";

GRANT DELETE ON public."instagram_conversations" TO "anon";

GRANT TRUNCATE ON public."instagram_conversations" TO "anon";

GRANT REFERENCES ON public."instagram_conversations" TO "anon";

GRANT TRIGGER ON public."instagram_conversations" TO "anon";

GRANT INSERT ON public."instagram_conversations" TO "authenticated";

GRANT SELECT ON public."instagram_conversations" TO "authenticated";

GRANT UPDATE ON public."instagram_conversations" TO "authenticated";

GRANT DELETE ON public."instagram_conversations" TO "authenticated";

GRANT TRUNCATE ON public."instagram_conversations" TO "authenticated";

GRANT REFERENCES ON public."instagram_conversations" TO "authenticated";

GRANT TRIGGER ON public."instagram_conversations" TO "authenticated";

GRANT INSERT ON public."instagram_conversations" TO "service_role";

GRANT SELECT ON public."instagram_conversations" TO "service_role";

GRANT UPDATE ON public."instagram_conversations" TO "service_role";

GRANT DELETE ON public."instagram_conversations" TO "service_role";

GRANT TRUNCATE ON public."instagram_conversations" TO "service_role";

GRANT REFERENCES ON public."instagram_conversations" TO "service_role";

GRANT TRIGGER ON public."instagram_conversations" TO "service_role";

GRANT INSERT ON public."instagram_messages" TO "anon";

GRANT SELECT ON public."instagram_messages" TO "anon";

GRANT UPDATE ON public."instagram_messages" TO "anon";

GRANT DELETE ON public."instagram_messages" TO "anon";

GRANT TRUNCATE ON public."instagram_messages" TO "anon";

GRANT REFERENCES ON public."instagram_messages" TO "anon";

GRANT TRIGGER ON public."instagram_messages" TO "anon";

GRANT INSERT ON public."instagram_messages" TO "authenticated";

GRANT SELECT ON public."instagram_messages" TO "authenticated";

GRANT UPDATE ON public."instagram_messages" TO "authenticated";

GRANT DELETE ON public."instagram_messages" TO "authenticated";

GRANT TRUNCATE ON public."instagram_messages" TO "authenticated";

GRANT REFERENCES ON public."instagram_messages" TO "authenticated";

GRANT TRIGGER ON public."instagram_messages" TO "authenticated";

GRANT INSERT ON public."instagram_messages" TO "service_role";

GRANT SELECT ON public."instagram_messages" TO "service_role";

GRANT UPDATE ON public."instagram_messages" TO "service_role";

GRANT DELETE ON public."instagram_messages" TO "service_role";

GRANT TRUNCATE ON public."instagram_messages" TO "service_role";

GRANT REFERENCES ON public."instagram_messages" TO "service_role";

GRANT TRIGGER ON public."instagram_messages" TO "service_role";

GRANT INSERT ON public."property_instagram_analytics" TO "anon";

GRANT SELECT ON public."property_instagram_analytics" TO "anon";

GRANT UPDATE ON public."property_instagram_analytics" TO "anon";

GRANT DELETE ON public."property_instagram_analytics" TO "anon";

GRANT TRUNCATE ON public."property_instagram_analytics" TO "anon";

GRANT REFERENCES ON public."property_instagram_analytics" TO "anon";

GRANT TRIGGER ON public."property_instagram_analytics" TO "anon";

GRANT INSERT ON public."property_instagram_analytics" TO "authenticated";

GRANT SELECT ON public."property_instagram_analytics" TO "authenticated";

GRANT UPDATE ON public."property_instagram_analytics" TO "authenticated";

GRANT DELETE ON public."property_instagram_analytics" TO "authenticated";

GRANT TRUNCATE ON public."property_instagram_analytics" TO "authenticated";

GRANT REFERENCES ON public."property_instagram_analytics" TO "authenticated";

GRANT TRIGGER ON public."property_instagram_analytics" TO "authenticated";

GRANT INSERT ON public."property_instagram_analytics" TO "service_role";

GRANT SELECT ON public."property_instagram_analytics" TO "service_role";

GRANT UPDATE ON public."property_instagram_analytics" TO "service_role";

GRANT DELETE ON public."property_instagram_analytics" TO "service_role";

GRANT TRUNCATE ON public."property_instagram_analytics" TO "service_role";

GRANT REFERENCES ON public."property_instagram_analytics" TO "service_role";

GRANT TRIGGER ON public."property_instagram_analytics" TO "service_role";

GRANT SELECT ON public."crm_properties_access" TO "authenticated";

GRANT SELECT ON public."crm_properties_access" TO "service_role";

GRANT INSERT ON public."whatsapp_send_operations" TO "service_role";

GRANT SELECT ON public."whatsapp_send_operations" TO "service_role";

GRANT UPDATE ON public."whatsapp_send_operations" TO "service_role";

GRANT DELETE ON public."whatsapp_send_operations" TO "service_role";

GRANT TRUNCATE ON public."whatsapp_send_operations" TO "service_role";

GRANT REFERENCES ON public."whatsapp_send_operations" TO "service_role";

GRANT TRIGGER ON public."whatsapp_send_operations" TO "service_role";

GRANT SELECT ON public."crm_deals_access" TO "authenticated";

GRANT SELECT ON public."crm_deals_access" TO "service_role";

GRANT INSERT ON public."property_message_attributions" TO "service_role";

GRANT SELECT ON public."property_message_attributions" TO "service_role";

GRANT UPDATE ON public."property_message_attributions" TO "service_role";

GRANT DELETE ON public."property_message_attributions" TO "service_role";

GRANT TRUNCATE ON public."property_message_attributions" TO "service_role";

GRANT REFERENCES ON public."property_message_attributions" TO "service_role";

GRANT TRIGGER ON public."property_message_attributions" TO "service_role";

GRANT SELECT ON public."property_message_attributions" TO "authenticated";

GRANT INSERT("added_by","agreement_duration_months","agreement_end_date","agreement_reminder_days","agreement_start_date","archived","archived_at","archived_by","area","availability_checked_at","bathrooms","bedrooms","branch_key","built_size","company_id","created_at","description","expected_commission","has_listing_agreement","id","images","inquiries_count","internal_name","land_size","last_ai_recommendation","last_ai_recommendation_at","map_url","marketing_review_note","marketing_review_status","marketing_reviewed_at","marketing_status","owner_client_id","owner_id","owner_net","performance_tracking_started_at","photography_completed_at","photography_reason","photography_required_at","photography_status","price","property_code","public_details","source_type","sourced_by","status","title","type","updated_at","views_count","wilayat") ON public."properties" TO "anon";

GRANT REFERENCES("added_by","agreement_duration_months","agreement_end_date","agreement_reminder_days","agreement_start_date","archived","archived_at","archived_by","area","availability_checked_at","bathrooms","bedrooms","branch_key","built_size","company_id","created_at","description","expected_commission","has_listing_agreement","id","images","inquiries_count","internal_name","land_size","last_ai_recommendation","last_ai_recommendation_at","map_url","marketing_review_note","marketing_review_status","marketing_reviewed_at","marketing_status","owner_client_id","owner_id","owner_net","performance_tracking_started_at","photography_completed_at","photography_reason","photography_required_at","photography_status","price","property_code","public_details","source_type","sourced_by","status","title","type","updated_at","views_count","wilayat") ON public."properties" TO "anon";

GRANT UPDATE("added_by","agreement_duration_months","agreement_end_date","agreement_reminder_days","agreement_start_date","archived","archived_at","archived_by","area","availability_checked_at","bathrooms","bedrooms","branch_key","built_size","company_id","created_at","description","expected_commission","has_listing_agreement","id","images","inquiries_count","internal_name","land_size","last_ai_recommendation","last_ai_recommendation_at","map_url","marketing_review_note","marketing_review_status","marketing_reviewed_at","marketing_status","owner_client_id","owner_id","owner_net","performance_tracking_started_at","photography_completed_at","photography_reason","photography_required_at","photography_status","price","property_code","public_details","source_type","sourced_by","status","title","type","updated_at","views_count","wilayat") ON public."properties" TO "anon";

GRANT INSERT("agent_commission","agent_id","agent_share","bank_financing","broker_commission","broker_id","client_id","closed_at","closing_probability","commission_received_at","commission_status","commission_total","company_commission","company_id","company_share","created_at","deal_value","deposit_amount","employee_commission_percent","entry_mode","expected_close_date","id","lost_at","lost_from_stage","lost_reason_id","lost_reason_note","notes","property_id","request_id","stage","updated_at","viewing_id") ON public."deals" TO "anon";

GRANT REFERENCES("agent_commission","agent_id","agent_share","bank_financing","broker_commission","broker_id","client_id","closed_at","closing_probability","commission_received_at","commission_status","commission_total","company_commission","company_id","company_share","created_at","deal_value","deposit_amount","employee_commission_percent","entry_mode","expected_close_date","id","lost_at","lost_from_stage","lost_reason_id","lost_reason_note","notes","property_id","request_id","stage","updated_at","viewing_id") ON public."deals" TO "anon";

GRANT UPDATE("agent_commission","agent_id","agent_share","bank_financing","broker_commission","broker_id","client_id","closed_at","closing_probability","commission_received_at","commission_status","commission_total","company_commission","company_id","company_share","created_at","deal_value","deposit_amount","employee_commission_percent","entry_mode","expected_close_date","id","lost_at","lost_from_stage","lost_reason_id","lost_reason_note","notes","property_id","request_id","stage","updated_at","viewing_id") ON public."deals" TO "anon";

GRANT INSERT("added_by","agreement_duration_months","agreement_end_date","agreement_reminder_days","agreement_start_date","archived","archived_at","archived_by","area","availability_checked_at","bathrooms","bedrooms","branch_key","built_size","company_id","created_at","description","expected_commission","has_listing_agreement","id","images","inquiries_count","internal_name","land_size","last_ai_recommendation","last_ai_recommendation_at","map_url","marketing_review_note","marketing_review_status","marketing_reviewed_at","marketing_status","owner_client_id","owner_id","owner_net","performance_tracking_started_at","photography_completed_at","photography_reason","photography_required_at","photography_status","price","property_code","public_details","source_type","sourced_by","status","title","type","updated_at","views_count","wilayat") ON public."properties" TO "authenticated";

GRANT REFERENCES("added_by","agreement_duration_months","agreement_end_date","agreement_reminder_days","agreement_start_date","archived","archived_at","archived_by","area","availability_checked_at","bathrooms","bedrooms","branch_key","built_size","company_id","created_at","description","expected_commission","has_listing_agreement","id","images","inquiries_count","internal_name","land_size","last_ai_recommendation","last_ai_recommendation_at","map_url","marketing_review_note","marketing_review_status","marketing_reviewed_at","marketing_status","owner_client_id","owner_id","owner_net","performance_tracking_started_at","photography_completed_at","photography_reason","photography_required_at","photography_status","price","property_code","public_details","source_type","sourced_by","status","title","type","updated_at","views_count","wilayat") ON public."properties" TO "authenticated";

GRANT SELECT("added_by","agreement_duration_months","agreement_end_date","agreement_reminder_days","agreement_start_date","archived","archived_at","archived_by","area","availability_checked_at","bathrooms","bedrooms","branch_key","built_size","company_id","created_at","description","has_listing_agreement","id","images","inquiries_count","internal_name","land_size","last_ai_recommendation","last_ai_recommendation_at","map_url","marketing_review_note","marketing_review_status","marketing_reviewed_at","marketing_status","owner_client_id","owner_id","performance_tracking_started_at","photography_completed_at","photography_reason","photography_required_at","photography_status","price","property_code","public_details","source_type","sourced_by","status","title","type","updated_at","views_count","wilayat") ON public."properties" TO "authenticated";

GRANT UPDATE("added_by","agreement_duration_months","agreement_end_date","agreement_reminder_days","agreement_start_date","archived","archived_at","archived_by","area","availability_checked_at","bathrooms","bedrooms","branch_key","built_size","company_id","created_at","description","expected_commission","has_listing_agreement","id","images","inquiries_count","internal_name","land_size","last_ai_recommendation","last_ai_recommendation_at","map_url","marketing_review_note","marketing_review_status","marketing_reviewed_at","marketing_status","owner_client_id","owner_id","owner_net","performance_tracking_started_at","photography_completed_at","photography_reason","photography_required_at","photography_status","price","property_code","public_details","source_type","sourced_by","status","title","type","updated_at","views_count","wilayat") ON public."properties" TO "authenticated";

GRANT INSERT("agent_commission","agent_id","agent_share","bank_financing","broker_commission","broker_id","client_id","closed_at","closing_probability","commission_received_at","commission_status","commission_total","company_commission","company_id","company_share","created_at","deal_value","deposit_amount","employee_commission_percent","entry_mode","expected_close_date","id","lost_at","lost_from_stage","lost_reason_id","lost_reason_note","notes","property_id","request_id","stage","updated_at","viewing_id") ON public."deals" TO "authenticated";

GRANT REFERENCES("agent_commission","agent_id","agent_share","bank_financing","broker_commission","broker_id","client_id","closed_at","closing_probability","commission_received_at","commission_status","commission_total","company_commission","company_id","company_share","created_at","deal_value","deposit_amount","employee_commission_percent","entry_mode","expected_close_date","id","lost_at","lost_from_stage","lost_reason_id","lost_reason_note","notes","property_id","request_id","stage","updated_at","viewing_id") ON public."deals" TO "authenticated";

GRANT UPDATE("agent_commission","agent_id","agent_share","bank_financing","broker_commission","broker_id","client_id","closed_at","closing_probability","commission_received_at","commission_status","commission_total","company_commission","company_id","company_share","created_at","deal_value","deposit_amount","employee_commission_percent","entry_mode","expected_close_date","id","lost_at","lost_from_stage","lost_reason_id","lost_reason_note","notes","property_id","request_id","stage","updated_at","viewing_id") ON public."deals" TO "authenticated";

GRANT SELECT("agent_id","bank_financing","broker_id","client_id","closed_at","closing_probability","company_id","created_at","deal_value","deposit_amount","entry_mode","expected_close_date","id","lost_at","lost_from_stage","lost_reason_id","lost_reason_note","notes","property_id","request_id","stage","updated_at","viewing_id") ON public."deals" TO "authenticated";

GRANT INSERT("added_by","agreement_duration_months","agreement_end_date","agreement_reminder_days","agreement_start_date","archived","archived_at","archived_by","area","availability_checked_at","bathrooms","bedrooms","branch_key","built_size","company_id","created_at","description","expected_commission","has_listing_agreement","id","images","inquiries_count","internal_name","land_size","last_ai_recommendation","last_ai_recommendation_at","map_url","marketing_review_note","marketing_review_status","marketing_reviewed_at","marketing_status","owner_client_id","owner_id","owner_net","performance_tracking_started_at","photography_completed_at","photography_reason","photography_required_at","photography_status","price","property_code","public_details","source_type","sourced_by","status","title","type","updated_at","views_count","wilayat") ON public."properties" TO "service_role";

GRANT REFERENCES("added_by","agreement_duration_months","agreement_end_date","agreement_reminder_days","agreement_start_date","archived","archived_at","archived_by","area","availability_checked_at","bathrooms","bedrooms","branch_key","built_size","company_id","created_at","description","expected_commission","has_listing_agreement","id","images","inquiries_count","internal_name","land_size","last_ai_recommendation","last_ai_recommendation_at","map_url","marketing_review_note","marketing_review_status","marketing_reviewed_at","marketing_status","owner_client_id","owner_id","owner_net","performance_tracking_started_at","photography_completed_at","photography_reason","photography_required_at","photography_status","price","property_code","public_details","source_type","sourced_by","status","title","type","updated_at","views_count","wilayat") ON public."properties" TO "service_role";

GRANT SELECT("added_by","agreement_duration_months","agreement_end_date","agreement_reminder_days","agreement_start_date","archived","archived_at","archived_by","area","availability_checked_at","bathrooms","bedrooms","branch_key","built_size","company_id","created_at","description","expected_commission","has_listing_agreement","id","images","inquiries_count","internal_name","land_size","last_ai_recommendation","last_ai_recommendation_at","map_url","marketing_review_note","marketing_review_status","marketing_reviewed_at","marketing_status","owner_client_id","owner_id","owner_net","performance_tracking_started_at","photography_completed_at","photography_reason","photography_required_at","photography_status","price","property_code","public_details","source_type","sourced_by","status","title","type","updated_at","views_count","wilayat") ON public."properties" TO "service_role";

GRANT UPDATE("added_by","agreement_duration_months","agreement_end_date","agreement_reminder_days","agreement_start_date","archived","archived_at","archived_by","area","availability_checked_at","bathrooms","bedrooms","branch_key","built_size","company_id","created_at","description","expected_commission","has_listing_agreement","id","images","inquiries_count","internal_name","land_size","last_ai_recommendation","last_ai_recommendation_at","map_url","marketing_review_note","marketing_review_status","marketing_reviewed_at","marketing_status","owner_client_id","owner_id","owner_net","performance_tracking_started_at","photography_completed_at","photography_reason","photography_required_at","photography_status","price","property_code","public_details","source_type","sourced_by","status","title","type","updated_at","views_count","wilayat") ON public."properties" TO "service_role";

GRANT INSERT("agent_commission","agent_id","agent_share","bank_financing","broker_commission","broker_id","client_id","closed_at","closing_probability","commission_received_at","commission_status","commission_total","company_commission","company_id","company_share","created_at","deal_value","deposit_amount","employee_commission_percent","entry_mode","expected_close_date","id","lost_at","lost_from_stage","lost_reason_id","lost_reason_note","notes","property_id","request_id","stage","updated_at","viewing_id") ON public."deals" TO "service_role";

GRANT REFERENCES("agent_commission","agent_id","agent_share","bank_financing","broker_commission","broker_id","client_id","closed_at","closing_probability","commission_received_at","commission_status","commission_total","company_commission","company_id","company_share","created_at","deal_value","deposit_amount","employee_commission_percent","entry_mode","expected_close_date","id","lost_at","lost_from_stage","lost_reason_id","lost_reason_note","notes","property_id","request_id","stage","updated_at","viewing_id") ON public."deals" TO "service_role";

GRANT SELECT("agent_commission","agent_id","agent_share","bank_financing","broker_commission","broker_id","client_id","closed_at","closing_probability","commission_received_at","commission_status","commission_total","company_commission","company_id","company_share","created_at","deal_value","deposit_amount","employee_commission_percent","entry_mode","expected_close_date","id","lost_at","lost_from_stage","lost_reason_id","lost_reason_note","notes","property_id","request_id","stage","updated_at","viewing_id") ON public."deals" TO "service_role";

GRANT UPDATE("agent_commission","agent_id","agent_share","bank_financing","broker_commission","broker_id","client_id","closed_at","closing_probability","commission_received_at","commission_status","commission_total","company_commission","company_id","company_share","created_at","deal_value","deposit_amount","employee_commission_percent","entry_mode","expected_close_date","id","lost_at","lost_from_stage","lost_reason_id","lost_reason_note","notes","property_id","request_id","stage","updated_at","viewing_id") ON public."deals" TO "service_role";

REVOKE ALL ON FUNCTION public."crm_whatsapp_inbox_counts"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_whatsapp_inbox_counts"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_whatsapp_inbox_counts"() TO "service_role";

REVOKE ALL ON FUNCTION public."handle_new_user"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."handle_new_user"() TO "service_role";

REVOKE ALL ON FUNCTION public."crm_employee_performance"(p_from date, p_to date) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_employee_performance"(p_from date, p_to date) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_employee_performance"(p_from date, p_to date) TO "service_role";

REVOKE ALL ON FUNCTION public."get_public_company_name"(p_company_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."get_public_company_name"(p_company_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."is_company_owner"(target_company uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."is_company_owner"(target_company uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."is_company_owner"(target_company uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."protect_profile_sensitive_fields"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."protect_profile_sensitive_fields"() TO "service_role";

REVOKE ALL ON FUNCTION public."apply_company_invite_to_new_user"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."apply_company_invite_to_new_user"() TO "service_role";

REVOKE ALL ON FUNCTION public."submit_public_lead"(p_company_id uuid, p_payload jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."submit_public_lead"(p_company_id uuid, p_payload jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public."calc_client_request_score"(p_request jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."calc_client_request_score"(p_request jsonb) TO "anon";

GRANT EXECUTE ON FUNCTION public."calc_client_request_score"(p_request jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."calc_client_request_score"(p_request jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public."upsert_whatsapp_client"(p_company_id uuid, p_phone text, p_customer_name text, p_route_key text, p_assigned_to uuid, p_inbound_number text, p_message_body text, p_extracted jsonb, p_message_at timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."upsert_whatsapp_client"(p_company_id uuid, p_phone text, p_customer_name text, p_route_key text, p_assigned_to uuid, p_inbound_number text, p_message_body text, p_extracted jsonb, p_message_at timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION public."resolve_whatsapp_route"(p_company_id uuid, p_meta_phone_number_id text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."resolve_whatsapp_route"(p_company_id uuid, p_meta_phone_number_id text) TO "service_role";

REVOKE ALL ON FUNCTION public."touch_property_inquiry_updated_at"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."touch_property_inquiry_updated_at"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."touch_property_inquiry_updated_at"() TO "anon";

GRANT EXECUTE ON FUNCTION public."touch_property_inquiry_updated_at"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."touch_property_inquiry_updated_at"() TO "service_role";

REVOKE ALL ON FUNCTION public."sync_client_pipeline_from_property_inquiry"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."sync_client_pipeline_from_property_inquiry"() TO "service_role";

REVOKE ALL ON FUNCTION public."touch_client_request_updated_at"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."touch_client_request_updated_at"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."touch_client_request_updated_at"() TO "anon";

GRANT EXECUTE ON FUNCTION public."touch_client_request_updated_at"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."touch_client_request_updated_at"() TO "service_role";

REVOKE ALL ON FUNCTION public."audit_client_request_change"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."audit_client_request_change"() TO "service_role";

REVOKE ALL ON FUNCTION public."sync_client_summary_after_request_change"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."sync_client_summary_after_request_change"() TO "service_role";

REVOKE ALL ON FUNCTION public."submit_public_lead"(p_company_id uuid, p_payload jsonb, p_route_key text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."submit_public_lead"(p_company_id uuid, p_payload jsonb, p_route_key text) TO "service_role";

REVOKE ALL ON FUNCTION public."refresh_client_request_summary"(p_client_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."refresh_client_request_summary"(p_client_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."apply_whatsapp_client_request"(p_company_id uuid, p_client_id uuid, p_action text, p_existing_request_id uuid, p_assigned_to uuid, p_route_key text, p_inbound_number text, p_message_id uuid, p_request jsonb, p_message_at timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."apply_whatsapp_client_request"(p_company_id uuid, p_client_id uuid, p_action text, p_existing_request_id uuid, p_assigned_to uuid, p_route_key text, p_inbound_number text, p_message_id uuid, p_request jsonb, p_message_at timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION public."disable_missing_requirements_auto_reply_guard"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."disable_missing_requirements_auto_reply_guard"() TO "service_role";

REVOKE ALL ON FUNCTION public."crm_infer_request_branches"(p_route_key text, p_branch_key text, p_wilayat text, p_preferred_area text, p_preferred_areas text[], p_alternative_areas text[]) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_infer_request_branches"(p_route_key text, p_branch_key text, p_wilayat text, p_preferred_area text, p_preferred_areas text[], p_alternative_areas text[]) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."crm_infer_request_branches"(p_route_key text, p_branch_key text, p_wilayat text, p_preferred_area text, p_preferred_areas text[], p_alternative_areas text[]) TO "anon";

GRANT EXECUTE ON FUNCTION public."crm_infer_request_branches"(p_route_key text, p_branch_key text, p_wilayat text, p_preferred_area text, p_preferred_areas text[], p_alternative_areas text[]) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_infer_request_branches"(p_route_key text, p_branch_key text, p_wilayat text, p_preferred_area text, p_preferred_areas text[], p_alternative_areas text[]) TO "service_role";

REVOKE ALL ON FUNCTION public."apply_whatsapp_client_request_guarded"(p_company_id uuid, p_client_id uuid, p_action text, p_existing_request_id uuid, p_assigned_to uuid, p_route_key text, p_inbound_number text, p_message_id uuid, p_request jsonb, p_message_at timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."apply_whatsapp_client_request_guarded"(p_company_id uuid, p_client_id uuid, p_action text, p_existing_request_id uuid, p_assigned_to uuid, p_route_key text, p_inbound_number text, p_message_id uuid, p_request jsonb, p_message_at timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_refresh_client_primary_assignment"(p_company_id uuid, p_client_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_refresh_client_primary_assignment"(p_company_id uuid, p_client_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."normalize_crm_phone"(p_phone text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."normalize_crm_phone"(p_phone text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."normalize_crm_phone"(p_phone text) TO "service_role";

REVOKE ALL ON FUNCTION public."sync_activity_compat_fields"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."sync_activity_compat_fields"() TO "service_role";

REVOKE ALL ON FUNCTION public."prevent_new_client_phone_duplicate"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."prevent_new_client_phone_duplicate"() TO "service_role";

REVOKE ALL ON FUNCTION public."set_client_phone_normalized"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."set_client_phone_normalized"() TO "service_role";

REVOKE ALL ON FUNCTION public."initialize_property_monitoring"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."initialize_property_monitoring"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."initialize_property_monitoring"() TO "anon";

GRANT EXECUTE ON FUNCTION public."initialize_property_monitoring"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."initialize_property_monitoring"() TO "service_role";

REVOKE ALL ON FUNCTION public."capture_request_response_milestones"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."capture_request_response_milestones"() TO "service_role";

REVOKE ALL ON FUNCTION public."my_company"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."my_company"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."my_company"() TO "service_role";

REVOKE ALL ON FUNCTION public."my_role"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."my_role"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."my_role"() TO "service_role";

REVOKE ALL ON FUNCTION public."crm_funnel_cohort_metrics"(p_period_id uuid, p_branch_key text, p_assigned_to uuid, p_request_type text, p_source text, p_new_client boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_funnel_cohort_metrics"(p_period_id uuid, p_branch_key text, p_assigned_to uuid, p_request_type text, p_source text, p_new_client boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_funnel_cohort_metrics"(p_period_id uuid, p_branch_key text, p_assigned_to uuid, p_request_type text, p_source text, p_new_client boolean) TO "service_role";

REVOKE ALL ON FUNCTION public."record_request_milestone_events"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."record_request_milestone_events"() TO "service_role";

REVOKE ALL ON FUNCTION public."apply_whatsapp_request_batch_guarded"(p_company_id uuid, p_client_id uuid, p_assigned_to uuid, p_route_key text, p_inbound_number text, p_message_id uuid, p_requests jsonb, p_message_at timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."apply_whatsapp_request_batch_guarded"(p_company_id uuid, p_client_id uuid, p_assigned_to uuid, p_route_key text, p_inbound_number text, p_message_id uuid, p_requests jsonb, p_message_at timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_activity_metrics"(p_start_date date, p_end_date date, p_branch_key text, p_assigned_to uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_activity_metrics"(p_start_date date, p_end_date date, p_branch_key text, p_assigned_to uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_activity_metrics"(p_start_date date, p_end_date date, p_branch_key text, p_assigned_to uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_qualified_attendance_opportunity_7d"(p_branch_key text, p_assigned_to uuid, p_new_client boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_qualified_attendance_opportunity_7d"(p_branch_key text, p_assigned_to uuid, p_new_client boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_qualified_attendance_opportunity_7d"(p_branch_key text, p_assigned_to uuid, p_new_client boolean) TO "service_role";

REVOKE ALL ON FUNCTION public."validate_client_request_refs"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."validate_client_request_refs"() TO "service_role";

REVOKE ALL ON FUNCTION public."crm_data_quality_summary"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_data_quality_summary"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_data_quality_summary"() TO "service_role";

REVOKE ALL ON FUNCTION public."sync_request_from_appointment"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."sync_request_from_appointment"() TO "service_role";

REVOKE ALL ON FUNCTION public."crm_sync_property_status"(p_property_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_sync_property_status"(p_property_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_sync_property_status"(p_property_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."sync_request_from_property_inquiry"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."sync_request_from_property_inquiry"() TO "service_role";

REVOKE ALL ON FUNCTION public."crm_set_client_followup_state"(p_client_id uuid, p_action text, p_reason text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_set_client_followup_state"(p_client_id uuid, p_action text, p_reason text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_set_client_followup_state"(p_client_id uuid, p_action text, p_reason text) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_whatsapp_latest_messages"(p_conversation_ids uuid[]) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_whatsapp_latest_messages"(p_conversation_ids uuid[]) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_whatsapp_latest_messages"(p_conversation_ids uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION public."sync_request_from_deposit"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."sync_request_from_deposit"() TO "service_role";

REVOKE ALL ON FUNCTION public."sync_request_from_deal"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."sync_request_from_deal"() TO "service_role";

REVOKE ALL ON FUNCTION public."set_property_marketing_link_identity"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."set_property_marketing_link_identity"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."set_property_marketing_link_identity"() TO "anon";

GRANT EXECUTE ON FUNCTION public."set_property_marketing_link_identity"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."set_property_marketing_link_identity"() TO "service_role";

REVOKE ALL ON FUNCTION public."sync_property_interest_from_appointment_property"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."sync_property_interest_from_appointment_property"() TO "service_role";

REVOKE ALL ON FUNCTION public."property_link_provider"(p_url text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."property_link_provider"(p_url text) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."property_link_provider"(p_url text) TO "anon";

GRANT EXECUTE ON FUNCTION public."property_link_provider"(p_url text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."property_link_provider"(p_url text) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_client_360"(p_client_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_client_360"(p_client_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_client_360"(p_client_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_property_performance"(p_start_date date, p_end_date date, p_branch_key text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_property_performance"(p_start_date date, p_end_date date, p_branch_key text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_property_performance"(p_start_date date, p_end_date date, p_branch_key text) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_due_whatsapp_followups"(p_limit integer) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_due_whatsapp_followups"(p_limit integer) TO "service_role";

REVOKE ALL ON FUNCTION public."record_property_link_inquiry_internal"(p_company_id uuid, p_client_id uuid, p_property_id uuid, p_marketing_event_id uuid, p_whatsapp_message_id uuid, p_raw_url text, p_link_key text, p_message_at timestamp with time zone, p_manual boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."record_property_link_inquiry_internal"(p_company_id uuid, p_client_id uuid, p_property_id uuid, p_marketing_event_id uuid, p_whatsapp_message_id uuid, p_raw_url text, p_link_key text, p_message_at timestamp with time zone, p_manual boolean) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_client_contact_queue"(p_limit integer) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_client_contact_queue"(p_limit integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_client_contact_queue"(p_limit integer) TO "service_role";

REVOKE ALL ON FUNCTION public."sync_deposits_when_deal_closed"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."sync_deposits_when_deal_closed"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."sync_deposits_when_deal_closed"() TO "anon";

GRANT EXECUTE ON FUNCTION public."sync_deposits_when_deal_closed"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."sync_deposits_when_deal_closed"() TO "service_role";

REVOKE ALL ON FUNCTION public."enforce_applied_deposit_on_completed_deal"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."enforce_applied_deposit_on_completed_deal"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."enforce_applied_deposit_on_completed_deal"() TO "anon";

GRANT EXECUTE ON FUNCTION public."enforce_applied_deposit_on_completed_deal"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."enforce_applied_deposit_on_completed_deal"() TO "service_role";

REVOKE ALL ON FUNCTION public."normalize_property_listing_agreement"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."normalize_property_listing_agreement"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."normalize_property_listing_agreement"() TO "anon";

GRANT EXECUTE ON FUNCTION public."normalize_property_listing_agreement"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."normalize_property_listing_agreement"() TO "service_role";

REVOKE ALL ON FUNCTION public."upsert_whatsapp_client_identity"(p_company_id uuid, p_phone text, p_customer_name text, p_route_key text, p_assigned_to uuid, p_inbound_number text, p_message_at timestamp with time zone) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."upsert_whatsapp_client_identity"(p_company_id uuid, p_phone text, p_customer_name text, p_route_key text, p_assigned_to uuid, p_inbound_number text, p_message_at timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION public."touch_client_contact_from_whatsapp"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."touch_client_contact_from_whatsapp"() TO "service_role";

REVOKE ALL ON FUNCTION public."reset_stale_requirement_prompt_on_new_inbound"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."reset_stale_requirement_prompt_on_new_inbound"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."reset_stale_requirement_prompt_on_new_inbound"() TO "anon";

GRANT EXECUTE ON FUNCTION public."reset_stale_requirement_prompt_on_new_inbound"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."reset_stale_requirement_prompt_on_new_inbound"() TO "service_role";

REVOKE ALL ON FUNCTION public."record_deal_stage_history"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."record_deal_stage_history"() TO "service_role";

REVOKE ALL ON FUNCTION public."sync_viewing_to_crm"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."sync_viewing_to_crm"() TO "service_role";

REVOKE ALL ON FUNCTION public."sync_followup_delivery_status"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."sync_followup_delivery_status"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."sync_followup_delivery_status"() TO "anon";

GRANT EXECUTE ON FUNCTION public."sync_followup_delivery_status"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."sync_followup_delivery_status"() TO "service_role";

REVOKE ALL ON FUNCTION public."exclude_internal_numbers_from_followups"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."exclude_internal_numbers_from_followups"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."exclude_internal_numbers_from_followups"() TO "anon";

GRANT EXECUTE ON FUNCTION public."exclude_internal_numbers_from_followups"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."exclude_internal_numbers_from_followups"() TO "service_role";

REVOKE ALL ON FUNCTION public."sync_property_monitoring_from_marketing_event"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."sync_property_monitoring_from_marketing_event"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."sync_property_monitoring_from_marketing_event"() TO "anon";

GRANT EXECUTE ON FUNCTION public."sync_property_monitoring_from_marketing_event"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."sync_property_monitoring_from_marketing_event"() TO "service_role";

REVOKE ALL ON FUNCTION public."crm_property_action_queue"(p_branch_key text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_property_action_queue"(p_branch_key text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_property_action_queue"(p_branch_key text) TO "service_role";

REVOKE ALL ON FUNCTION public."process_followup_reply_from_whatsapp"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."process_followup_reply_from_whatsapp"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."process_followup_reply_from_whatsapp"() TO "anon";

GRANT EXECUTE ON FUNCTION public."process_followup_reply_from_whatsapp"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."process_followup_reply_from_whatsapp"() TO "service_role";

REVOKE ALL ON FUNCTION public."crm_property_source_guard"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_property_source_guard"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."crm_property_source_guard"() TO "anon";

GRANT EXECUTE ON FUNCTION public."crm_property_source_guard"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_property_source_guard"() TO "service_role";

REVOKE ALL ON FUNCTION public."normalize_property_marketing_link"(p_url text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."normalize_property_marketing_link"(p_url text) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."normalize_property_marketing_link"(p_url text) TO "anon";

GRANT EXECUTE ON FUNCTION public."normalize_property_marketing_link"(p_url text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."normalize_property_marketing_link"(p_url text) TO "service_role";

REVOKE ALL ON FUNCTION public."process_property_links_from_whatsapp"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."process_property_links_from_whatsapp"() TO "service_role";

REVOKE ALL ON FUNCTION public."crm_finalize_property_message"(p_message_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_finalize_property_message"(p_message_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_replace_rejection_reasons"(p_inquiry_id uuid, p_reason_ids uuid[], p_primary_id uuid, p_phase text, p_note text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_replace_rejection_reasons"(p_inquiry_id uuid, p_reason_ids uuid[], p_primary_id uuid, p_phase text, p_note text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_replace_rejection_reasons"(p_inquiry_id uuid, p_reason_ids uuid[], p_primary_id uuid, p_phase text, p_note text) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_set_request_geography"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_set_request_geography"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."crm_set_request_geography"() TO "anon";

GRANT EXECUTE ON FUNCTION public."crm_set_request_geography"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_set_request_geography"() TO "service_role";

REVOKE ALL ON FUNCTION public."ignore_unmatched_property_link"(p_unmatched_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."ignore_unmatched_property_link"(p_unmatched_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."ignore_unmatched_property_link"(p_unmatched_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_save_viewing_atomic"(p_payload jsonb, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_save_viewing_atomic"(p_payload jsonb, p_idempotency_key uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_save_viewing_atomic"(p_payload jsonb, p_idempotency_key uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_delete_deal_atomic"(p_deal_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_delete_deal_atomic"(p_deal_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_delete_deal_atomic"(p_deal_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_verify_followup_cron_secret"(p_secret text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_verify_followup_cron_secret"(p_secret text) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_add_property_marketing_links"(p_property_id uuid, p_urls text[]) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_add_property_marketing_links"(p_property_id uuid, p_urls text[]) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_add_property_marketing_links"(p_property_id uuid, p_urls text[]) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_guard_instagram_conversation_counters"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_guard_instagram_conversation_counters"() TO "service_role";

REVOKE ALL ON FUNCTION public."crm_get_deal_workflow"(p_deal_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_get_deal_workflow"(p_deal_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_get_deal_workflow"(p_deal_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_apply_property_image_evidence"(p_message_id uuid, p_evidence jsonb) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_apply_property_image_evidence"(p_message_id uuid, p_evidence jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_touch_whatsapp_conversation"(p_conversation_id uuid, p_message_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_touch_whatsapp_conversation"(p_conversation_id uuid, p_message_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_touch_whatsapp_after_insert"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_touch_whatsapp_after_insert"() TO "service_role";

REVOKE ALL ON FUNCTION public."crm_mark_whatsapp_read"(p_conversation_id uuid, p_message_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_mark_whatsapp_read"(p_conversation_id uuid, p_message_id uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION public."crm_mark_whatsapp_read"(p_conversation_id uuid, p_message_id uuid) TO "authenticated";

REVOKE ALL ON FUNCTION public."crm_touch_instagram_after_insert"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_touch_instagram_after_insert"() TO "service_role";

REVOKE ALL ON FUNCTION public."crm_mark_instagram_read"(p_conversation_id uuid, p_message_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_mark_instagram_read"(p_conversation_id uuid, p_message_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_mark_instagram_read"(p_conversation_id uuid, p_message_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_claim_instagram_send"(p_company_id uuid, p_operation_id uuid, p_conversation_id uuid, p_actor_id uuid, p_body_sha256 text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_claim_instagram_send"(p_company_id uuid, p_operation_id uuid, p_conversation_id uuid, p_actor_id uuid, p_body_sha256 text) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_property_acquisition_funnel"(p_property_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_property_acquisition_funnel"(p_property_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_property_acquisition_funnel"(p_property_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_public_business_routes"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_public_business_routes"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_public_business_routes"() TO "service_role";

REVOKE ALL ON FUNCTION public."resolve_unmatched_property_link"(p_unmatched_id uuid, p_property_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."resolve_unmatched_property_link"(p_unmatched_id uuid, p_property_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."resolve_unmatched_property_link"(p_unmatched_id uuid, p_property_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_guard_whatsapp_conversation_counters"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_guard_whatsapp_conversation_counters"() TO "service_role";

REVOKE ALL ON FUNCTION public."crm_save_deal_workflow"(p_payload jsonb, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_save_deal_workflow"(p_payload jsonb, p_idempotency_key uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_save_deal_workflow"(p_payload jsonb, p_idempotency_key uuid) TO "service_role";

REVOKE ALL ON FUNCTION public."crm_sync_request_assignees"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."crm_sync_request_assignees"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."crm_sync_request_assignees"() TO "anon";

GRANT EXECUTE ON FUNCTION public."crm_sync_request_assignees"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."crm_sync_request_assignees"() TO "service_role";

REVOKE ALL ON FUNCTION public."normalize_request_branch_when_location_missing"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public."normalize_request_branch_when_location_missing"() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public."normalize_request_branch_when_location_missing"() TO "anon";

GRANT EXECUTE ON FUNCTION public."normalize_request_branch_when_location_missing"() TO "authenticated";

GRANT EXECUTE ON FUNCTION public."normalize_request_branch_when_location_missing"() TO "service_role";

REVOKE ALL ON FUNCTION crm_repair_private."staff_can_access_branch"(p_company uuid, p_branch text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION crm_repair_private."staff_can_access_branch"(p_company uuid, p_branch text) TO "authenticated";

GRANT EXECUTE ON FUNCTION crm_repair_private."staff_can_access_branch"(p_company uuid, p_branch text) TO "service_role";

REVOKE ALL ON FUNCTION crm_repair_private."guard_property_branch"() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION crm_repair_private."guard_property_branch"() TO PUBLIC;

REVOKE ALL ON FUNCTION crm_repair_private."apply_property_branch_employee"() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."can_access_request"(p_company_id uuid, p_request_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION crm_repair_private."can_access_request"(p_company_id uuid, p_request_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION crm_repair_private."can_access_request"(p_company_id uuid, p_request_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION crm_repair_private."stamp_first_client_request"() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."can_access_whatsapp_conversation"(p_company_id uuid, p_conversation_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION crm_repair_private."can_access_whatsapp_conversation"(p_company_id uuid, p_conversation_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION crm_repair_private."can_access_whatsapp_conversation"(p_company_id uuid, p_conversation_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION crm_repair_private."can_access_client"(p_company_id uuid, p_client_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION crm_repair_private."can_access_client"(p_company_id uuid, p_client_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION crm_repair_private."can_access_client"(p_company_id uuid, p_client_id uuid) TO "service_role";

REVOKE ALL ON FUNCTION crm_repair_private."guard_property_deal_state"() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."sync_property_after_deal_change"() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."performance_employee"(p_company uuid, p_branch text, p_at timestamp with time zone, p_original uuid) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."guard_request_manual_assignment"() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."property_image_draft_target_available"(p_property_id text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION crm_repair_private."property_image_draft_target_available"(p_property_id text) TO "authenticated";

REVOKE ALL ON FUNCTION crm_repair_private."validate_viewing_refs_and_version"() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."sync_property_status_internal"(p_property_id uuid) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."sync_property_status_checked"(p_property_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION crm_repair_private."sync_property_status_checked"(p_property_id uuid) TO "authenticated";

REVOKE ALL ON FUNCTION crm_repair_private."can_access_property_image"(p_name text, p_owner_id text, p_operation text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION crm_repair_private."can_access_property_image"(p_name text, p_owner_id text, p_operation text) TO "authenticated";

REVOKE ALL ON FUNCTION crm_repair_private."get_deal_workflow"(p_deal_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION crm_repair_private."get_deal_workflow"(p_deal_id uuid) TO "authenticated";

REVOKE ALL ON FUNCTION crm_repair_private."guard_properties_financial_fields"() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."guard_deals_financial_fields"() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."link_viewing_interest"() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."can_access_deal_workflow"(p_deal_id uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION crm_repair_private."can_access_deal_workflow"(p_deal_id uuid) TO "authenticated";

REVOKE ALL ON FUNCTION crm_repair_private."guard_deal_workflow"() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."save_deal_workflow"(p_payload jsonb, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION crm_repair_private."save_deal_workflow"(p_payload jsonb, p_idempotency_key uuid) TO "authenticated";

REVOKE ALL ON FUNCTION crm_repair_private."audit_rejection_change"() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."set_primary_rejection"(p_company uuid, p_client uuid, p_property uuid, p_request uuid, p_inquiry uuid, p_reason uuid, p_note text, p_phase text, p_actor uuid) FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."sync_deal_primary_rejection"() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION crm_repair_private."replace_primary_rejection"(p_inquiry_id uuid, p_reason_ids uuid[], p_primary_id uuid, p_phase text, p_note text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION crm_repair_private."replace_primary_rejection"(p_inquiry_id uuid, p_reason_ids uuid[], p_primary_id uuid, p_phase text, p_note text) TO "authenticated";

REVOKE ALL ON FUNCTION crm_repair_private."whatsapp_request_physical_branch"(p_company_id uuid, p_client_id uuid, p_origin_message_id uuid, p_inbound_number text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION crm_repair_private."whatsapp_request_physical_branch"(p_company_id uuid, p_client_id uuid, p_origin_message_id uuid, p_inbound_number text) TO "service_role";

CREATE TRIGGER protect_profile_sensitive_fields_trigger BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION protect_profile_sensitive_fields();

CREATE TRIGGER crm_audit_deal_rejection AFTER UPDATE OF lost_reason_id, lost_reason_note ON public.deals FOR EACH ROW EXECUTE FUNCTION crm_repair_private.audit_rejection_change();

CREATE TRIGGER crm_guard_deal_workflow BEFORE INSERT OR UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_deal_workflow();

CREATE TRIGGER crm_guard_deals_financial_fields BEFORE INSERT OR UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_deals_financial_fields();

CREATE TRIGGER crm_sync_deal_primary_rejection AFTER INSERT OR UPDATE OF stage, lost_reason_id, lost_reason_note, request_id ON public.deals FOR EACH ROW EXECUTE FUNCTION crm_repair_private.sync_deal_primary_rejection();

CREATE TRIGGER crm_sync_property_after_deal_change AFTER INSERT OR DELETE OR UPDATE OF stage, property_id ON public.deals FOR EACH ROW EXECUTE FUNCTION crm_repair_private.sync_property_after_deal_change();

CREATE TRIGGER trg_record_deal_stage_history AFTER INSERT OR UPDATE OF stage ON public.deals FOR EACH ROW EXECUTE FUNCTION record_deal_stage_history();

CREATE TRIGGER trg_sync_deposits_when_deal_closed AFTER INSERT OR UPDATE OF stage ON public.deals FOR EACH ROW EXECUTE FUNCTION sync_deposits_when_deal_closed();

CREATE TRIGGER trg_sync_request_from_deal AFTER INSERT OR UPDATE OF stage, request_id, closed_at ON public.deals FOR EACH ROW EXECUTE FUNCTION sync_request_from_deal();

CREATE TRIGGER trg_enforce_applied_deposit_on_completed_deal BEFORE INSERT OR UPDATE OF deal_id, status ON public.deposits FOR EACH ROW EXECUTE FUNCTION enforce_applied_deposit_on_completed_deal();

CREATE TRIGGER trg_sync_request_from_deposit AFTER INSERT OR UPDATE OF payment_date, status, deal_id ON public.deposits FOR EACH ROW EXECUTE FUNCTION sync_request_from_deposit();

CREATE TRIGGER crm_link_viewing_interest AFTER INSERT OR UPDATE OF status, archived ON public.viewings FOR EACH ROW EXECUTE FUNCTION crm_repair_private.link_viewing_interest();

CREATE TRIGGER crm_validate_viewing_refs_and_version BEFORE INSERT OR UPDATE ON public.viewings FOR EACH ROW EXECUTE FUNCTION crm_repair_private.validate_viewing_refs_and_version();

CREATE TRIGGER trg_sync_viewing_to_crm AFTER INSERT OR UPDATE OF status, client_feedback, rejection_reason, pipeline_outcome, outcome_note, followup_date, next_step, archived ON public.viewings FOR EACH ROW EXECUTE FUNCTION sync_viewing_to_crm();

CREATE TRIGGER trg_prevent_new_client_phone_duplicate BEFORE INSERT OR UPDATE OF company_id, phone_normalized ON public.clients FOR EACH ROW EXECUTE FUNCTION prevent_new_client_phone_duplicate();

CREATE TRIGGER trg_set_client_phone_normalized BEFORE INSERT OR UPDATE OF phone ON public.clients FOR EACH ROW EXECUTE FUNCTION set_client_phone_normalized();

CREATE TRIGGER trg_property_marketing_link_identity BEFORE INSERT OR UPDATE OF url, link_key, link_provider ON public.property_marketing_events FOR EACH ROW EXECUTE FUNCTION set_property_marketing_link_identity();

CREATE TRIGGER trg_sync_property_monitoring_from_marketing_event AFTER INSERT OR UPDATE OF channel, event_type, published_at, url ON public.property_marketing_events FOR EACH ROW EXECUTE FUNCTION sync_property_monitoring_from_marketing_event();

CREATE TRIGGER trg_crm_guard_whatsapp_counters BEFORE UPDATE ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION crm_guard_whatsapp_conversation_counters();

CREATE TRIGGER trg_capture_request_response_milestones AFTER INSERT OR UPDATE OF request_id ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION capture_request_response_milestones();

CREATE TRIGGER trg_crm_touch_whatsapp_atomic AFTER INSERT ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION crm_touch_whatsapp_after_insert();

CREATE TRIGGER trg_process_followup_reply_from_whatsapp AFTER INSERT ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION process_followup_reply_from_whatsapp();

CREATE TRIGGER trg_process_property_links_from_whatsapp AFTER INSERT ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION process_property_links_from_whatsapp();

CREATE TRIGGER trg_reset_stale_requirement_prompt_on_new_inbound AFTER INSERT ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION reset_stale_requirement_prompt_on_new_inbound();

CREATE TRIGGER trg_sync_followup_delivery_status AFTER UPDATE OF delivery_status ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION sync_followup_delivery_status();

CREATE TRIGGER trg_touch_client_contact_from_whatsapp AFTER INSERT ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION touch_client_contact_from_whatsapp();

CREATE TRIGGER crm_guard_request_manual_assignment BEFORE INSERT OR UPDATE OF manual_assigned_to ON public.client_requests FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_request_manual_assignment();

CREATE TRIGGER crm_stamp_first_client_request BEFORE INSERT ON public.client_requests FOR EACH ROW EXECUTE FUNCTION crm_repair_private.stamp_first_client_request();

CREATE TRIGGER trg_assign_request_geography BEFORE INSERT OR UPDATE OF route_key, branch_key, wilayat, preferred_area, preferred_areas, alternative_areas, status, manual_assigned_to ON public.client_requests FOR EACH ROW EXECUTE FUNCTION crm_set_request_geography();

CREATE TRIGGER trg_audit_client_request AFTER INSERT OR DELETE OR UPDATE ON public.client_requests FOR EACH ROW EXECUTE FUNCTION audit_client_request_change();

CREATE TRIGGER trg_disable_missing_requirements_auto_reply BEFORE INSERT OR UPDATE OF missing_required_fields ON public.client_requests FOR EACH ROW EXECUTE FUNCTION disable_missing_requirements_auto_reply_guard();

CREATE TRIGGER trg_exclude_internal_numbers_from_followups AFTER INSERT OR UPDATE OF client_id, company_id ON public.client_requests FOR EACH ROW EXECUTE FUNCTION exclude_internal_numbers_from_followups();

CREATE TRIGGER trg_normalize_request_branch_when_location_missing BEFORE INSERT OR UPDATE OF branch_key, missing_required_fields ON public.client_requests FOR EACH ROW EXECUTE FUNCTION normalize_request_branch_when_location_missing();

CREATE TRIGGER trg_record_request_milestones AFTER UPDATE OF first_human_response_at, first_mutual_dialogue_at, requirements_completed_at, qualified_at, first_match_sent_at, first_appointment_booked_at, first_appointment_confirmed_at, first_attended_at, serious_interest_at, opportunity_opened_at, negotiation_started_at, deposit_paid_at, contract_completed_at, closed_won_at ON public.client_requests FOR EACH ROW EXECUTE FUNCTION record_request_milestone_events();

CREATE TRIGGER trg_sync_client_summary_from_request AFTER INSERT OR DELETE OR UPDATE ON public.client_requests FOR EACH ROW EXECUTE FUNCTION sync_client_summary_after_request_change();

CREATE TRIGGER trg_sync_request_assignees AFTER INSERT OR UPDATE OF route_key, branch_key, wilayat, preferred_area, preferred_areas, alternative_areas, status, assigned_to, manual_assigned_to ON public.client_requests FOR EACH ROW EXECUTE FUNCTION crm_sync_request_assignees();

CREATE TRIGGER trg_touch_client_request_updated_at BEFORE UPDATE ON public.client_requests FOR EACH ROW EXECUTE FUNCTION touch_client_request_updated_at();

CREATE TRIGGER trg_validate_client_request_refs BEFORE INSERT OR UPDATE ON public.client_requests FOR EACH ROW EXECUTE FUNCTION validate_client_request_refs();

CREATE TRIGGER trg_sync_client_pipeline_from_property_inquiry AFTER INSERT OR UPDATE OF status ON public.property_inquiries FOR EACH ROW EXECUTE FUNCTION sync_client_pipeline_from_property_inquiry();

CREATE TRIGGER trg_sync_request_from_property_inquiry_milestones AFTER INSERT OR UPDATE OF shown_by_agent, match_status, post_visit_interest, status, last_contact_at ON public.property_inquiries FOR EACH ROW EXECUTE FUNCTION sync_request_from_property_inquiry();

CREATE TRIGGER trg_touch_property_inquiry_updated_at BEFORE UPDATE ON public.property_inquiries FOR EACH ROW EXECUTE FUNCTION touch_property_inquiry_updated_at();

CREATE TRIGGER trg_sync_request_from_appointment AFTER INSERT OR UPDATE OF booked_at, confirmed_at, attended_at, status, request_id ON public.appointments FOR EACH ROW EXECUTE FUNCTION sync_request_from_appointment();

CREATE TRIGGER trg_sync_interest_from_appointment_property AFTER INSERT OR UPDATE OF property_id, appointment_id ON public.appointment_properties FOR EACH ROW EXECUTE FUNCTION sync_property_interest_from_appointment_property();

CREATE TRIGGER trg_sync_activity_compat_fields BEFORE INSERT OR UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION sync_activity_compat_fields();

CREATE TRIGGER crm_audit_structured_rejection AFTER UPDATE OF note, is_primary ON public.property_rejection_reasons FOR EACH ROW EXECUTE FUNCTION crm_repair_private.audit_rejection_change();

CREATE TRIGGER crm_guard_properties_financial_fields BEFORE INSERT OR UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_properties_financial_fields();

CREATE TRIGGER crm_guard_property_branch BEFORE INSERT OR UPDATE OF branch_key, wilayat, area ON public.properties FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_property_branch();

CREATE TRIGGER crm_guard_property_deal_state BEFORE UPDATE OF status ON public.properties FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_property_deal_state();

CREATE TRIGGER crm_property_source_guard BEFORE INSERT OR UPDATE OF sourced_by ON public.properties FOR EACH ROW EXECUTE FUNCTION crm_property_source_guard();

CREATE TRIGGER trg_initialize_property_monitoring BEFORE INSERT ON public.properties FOR EACH ROW EXECUTE FUNCTION initialize_property_monitoring();

CREATE TRIGGER trg_normalize_property_listing_agreement BEFORE INSERT OR UPDATE OF has_listing_agreement, agreement_start_date, agreement_duration_months ON public.properties FOR EACH ROW EXECUTE FUNCTION normalize_property_listing_agreement();

CREATE TRIGGER zzzz_property_branch_employee BEFORE INSERT OR UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION crm_repair_private.apply_property_branch_employee();

CREATE TRIGGER trg_crm_guard_instagram_counters BEFORE UPDATE ON public.instagram_conversations FOR EACH ROW EXECUTE FUNCTION crm_guard_instagram_conversation_counters();

CREATE TRIGGER trg_crm_touch_instagram_atomic AFTER INSERT ON public.instagram_messages FOR EACH ROW EXECUTE FUNCTION crm_touch_instagram_after_insert();

SET check_function_bodies=on;
-- The following rows are all synthetic historical fixture state. Replication mode is
-- used only while constructing it, so legacy misassignments exercise the real policies.
SET session_replication_role=replica;
INSERT INTO companies(id,name) VALUES(test_id(1),'SYNTHETIC COMPANY'),(test_id(2),'OTHER SYNTHETIC COMPANY');
INSERT INTO auth.users(id,email) SELECT test_id(n),'synthetic-'||n||'@example.invalid' FROM generate_series(10,16)n;
INSERT INTO profiles(id,company_id,full_name,email,role,is_active) VALUES
(test_id(10),test_id(1),'Synthetic owner','synthetic-10@example.invalid','owner',true),
(test_id(11),test_id(1),'Synthetic Muscat','synthetic-11@example.invalid','agent',true),
(test_id(12),test_id(1),'Synthetic Barka','synthetic-12@example.invalid','agent',true),
(test_id(13),test_id(1),'Synthetic manager','synthetic-13@example.invalid','manager',true),
(test_id(14),test_id(1),'Synthetic viewer','synthetic-14@example.invalid','viewer',true),
(test_id(15),test_id(1),'Synthetic inactive owner','synthetic-15@example.invalid','owner',false),
(test_id(16),test_id(2),'Synthetic foreign owner','synthetic-16@example.invalid','owner',true);
INSERT INTO company_lead_routes(id,company_id,route_key,label,assigned_to,owner_only_inbox,whatsapp_number,meta_phone_number_id)
VALUES(test_id(20),test_id(1),'muscat','Synthetic Muscat',test_id(11),false,'+96890000001','synthetic-muscat'),
(test_id(21),test_id(1),'barka','Synthetic Barka',test_id(12),false,'+96890000002','synthetic-barka'),
(test_id(22),test_id(1),'investment','Synthetic investment',test_id(10),true,'+96890000003','synthetic-investment'),
(test_id(23),test_id(2),'muscat','Synthetic other company',test_id(16),false,'+96890000004','synthetic-other');
INSERT INTO clients(id,company_id,assigned_to,name,phone,phone_normalized,client_type,is_investor,lead_route,source,created_at)
VALUES(test_id(100),test_id(1),test_id(11),'Synthetic Muscat buyer','+96891100100','+96891100100','buyer',false,'muscat','other','2026-01-01'),
(test_id(101),test_id(1),test_id(12),'Synthetic Barka buyer','+96891100101','+96891100101','buyer',false,'barka','other','2026-01-01'),
(test_id(102),test_id(1),test_id(11),'PRIVATE INVESTOR SENTINEL','+96891100102','+96891100102','investor',true,'investment','other','2026-01-01'),
(test_id(103),test_id(1),test_id(11),'Synthetic legacy investor Muscat','+96891100103','+96891100103','investor',true,'muscat','other','2026-01-01'),
(test_id(104),test_id(1),test_id(12),'Synthetic legacy investor Barka','+96891100104','+96891100104','investor',true,'barka','other','2026-01-01'),
(test_id(105),test_id(2),test_id(16),'Synthetic other company','+96891100105','+96891100105','investor',true,'investment','other','2026-01-01'),
(test_id(106),test_id(1),test_id(11),'Synthetic ordinary mixed parent','+96891100106','+96891100106','buyer',false,'muscat','other','2026-01-01');
INSERT INTO properties(id,company_id,title,branch_key,sourced_by,added_by,area,price,status)
VALUES(test_id(300),test_id(1),'Synthetic Muscat property','muscat',test_id(11),test_id(11),'مسقط',100000,'available'),
(test_id(301),test_id(1),'Synthetic Barka property','barka',test_id(12),test_id(12),'بركاء',100000,'available'),
(test_id(302),test_id(1),'PRIVATE INVESTMENT PROPERTY','investment',test_id(10),test_id(10),'Investment',100000,'available');
INSERT INTO client_requests(id,company_id,client_id,request_type,route_key,branch_key,assigned_to,created_by,notes,pipeline_stage,created_at)
VALUES(test_id(200),test_id(1),test_id(100),'buyer','muscat','muscat',test_id(11),test_id(11),'Synthetic Muscat','qualified','2026-01-01'),
(test_id(201),test_id(1),test_id(101),'buyer','barka','barka',test_id(12),test_id(12),'Synthetic Barka','qualified','2026-01-01'),
(test_id(202),test_id(1),test_id(102),'investor','investment','investment',test_id(11),test_id(10),'PRIVATE INVESTOR SENTINEL','qualified','2026-01-01'),
(test_id(203),test_id(1),test_id(103),'investor','muscat','muscat',test_id(11),test_id(11),'Synthetic legacy investor','new','2026-01-01'),
(test_id(204),test_id(1),test_id(104),'investor','barka','barka',test_id(12),test_id(12),'Synthetic legacy investor','new','2026-01-01'),
(test_id(205),test_id(2),test_id(105),'investor','investment','investment',test_id(16),test_id(16),'Synthetic foreign','new','2026-01-01'),
(test_id(206),test_id(1),test_id(106),'investor','investment','investment',test_id(11),test_id(10),'PRIVATE REQUEST ON ORDINARY PARENT','qualified','2026-01-01'),
(test_id(207),test_id(1),test_id(102),'buyer','muscat','muscat',test_id(11),test_id(10),'PRIVATE CLIENT WITH ORDINARY REQUEST','new','2026-01-01');
INSERT INTO client_request_assignees(request_id,company_id,user_id,branch_key)
SELECT id,company_id,assigned_to,branch_key FROM client_requests;
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key,meta_phone_number_id,customer_wa_id,customer_phone,unread_count)
VALUES(test_id(400),test_id(1),test_id(100),test_id(11),'muscat','synthetic-muscat','96891100100','+96891100100',1),
(test_id(401),test_id(1),test_id(101),test_id(12),'barka','synthetic-barka','96891100101','+96891100101',1),
(test_id(402),test_id(1),test_id(102),test_id(11),'investment','synthetic-investment','96891100102','+96891100102',1),
(test_id(403),test_id(1),test_id(102),test_id(12),'barka','synthetic-barka','96891100102','+96891100102',1),
(test_id(404),test_id(1),test_id(106),test_id(11),'investment','synthetic-investment','96891100106','+96891100106',1);
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,request_id,whatsapp_message_id,direction,body,message_timestamp)
VALUES(test_id(500),test_id(1),test_id(400),test_id(100),test_id(200),'wamid.synthetic-500','inbound','Synthetic ordinary','2026-01-02'),
(test_id(501),test_id(1),test_id(401),test_id(101),test_id(201),'wamid.synthetic-501','inbound','Synthetic ordinary','2026-01-02'),
(test_id(502),test_id(1),test_id(402),test_id(102),test_id(202),'wamid.synthetic-502','inbound','PRIVATE INVESTOR SENTINEL','2026-01-02'),
(test_id(503),test_id(1),test_id(403),NULL,NULL,'wamid.synthetic-503','inbound','PRIVATE CONVERSATION ONLY','2026-01-02'),
(test_id(504),test_id(1),test_id(404),test_id(106),test_id(206),'wamid.synthetic-504','inbound','PRIVATE MIXED PARENT','2026-01-02');
INSERT INTO viewings(id,company_id,client_id,property_id,agent_id,viewing_date,status,request_id,created_by)
VALUES(test_id(600),test_id(1),test_id(100),test_id(300),test_id(11),'2026-01-03','done',test_id(200),test_id(11)),
(test_id(601),test_id(1),test_id(101),test_id(301),test_id(12),'2026-01-03','done',test_id(201),test_id(12)),
(test_id(602),test_id(1),test_id(102),test_id(300),test_id(11),'2026-01-03','done',test_id(202),test_id(10)),
(test_id(603),test_id(1),test_id(106),test_id(300),test_id(11),'2026-01-03','done',test_id(206),test_id(10));
INSERT INTO appointments(id,company_id,client_id,request_id,branch_key,agent_id,appointment_at,status)
VALUES(test_id(700),test_id(1),test_id(100),test_id(200),'muscat',test_id(11),'2026-01-03','attended'),
(test_id(701),test_id(1),test_id(101),test_id(201),'barka',test_id(12),'2026-01-03','attended'),
(test_id(702),test_id(1),test_id(102),test_id(202),'muscat',test_id(11),'2026-01-03','attended'),
(test_id(703),test_id(1),test_id(106),test_id(206),'muscat',test_id(11),'2026-01-03','attended');
INSERT INTO deals(id,company_id,client_id,property_id,agent_id,request_id,viewing_id,stage,closed_at,company_commission,company_share,notes)
VALUES(test_id(800),test_id(1),test_id(100),test_id(300),test_id(11),test_id(200),test_id(600),'closed','2026-01-04',1000,1000,'Synthetic ordinary'),
(test_id(801),test_id(1),test_id(101),test_id(301),test_id(12),test_id(201),test_id(601),'closed','2026-01-04',1000,1000,'Synthetic ordinary'),
(test_id(802),test_id(1),test_id(102),test_id(300),test_id(11),test_id(202),test_id(602),'closed','2020-01-04',999999,999999,'PRIVATE INVESTOR SENTINEL'),
(test_id(803),test_id(1),test_id(106),test_id(300),test_id(11),test_id(206),test_id(603),'closed','2026-01-04',999999,999999,'PRIVATE MIXED PARENT');
INSERT INTO tasks(id,company_id,user_id,client_id,deal_id,request_id,viewing_id,title)
VALUES(test_id(900),test_id(1),test_id(11),test_id(100),test_id(800),test_id(200),test_id(600),'Synthetic ordinary'),
(test_id(901),test_id(1),test_id(12),test_id(101),test_id(801),test_id(201),test_id(601),'Synthetic ordinary'),
(test_id(902),test_id(1),test_id(11),test_id(102),test_id(802),test_id(202),test_id(602),'PRIVATE INVESTOR SENTINEL'),
(test_id(903),test_id(1),test_id(11),NULL,test_id(803),NULL,NULL,'PRIVATE DEAL ONLY'),
(test_id(904),test_id(1),test_id(11),test_id(106),NULL,test_id(206),NULL,'PRIVATE REQUEST ONLY'),
(test_id(905),test_id(1),test_id(11),NULL,NULL,NULL,test_id(603),'PRIVATE VIEWING ONLY');
INSERT INTO activities(id,company_id,user_id,client_id,deal_id,request_id,appointment_id,type,description,occurred_at,actor_type)
VALUES(test_id(1000),test_id(1),test_id(11),test_id(100),test_id(800),test_id(200),test_id(700),'call','Synthetic ordinary','2026-01-04','human'),
(test_id(1001),test_id(1),test_id(12),test_id(101),test_id(801),test_id(201),test_id(701),'call','Synthetic ordinary','2026-01-04','human'),
(test_id(1002),test_id(1),test_id(11),test_id(102),test_id(802),test_id(202),test_id(702),'call','PRIVATE INVESTOR SENTINEL','2026-01-04','human'),
(test_id(1003),test_id(1),test_id(11),NULL,NULL,NULL,test_id(703),'call','PRIVATE APPOINTMENT ONLY','2026-01-04','human');
INSERT INTO events(id,company_id,user_id,client_id,title,event_date)
VALUES(test_id(1100),test_id(1),test_id(11),test_id(100),'Synthetic ordinary','2026-01-04'),
(test_id(1102),test_id(1),test_id(11),test_id(102),'PRIVATE INVESTOR SENTINEL','2026-01-04');
INSERT INTO notifications(id,user_id,title,body,link)
VALUES(test_id(1200),test_id(11),'Synthetic ordinary','Synthetic ordinary',NULL);
INSERT INTO client_request_events(id,company_id,request_id,client_id,event_type,occurred_at)
VALUES(test_id(1300),test_id(1),test_id(200),test_id(100),'qualified','2026-01-04'),
(test_id(1301),test_id(1),test_id(201),test_id(101),'qualified','2026-01-04'),
(test_id(1302),test_id(1),test_id(202),test_id(102),'qualified','2026-01-04'),
(test_id(1303),test_id(1),test_id(206),test_id(106),'qualified','2026-01-04');
INSERT INTO property_inquiries(id,company_id,client_id,property_id,request_id,status,source,has_inbound_inquiry,first_inquiry_at,last_inquiry_at)
VALUES(test_id(1400),test_id(1),test_id(100),test_id(300),test_id(200),'viewed','other',true,'2026-01-02','2026-01-02'),
(test_id(1401),test_id(1),test_id(101),test_id(301),test_id(201),'viewed','other',true,'2026-01-02','2026-01-02'),
(test_id(1402),test_id(1),test_id(102),test_id(300),test_id(202),'viewed','other',true,'2026-01-02','2026-01-02'),
(test_id(1403),test_id(1),test_id(106),test_id(300),test_id(206),'viewed','other',true,'2026-01-02','2026-01-02');
INSERT INTO appointment_properties(id,company_id,appointment_id,property_id)
VALUES(test_id(1500),test_id(1),test_id(700),test_id(300)),(test_id(1502),test_id(1),test_id(702),test_id(300)),(test_id(1503),test_id(1),test_id(703),test_id(300));
INSERT INTO deposits(id,company_id,deal_id,client_id,property_id,amount,payment_date)
VALUES(test_id(1600),test_id(1),test_id(800),test_id(100),test_id(300),10,'2026-01-04'),(test_id(1602),test_id(1),test_id(802),test_id(102),test_id(300),999999,'2026-01-04'),(test_id(1603),test_id(1),test_id(803),NULL,test_id(300),999999,'2026-01-04');
INSERT INTO deal_stage_history(id,company_id,deal_id,client_id,property_id,to_stage)
VALUES(test_id(1700),test_id(1),test_id(800),test_id(100),test_id(300),'closed'),(test_id(1702),test_id(1),test_id(802),test_id(102),test_id(300),'closed'),(test_id(1703),test_id(1),test_id(803),NULL,test_id(300),'closed');
INSERT INTO whatsapp_message_requests(company_id,message_id,request_id) VALUES(test_id(1),test_id(502),test_id(202)),(test_id(1),test_id(504),test_id(206));
INSERT INTO whatsapp_followup_optins(client_id,company_id,consent_text,source_message_id,source_conversation_id) VALUES(test_id(102),test_id(1),'PRIVATE INVESTOR SENTINEL',test_id(502),test_id(402));
INSERT INTO whatsapp_followup_optouts(request_id,company_id,client_id,reason,source_message_id) VALUES(test_id(202),test_id(1),test_id(102),'PRIVATE INVESTOR SENTINEL',test_id(502));
INSERT INTO whatsapp_followup_events(id,company_id,request_id,client_id,route_key,conversation_id,step,status)
VALUES(test_id(1802),test_id(1),test_id(202),test_id(102),'investment',test_id(402),'reminder_1','queued');
INSERT INTO instagram_accounts(id,company_id,facebook_page_id,instagram_user_id,connected_by)
VALUES(test_id(1900),test_id(1),'synthetic-page','synthetic-ig',test_id(10));
INSERT INTO instagram_conversations(id,company_id,account_id,client_id,assigned_to,participant_id,unread_count,last_message_seq)
VALUES(test_id(1902),test_id(1),test_id(1900),test_id(102),test_id(11),'synthetic-private-ig',1,1);
INSERT INTO instagram_messages(id,company_id,conversation_id,client_id,instagram_message_id,direction,body)
VALUES(test_id(2002),test_id(1),test_id(1902),NULL,'synthetic-private-message','inbound','PRIVATE CONVERSATION ONLY');
INSERT INTO measurement_periods(id,company_id,name,starts_on,ends_on) VALUES(test_id(2100),test_id(1),'Synthetic reporting period','2026-01-01','2026-01-31');
INSERT INTO rejection_reasons(id,company_id,code,label_ar) VALUES(test_id(2200),test_id(1),'synthetic','Synthetic reason');
INSERT INTO property_rejection_reasons(id,company_id,client_id,request_id,property_id,property_inquiry_id,reason_id,note)
VALUES(test_id(2202),test_id(1),test_id(102),test_id(202),test_id(300),test_id(1402),test_id(2200),'PRIVATE INVESTOR SENTINEL');
INSERT INTO property_marketing_events(id,company_id,property_id,channel,notes) VALUES(test_id(2212),test_id(1),test_id(302),'other','PRIVATE INVESTMENT PROPERTY');
INSERT INTO property_action_reviews(id,company_id,property_id,alert_type,decision_note) VALUES(test_id(2222),test_id(1),test_id(302),'synthetic','PRIVATE INVESTMENT PROPERTY');
INSERT INTO measurement_targets(id,company_id,period_id,branch_key,metric_key,target_value) VALUES(test_id(2232),test_id(1),test_id(2100),'investment','synthetic',99);
INSERT INTO whatsapp_onboarding_events(id,company_id,route_key,initiated_by) VALUES(test_id(2242),test_id(1),'investment',test_id(10));
INSERT INTO whatsapp_automation_events(id,company_id,message_id,action_type,payload) VALUES(test_id(2252),test_id(1),test_id(504),'synthetic','{"synthetic":true}');
INSERT INTO unmatched_property_links(id,company_id,client_id,conversation_id,whatsapp_message_id,raw_url,link_key,provider)
VALUES(test_id(2262),test_id(1),test_id(106),test_id(404),test_id(504),'https://example.invalid/synthetic','synthetic','other');
-- Fake ciphertext strings are deliberately invalid and never call any network sender.
INSERT INTO whatsapp_route_credentials(company_id,route_key,token_ciphertext,token_iv) VALUES(test_id(1),'investment','not-a-token-synthetic-only','not-an-iv');
INSERT INTO instagram_outbound_operations(company_id,operation_id,conversation_id,actor_id,body_sha256) VALUES(test_id(1),test_id(2272),test_id(1902),test_id(11),repeat('0',64));
INSERT INTO whatsapp_template_registry(id,company_id,route_key,waba_id,template_name) VALUES(test_id(2282),test_id(1),'investment','synthetic-waba','synthetic-template');
INSERT INTO whatsapp_send_operations(company_id,user_id,operation_key,client_id,conversation_id,crm_request_id,payload_hash,status)
VALUES(test_id(1),test_id(11),test_id(2292),test_id(106),test_id(404),test_id(206),repeat('0',64),'failed');
INSERT INTO property_message_attributions(id,company_id,message_id,client_id,property_id,inquiry_id,request_id,evidence_key,method)
VALUES(test_id(2302),test_id(1),test_id(504),test_id(106),test_id(300),test_id(1403),test_id(206),'synthetic','manual');

SET session_replication_role=origin;
-- Snapshot exact ordinary records; production migration must never rewrite these rows,
-- including the pre-existing investor flags already assigned to ordinary offices.
CREATE TABLE test_ordinary_before(table_name text,row_id uuid,row_data jsonb);
INSERT INTO test_ordinary_before SELECT 'clients',id,to_jsonb(c) FROM clients c WHERE id IN(test_id(100),test_id(101),test_id(103),test_id(104),test_id(106));
INSERT INTO test_ordinary_before SELECT 'client_requests',id,to_jsonb(r) FROM client_requests r WHERE id IN(test_id(200),test_id(201),test_id(203),test_id(204));
INSERT INTO test_ordinary_before SELECT 'whatsapp_conversations',id,to_jsonb(c) FROM whatsapp_conversations c WHERE id IN(test_id(400),test_id(401));
INSERT INTO test_ordinary_before SELECT 'deals',id,to_jsonb(d) FROM deals d WHERE id IN(test_id(800),test_id(801));
INSERT INTO test_ordinary_before SELECT 'company_lead_routes',id,to_jsonb(r) FROM company_lead_routes r WHERE id IN(test_id(20),test_id(21));
CREATE FUNCTION test_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',msg;END IF;END$$;
-- Establish that this is a real regression fixture: old company-wide manager/client
-- and assigned-staff task policies do leak canonical investment data before SQL18.
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(13)::text,false);
SELECT test_assert(EXISTS(SELECT 1 FROM clients WHERE id=test_id(102)),'baseline manager leak was not reproduced');
SELECT test_assert(EXISTS(SELECT 1 FROM tasks WHERE id=test_id(902)),'baseline manager task leak was not reproduced');
SELECT set_config('test.actor',test_id(11)::text,false);
SELECT test_assert(EXISTS(SELECT 1 FROM clients WHERE id=test_id(103)),'baseline legacy investor flag is not visible to Muscat');
SELECT set_config('test.actor',test_id(12)::text,false);
SELECT test_assert(EXISTS(SELECT 1 FROM clients WHERE id=test_id(104)),'baseline legacy investor flag is not visible to Barka');
RESET ROLE;
SELECT set_config('test.actor','',false);
-- Capture the pre-migration role visibility of ordinary records, not only values.
-- Each query runs as authenticated with the corresponding synthetic JWT subject.
CREATE FUNCTION test_ordinary_visibility() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_object_agg(surface,coalesce(ids,'[]'::jsonb)) FROM (
 SELECT 'clients' surface,jsonb_agg(id ORDER BY id) ids FROM clients WHERE id IN(test_id(100),test_id(101),test_id(103),test_id(104),test_id(106))
 UNION ALL SELECT 'requests',jsonb_agg(id ORDER BY id) FROM client_requests WHERE id IN(test_id(200),test_id(201),test_id(203),test_id(204))
 UNION ALL SELECT 'conversations',jsonb_agg(id ORDER BY id) FROM whatsapp_conversations WHERE id IN(test_id(400),test_id(401))
 UNION ALL SELECT 'messages',jsonb_agg(id ORDER BY id) FROM whatsapp_messages WHERE id IN(test_id(500),test_id(501))
 UNION ALL SELECT 'viewings',jsonb_agg(id ORDER BY id) FROM viewings WHERE id IN(test_id(600),test_id(601))
 UNION ALL SELECT 'appointments',jsonb_agg(id ORDER BY id) FROM appointments WHERE id IN(test_id(700),test_id(701))
 UNION ALL SELECT 'deals',jsonb_agg(id ORDER BY id) FROM crm_deals_access WHERE id IN(test_id(800),test_id(801))
 UNION ALL SELECT 'tasks',jsonb_agg(id ORDER BY id) FROM tasks WHERE id IN(test_id(900),test_id(901))
 UNION ALL SELECT 'activities',jsonb_agg(id ORDER BY id) FROM activities WHERE id IN(test_id(1000),test_id(1001))
 UNION ALL SELECT 'properties',jsonb_agg(id ORDER BY id) FROM crm_properties_access WHERE id IN(test_id(300),test_id(301))
 UNION ALL SELECT 'routes',jsonb_agg(id ORDER BY id) FROM company_lead_routes WHERE id IN(test_id(20),test_id(21))
 ) q;
$$;
CREATE TABLE test_ordinary_visibility_before(actor uuid PRIMARY KEY,visibility jsonb NOT NULL);
GRANT SELECT,INSERT ON test_ordinary_visibility_before TO authenticated;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(10)::text,false);INSERT INTO test_ordinary_visibility_before VALUES(auth.uid(),test_ordinary_visibility());
SELECT set_config('test.actor',test_id(11)::text,false);INSERT INTO test_ordinary_visibility_before VALUES(auth.uid(),test_ordinary_visibility());
SELECT set_config('test.actor',test_id(12)::text,false);INSERT INTO test_ordinary_visibility_before VALUES(auth.uid(),test_ordinary_visibility());
SELECT set_config('test.actor',test_id(13)::text,false);INSERT INTO test_ordinary_visibility_before VALUES(auth.uid(),test_ordinary_visibility());
SELECT set_config('test.actor',test_id(14)::text,false);INSERT INTO test_ordinary_visibility_before VALUES(auth.uid(),test_ordinary_visibility());
SELECT set_config('test.actor',test_id(15)::text,false);INSERT INTO test_ordinary_visibility_before VALUES(auth.uid(),test_ordinary_visibility());
SELECT set_config('test.actor',test_id(16)::text,false);INSERT INTO test_ordinary_visibility_before VALUES(auth.uid(),test_ordinary_visibility());
RESET ROLE;
SELECT set_config('test.actor','',false);
REVOKE INSERT ON test_ordinary_visibility_before FROM authenticated;
