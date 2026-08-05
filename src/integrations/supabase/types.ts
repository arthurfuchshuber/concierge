export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_member_invites: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          owner_id: string
          role: Database["public"]["Enums"]["account_member_role"]
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          owner_id: string
          role?: Database["public"]["Enums"]["account_member_role"]
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          owner_id?: string
          role?: Database["public"]["Enums"]["account_member_role"]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      account_member_permissions: {
        Row: {
          granted: boolean
          member_user_id: string
          owner_id: string
          permission: Database["public"]["Enums"]["member_permission"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          granted?: boolean
          member_user_id: string
          owner_id: string
          permission: Database["public"]["Enums"]["member_permission"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          granted?: boolean
          member_user_id?: string
          owner_id?: string
          permission?: Database["public"]["Enums"]["member_permission"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      account_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          member_user_id: string
          owner_id: string
          role: Database["public"]["Enums"]["account_member_role"]
          status: Database["public"]["Enums"]["account_member_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          member_user_id: string
          owner_id: string
          role?: Database["public"]["Enums"]["account_member_role"]
          status?: Database["public"]["Enums"]["account_member_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          member_user_id?: string
          owner_id?: string
          role?: Database["public"]["Enums"]["account_member_role"]
          status?: Database["public"]["Enums"]["account_member_status"]
          updated_at?: string
        }
        Relationships: []
      }
      admin_invites: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_agent_evaluations: {
        Row: {
          accuracy_score: number | null
          actual_agent: string | null
          actual_sources: Json
          actual_tools: Json
          confidence_score: number | null
          created_at: string
          evaluation_status: string
          expected_agent: string | null
          expected_behavior: string | null
          expected_sources: Json
          expected_tools: Json
          generated_response: string | null
          human_score: number | null
          id: string
          input_message: string
          latency_ms: number | null
          models: Json | null
          notes: string | null
          prompt_versions: Json | null
          property_id: string | null
          quality_score: number | null
          reflection_score: number | null
          regression_baseline_id: string | null
          regression_result: string | null
          run_id: string | null
          suite: string
          tenant_id: string | null
          test_case_name: string
          updated_at: string
        }
        Insert: {
          accuracy_score?: number | null
          actual_agent?: string | null
          actual_sources?: Json
          actual_tools?: Json
          confidence_score?: number | null
          created_at?: string
          evaluation_status?: string
          expected_agent?: string | null
          expected_behavior?: string | null
          expected_sources?: Json
          expected_tools?: Json
          generated_response?: string | null
          human_score?: number | null
          id?: string
          input_message: string
          latency_ms?: number | null
          models?: Json | null
          notes?: string | null
          prompt_versions?: Json | null
          property_id?: string | null
          quality_score?: number | null
          reflection_score?: number | null
          regression_baseline_id?: string | null
          regression_result?: string | null
          run_id?: string | null
          suite?: string
          tenant_id?: string | null
          test_case_name: string
          updated_at?: string
        }
        Update: {
          accuracy_score?: number | null
          actual_agent?: string | null
          actual_sources?: Json
          actual_tools?: Json
          confidence_score?: number | null
          created_at?: string
          evaluation_status?: string
          expected_agent?: string | null
          expected_behavior?: string | null
          expected_sources?: Json
          expected_tools?: Json
          generated_response?: string | null
          human_score?: number | null
          id?: string
          input_message?: string
          latency_ms?: number | null
          models?: Json | null
          notes?: string | null
          prompt_versions?: Json | null
          property_id?: string | null
          quality_score?: number | null
          reflection_score?: number | null
          regression_baseline_id?: string | null
          regression_result?: string | null
          run_id?: string | null
          suite?: string
          tenant_id?: string | null
          test_case_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_evaluations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_evaluations_regression_baseline_id_fkey"
            columns: ["regression_baseline_id"]
            isOneToOne: false
            referencedRelation: "ai_agent_evaluations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agent_learning_metrics: {
        Row: {
          agent_type: string
          created_at: string
          id: string
          metadata: Json
          metric: string
          owner_id: string
          period: string
          period_start: string
          previous_value: number | null
          sample_size: number
          tenant_id: string
          trend: string
          value: number
        }
        Insert: {
          agent_type: string
          created_at?: string
          id?: string
          metadata?: Json
          metric: string
          owner_id: string
          period?: string
          period_start?: string
          previous_value?: number | null
          sample_size?: number
          tenant_id: string
          trend?: string
          value?: number
        }
        Update: {
          agent_type?: string
          created_at?: string
          id?: string
          metadata?: Json
          metric?: string
          owner_id?: string
          period?: string
          period_start?: string
          previous_value?: number | null
          sample_size?: number
          tenant_id?: string
          trend?: string
          value?: number
        }
        Relationships: []
      }
      ai_agent_logs: {
        Row: {
          action_approval_status: string | null
          autonomy_level: string | null
          channel_origin: string | null
          channel_reference: string | null
          confidence: number | null
          confidence_tier: string | null
          context_keys: Json | null
          conversation_id: string | null
          cost_estimate: number | null
          created_at: string
          error: string | null
          escalation_id: string | null
          escalation_triggered: boolean
          evaluation_score: number | null
          guest_context_snapshot: Json | null
          human_response_used: boolean
          id: string
          intent: Json | null
          latency_ms: number | null
          learning_created: boolean
          memories_retrieved: Json | null
          memory_confidence_score: number | null
          memory_context_used: boolean
          memory_saved: boolean
          memory_scope: string | null
          models: Json | null
          needs_human: boolean
          operational_context_snapshot: Json | null
          orchestrator_decision: Json | null
          owner_id: string | null
          plan: Json | null
          proactive_trigger: string | null
          prompt_versions: Json | null
          property_id: string | null
          reflection: Json | null
          regression_test_result: string | null
          root_cause: Json | null
          selected_agent: string | null
          source_weight: number | null
          sources: Json | null
          surface: string
          tenant_id: string | null
          tokens: Json | null
          tools_used: Json | null
          validation: Json | null
        }
        Insert: {
          action_approval_status?: string | null
          autonomy_level?: string | null
          channel_origin?: string | null
          channel_reference?: string | null
          confidence?: number | null
          confidence_tier?: string | null
          context_keys?: Json | null
          conversation_id?: string | null
          cost_estimate?: number | null
          created_at?: string
          error?: string | null
          escalation_id?: string | null
          escalation_triggered?: boolean
          evaluation_score?: number | null
          guest_context_snapshot?: Json | null
          human_response_used?: boolean
          id?: string
          intent?: Json | null
          latency_ms?: number | null
          learning_created?: boolean
          memories_retrieved?: Json | null
          memory_confidence_score?: number | null
          memory_context_used?: boolean
          memory_saved?: boolean
          memory_scope?: string | null
          models?: Json | null
          needs_human?: boolean
          operational_context_snapshot?: Json | null
          orchestrator_decision?: Json | null
          owner_id?: string | null
          plan?: Json | null
          proactive_trigger?: string | null
          prompt_versions?: Json | null
          property_id?: string | null
          reflection?: Json | null
          regression_test_result?: string | null
          root_cause?: Json | null
          selected_agent?: string | null
          source_weight?: number | null
          sources?: Json | null
          surface?: string
          tenant_id?: string | null
          tokens?: Json | null
          tools_used?: Json | null
          validation?: Json | null
        }
        Update: {
          action_approval_status?: string | null
          autonomy_level?: string | null
          channel_origin?: string | null
          channel_reference?: string | null
          confidence?: number | null
          confidence_tier?: string | null
          context_keys?: Json | null
          conversation_id?: string | null
          cost_estimate?: number | null
          created_at?: string
          error?: string | null
          escalation_id?: string | null
          escalation_triggered?: boolean
          evaluation_score?: number | null
          guest_context_snapshot?: Json | null
          human_response_used?: boolean
          id?: string
          intent?: Json | null
          latency_ms?: number | null
          learning_created?: boolean
          memories_retrieved?: Json | null
          memory_confidence_score?: number | null
          memory_context_used?: boolean
          memory_saved?: boolean
          memory_scope?: string | null
          models?: Json | null
          needs_human?: boolean
          operational_context_snapshot?: Json | null
          orchestrator_decision?: Json | null
          owner_id?: string | null
          plan?: Json | null
          proactive_trigger?: string | null
          prompt_versions?: Json | null
          property_id?: string | null
          reflection?: Json | null
          regression_test_result?: string | null
          root_cause?: Json | null
          selected_agent?: string | null
          source_weight?: number | null
          sources?: Json | null
          surface?: string
          tenant_id?: string | null
          tokens?: Json | null
          tools_used?: Json | null
          validation?: Json | null
        }
        Relationships: []
      }
      ai_agent_metrics: {
        Row: {
          agent_type: string
          created_at: string
          dimension: string | null
          id: string
          metadata: Json
          metric_name: string
          metric_value: number
          period: string
          period_start: string
          property_id: string | null
          sample_size: number
          tenant_id: string | null
        }
        Insert: {
          agent_type?: string
          created_at?: string
          dimension?: string | null
          id?: string
          metadata?: Json
          metric_name: string
          metric_value: number
          period?: string
          period_start?: string
          property_id?: string | null
          sample_size?: number
          tenant_id?: string | null
        }
        Update: {
          agent_type?: string
          created_at?: string
          dimension?: string | null
          id?: string
          metadata?: Json
          metric_name?: string
          metric_value?: number
          period?: string
          period_start?: string
          property_id?: string | null
          sample_size?: number
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_metrics_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          baseline_value: number | null
          created_at: string
          detail: string | null
          id: string
          kind: string
          metadata: Json
          metric_value: number | null
          property_id: string | null
          severity: string
          status: string
          tenant_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          baseline_value?: number | null
          created_at?: string
          detail?: string | null
          id?: string
          kind: string
          metadata?: Json
          metric_value?: number | null
          property_id?: string | null
          severity?: string
          status?: string
          tenant_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          baseline_value?: number | null
          created_at?: string
          detail?: string | null
          id?: string
          kind?: string
          metadata?: Json
          metric_value?: number | null
          property_id?: string | null
          severity?: string
          status?: string
          tenant_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_channel_connections: {
        Row: {
          channel_type: string
          connected_at: string | null
          created_at: string
          credentials_reference: string | null
          external_identity: string | null
          id: string
          last_error: string | null
          last_seen_at: string | null
          metadata: Json
          provider: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          channel_type: string
          connected_at?: string | null
          created_at?: string
          credentials_reference?: string | null
          external_identity?: string | null
          id?: string
          last_error?: string | null
          last_seen_at?: string | null
          metadata?: Json
          provider: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          channel_type?: string
          connected_at?: string | null
          created_at?: string
          credentials_reference?: string | null
          external_identity?: string | null
          id?: string
          last_error?: string | null
          last_seen_at?: string | null
          metadata?: Json
          provider?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_conversation_channels: {
        Row: {
          channel_type: string
          conversation_id: string
          created_at: string
          external_reference: string | null
          external_thread_id: string | null
          id: string
          locale: string | null
          metadata: Json
          property_id: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          channel_type?: string
          conversation_id: string
          created_at?: string
          external_reference?: string | null
          external_thread_id?: string | null
          id?: string
          locale?: string | null
          metadata?: Json
          property_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          channel_type?: string
          conversation_id?: string
          created_at?: string
          external_reference?: string | null
          external_thread_id?: string | null
          id?: string
          locale?: string | null
          metadata?: Json
          property_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversation_channels_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "property_chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_conversation_channels_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversation_summaries: {
        Row: {
          conversation_id: string
          created_at: string
          language: string | null
          owner_id: string | null
          property_id: string | null
          risk: string | null
          sentiment: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          language?: string | null
          owner_id?: string | null
          property_id?: string | null
          risk?: string | null
          sentiment?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          language?: string | null
          owner_id?: string | null
          property_id?: string | null
          risk?: string | null
          sentiment?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_conversations: {
        Row: {
          assigned_agent: string | null
          assigned_user_id: string | null
          channel_origin: string
          created_at: string
          guest_id: string | null
          guest_name: string | null
          guest_phone: string | null
          id: string
          last_message_at: string
          legacy_conversation_id: string | null
          metadata: Json
          property_id: string | null
          reservation_id: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_agent?: string | null
          assigned_user_id?: string | null
          channel_origin?: string
          created_at?: string
          guest_id?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          last_message_at?: string
          legacy_conversation_id?: string | null
          metadata?: Json
          property_id?: string | null
          reservation_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_agent?: string | null
          assigned_user_id?: string | null
          channel_origin?: string
          created_at?: string
          guest_id?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          id?: string
          last_message_at?: string
          legacy_conversation_id?: string | null
          metadata?: Json
          property_id?: string | null
          reservation_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_legacy_conversation_id_fkey"
            columns: ["legacy_conversation_id"]
            isOneToOne: false
            referencedRelation: "property_chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_conversations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_global_intelligence: {
        Row: {
          category: string
          confidence: number
          created_at: string
          created_by: string | null
          evidence: Json
          id: string
          impact_estimate: string | null
          impact_percentage: number | null
          insight: string
          metadata: Json
          published_at: string | null
          source_conversations: number
          source_tenants: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          confidence?: number
          created_at?: string
          created_by?: string | null
          evidence?: Json
          id?: string
          impact_estimate?: string | null
          impact_percentage?: number | null
          insight: string
          metadata?: Json
          published_at?: string | null
          source_conversations?: number
          source_tenants?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          confidence?: number
          created_at?: string
          created_by?: string | null
          evidence?: Json
          id?: string
          impact_estimate?: string | null
          impact_percentage?: number | null
          insight?: string
          metadata?: Json
          published_at?: string | null
          source_conversations?: number
          source_tenants?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_guest_memory: {
        Row: {
          created_at: string
          guest_key: string
          guest_name: string | null
          id: string
          language: string | null
          owner_id: string
          preferences: Json
          property_id: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          guest_key: string
          guest_name?: string | null
          id?: string
          language?: string | null
          owner_id: string
          preferences?: Json
          property_id?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          guest_key?: string
          guest_name?: string | null
          id?: string
          language?: string | null
          owner_id?: string
          preferences?: Json
          property_id?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_guest_memory_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_human_escalations: {
        Row: {
          agent_type: string
          applied_to_guest: boolean
          confidence_score: number | null
          context_snapshot: Json
          conversation_id: string | null
          created_at: string
          guest_key: string | null
          guest_name: string | null
          human_response: string | null
          human_user_id: string | null
          id: string
          owner_id: string
          property_id: string | null
          question_to_human: string
          reason: string
          resolved_at: string | null
          status: string
          tenant_id: string | null
          trigger: string
          updated_at: string
        }
        Insert: {
          agent_type?: string
          applied_to_guest?: boolean
          confidence_score?: number | null
          context_snapshot?: Json
          conversation_id?: string | null
          created_at?: string
          guest_key?: string | null
          guest_name?: string | null
          human_response?: string | null
          human_user_id?: string | null
          id?: string
          owner_id: string
          property_id?: string | null
          question_to_human: string
          reason: string
          resolved_at?: string | null
          status?: string
          tenant_id?: string | null
          trigger?: string
          updated_at?: string
        }
        Update: {
          agent_type?: string
          applied_to_guest?: boolean
          confidence_score?: number | null
          context_snapshot?: Json
          conversation_id?: string | null
          created_at?: string
          guest_key?: string | null
          guest_name?: string | null
          human_response?: string | null
          human_user_id?: string | null
          id?: string
          owner_id?: string
          property_id?: string | null
          question_to_human?: string
          reason?: string
          resolved_at?: string | null
          status?: string
          tenant_id?: string | null
          trigger?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_human_escalations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_kb_chunks: {
        Row: {
          confidence: number
          content: string
          content_hash: string | null
          created_at: string
          embedding: string | null
          id: string
          owner_id: string
          property_id: string | null
          source: string
          source_id: string | null
          tenant_id: string | null
          title: string | null
          tsv: unknown
          updated_at: string
        }
        Insert: {
          confidence?: number
          content: string
          content_hash?: string | null
          created_at?: string
          embedding?: string | null
          id?: string
          owner_id: string
          property_id?: string | null
          source: string
          source_id?: string | null
          tenant_id?: string | null
          title?: string | null
          tsv?: unknown
          updated_at?: string
        }
        Update: {
          confidence?: number
          content?: string
          content_hash?: string | null
          created_at?: string
          embedding?: string | null
          id?: string
          owner_id?: string
          property_id?: string | null
          source?: string
          source_id?: string | null
          tenant_id?: string | null
          title?: string | null
          tsv?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_kb_chunks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_knowledge_gaps: {
        Row: {
          avg_confidence: number | null
          created_at: string
          escalation_count: number
          first_seen_at: string
          id: string
          last_seen_at: string
          metadata: Json
          normalized_key: string
          occurrences: number
          owner_id: string
          property_id: string | null
          resolved_at: string | null
          sample_questions: Json
          status: string
          tenant_id: string
          topic: string
          updated_at: string
        }
        Insert: {
          avg_confidence?: number | null
          created_at?: string
          escalation_count?: number
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          normalized_key: string
          occurrences?: number
          owner_id: string
          property_id?: string | null
          resolved_at?: string | null
          sample_questions?: Json
          status?: string
          tenant_id: string
          topic: string
          updated_at?: string
        }
        Update: {
          avg_confidence?: number | null
          created_at?: string
          escalation_count?: number
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          metadata?: Json
          normalized_key?: string
          occurrences?: number
          owner_id?: string
          property_id?: string | null
          resolved_at?: string | null
          sample_questions?: Json
          status?: string
          tenant_id?: string
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_learning_candidates: {
        Row: {
          agent_type: string | null
          application_history: Json
          applied_at: string | null
          applied_memory_id: string | null
          approval_history: Json
          approval_status: string
          approved_scope: string | null
          category: string | null
          confidence: number
          created_at: string
          dedupe_key: string | null
          estimated_impact: string | null
          event_origin: string | null
          extracted_information: string | null
          id: string
          learning_type: string
          memory_kind: string
          owner_id: string
          promoted_global_id: string | null
          property_id: string | null
          proposed_memory: string
          rationale: string | null
          recommended_scope: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_conversation_id: string | null
          source_escalation_id: string | null
          suggested_scope: string | null
          tenant_id: string | null
          tenant_origin: string | null
          title: string | null
          ttl_days: number | null
          updated_at: string
          validation: Json
        }
        Insert: {
          agent_type?: string | null
          application_history?: Json
          applied_at?: string | null
          applied_memory_id?: string | null
          approval_history?: Json
          approval_status?: string
          approved_scope?: string | null
          category?: string | null
          confidence?: number
          created_at?: string
          dedupe_key?: string | null
          estimated_impact?: string | null
          event_origin?: string | null
          extracted_information?: string | null
          id?: string
          learning_type?: string
          memory_kind?: string
          owner_id: string
          promoted_global_id?: string | null
          property_id?: string | null
          proposed_memory: string
          rationale?: string | null
          recommended_scope?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_conversation_id?: string | null
          source_escalation_id?: string | null
          suggested_scope?: string | null
          tenant_id?: string | null
          tenant_origin?: string | null
          title?: string | null
          ttl_days?: number | null
          updated_at?: string
          validation?: Json
        }
        Update: {
          agent_type?: string | null
          application_history?: Json
          applied_at?: string | null
          applied_memory_id?: string | null
          approval_history?: Json
          approval_status?: string
          approved_scope?: string | null
          category?: string | null
          confidence?: number
          created_at?: string
          dedupe_key?: string | null
          estimated_impact?: string | null
          event_origin?: string | null
          extracted_information?: string | null
          id?: string
          learning_type?: string
          memory_kind?: string
          owner_id?: string
          promoted_global_id?: string | null
          property_id?: string | null
          proposed_memory?: string
          rationale?: string | null
          recommended_scope?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_conversation_id?: string | null
          source_escalation_id?: string | null
          suggested_scope?: string | null
          tenant_id?: string | null
          tenant_origin?: string | null
          title?: string | null
          ttl_days?: number | null
          updated_at?: string
          validation?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_learning_candidates_promoted_global_id_fkey"
            columns: ["promoted_global_id"]
            isOneToOne: false
            referencedRelation: "ai_global_intelligence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_learning_candidates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_learning_candidates_source_escalation_id_fkey"
            columns: ["source_escalation_id"]
            isOneToOne: false
            referencedRelation: "ai_human_escalations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_learning_impact_logs: {
        Row: {
          created_at: string
          id: string
          improvement_percentage: number | null
          learning_id: string | null
          measured_at: string
          metadata: Json
          metric: string
          metric_after: number | null
          metric_before: number | null
          owner_id: string
          sample_after: number
          sample_before: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          improvement_percentage?: number | null
          learning_id?: string | null
          measured_at?: string
          metadata?: Json
          metric: string
          metric_after?: number | null
          metric_before?: number | null
          owner_id: string
          sample_after?: number
          sample_before?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          improvement_percentage?: number | null
          learning_id?: string | null
          measured_at?: string
          metadata?: Json
          metric?: string
          metric_after?: number | null
          metric_before?: number | null
          owner_id?: string
          sample_after?: number
          sample_before?: number
          tenant_id?: string
        }
        Relationships: []
      }
      ai_memories: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          author: string | null
          category: string | null
          confidence: number
          content: string
          content_hash: string | null
          created_at: string
          embedding: string | null
          expires_at: string | null
          failure_count: number
          guest_name: string | null
          id: string
          importance: number
          kind: string
          last_seen_at: string
          last_used_at: string | null
          memory_usage_count: number
          metadata: Json
          occurrences: number
          owner_id: string
          property_id: string | null
          scope: string
          source: string
          source_ref: string | null
          subject_key: string | null
          success_count: number
          tenant_id: string | null
          title: string | null
          tsv: unknown
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          author?: string | null
          category?: string | null
          confidence?: number
          content: string
          content_hash?: string | null
          created_at?: string
          embedding?: string | null
          expires_at?: string | null
          failure_count?: number
          guest_name?: string | null
          id?: string
          importance?: number
          kind?: string
          last_seen_at?: string
          last_used_at?: string | null
          memory_usage_count?: number
          metadata?: Json
          occurrences?: number
          owner_id: string
          property_id?: string | null
          scope?: string
          source?: string
          source_ref?: string | null
          subject_key?: string | null
          success_count?: number
          tenant_id?: string | null
          title?: string | null
          tsv?: unknown
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          author?: string | null
          category?: string | null
          confidence?: number
          content?: string
          content_hash?: string | null
          created_at?: string
          embedding?: string | null
          expires_at?: string | null
          failure_count?: number
          guest_name?: string | null
          id?: string
          importance?: number
          kind?: string
          last_seen_at?: string
          last_used_at?: string | null
          memory_usage_count?: number
          metadata?: Json
          occurrences?: number
          owner_id?: string
          property_id?: string | null
          scope?: string
          source?: string
          source_ref?: string | null
          subject_key?: string | null
          success_count?: number
          tenant_id?: string | null
          title?: string | null
          tsv?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_memories_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_messages: {
        Row: {
          agent_key: string | null
          channel_origin: string
          confidence: number | null
          conversation_id: string
          cost_usd: number | null
          created_at: string
          delivery_status: string | null
          external_id: string | null
          id: string
          message_content: string
          metadata: Json
          property_id: string | null
          sender_type: string
          tenant_id: string
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          agent_key?: string | null
          channel_origin?: string
          confidence?: number | null
          conversation_id: string
          cost_usd?: number | null
          created_at?: string
          delivery_status?: string | null
          external_id?: string | null
          id?: string
          message_content: string
          metadata?: Json
          property_id?: string | null
          sender_type: string
          tenant_id: string
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          agent_key?: string | null
          channel_origin?: string
          confidence?: number | null
          conversation_id?: string
          cost_usd?: number | null
          created_at?: string
          delivery_status?: string | null
          external_id?: string | null
          id?: string
          message_content?: string
          metadata?: Json
          property_id?: string | null
          sender_type?: string
          tenant_id?: string
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_operational_memory: {
        Row: {
          category: string
          conversation_id: string | null
          created_at: string
          guest_key: string | null
          guest_name: string | null
          id: string
          metadata: Json
          owner_id: string
          property_id: string | null
          provider_id: string | null
          provider_name: string | null
          recurrence_count: number
          request: string
          resolution: string | null
          resolution_minutes: number | null
          resolved_at: string | null
          satisfaction: string | null
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          conversation_id?: string | null
          created_at?: string
          guest_key?: string | null
          guest_name?: string | null
          id?: string
          metadata?: Json
          owner_id: string
          property_id?: string | null
          provider_id?: string | null
          provider_name?: string | null
          recurrence_count?: number
          request: string
          resolution?: string | null
          resolution_minutes?: number | null
          resolved_at?: string | null
          satisfaction?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          conversation_id?: string | null
          created_at?: string
          guest_key?: string | null
          guest_name?: string | null
          id?: string
          metadata?: Json
          owner_id?: string
          property_id?: string | null
          provider_id?: string | null
          provider_name?: string | null
          recurrence_count?: number
          request?: string
          resolution?: string | null
          resolution_minutes?: number | null
          resolved_at?: string | null
          satisfaction?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_operational_memory_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_proactive_actions: {
        Row: {
          action_payload: Json
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          autonomy_level: string
          conversation_id: string | null
          created_at: string
          dedupe_key: string | null
          error: string | null
          executed_action: string | null
          executed_at: string | null
          guest_id: string | null
          guest_name: string | null
          id: string
          owner_id: string | null
          property_id: string | null
          recommended_action: string
          reservation_id: string | null
          rule_key: string
          scheduled_for: string | null
          status: string
          tenant_id: string | null
          trigger_event: string
          trigger_payload: Json
          updated_at: string
        }
        Insert: {
          action_payload?: Json
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          autonomy_level?: string
          conversation_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          error?: string | null
          executed_action?: string | null
          executed_at?: string | null
          guest_id?: string | null
          guest_name?: string | null
          id?: string
          owner_id?: string | null
          property_id?: string | null
          recommended_action: string
          reservation_id?: string | null
          rule_key: string
          scheduled_for?: string | null
          status?: string
          tenant_id?: string | null
          trigger_event: string
          trigger_payload?: Json
          updated_at?: string
        }
        Update: {
          action_payload?: Json
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          autonomy_level?: string
          conversation_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          error?: string | null
          executed_action?: string | null
          executed_at?: string | null
          guest_id?: string | null
          guest_name?: string | null
          id?: string
          owner_id?: string | null
          property_id?: string | null
          recommended_action?: string
          reservation_id?: string | null
          rule_key?: string
          scheduled_for?: string | null
          status?: string
          tenant_id?: string | null
          trigger_event?: string
          trigger_payload?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_proactive_actions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "property_chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_proactive_actions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_proactive_actions_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "property_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_prompt_change_candidates: {
        Row: {
          confidence: number
          created_at: string
          current_prompt: string | null
          evidence: Json
          expected_impact: string | null
          id: string
          owner_id: string
          prompt_key: string
          prompt_version: string | null
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sample_size: number
          status: string
          suggestion: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          current_prompt?: string | null
          evidence?: Json
          expected_impact?: string | null
          id?: string
          owner_id: string
          prompt_key: string
          prompt_version?: string | null
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sample_size?: number
          status?: string
          suggestion: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          current_prompt?: string | null
          evidence?: Json
          expected_impact?: string | null
          id?: string
          owner_id?: string
          prompt_key?: string
          prompt_version?: string | null
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sample_size?: number
          status?: string
          suggestion?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_system_events: {
        Row: {
          action: string | null
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          actor_type: string
          channel: string | null
          conversation_id: string | null
          correlation_id: string | null
          created_at: string
          description: string | null
          entity_id: string | null
          entity_type: string | null
          event_category: string
          event_type: string
          id: string
          ip_reference: string | null
          metadata: Json
          organization_id: string | null
          permission_snapshot: Json
          property_id: string | null
          reason: string | null
          result: string | null
          severity: string
          source: string
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          actor_type?: string
          channel?: string | null
          conversation_id?: string | null
          correlation_id?: string | null
          created_at?: string
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          event_category: string
          event_type: string
          id?: string
          ip_reference?: string | null
          metadata?: Json
          organization_id?: string | null
          permission_snapshot?: Json
          property_id?: string | null
          reason?: string | null
          result?: string | null
          severity?: string
          source?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          actor_type?: string
          channel?: string | null
          conversation_id?: string | null
          correlation_id?: string | null
          created_at?: string
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          event_category?: string
          event_type?: string
          id?: string
          ip_reference?: string | null
          metadata?: Json
          organization_id?: string | null
          permission_snapshot?: Json
          property_id?: string | null
          reason?: string | null
          result?: string | null
          severity?: string
          source?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_tenant_knowledge: {
        Row: {
          applied_memory_id: string | null
          author_id: string | null
          author_name: string | null
          category: string
          content: string
          created_at: string
          id: string
          knowledge_scope: string
          metadata: Json
          owner_id: string
          priority: number
          property_id: string | null
          source: string
          source_learning_id: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          applied_memory_id?: string | null
          author_id?: string | null
          author_name?: string | null
          category?: string
          content: string
          created_at?: string
          id?: string
          knowledge_scope?: string
          metadata?: Json
          owner_id: string
          priority?: number
          property_id?: string | null
          source?: string
          source_learning_id?: string | null
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          applied_memory_id?: string | null
          author_id?: string | null
          author_name?: string | null
          category?: string
          content?: string
          created_at?: string
          id?: string
          knowledge_scope?: string
          metadata?: Json
          owner_id?: string
          priority?: number
          property_id?: string | null
          source?: string
          source_learning_id?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_tenant_knowledge_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      app_user_connections: {
        Row: {
          connection_key_ciphertext: string
          connector_id: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_key_ciphertext: string
          connector_id: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_key_ciphertext?: string
          connector_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip: string | null
          metadata: Json
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      chat_message_feedback: {
        Row: {
          behavior_id: string | null
          conversation_id: string
          created_at: string
          id: string
          marked_by: string | null
          message_id: string
          owner_id: string
          property_id: string
          reason: string | null
          resolved: boolean
          updated_at: string
        }
        Insert: {
          behavior_id?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          marked_by?: string | null
          message_id: string
          owner_id: string
          property_id: string
          reason?: string | null
          resolved?: boolean
          updated_at?: string
        }
        Update: {
          behavior_id?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          marked_by?: string | null
          message_id?: string
          owner_id?: string
          property_id?: string
          reason?: string | null
          resolved?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_feedback_behavior_id_fkey"
            columns: ["behavior_id"]
            isOneToOne: false
            referencedRelation: "host_behavior"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_feedback_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "property_chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_feedback_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "property_chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_feedback_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      city_daily_news: {
        Row: {
          city_key: string
          created_at: string
          date: string
          items: Json
        }
        Insert: {
          city_key: string
          created_at?: string
          date: string
          items?: Json
        }
        Update: {
          city_key?: string
          created_at?: string
          date?: string
          items?: Json
        }
        Relationships: []
      }
      city_daily_pulse: {
        Row: {
          city_key: string
          created_at: string
          date: string
          id: string
          items: Json
        }
        Insert: {
          city_key: string
          created_at?: string
          date: string
          id?: string
          items: Json
        }
        Update: {
          city_key?: string
          created_at?: string
          date?: string
          id?: string
          items?: Json
        }
        Relationships: []
      }
      city_reference_group_members: {
        Row: {
          group_id: string
          joined_at: string
          property_id: string
        }
        Insert: {
          group_id: string
          joined_at?: string
          property_id: string
        }
        Update: {
          group_id?: string
          joined_at?: string
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "city_reference_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "city_reference_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "city_reference_group_members_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      city_reference_groups: {
        Row: {
          city_key: string
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          city_key: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          city_key?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      city_reference_jobs: {
        Row: {
          city_key: string
          city_label: string
          country: string
          created_at: string
          id: string
          last_message: string | null
          last_refreshed_at: string | null
          last_status: string | null
          state: string | null
          updated_at: string
        }
        Insert: {
          city_key: string
          city_label: string
          country?: string
          created_at?: string
          id?: string
          last_message?: string | null
          last_refreshed_at?: string | null
          last_status?: string | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          city_key?: string
          city_label?: string
          country?: string
          created_at?: string
          id?: string
          last_message?: string | null
          last_refreshed_at?: string | null
          last_status?: string | null
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      city_references: {
        Row: {
          address: string | null
          category: string
          city_key: string
          city_label: string
          country: string
          created_at: string
          display_order: number
          group_id: string | null
          id: string
          image_url: string | null
          is_hidden: boolean
          last_synced_at: string | null
          lat: number | null
          lng: number | null
          maps_url: string | null
          name: string
          note: string | null
          opening_hours: string[] | null
          place_id: string | null
          primary_type: string | null
          property_id: string | null
          rating: number | null
          source: string
          state: string | null
          type: string
          updated_at: string
          user_ratings_total: number | null
        }
        Insert: {
          address?: string | null
          category: string
          city_key: string
          city_label: string
          country?: string
          created_at?: string
          display_order?: number
          group_id?: string | null
          id?: string
          image_url?: string | null
          is_hidden?: boolean
          last_synced_at?: string | null
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          name: string
          note?: string | null
          opening_hours?: string[] | null
          place_id?: string | null
          primary_type?: string | null
          property_id?: string | null
          rating?: number | null
          source?: string
          state?: string | null
          type: string
          updated_at?: string
          user_ratings_total?: number | null
        }
        Update: {
          address?: string | null
          category?: string
          city_key?: string
          city_label?: string
          country?: string
          created_at?: string
          display_order?: number
          group_id?: string | null
          id?: string
          image_url?: string | null
          is_hidden?: boolean
          last_synced_at?: string | null
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          name?: string
          note?: string | null
          opening_hours?: string[] | null
          place_id?: string | null
          primary_type?: string | null
          property_id?: string | null
          rating?: number | null
          source?: string
          state?: string | null
          type?: string
          updated_at?: string
          user_ratings_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "city_references_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "city_reference_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "city_references_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      clicksign_documents: {
        Row: {
          account_owner_id: string
          created_at: string
          document_key: string
          finished_at: string | null
          guest_name: string | null
          id: string
          name: string | null
          property_id: string | null
          raw: Json | null
          signers: Json
          stakeholder_id: string | null
          stakeholder_type: string | null
          status: string | null
          synced_at: string
          updated_at: string
          url_original: string | null
          url_signed: string | null
        }
        Insert: {
          account_owner_id: string
          created_at?: string
          document_key: string
          finished_at?: string | null
          guest_name?: string | null
          id?: string
          name?: string | null
          property_id?: string | null
          raw?: Json | null
          signers?: Json
          stakeholder_id?: string | null
          stakeholder_type?: string | null
          status?: string | null
          synced_at?: string
          updated_at?: string
          url_original?: string | null
          url_signed?: string | null
        }
        Update: {
          account_owner_id?: string
          created_at?: string
          document_key?: string
          finished_at?: string | null
          guest_name?: string | null
          id?: string
          name?: string | null
          property_id?: string | null
          raw?: Json | null
          signers?: Json
          stakeholder_id?: string | null
          stakeholder_type?: string | null
          status?: string | null
          synced_at?: string
          updated_at?: string
          url_original?: string | null
          url_signed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clicksign_documents_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      guest_arrival_status: {
        Row: {
          arrival_time_override: string | null
          concluded_at: string | null
          created_at: string
          done_at: string | null
          id: string
          kind: string
          log_id: string | null
          note: string | null
          property_id: string
          reservation_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          arrival_time_override?: string | null
          concluded_at?: string | null
          created_at?: string
          done_at?: string | null
          id?: string
          kind: string
          log_id?: string | null
          note?: string | null
          property_id: string
          reservation_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          arrival_time_override?: string | null
          concluded_at?: string | null
          created_at?: string
          done_at?: string | null
          id?: string
          kind?: string
          log_id?: string | null
          note?: string | null
          property_id?: string
          reservation_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_arrival_status_log_id_fkey"
            columns: ["log_id"]
            isOneToOne: false
            referencedRelation: "guide_access_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_arrival_status_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_arrival_status_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "property_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_push_subscriptions: {
        Row: {
          auth: string
          conversation_id: string | null
          created_at: string
          enabled: boolean
          endpoint: string
          guest_session_id: string
          id: string
          last_used_at: string | null
          p256dh: string
          property_id: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          auth: string
          conversation_id?: string | null
          created_at?: string
          enabled?: boolean
          endpoint: string
          guest_session_id: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          property_id: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          conversation_id?: string | null
          created_at?: string
          enabled?: boolean
          endpoint?: string
          guest_session_id?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          property_id?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_push_subscriptions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "property_chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_push_subscriptions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      guide_access_logs: {
        Row: {
          checkin_date: string
          checkout_date: string | null
          created_at: string
          guest_arrival_time: string | null
          guest_documents: Json | null
          guest_name: string
          guest_phone: string | null
          guest_phone_country: string | null
          guest_vehicles: Json | null
          id: string
          property_id: string
          reservation_code: string | null
          user_agent: string | null
        }
        Insert: {
          checkin_date: string
          checkout_date?: string | null
          created_at?: string
          guest_arrival_time?: string | null
          guest_documents?: Json | null
          guest_name: string
          guest_phone?: string | null
          guest_phone_country?: string | null
          guest_vehicles?: Json | null
          id?: string
          property_id: string
          reservation_code?: string | null
          user_agent?: string | null
        }
        Update: {
          checkin_date?: string
          checkout_date?: string | null
          created_at?: string
          guest_arrival_time?: string | null
          guest_documents?: Json | null
          guest_name?: string
          guest_phone?: string | null
          guest_phone_country?: string | null
          guest_vehicles?: Json | null
          id?: string
          property_id?: string
          reservation_code?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guide_access_logs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      guide_section_events: {
        Row: {
          created_at: string
          guest_name: string | null
          guest_phone: string | null
          guest_session_id: string | null
          id: string
          page_path: string | null
          property_id: string
          section: string
        }
        Insert: {
          created_at?: string
          guest_name?: string | null
          guest_phone?: string | null
          guest_session_id?: string | null
          id?: string
          page_path?: string | null
          property_id: string
          section: string
        }
        Update: {
          created_at?: string
          guest_name?: string | null
          guest_phone?: string | null
          guest_session_id?: string | null
          id?: string
          page_path?: string | null
          property_id?: string
          section?: string
        }
        Relationships: [
          {
            foreignKeyName: "guide_section_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      host_behavior: {
        Row: {
          body: string
          created_at: string
          enabled: boolean
          id: string
          owner_id: string
          position: number
          scope_property_id: string | null
          source: string
          source_property_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          enabled?: boolean
          id?: string
          owner_id: string
          position?: number
          scope_property_id?: string | null
          source?: string
          source_property_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          enabled?: boolean
          id?: string
          owner_id?: string
          position?: number
          scope_property_id?: string | null
          source?: string
          source_property_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "host_behavior_scope_property_id_fkey"
            columns: ["scope_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "host_behavior_source_property_id_fkey"
            columns: ["source_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      host_faqs: {
        Row: {
          answer: string
          created_at: string
          id: string
          owner_id: string
          position: number
          question: string
          scope_property_id: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          owner_id: string
          position?: number
          question: string
          scope_property_id?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          owner_id?: string
          position?: number
          question?: string
          scope_property_id?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "host_faqs_scope_property_id_fkey"
            columns: ["scope_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      host_integration_credentials: {
        Row: {
          api_token_encrypted: string | null
          created_at: string
          environment: string
          last_error: string | null
          last_sync_at: string | null
          last_verified_at: string | null
          owner_id: string
          provider: string
          status: string
          updated_at: string
          webhook_last_event_at: string | null
          webhook_secret: string | null
        }
        Insert: {
          api_token_encrypted?: string | null
          created_at?: string
          environment?: string
          last_error?: string | null
          last_sync_at?: string | null
          last_verified_at?: string | null
          owner_id: string
          provider: string
          status?: string
          updated_at?: string
          webhook_last_event_at?: string | null
          webhook_secret?: string | null
        }
        Update: {
          api_token_encrypted?: string | null
          created_at?: string
          environment?: string
          last_error?: string | null
          last_sync_at?: string | null
          last_verified_at?: string | null
          owner_id?: string
          provider?: string
          status?: string
          updated_at?: string
          webhook_last_event_at?: string | null
          webhook_secret?: string | null
        }
        Relationships: []
      }
      host_knowledge: {
        Row: {
          body: string
          created_at: string
          enabled: boolean
          id: string
          owner_id: string
          position: number
          scope_property_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          enabled?: boolean
          id?: string
          owner_id: string
          position?: number
          scope_property_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          enabled?: boolean
          id?: string
          owner_id?: string
          position?: number
          scope_property_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "host_knowledge_scope_property_id_fkey"
            columns: ["scope_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      host_whatsapp_config: {
        Row: {
          api_token_encrypted: string | null
          app_id: string | null
          created_at: string
          last_error: string | null
          last_verified_at: string | null
          owner_id: string
          provider: string
          sender_number: string | null
          service_plan_id: string | null
          status: string
          updated_at: string
          webhook_secret: string
        }
        Insert: {
          api_token_encrypted?: string | null
          app_id?: string | null
          created_at?: string
          last_error?: string | null
          last_verified_at?: string | null
          owner_id: string
          provider?: string
          sender_number?: string | null
          service_plan_id?: string | null
          status?: string
          updated_at?: string
          webhook_secret?: string
        }
        Update: {
          api_token_encrypted?: string | null
          app_id?: string | null
          created_at?: string
          last_error?: string | null
          last_verified_at?: string | null
          owner_id?: string
          provider?: string
          sender_number?: string | null
          service_plan_id?: string | null
          status?: string
          updated_at?: string
          webhook_secret?: string
        }
        Relationships: []
      }
      permission_assignments: {
        Row: {
          access_level: Database["public"]["Enums"]["permission_access_level"]
          created_at: string
          created_by: string | null
          id: string
          permission_node_id: string
          scope_id: string | null
          scope_type: Database["public"]["Enums"]["permission_scope_type"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_level?: Database["public"]["Enums"]["permission_access_level"]
          created_at?: string
          created_by?: string | null
          id?: string
          permission_node_id: string
          scope_id?: string | null
          scope_type?: Database["public"]["Enums"]["permission_scope_type"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_level?: Database["public"]["Enums"]["permission_access_level"]
          created_at?: string
          created_by?: string | null
          id?: string
          permission_node_id?: string
          scope_id?: string | null
          scope_type?: Database["public"]["Enums"]["permission_scope_type"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_assignments_permission_node_id_fkey"
            columns: ["permission_node_id"]
            isOneToOne: false
            referencedRelation: "permission_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_audit: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          created_at: string
          id: string
          metadata: Json | null
          new_access_level:
            | Database["public"]["Enums"]["permission_access_level"]
            | null
          permission_node_id: string | null
          previous_access_level:
            | Database["public"]["Enums"]["permission_access_level"]
            | null
          scope_id: string | null
          scope_type:
            | Database["public"]["Enums"]["permission_scope_type"]
            | null
          target_user_id: string | null
          tenant_id: string
        }
        Insert: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          new_access_level?:
            | Database["public"]["Enums"]["permission_access_level"]
            | null
          permission_node_id?: string | null
          previous_access_level?:
            | Database["public"]["Enums"]["permission_access_level"]
            | null
          scope_id?: string | null
          scope_type?:
            | Database["public"]["Enums"]["permission_scope_type"]
            | null
          target_user_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          new_access_level?:
            | Database["public"]["Enums"]["permission_access_level"]
            | null
          permission_node_id?: string | null
          previous_access_level?:
            | Database["public"]["Enums"]["permission_access_level"]
            | null
          scope_id?: string | null
          scope_type?:
            | Database["public"]["Enums"]["permission_scope_type"]
            | null
          target_user_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_audit_permission_node_id_fkey"
            columns: ["permission_node_id"]
            isOneToOne: false
            referencedRelation: "permission_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_migration_status: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["permission_migration_mode"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["permission_migration_mode"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["permission_migration_mode"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      permission_node_slug_history: {
        Row: {
          created_at: string
          id: string
          new_slug: string
          old_slug: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          new_slug: string
          old_slug: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          new_slug?: string
          old_slug?: string
          reason?: string | null
        }
        Relationships: []
      }
      permission_nodes: {
        Row: {
          active: boolean
          created_at: string
          deactivated_at: string | null
          deprecated: boolean
          description: string | null
          display_order: number
          feature: string | null
          icon: string | null
          id: string
          is_hidden: boolean
          is_permissionable: boolean
          is_system: boolean
          label: string | null
          last_synced_at: string | null
          max_access_level: Database["public"]["Enums"]["permission_access_level"]
          name: string
          order: number
          parent_id: string | null
          route: string | null
          slug: string
          source: string | null
          type: Database["public"]["Enums"]["permission_node_type"]
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          deactivated_at?: string | null
          deprecated?: boolean
          description?: string | null
          display_order?: number
          feature?: string | null
          icon?: string | null
          id?: string
          is_hidden?: boolean
          is_permissionable?: boolean
          is_system?: boolean
          label?: string | null
          last_synced_at?: string | null
          max_access_level?: Database["public"]["Enums"]["permission_access_level"]
          name: string
          order?: number
          parent_id?: string | null
          route?: string | null
          slug: string
          source?: string | null
          type: Database["public"]["Enums"]["permission_node_type"]
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          deactivated_at?: string | null
          deprecated?: boolean
          description?: string | null
          display_order?: number
          feature?: string | null
          icon?: string | null
          id?: string
          is_hidden?: boolean
          is_permissionable?: boolean
          is_system?: boolean
          label?: string | null
          last_synced_at?: string | null
          max_access_level?: Database["public"]["Enums"]["permission_access_level"]
          name?: string
          order?: number
          parent_id?: string | null
          route?: string | null
          slug?: string
          source?: string | null
          type?: Database["public"]["Enums"]["permission_node_type"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "permission_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "permission_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_sync_runs: {
        Row: {
          created_at: string
          created_count: number
          deactivated_count: number
          errors: Json
          finished_at: string | null
          id: string
          started_at: string
          status: string
          total_nodes: number
          triggered_by: string | null
          updated_count: number
        }
        Insert: {
          created_at?: string
          created_count?: number
          deactivated_count?: number
          errors?: Json
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          total_nodes?: number
          triggered_by?: string | null
          updated_count?: number
        }
        Update: {
          created_at?: string
          created_count?: number
          deactivated_count?: number
          errors?: Json
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          total_nodes?: number
          triggered_by?: string | null
          updated_count?: number
        }
        Relationships: []
      }
      poi_categories: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_protected: boolean
          label: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_protected?: boolean
          label: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_protected?: boolean
          label?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      poi_engagement_events: {
        Row: {
          anon_id: string
          created_at: string
          event_type: string
          id: string
          poi_key: string
          poi_type: string
          property_id: string
        }
        Insert: {
          anon_id: string
          created_at?: string
          event_type: string
          id?: string
          poi_key: string
          poi_type: string
          property_id: string
        }
        Update: {
          anon_id?: string
          created_at?: string
          event_type?: string
          id?: string
          poi_key?: string
          poi_type?: string
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poi_engagement_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_tags: {
        Row: {
          accepted_primary_types: string[]
          category_id: string
          created_at: string
          display_order: number
          id: string
          is_protected: boolean
          label: string
          min_reviews: number
          places_types: string[]
          query_variants: string[]
          slug: string
          updated_at: string
        }
        Insert: {
          accepted_primary_types?: string[]
          category_id: string
          created_at?: string
          display_order?: number
          id?: string
          is_protected?: boolean
          label: string
          min_reviews?: number
          places_types?: string[]
          query_variants?: string[]
          slug: string
          updated_at?: string
        }
        Update: {
          accepted_primary_types?: string[]
          category_id?: string
          created_at?: string
          display_order?: number
          id?: string
          is_protected?: boolean
          label?: string
          min_reviews?: number
          places_types?: string[]
          query_variants?: string[]
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "poi_tags_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "poi_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          birth_date: string | null
          cpf: string | null
          created_at: string
          etiqueta_options: string[]
          full_name: string | null
          id: string
          job_title: string | null
          onboarding_completed_at: string | null
          phone: string | null
          phone_country: string | null
          trade_name: string | null
        }
        Insert: {
          avatar_url?: string | null
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          etiqueta_options?: string[]
          full_name?: string | null
          id: string
          job_title?: string | null
          onboarding_completed_at?: string | null
          phone?: string | null
          phone_country?: string | null
          trade_name?: string | null
        }
        Update: {
          avatar_url?: string | null
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          etiqueta_options?: string[]
          full_name?: string | null
          id?: string
          job_title?: string | null
          onboarding_completed_at?: string | null
          phone?: string | null
          phone_country?: string | null
          trade_name?: string | null
        }
        Relationships: []
      }
      properties: {
        Row: {
          access_codes_pin: string | null
          access_mode: Database["public"]["Enums"]["access_mode"]
          address: string | null
          address_note: string | null
          airbnb_ical_last_error: string | null
          airbnb_ical_last_sync_at: string | null
          airbnb_ical_url: string | null
          airbnb_listing_url: string | null
          brand_logo_url: string | null
          brand_name: string | null
          checkin_instructions: string | null
          checkin_media: Json
          checkin_note: string | null
          checkin_time: string | null
          checkin_time_max: string | null
          checkout_instructions: string | null
          checkout_note: string | null
          checkout_time: string | null
          checkout_time_min: string | null
          city: string | null
          collect_arrival_time: string
          collect_document: string
          collect_vehicles: string
          country: string | null
          created_at: string
          default_language: Database["public"]["Enums"]["guide_language"]
          document_scope: string
          gallery_images: string[]
          garage_maps_url: string | null
          gate_code: string | null
          gate_instructions: string | null
          gate_label: string | null
          gate_media: Json
          gate_video_url: string | null
          guide_theme: string
          hero_image_url: string | null
          host_name: string | null
          host_phone: string | null
          house_rules: string | null
          id: string
          lat: number | null
          lng: number | null
          lock_code: string | null
          lock_instructions: string | null
          lock_label: string | null
          lock_media: Json
          lock_video_url: string | null
          maps_url: string | null
          marketplace_links: Json
          name: string
          owner_contact_id: string | null
          owner_id: string
          pin_code: string | null
          pin_expires_at: string | null
          portaria_email: string | null
          published: boolean
          require_access_gate: boolean
          sigma_pack_activated_at: string | null
          sigma_pack_city_key: string | null
          sigma_pack_snapshot: Json | null
          slug: string
          state: string | null
          tagline: string | null
          theme_images: Json
          updated_at: string
          vehicles_max: number
          wifi_password: string | null
          wifi_ssid: string | null
        }
        Insert: {
          access_codes_pin?: string | null
          access_mode?: Database["public"]["Enums"]["access_mode"]
          address?: string | null
          address_note?: string | null
          airbnb_ical_last_error?: string | null
          airbnb_ical_last_sync_at?: string | null
          airbnb_ical_url?: string | null
          airbnb_listing_url?: string | null
          brand_logo_url?: string | null
          brand_name?: string | null
          checkin_instructions?: string | null
          checkin_media?: Json
          checkin_note?: string | null
          checkin_time?: string | null
          checkin_time_max?: string | null
          checkout_instructions?: string | null
          checkout_note?: string | null
          checkout_time?: string | null
          checkout_time_min?: string | null
          city?: string | null
          collect_arrival_time?: string
          collect_document?: string
          collect_vehicles?: string
          country?: string | null
          created_at?: string
          default_language?: Database["public"]["Enums"]["guide_language"]
          document_scope?: string
          gallery_images?: string[]
          garage_maps_url?: string | null
          gate_code?: string | null
          gate_instructions?: string | null
          gate_label?: string | null
          gate_media?: Json
          gate_video_url?: string | null
          guide_theme?: string
          hero_image_url?: string | null
          host_name?: string | null
          host_phone?: string | null
          house_rules?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          lock_code?: string | null
          lock_instructions?: string | null
          lock_label?: string | null
          lock_media?: Json
          lock_video_url?: string | null
          maps_url?: string | null
          marketplace_links?: Json
          name: string
          owner_contact_id?: string | null
          owner_id: string
          pin_code?: string | null
          pin_expires_at?: string | null
          portaria_email?: string | null
          published?: boolean
          require_access_gate?: boolean
          sigma_pack_activated_at?: string | null
          sigma_pack_city_key?: string | null
          sigma_pack_snapshot?: Json | null
          slug: string
          state?: string | null
          tagline?: string | null
          theme_images?: Json
          updated_at?: string
          vehicles_max?: number
          wifi_password?: string | null
          wifi_ssid?: string | null
        }
        Update: {
          access_codes_pin?: string | null
          access_mode?: Database["public"]["Enums"]["access_mode"]
          address?: string | null
          address_note?: string | null
          airbnb_ical_last_error?: string | null
          airbnb_ical_last_sync_at?: string | null
          airbnb_ical_url?: string | null
          airbnb_listing_url?: string | null
          brand_logo_url?: string | null
          brand_name?: string | null
          checkin_instructions?: string | null
          checkin_media?: Json
          checkin_note?: string | null
          checkin_time?: string | null
          checkin_time_max?: string | null
          checkout_instructions?: string | null
          checkout_note?: string | null
          checkout_time?: string | null
          checkout_time_min?: string | null
          city?: string | null
          collect_arrival_time?: string
          collect_document?: string
          collect_vehicles?: string
          country?: string | null
          created_at?: string
          default_language?: Database["public"]["Enums"]["guide_language"]
          document_scope?: string
          gallery_images?: string[]
          garage_maps_url?: string | null
          gate_code?: string | null
          gate_instructions?: string | null
          gate_label?: string | null
          gate_media?: Json
          gate_video_url?: string | null
          guide_theme?: string
          hero_image_url?: string | null
          host_name?: string | null
          host_phone?: string | null
          house_rules?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          lock_code?: string | null
          lock_instructions?: string | null
          lock_label?: string | null
          lock_media?: Json
          lock_video_url?: string | null
          maps_url?: string | null
          marketplace_links?: Json
          name?: string
          owner_contact_id?: string | null
          owner_id?: string
          pin_code?: string | null
          pin_expires_at?: string | null
          portaria_email?: string | null
          published?: boolean
          require_access_gate?: boolean
          sigma_pack_activated_at?: string | null
          sigma_pack_city_key?: string | null
          sigma_pack_snapshot?: Json | null
          slug?: string
          state?: string | null
          tagline?: string | null
          theme_images?: Json
          updated_at?: string
          vehicles_max?: number
          wifi_password?: string | null
          wifi_ssid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_owner_contact_id_fkey"
            columns: ["owner_contact_id"]
            isOneToOne: false
            referencedRelation: "property_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      property_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          property_id: string
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          property_id: string
          status?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          property_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_assignments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_chat_conversations: {
        Row: {
          ai_paused: boolean
          assigned_to: string | null
          claim_requested_at: string | null
          claim_requested_by: string | null
          created_at: string
          guest_name: string | null
          guest_session_id: string
          handoff_at: string | null
          handoff_reason: string | null
          handoff_urgency: string | null
          id: string
          last_message_at: string
          property_id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["chat_conversation_status"]
          updated_at: string
        }
        Insert: {
          ai_paused?: boolean
          assigned_to?: string | null
          claim_requested_at?: string | null
          claim_requested_by?: string | null
          created_at?: string
          guest_name?: string | null
          guest_session_id: string
          handoff_at?: string | null
          handoff_reason?: string | null
          handoff_urgency?: string | null
          id?: string
          last_message_at?: string
          property_id: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["chat_conversation_status"]
          updated_at?: string
        }
        Update: {
          ai_paused?: boolean
          assigned_to?: string | null
          claim_requested_at?: string | null
          claim_requested_by?: string | null
          created_at?: string
          guest_name?: string | null
          guest_session_id?: string
          handoff_at?: string | null
          handoff_reason?: string | null
          handoff_urgency?: string | null
          id?: string
          last_message_at?: string
          property_id?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["chat_conversation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_chat_conversations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_chat_messages: {
        Row: {
          attachment_duration_ms: number | null
          attachment_mime: string | null
          attachment_name: string | null
          attachment_path: string | null
          attachment_size_bytes: number | null
          attachment_type: string | null
          channel: string
          content: string
          conversation_id: string
          created_at: string
          delivery_status: string | null
          edited_at: string | null
          external_id: string | null
          id: string
          is_internal_note: boolean
          role: string
          sender_type: Database["public"]["Enums"]["chat_sender_type"]
          sender_user_id: string | null
          sent_via_number: string | null
        }
        Insert: {
          attachment_duration_ms?: number | null
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size_bytes?: number | null
          attachment_type?: string | null
          channel?: string
          content: string
          conversation_id: string
          created_at?: string
          delivery_status?: string | null
          edited_at?: string | null
          external_id?: string | null
          id?: string
          is_internal_note?: boolean
          role: string
          sender_type?: Database["public"]["Enums"]["chat_sender_type"]
          sender_user_id?: string | null
          sent_via_number?: string | null
        }
        Update: {
          attachment_duration_ms?: number | null
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size_bytes?: number | null
          attachment_type?: string | null
          channel?: string
          content?: string
          conversation_id?: string
          created_at?: string
          delivery_status?: string | null
          edited_at?: string | null
          external_id?: string | null
          id?: string
          is_internal_note?: boolean
          role?: string
          sender_type?: Database["public"]["Enums"]["chat_sender_type"]
          sender_user_id?: string | null
          sent_via_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "property_chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      property_checkout_items: {
        Row: {
          id: string
          label: string
          position: number
          property_id: string
        }
        Insert: {
          id?: string
          label: string
          position?: number
          property_id: string
        }
        Update: {
          id?: string
          label?: string
          position?: number
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_checkout_items_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_daily_tips: {
        Row: {
          content: Json
          created_at: string
          date: string
          id: string
          property_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          date: string
          id?: string
          property_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          date?: string
          id?: string
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_daily_tips_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_emergency_contacts: {
        Row: {
          id: string
          label: string
          number: string
          position: number
          property_id: string
        }
        Insert: {
          id?: string
          label: string
          number: string
          position?: number
          property_id: string
        }
        Update: {
          id?: string
          label?: string
          number?: string
          position?: number
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_emergency_contacts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_faqs: {
        Row: {
          answer: string
          id: string
          position: number
          property_id: string
          question: string
          tags: string[]
        }
        Insert: {
          answer: string
          id?: string
          position?: number
          property_id: string
          question: string
          tags?: string[]
        }
        Update: {
          answer?: string
          id?: string
          position?: number
          property_id?: string
          question?: string
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "property_faqs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_manual_items: {
        Row: {
          body: string | null
          created_at: string
          description: string | null
          id: string
          position: number
          property_id: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          description?: string | null
          id?: string
          position?: number
          property_id: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          description?: string | null
          id?: string
          position?: number
          property_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_manual_items_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_owners: {
        Row: {
          account_owner_id: string
          address: string | null
          birth_date: string | null
          cep: string | null
          city: string | null
          created_at: string
          created_by: string | null
          created_via: string
          district: string | null
          doc: string | null
          doc_type: string
          email: string | null
          id: string
          name: string
          notes: string | null
          person_type: string
          phone: string | null
          phone_country: string | null
          state: string | null
          status: string
          status_changed_at: string | null
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          account_owner_id: string
          address?: string | null
          birth_date?: string | null
          cep?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          created_via?: string
          district?: string | null
          doc?: string | null
          doc_type?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          person_type?: string
          phone?: string | null
          phone_country?: string | null
          state?: string | null
          status?: string
          status_changed_at?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          account_owner_id?: string
          address?: string | null
          birth_date?: string | null
          cep?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          created_via?: string
          district?: string | null
          doc?: string | null
          doc_type?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          person_type?: string
          phone?: string | null
          phone_country?: string | null
          state?: string | null
          status?: string
          status_changed_at?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      property_recommendations: {
        Row: {
          category: string | null
          created_at: string
          distance_meters: number | null
          distance_text: string | null
          drive_minutes: number | null
          id: string
          image_url: string | null
          last_synced_at: string | null
          maps_url: string | null
          name: string
          note: string | null
          opening_hours: string[] | null
          place_id: string | null
          position: number
          property_id: string
          rating: number | null
          scope: Database["public"]["Enums"]["rec_scope"]
          type: Database["public"]["Enums"]["rec_type"]
          user_ratings_total: number | null
          walk_minutes: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          distance_meters?: number | null
          distance_text?: string | null
          drive_minutes?: number | null
          id?: string
          image_url?: string | null
          last_synced_at?: string | null
          maps_url?: string | null
          name: string
          note?: string | null
          opening_hours?: string[] | null
          place_id?: string | null
          position?: number
          property_id: string
          rating?: number | null
          scope: Database["public"]["Enums"]["rec_scope"]
          type: Database["public"]["Enums"]["rec_type"]
          user_ratings_total?: number | null
          walk_minutes?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string
          distance_meters?: number | null
          distance_text?: string | null
          drive_minutes?: number | null
          id?: string
          image_url?: string | null
          last_synced_at?: string | null
          maps_url?: string | null
          name?: string
          note?: string | null
          opening_hours?: string[] | null
          place_id?: string | null
          position?: number
          property_id?: string
          rating?: number | null
          scope?: Database["public"]["Enums"]["rec_scope"]
          type?: Database["public"]["Enums"]["rec_type"]
          user_ratings_total?: number | null
          walk_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "property_recommendations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_reservations: {
        Row: {
          checkin_date: string
          checkout_date: string
          created_at: string
          external_uid: string
          guest_hint: string | null
          id: string
          property_id: string
          raw_summary: string | null
          reservation_url: string | null
          source: string
          status: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          checkin_date: string
          checkout_date: string
          created_at?: string
          external_uid: string
          guest_hint?: string | null
          id?: string
          property_id: string
          raw_summary?: string | null
          reservation_url?: string | null
          source?: string
          status?: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          checkin_date?: string
          checkout_date?: string
          created_at?: string
          external_uid?: string
          guest_hint?: string | null
          id?: string
          property_id?: string
          raw_summary?: string | null
          reservation_url?: string | null
          source?: string
          status?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_reservations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_slug_history: {
        Row: {
          created_at: string
          id: string
          old_slug: string
          property_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          old_slug: string
          property_id: string
        }
        Update: {
          created_at?: string
          id?: string
          old_slug?: string
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_slug_history_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          enabled: boolean
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          sound_enabled: boolean
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          enabled?: boolean
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          sound_enabled?: boolean
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          enabled?: boolean
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          sound_enabled?: boolean
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      service_providers: {
        Row: {
          account_owner_id: string
          address: string | null
          birth_date: string | null
          category: string
          cep: string | null
          city: string | null
          created_at: string
          created_by: string | null
          created_via: string
          district: string | null
          doc: string | null
          doc_type: string
          email: string | null
          hourly_rate_cents: number | null
          id: string
          member_user_id: string | null
          name: string
          notes: string | null
          person_type: string
          phone: string | null
          phone_country: string | null
          state: string | null
          status: string
          status_changed_at: string | null
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          account_owner_id: string
          address?: string | null
          birth_date?: string | null
          category?: string
          cep?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          created_via?: string
          district?: string | null
          doc?: string | null
          doc_type?: string
          email?: string | null
          hourly_rate_cents?: number | null
          id?: string
          member_user_id?: string | null
          name: string
          notes?: string | null
          person_type?: string
          phone?: string | null
          phone_country?: string | null
          state?: string | null
          status?: string
          status_changed_at?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          account_owner_id?: string
          address?: string | null
          birth_date?: string | null
          category?: string
          cep?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          created_via?: string
          district?: string | null
          doc?: string | null
          doc_type?: string
          email?: string | null
          hourly_rate_cents?: number | null
          id?: string
          member_user_id?: string | null
          name?: string
          notes?: string | null
          person_type?: string
          phone?: string | null
          phone_country?: string | null
          state?: string | null
          status?: string
          status_changed_at?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sigma_city_faqs: {
        Row: {
          answer: string
          city_key: string
          created_at: string
          id: string
          position: number
          question: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          answer: string
          city_key: string
          created_at?: string
          id?: string
          position?: number
          question: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          answer?: string
          city_key?: string
          created_at?: string
          id?: string
          position?: number
          question?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sigma_city_faqs_city_key_fkey"
            columns: ["city_key"]
            isOneToOne: false
            referencedRelation: "sigma_city_packs"
            referencedColumns: ["city_key"]
          },
        ]
      }
      sigma_city_marketplace: {
        Row: {
          city_key: string
          created_at: string
          description: string | null
          id: string
          label: string
          position: number
          updated_at: string
          url: string
        }
        Insert: {
          city_key: string
          created_at?: string
          description?: string | null
          id?: string
          label: string
          position?: number
          updated_at?: string
          url: string
        }
        Update: {
          city_key?: string
          created_at?: string
          description?: string | null
          id?: string
          label?: string
          position?: number
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "sigma_city_marketplace_city_key_fkey"
            columns: ["city_key"]
            isOneToOne: false
            referencedRelation: "sigma_city_packs"
            referencedColumns: ["city_key"]
          },
        ]
      }
      sigma_city_packs: {
        Row: {
          city_key: string
          city_label: string
          country: string | null
          cover_url: string | null
          created_at: string
          id: string
          is_published: boolean
          notes: string | null
          updated_at: string
        }
        Insert: {
          city_key: string
          city_label: string
          country?: string | null
          cover_url?: string | null
          created_at?: string
          id?: string
          is_published?: boolean
          notes?: string | null
          updated_at?: string
        }
        Update: {
          city_key?: string
          city_label?: string
          country?: string | null
          cover_url?: string | null
          created_at?: string
          id?: string
          is_published?: boolean
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sigma_city_recommendations: {
        Row: {
          address: string | null
          category: string | null
          city_key: string
          created_at: string
          id: string
          image_url: string | null
          lat: number | null
          lng: number | null
          maps_url: string | null
          name: string
          note: string | null
          opening_hours: string[] | null
          place_id: string | null
          position: number
          rating: number | null
          type: string
          updated_at: string
          user_ratings_total: number | null
        }
        Insert: {
          address?: string | null
          category?: string | null
          city_key: string
          created_at?: string
          id?: string
          image_url?: string | null
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          name: string
          note?: string | null
          opening_hours?: string[] | null
          place_id?: string | null
          position?: number
          rating?: number | null
          type: string
          updated_at?: string
          user_ratings_total?: number | null
        }
        Update: {
          address?: string | null
          category?: string | null
          city_key?: string
          created_at?: string
          id?: string
          image_url?: string | null
          lat?: number | null
          lng?: number | null
          maps_url?: string | null
          name?: string
          note?: string | null
          opening_hours?: string[] | null
          place_id?: string | null
          position?: number
          rating?: number | null
          type?: string
          updated_at?: string
          user_ratings_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sigma_city_recommendations_city_key_fkey"
            columns: ["city_key"]
            isOneToOne: false
            referencedRelation: "sigma_city_packs"
            referencedColumns: ["city_key"]
          },
        ]
      }
      stakeholder_activities: {
        Row: {
          account_owner_id: string
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: string
          property_id: string | null
          stakeholder_id: string
          stakeholder_type: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          account_owner_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          property_id?: string | null
          stakeholder_id: string
          stakeholder_type: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          account_owner_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          property_id?: string | null
          stakeholder_id?: string
          stakeholder_type?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_activities_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholder_events: {
        Row: {
          account_owner_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          message: string
          metadata: Json
          stakeholder_id: string
          stakeholder_type: string
        }
        Insert: {
          account_owner_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          message: string
          metadata?: Json
          stakeholder_id: string
          stakeholder_type: string
        }
        Update: {
          account_owner_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          message?: string
          metadata?: Json
          stakeholder_id?: string
          stakeholder_type?: string
        }
        Relationships: []
      }
      stakeholder_link_aliases: {
        Row: {
          account_owner_id: string
          alias_kind: string
          alias_value: string
          created_at: string
          created_by: string | null
          id: string
          stakeholder_id: string
          stakeholder_type: string
          updated_at: string
        }
        Insert: {
          account_owner_id: string
          alias_kind: string
          alias_value: string
          created_at?: string
          created_by?: string | null
          id?: string
          stakeholder_id: string
          stakeholder_type: string
          updated_at?: string
        }
        Update: {
          account_owner_id?: string
          alias_kind?: string
          alias_value?: string
          created_at?: string
          created_by?: string | null
          id?: string
          stakeholder_id?: string
          stakeholder_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          admin_notes: string | null
          billing_anchor_day: number | null
          billing_paused: boolean
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          custom_currency: string | null
          custom_price_cents: number | null
          enterprise_request: boolean | null
          environment: string
          id: string
          is_manual: boolean
          max_guides_override: number | null
          paddle_customer_id: string
          paddle_subscription_id: string
          price_id: string
          product_id: string
          status: string
          trial_ends_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          billing_anchor_day?: number | null
          billing_paused?: boolean
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          custom_currency?: string | null
          custom_price_cents?: number | null
          enterprise_request?: boolean | null
          environment?: string
          id?: string
          is_manual?: boolean
          max_guides_override?: number | null
          paddle_customer_id: string
          paddle_subscription_id: string
          price_id: string
          product_id: string
          status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          billing_anchor_day?: number | null
          billing_paused?: boolean
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          custom_currency?: string | null
          custom_price_cents?: number | null
          enterprise_request?: boolean | null
          environment?: string
          id?: string
          is_manual?: boolean
          max_guides_override?: number | null
          paddle_customer_id?: string
          paddle_subscription_id?: string
          price_id?: string
          product_id?: string
          status?: string
          trial_ends_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_templates: {
        Row: {
          body: string
          category: string
          created_at: string
          id: string
          language: string
          name: string
          owner_id: string
          sinch_template_id: string | null
          status: string
          updated_at: string
          variables: Json
        }
        Insert: {
          body: string
          category?: string
          created_at?: string
          id?: string
          language?: string
          name: string
          owner_id: string
          sinch_template_id?: string | null
          status?: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          id?: string
          language?: string
          name?: string
          owner_id?: string
          sinch_template_id?: string | null
          status?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_my_account_invite: {
        Args: { _invite_id: string }
        Returns: boolean
      }
      account_member_role_of: {
        Args: { _owner_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["account_member_role"]
      }
      bump_memory_usage: {
        Args: { _ids: string[]; _outcome?: string }
        Returns: undefined
      }
      decline_my_account_invite: {
        Args: { _invite_id: string }
        Returns: boolean
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_active_subscription: {
        Args: { check_env?: string; user_uuid: string }
        Returns: boolean
      }
      has_member_permission: {
        Args: {
          _owner_id: string
          _permission: Database["public"]["Enums"]["member_permission"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_account_member: {
        Args: { _owner_id: string; _user_id: string }
        Returns: boolean
      }
      match_ai_kb_chunks: {
        Args: {
          _owner_id: string
          _property_id?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          confidence: number
          content: string
          id: string
          similarity: number
          source: string
          source_id: string
          title: string
        }[]
      }
      match_ai_memories: {
        Args: {
          _owner_id: string
          _property_id?: string
          _subject_key?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          category: string
          confidence: number
          content: string
          id: string
          importance: number
          kind: string
          last_seen_at: string
          property_id: string
          scope: string
          similarity: number
          source: string
          subject_key: string
          title: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      property_is_published: {
        Args: { _property_id: string }
        Returns: boolean
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      replace_permission_assignment: {
        Args: {
          _access_level: Database["public"]["Enums"]["permission_access_level"]
          _created_by?: string
          _permission_node_id: string
          _scope_id?: string
          _scope_type: Database["public"]["Enums"]["permission_scope_type"]
          _tenant_id: string
          _user_id: string
        }
        Returns: {
          access_level: Database["public"]["Enums"]["permission_access_level"]
          created_at: string
          created_by: string | null
          id: string
          permission_node_id: string
          scope_id: string | null
          scope_type: Database["public"]["Enums"]["permission_scope_type"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "permission_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_ai_kb_chunks_text: {
        Args: {
          _owner_id: string
          _property_id?: string
          _query: string
          match_count?: number
        }
        Returns: {
          confidence: number
          content: string
          id: string
          rank: number
          source: string
          source_id: string
          title: string
        }[]
      }
      search_ai_memories_text: {
        Args: {
          _owner_id: string
          _property_id?: string
          _query: string
          _subject_key?: string
          match_count?: number
        }
        Returns: {
          category: string
          confidence: number
          content: string
          id: string
          importance: number
          kind: string
          last_seen_at: string
          property_id: string
          rank: number
          scope: string
          source: string
          subject_key: string
          title: string
        }[]
      }
      user_can_access_property: {
        Args: { _property_id: string; _user_id: string }
        Returns: boolean
      }
      user_is_group_member: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      user_owns_property_in_city: {
        Args: { _city_key: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      access_mode: "public" | "pin"
      account_member_role: "owner" | "agent" | "viewer"
      account_member_status: "pending" | "active" | "revoked"
      app_role: "admin" | "host"
      chat_conversation_status: "ai" | "needs_human" | "assigned" | "resolved"
      chat_sender_type: "guest" | "ai" | "human" | "system"
      guide_language: "pt" | "en"
      member_permission:
        | "chat_respond"
        | "ai_train"
        | "library_edit"
        | "clients_manage"
        | "trial_manage"
        | "pricing_override"
        | "library_view"
        | "ai_view"
        | "chat_view"
        | "operation_view"
        | "operation_edit"
        | "guests_view"
        | "guests_edit"
      permission_access_level: "NONE" | "READ" | "WRITE"
      permission_migration_mode:
        | "legacy"
        | "monitoring"
        | "enforced"
        | "completed"
      permission_node_type:
        | "PAGE"
        | "SUBPAGE"
        | "TAB"
        | "RESOURCE"
        | "FIELD"
        | "SECTION"
      permission_scope_type:
        | "GLOBAL"
        | "TENANT"
        | "CLIENT"
        | "PROPERTY"
        | "RECORD"
      permission_system_role:
        | "OWNER"
        | "SYSTEM"
        | "ADMIN_SAAS"
        | "CRON"
        | "INTEGRATION"
      rec_scope: "nearby" | "city"
      rec_type:
        | "restaurant"
        | "bar"
        | "cafe"
        | "beach"
        | "attraction"
        | "market"
        | "pharmacy"
        | "park"
        | "nightlife"
        | "shopping"
        | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      access_mode: ["public", "pin"],
      account_member_role: ["owner", "agent", "viewer"],
      account_member_status: ["pending", "active", "revoked"],
      app_role: ["admin", "host"],
      chat_conversation_status: ["ai", "needs_human", "assigned", "resolved"],
      chat_sender_type: ["guest", "ai", "human", "system"],
      guide_language: ["pt", "en"],
      member_permission: [
        "chat_respond",
        "ai_train",
        "library_edit",
        "clients_manage",
        "trial_manage",
        "pricing_override",
        "library_view",
        "ai_view",
        "chat_view",
        "operation_view",
        "operation_edit",
        "guests_view",
        "guests_edit",
      ],
      permission_access_level: ["NONE", "READ", "WRITE"],
      permission_migration_mode: [
        "legacy",
        "monitoring",
        "enforced",
        "completed",
      ],
      permission_node_type: [
        "PAGE",
        "SUBPAGE",
        "TAB",
        "RESOURCE",
        "FIELD",
        "SECTION",
      ],
      permission_scope_type: [
        "GLOBAL",
        "TENANT",
        "CLIENT",
        "PROPERTY",
        "RECORD",
      ],
      permission_system_role: [
        "OWNER",
        "SYSTEM",
        "ADMIN_SAAS",
        "CRON",
        "INTEGRATION",
      ],
      rec_scope: ["nearby", "city"],
      rec_type: [
        "restaurant",
        "bar",
        "cafe",
        "beach",
        "attraction",
        "market",
        "pharmacy",
        "park",
        "nightlife",
        "shopping",
        "other",
      ],
    },
  },
} as const
