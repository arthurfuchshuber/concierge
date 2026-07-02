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
      guide_access_logs: {
        Row: {
          checkin_date: string
          created_at: string
          guest_name: string
          guest_phone: string | null
          guest_phone_country: string | null
          id: string
          property_id: string
          reservation_code: string | null
          user_agent: string | null
        }
        Insert: {
          checkin_date: string
          created_at?: string
          guest_name: string
          guest_phone?: string | null
          guest_phone_country?: string | null
          id?: string
          property_id: string
          reservation_code?: string | null
          user_agent?: string | null
        }
        Update: {
          checkin_date?: string
          created_at?: string
          guest_name?: string
          guest_phone?: string | null
          guest_phone_country?: string | null
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
          cpf: string | null
          created_at: string
          etiqueta_options: string[]
          full_name: string | null
          id: string
          onboarding_completed_at: string | null
          phone: string | null
          phone_country: string | null
        }
        Insert: {
          avatar_url?: string | null
          cpf?: string | null
          created_at?: string
          etiqueta_options?: string[]
          full_name?: string | null
          id: string
          onboarding_completed_at?: string | null
          phone?: string | null
          phone_country?: string | null
        }
        Update: {
          avatar_url?: string | null
          cpf?: string | null
          created_at?: string
          etiqueta_options?: string[]
          full_name?: string | null
          id?: string
          onboarding_completed_at?: string | null
          phone?: string | null
          phone_country?: string | null
        }
        Relationships: []
      }
      properties: {
        Row: {
          access_codes_pin: string | null
          access_mode: Database["public"]["Enums"]["access_mode"]
          address: string | null
          address_note: string | null
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
          country: string | null
          created_at: string
          default_language: Database["public"]["Enums"]["guide_language"]
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
          owner_id: string
          pin_code: string | null
          pin_expires_at: string | null
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
          wifi_password: string | null
          wifi_ssid: string | null
        }
        Insert: {
          access_codes_pin?: string | null
          access_mode?: Database["public"]["Enums"]["access_mode"]
          address?: string | null
          address_note?: string | null
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
          country?: string | null
          created_at?: string
          default_language?: Database["public"]["Enums"]["guide_language"]
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
          owner_id: string
          pin_code?: string | null
          pin_expires_at?: string | null
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
          wifi_password?: string | null
          wifi_ssid?: string | null
        }
        Update: {
          access_codes_pin?: string | null
          access_mode?: Database["public"]["Enums"]["access_mode"]
          address?: string | null
          address_note?: string | null
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
          country?: string | null
          created_at?: string
          default_language?: Database["public"]["Enums"]["guide_language"]
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
          owner_id?: string
          pin_code?: string | null
          pin_expires_at?: string | null
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
          wifi_password?: string | null
          wifi_ssid?: string | null
        }
        Relationships: []
      }
      property_chat_conversations: {
        Row: {
          created_at: string
          guest_name: string | null
          guest_session_id: string
          id: string
          last_message_at: string
          property_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          guest_name?: string | null
          guest_session_id: string
          id?: string
          last_message_at?: string
          property_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          guest_name?: string | null
          guest_session_id?: string
          id?: string
          last_message_at?: string
          property_id?: string
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
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
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
      app_role: "admin" | "host"
      guide_language: "pt" | "en"
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
      app_role: ["admin", "host"],
      guide_language: ["pt", "en"],
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
