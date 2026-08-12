export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      auth_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          ip_address: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      capa_audit_events: {
        Row: {
          action: string
          actor_id: string
          actor_type: string
          actor_version: string | null
          after_object_id: string | null
          after_object_type: string | null
          after_object_version_id: string | null
          aggregate_id: string
          aggregate_type: string
          aggregate_version: number | null
          before_object_id: string | null
          before_object_type: string | null
          before_object_version_id: string | null
          change_set: Json | null
          configuration_versions: Json
          correlation_id: string
          event_id: string
          event_type: string
          idempotency_key: string | null
          integrity_proof: Json | null
          metadata: Json
          occurred_at: string
          organization_id: string
          outcome: string
          reason: string | null
          recorded_at: string
          request_id: string
          schema_version: string
          target_object_id: string
          target_object_type: string
          target_object_version_id: string | null
        }
        Insert: {
          action: string
          actor_id: string
          actor_type: string
          actor_version?: string | null
          after_object_id?: string | null
          after_object_type?: string | null
          after_object_version_id?: string | null
          aggregate_id: string
          aggregate_type: string
          aggregate_version?: number | null
          before_object_id?: string | null
          before_object_type?: string | null
          before_object_version_id?: string | null
          change_set?: Json | null
          configuration_versions: Json
          correlation_id: string
          event_id: string
          event_type: string
          idempotency_key?: string | null
          integrity_proof?: Json | null
          metadata?: Json
          occurred_at: string
          organization_id: string
          outcome: string
          reason?: string | null
          recorded_at?: string
          request_id: string
          schema_version: string
          target_object_id: string
          target_object_type: string
          target_object_version_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          actor_type?: string
          actor_version?: string | null
          after_object_id?: string | null
          after_object_type?: string | null
          after_object_version_id?: string | null
          aggregate_id?: string
          aggregate_type?: string
          aggregate_version?: number | null
          before_object_id?: string | null
          before_object_type?: string | null
          before_object_version_id?: string | null
          change_set?: Json | null
          configuration_versions?: Json
          correlation_id?: string
          event_id?: string
          event_type?: string
          idempotency_key?: string | null
          integrity_proof?: Json | null
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          outcome?: string
          reason?: string | null
          recorded_at?: string
          request_id?: string
          schema_version?: string
          target_object_id?: string
          target_object_type?: string
          target_object_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "capa_audit_events_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "capa_organizations"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      capa_case_version_sections: {
        Row: {
          capa_case_id: string
          case_version_id: string
          created_at: string
          created_by_actor_id: string
          created_by_actor_type: string
          created_by_actor_version: string | null
          display_order: number
          organization_id: string
          section_version_id: string
        }
        Insert: {
          capa_case_id: string
          case_version_id: string
          created_at: string
          created_by_actor_id: string
          created_by_actor_type: string
          created_by_actor_version?: string | null
          display_order: number
          organization_id: string
          section_version_id: string
        }
        Update: {
          capa_case_id?: string
          case_version_id?: string
          created_at?: string
          created_by_actor_id?: string
          created_by_actor_type?: string
          created_by_actor_version?: string | null
          display_order?: number
          organization_id?: string
          section_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capa_case_version_sections_case_version_fk"
            columns: ["organization_id", "capa_case_id", "case_version_id"]
            isOneToOne: false
            referencedRelation: "capa_case_versions"
            referencedColumns: [
              "organization_id",
              "capa_case_id",
              "case_version_id",
            ]
          },
          {
            foreignKeyName: "capa_case_version_sections_section_version_fk"
            columns: ["organization_id", "capa_case_id", "section_version_id"]
            isOneToOne: false
            referencedRelation: "capa_section_versions"
            referencedColumns: [
              "organization_id",
              "capa_case_id",
              "section_version_id",
            ]
          },
        ]
      }
      capa_case_versions: {
        Row: {
          capa_case_id: string
          case_version_id: string
          change_reason: string
          created_at: string
          created_by_actor_id: string
          created_by_actor_type: string
          created_by_actor_version: string | null
          effective_at: string
          organization_id: string
          parent_version_id: string | null
          status: string
          superseded_at: string | null
          version_number: number
        }
        Insert: {
          capa_case_id: string
          case_version_id: string
          change_reason: string
          created_at: string
          created_by_actor_id: string
          created_by_actor_type: string
          created_by_actor_version?: string | null
          effective_at: string
          organization_id: string
          parent_version_id?: string | null
          status: string
          superseded_at?: string | null
          version_number: number
        }
        Update: {
          capa_case_id?: string
          case_version_id?: string
          change_reason?: string
          created_at?: string
          created_by_actor_id?: string
          created_by_actor_type?: string
          created_by_actor_version?: string | null
          effective_at?: string
          organization_id?: string
          parent_version_id?: string | null
          status?: string
          superseded_at?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "capa_case_versions_case_fk"
            columns: ["organization_id", "capa_case_id"]
            isOneToOne: false
            referencedRelation: "capa_cases"
            referencedColumns: ["organization_id", "capa_case_id"]
          },
          {
            foreignKeyName: "capa_case_versions_parent_fk"
            columns: ["organization_id", "capa_case_id", "parent_version_id"]
            isOneToOne: false
            referencedRelation: "capa_case_versions"
            referencedColumns: [
              "organization_id",
              "capa_case_id",
              "case_version_id",
            ]
          },
        ]
      }
      capa_cases: {
        Row: {
          cancelled_at: string | null
          capa_case_id: string
          case_number: string
          closed_at: string | null
          confidentiality: string
          created_at: string
          created_by_actor_id: string
          created_by_actor_type: string
          created_by_actor_version: string | null
          current_version_id: string
          effective_at: string
          organization_id: string
          owner_user_id: string
          record_version: number
          status: string
          superseded_at: string | null
          updated_at: string
          updated_by_actor_id: string
          updated_by_actor_type: string
          updated_by_actor_version: string | null
        }
        Insert: {
          cancelled_at?: string | null
          capa_case_id: string
          case_number: string
          closed_at?: string | null
          confidentiality: string
          created_at: string
          created_by_actor_id: string
          created_by_actor_type: string
          created_by_actor_version?: string | null
          current_version_id: string
          effective_at: string
          organization_id: string
          owner_user_id: string
          record_version: number
          status: string
          superseded_at?: string | null
          updated_at: string
          updated_by_actor_id: string
          updated_by_actor_type: string
          updated_by_actor_version?: string | null
        }
        Update: {
          cancelled_at?: string | null
          capa_case_id?: string
          case_number?: string
          closed_at?: string | null
          confidentiality?: string
          created_at?: string
          created_by_actor_id?: string
          created_by_actor_type?: string
          created_by_actor_version?: string | null
          current_version_id?: string
          effective_at?: string
          organization_id?: string
          owner_user_id?: string
          record_version?: number
          status?: string
          superseded_at?: string | null
          updated_at?: string
          updated_by_actor_id?: string
          updated_by_actor_type?: string
          updated_by_actor_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "capa_cases_current_version_fk"
            columns: [
              "organization_id",
              "capa_case_id",
              "current_version_id",
              "status",
            ]
            isOneToOne: false
            referencedRelation: "capa_case_versions"
            referencedColumns: [
              "organization_id",
              "capa_case_id",
              "case_version_id",
              "status",
            ]
          },
          {
            foreignKeyName: "capa_cases_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "capa_organizations"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "capa_cases_owner_membership_fk"
            columns: ["organization_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "capa_organization_memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      capa_organization_memberships: {
        Row: {
          created_at: string
          created_by_actor_id: string
          created_by_actor_type: string
          created_by_actor_version: string | null
          effective_at: string
          expires_at: string | null
          membership_id: string
          organization_id: string
          record_version: number
          status: string
          updated_at: string
          updated_by_actor_id: string
          updated_by_actor_type: string
          updated_by_actor_version: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by_actor_id: string
          created_by_actor_type: string
          created_by_actor_version?: string | null
          effective_at?: string
          expires_at?: string | null
          membership_id?: string
          organization_id: string
          record_version?: number
          status?: string
          updated_at?: string
          updated_by_actor_id: string
          updated_by_actor_type: string
          updated_by_actor_version?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by_actor_id?: string
          created_by_actor_type?: string
          created_by_actor_version?: string | null
          effective_at?: string
          expires_at?: string | null
          membership_id?: string
          organization_id?: string
          record_version?: number
          status?: string
          updated_at?: string
          updated_by_actor_id?: string
          updated_by_actor_type?: string
          updated_by_actor_version?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capa_memberships_organization_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "capa_organizations"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      capa_organizations: {
        Row: {
          authorization_policy_version: string
          created_at: string
          created_by_actor_id: string
          created_by_actor_type: string
          created_by_actor_version: string | null
          effective_at: string
          organization_id: string
          organization_name: string
          record_version: number
          region_code: string | null
          sensitivity_class: string
          status: string
          superseded_at: string | null
          updated_at: string
          updated_by_actor_id: string
          updated_by_actor_type: string
          updated_by_actor_version: string | null
        }
        Insert: {
          authorization_policy_version: string
          created_at?: string
          created_by_actor_id: string
          created_by_actor_type: string
          created_by_actor_version?: string | null
          effective_at?: string
          organization_id?: string
          organization_name: string
          record_version?: number
          region_code?: string | null
          sensitivity_class?: string
          status?: string
          superseded_at?: string | null
          updated_at?: string
          updated_by_actor_id: string
          updated_by_actor_type: string
          updated_by_actor_version?: string | null
        }
        Update: {
          authorization_policy_version?: string
          created_at?: string
          created_by_actor_id?: string
          created_by_actor_type?: string
          created_by_actor_version?: string | null
          effective_at?: string
          organization_id?: string
          organization_name?: string
          record_version?: number
          region_code?: string | null
          sensitivity_class?: string
          status?: string
          superseded_at?: string | null
          updated_at?: string
          updated_by_actor_id?: string
          updated_by_actor_type?: string
          updated_by_actor_version?: string | null
        }
        Relationships: []
      }
      capa_role_assignments: {
        Row: {
          created_at: string
          effective_at: string
          expires_at: string | null
          grant_reason: string
          granted_by_actor_id: string
          granted_by_actor_type: string
          granted_by_actor_version: string | null
          membership_id: string
          organization_id: string
          record_version: number
          role_assignment_id: string
          role_id: string
          scope_code: string
          scope_resource_id: string | null
          scope_resource_type: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          effective_at?: string
          expires_at?: string | null
          grant_reason: string
          granted_by_actor_id: string
          granted_by_actor_type: string
          granted_by_actor_version?: string | null
          membership_id: string
          organization_id: string
          record_version?: number
          role_assignment_id?: string
          role_id: string
          scope_code?: string
          scope_resource_id?: string | null
          scope_resource_type?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          effective_at?: string
          expires_at?: string | null
          grant_reason?: string
          granted_by_actor_id?: string
          granted_by_actor_type?: string
          granted_by_actor_version?: string | null
          membership_id?: string
          organization_id?: string
          record_version?: number
          role_assignment_id?: string
          role_id?: string
          scope_code?: string
          scope_resource_id?: string | null
          scope_resource_type?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capa_role_assignments_membership_fk"
            columns: ["organization_id", "user_id", "membership_id"]
            isOneToOne: false
            referencedRelation: "capa_organization_memberships"
            referencedColumns: ["organization_id", "user_id", "membership_id"]
          },
          {
            foreignKeyName: "capa_role_assignments_role_fk"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "capa_roles"
            referencedColumns: ["role_id"]
          },
        ]
      }
      capa_roles: {
        Row: {
          created_at: string
          human_authority: boolean
          permissions: string[]
          role_id: string
          role_name: string
          role_version: string
          status: string
        }
        Insert: {
          created_at?: string
          human_authority?: boolean
          permissions?: string[]
          role_id: string
          role_name: string
          role_version: string
          status?: string
        }
        Update: {
          created_at?: string
          human_authority?: boolean
          permissions?: string[]
          role_id?: string
          role_name?: string
          role_version?: string
          status?: string
        }
        Relationships: []
      }
      capa_section_versions: {
        Row: {
          capa_case_id: string
          change_reason: string
          content: Json
          created_at: string
          created_by_actor_id: string
          created_by_actor_type: string
          created_by_actor_version: string | null
          effective_at: string
          organization_id: string
          parent_version_id: string | null
          schema_version: string
          section_type: string
          section_version_id: string
          superseded_at: string | null
          version_number: number
        }
        Insert: {
          capa_case_id: string
          change_reason: string
          content: Json
          created_at: string
          created_by_actor_id: string
          created_by_actor_type: string
          created_by_actor_version?: string | null
          effective_at: string
          organization_id: string
          parent_version_id?: string | null
          schema_version: string
          section_type: string
          section_version_id: string
          superseded_at?: string | null
          version_number: number
        }
        Update: {
          capa_case_id?: string
          change_reason?: string
          content?: Json
          created_at?: string
          created_by_actor_id?: string
          created_by_actor_type?: string
          created_by_actor_version?: string | null
          effective_at?: string
          organization_id?: string
          parent_version_id?: string | null
          schema_version?: string
          section_type?: string
          section_version_id?: string
          superseded_at?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "capa_section_versions_case_fk"
            columns: ["organization_id", "capa_case_id"]
            isOneToOne: false
            referencedRelation: "capa_cases"
            referencedColumns: ["organization_id", "capa_case_id"]
          },
          {
            foreignKeyName: "capa_section_versions_parent_fk"
            columns: [
              "organization_id",
              "capa_case_id",
              "section_type",
              "parent_version_id",
            ]
            isOneToOne: false
            referencedRelation: "capa_section_versions"
            referencedColumns: [
              "organization_id",
              "capa_case_id",
              "section_type",
              "section_version_id",
            ]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      documents: {
        Row: {
          conversation_id: string | null
          created_at: string
          extracted_text: string | null
          extraction_error: string | null
          extraction_status: string
          file_name: string
          id: string
          mime_type: string
          openai_file_id: string | null
          openai_vector_store_id: string | null
          size_bytes: number
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          extracted_text?: string | null
          extraction_error?: string | null
          extraction_status?: string
          file_name: string
          id?: string
          mime_type: string
          openai_file_id?: string | null
          openai_vector_store_id?: string | null
          size_bytes: number
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          extracted_text?: string | null
          extraction_error?: string | null
          extraction_status?: string
          file_name?: string
          id?: string
          mime_type?: string
          openai_file_id?: string | null
          openai_vector_store_id?: string | null
          size_bytes?: number
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      message_feedback: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          message_id: string
          rating: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          message_id: string
          rating: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          message_id?: string
          rating?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_feedback_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          documents: Json
          id: string
          image_name: string | null
          image_path: string | null
          role: string
          source_count: number | null
          sources: Json | null
          user_id: string | null
          widget: Json | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          documents?: Json
          id?: string
          image_name?: string | null
          image_path?: string | null
          role: string
          source_count?: number | null
          sources?: Json | null
          user_id?: string | null
          widget?: Json | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          documents?: Json
          id?: string
          image_name?: string | null
          image_path?: string | null
          role?: string
          source_count?: number | null
          sources?: Json | null
          user_id?: string | null
          widget?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          current_period_end: string | null
          id: string
          lifetime_pro: boolean | null
          plan: string
          plan_source: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_period_end?: string | null
          id: string
          lifetime_pro?: boolean | null
          plan?: string
          plan_source?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_period_end?: string | null
          id?: string
          lifetime_pro?: boolean | null
          plan?: string
          plan_source?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      usage: {
        Row: {
          created_at: string | null
          date: string
          id: string
          message_count: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          date?: string
          id?: string
          message_count?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          message_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      refund_daily_usage: {
        Args: { p_date: string; p_user_id: string }
        Returns: number
      }
      reserve_daily_usage: {
        Args: { p_date: string; p_limit: number; p_user_id: string }
        Returns: {
          allowed: boolean
          message_count: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
