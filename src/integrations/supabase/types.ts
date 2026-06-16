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
      guide_access_logs: {
        Row: {
          checkin_date: string
          created_at: string
          guest_name: string
          id: string
          property_id: string
          reservation_code: string
          user_agent: string | null
        }
        Insert: {
          checkin_date: string
          created_at?: string
          guest_name: string
          id?: string
          property_id: string
          reservation_code: string
          user_agent?: string | null
        }
        Update: {
          checkin_date?: string
          created_at?: string
          guest_name?: string
          id?: string
          property_id?: string
          reservation_code?: string
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
      host_faqs: {
        Row: {
          answer: string
          created_at: string
          id: string
          owner_id: string
          position: number
          question: string
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
          tags?: string[]
          updated_at?: string
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
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          etiqueta_options: string[]
          full_name: string | null
          id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          etiqueta_options?: string[]
          full_name?: string | null
          id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          etiqueta_options?: string[]
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          access_mode: Database["public"]["Enums"]["access_mode"]
          address: string | null
          address_note: string | null
          brand_logo_url: string | null
          brand_name: string | null
          checkin_instructions: string | null
          checkin_media: Json
          checkin_time: string | null
          checkin_time_max: string | null
          checkout_instructions: string | null
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
          gate_media: Json
          gate_video_url: string | null
          guide_theme: string
          hero_image_url: string | null
          host_name: string | null
          host_phone: string | null
          id: string
          lat: number | null
          lng: number | null
          lock_code: string | null
          lock_instructions: string | null
          lock_media: Json
          lock_video_url: string | null
          maps_url: string | null
          marketplace_links: Json
          name: string
          owner_id: string
          pin_code: string | null
          pin_expires_at: string | null
          published: boolean
          slug: string
          tagline: string | null
          theme_images: Json
          updated_at: string
          wifi_password: string | null
          wifi_ssid: string | null
        }
        Insert: {
          access_mode?: Database["public"]["Enums"]["access_mode"]
          address?: string | null
          address_note?: string | null
          brand_logo_url?: string | null
          brand_name?: string | null
          checkin_instructions?: string | null
          checkin_media?: Json
          checkin_time?: string | null
          checkin_time_max?: string | null
          checkout_instructions?: string | null
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
          gate_media?: Json
          gate_video_url?: string | null
          guide_theme?: string
          hero_image_url?: string | null
          host_name?: string | null
          host_phone?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          lock_code?: string | null
          lock_instructions?: string | null
          lock_media?: Json
          lock_video_url?: string | null
          maps_url?: string | null
          marketplace_links?: Json
          name: string
          owner_id: string
          pin_code?: string | null
          pin_expires_at?: string | null
          published?: boolean
          slug: string
          tagline?: string | null
          theme_images?: Json
          updated_at?: string
          wifi_password?: string | null
          wifi_ssid?: string | null
        }
        Update: {
          access_mode?: Database["public"]["Enums"]["access_mode"]
          address?: string | null
          address_note?: string | null
          brand_logo_url?: string | null
          brand_name?: string | null
          checkin_instructions?: string | null
          checkin_media?: Json
          checkin_time?: string | null
          checkin_time_max?: string | null
          checkout_instructions?: string | null
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
          gate_media?: Json
          gate_video_url?: string | null
          guide_theme?: string
          hero_image_url?: string | null
          host_name?: string | null
          host_phone?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          lock_code?: string | null
          lock_instructions?: string | null
          lock_media?: Json
          lock_video_url?: string | null
          maps_url?: string | null
          marketplace_links?: Json
          name?: string
          owner_id?: string
          pin_code?: string | null
          pin_expires_at?: string | null
          published?: boolean
          slug?: string
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
      subscriptions: {
        Row: {
          admin_notes: string | null
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          custom_currency: string | null
          custom_price_cents: number | null
          environment: string
          id: string
          is_manual: boolean
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
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          custom_currency?: string | null
          custom_price_cents?: number | null
          environment?: string
          id?: string
          is_manual?: boolean
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
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          custom_currency?: string | null
          custom_price_cents?: number | null
          environment?: string
          id?: string
          is_manual?: boolean
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
