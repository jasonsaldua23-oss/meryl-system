export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      category: {
        Row: {
          category_id: string
          category_name: string
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          category_id: string
          category_name: string
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          category_id?: string
          category_name?: string
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      customer: {
        Row: {
          address: string | null
          contact_number: string | null
          created_at: string | null
          customer_id: string
          date_registered: string | null
          email: string | null
          name: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          contact_number?: string | null
          created_at?: string | null
          customer_id: string
          date_registered?: string | null
          email?: string | null
          name: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          contact_number?: string | null
          created_at?: string | null
          customer_id?: string
          date_registered?: string | null
          email?: string | null
          name?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      inventory: {
        Row: {
          expiration_date: string | null
          inventory_id: string
          inventory_status: string | null
          last_updated: string | null
          manufacturer_date: string | null
          product_id: string
          reorder_level: number | null
          reserved_quantity: number | null
          srp: number | null
          stock_quantity: number
        }
        Insert: {
          expiration_date?: string | null
          inventory_id: string
          inventory_status?: string | null
          last_updated?: string | null
          manufacturer_date?: string | null
          product_id: string
          reorder_level?: number | null
          reserved_quantity?: number | null
          srp?: number | null
          stock_quantity: number
        }
        Update: {
          expiration_date?: string | null
          inventory_id?: string
          inventory_status?: string | null
          last_updated?: string | null
          manufacturer_date?: string | null
          product_id?: string
          reorder_level?: number | null
          reserved_quantity?: number | null
          srp?: number | null
          stock_quantity?: number
        }
        Relationships: []
      }
      inventory_log: {
        Row: {
          date_updated: string | null
          inventory_log_id: string
          product_id: string
          quantity_change: number
          reference_id: string | null
          transaction_type: string | null
        }
        Insert: {
          date_updated?: string | null
          inventory_log_id: string
          product_id: string
          quantity_change: number
          reference_id?: string | null
          transaction_type?: string | null
        }
        Update: {
          date_updated?: string | null
          inventory_log_id?: string
          product_id?: string
          quantity_change?: number
          reference_id?: string | null
          transaction_type?: string | null
        }
        Relationships: []
      }
      notification: {
        Row: {
          created_at: string | null
          customer_id: string
          date_sent: string | null
          email_status: string | null
          notification_id: string
          promo_id: string
        }
        Insert: {
          created_at?: string | null
          customer_id: string
          date_sent?: string | null
          email_status?: string | null
          notification_id: string
          promo_id: string
        }
        Update: {
          created_at?: string | null
          customer_id?: string
          date_sent?: string | null
          email_status?: string | null
          notification_id?: string
          promo_id?: string
        }
        Relationships: []
      }
      payment: {
        Row: {
          amount_paid: number
          change_amount: number | null
          created_at: string | null
          payment_id: string
          payment_method: string
          payment_status: string | null
          sales_id: string
          updated_at: string | null
        }
        Insert: {
          amount_paid: number
          change_amount?: number | null
          created_at?: string | null
          payment_id: string
          payment_method: string
          payment_status?: string | null
          sales_id: string
          updated_at?: string | null
        }
        Update: {
          amount_paid?: number
          change_amount?: number | null
          created_at?: string | null
          payment_id?: string
          payment_method?: string
          payment_status?: string | null
          sales_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      prediction: {
        Row: {
          created_at: string | null
          predicted_demand: number
          prediction_date: string
          prediction_id: string
          prediction_period: string | null
          product_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          predicted_demand: number
          prediction_date: string
          prediction_id: string
          prediction_period?: string | null
          product_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          predicted_demand?: number
          prediction_date?: string
          prediction_id?: string
          prediction_period?: string | null
          product_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      prediction_history: {
        Row: {
          actual_sales: number | null
          created_at: string | null
          history_id: string
          prediction_accuracy: number | null
          prediction_id: string
        }
        Insert: {
          actual_sales?: number | null
          created_at?: string | null
          history_id: string
          prediction_accuracy?: number | null
          prediction_id: string
        }
        Update: {
          actual_sales?: number | null
          created_at?: string | null
          history_id?: string
          prediction_accuracy?: number | null
          prediction_id?: string
        }
        Relationships: []
      }
      product: {
        Row: {
          brand: string | null
          category_id: string
          color: string | null
          cost_price: number
          created_at: string | null
          product_id: string
          product_name: string
          reorder_level: number | null
          size: string | null
          sku: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          brand?: string | null
          category_id: string
          color?: string | null
          cost_price: number
          created_at?: string | null
          product_id: string
          product_name: string
          reorder_level?: number | null
          size?: string | null
          sku?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          brand?: string | null
          category_id?: string
          color?: string | null
          cost_price?: number
          created_at?: string | null
          product_id?: string
          product_name?: string
          reorder_level?: number | null
          size?: string | null
          sku?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      promo_product: {
        Row: {
          created_at: string | null
          product_id: string
          promo_id: string
          promo_product_id: string
        }
        Insert: {
          created_at?: string | null
          product_id: string
          promo_id: string
          promo_product_id: string
        }
        Update: {
          created_at?: string | null
          product_id?: string
          promo_id?: string
          promo_product_id?: string
        }
        Relationships: []
      }
      promotion: {
        Row: {
          created_at: string | null
          discount_type: string
          discount_value: number
          end_date: string
          promo_id: string
          promo_name: string
          start_date: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          discount_type: string
          discount_value: number
          end_date: string
          promo_id: string
          promo_name: string
          start_date: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          discount_type?: string
          discount_value?: number
          end_date?: string
          promo_id?: string
          promo_name?: string
          start_date?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      return_details: {
        Row: {
          created_at: string | null
          product_id: string
          quantity_returned: number
          reason: string | null
          refund_amount: number
          return_detail_id: string
          return_id: string
        }
        Insert: {
          created_at?: string | null
          product_id: string
          quantity_returned: number
          reason?: string | null
          refund_amount: number
          return_detail_id: string
          return_id: string
        }
        Update: {
          created_at?: string | null
          product_id?: string
          quantity_returned?: number
          reason?: string | null
          refund_amount?: number
          return_detail_id?: string
          return_id?: string
        }
        Relationships: []
      }
      returns: {
        Row: {
          created_at: string | null
          return_date: string | null
          return_id: string
          sales_id: string
          total_refund: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          return_date?: string | null
          return_id: string
          sales_id: string
          total_refund: number
          user_id: string
        }
        Update: {
          created_at?: string | null
          return_date?: string | null
          return_id?: string
          sales_id?: string
          total_refund?: number
          user_id?: string
        }
        Relationships: []
      }
      role: {
        Row: {
          created_at: string | null
          role_id: string
          role_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          role_id: string
          role_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          role_id?: string
          role_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      sales_analytics: {
        Row: {
          analytics_id: string
          average_sales: number | null
          created_at: string | null
          product_id: string
          ranking: number | null
          time_period: string | null
          total_quantity_sold: number
          total_sales: number
          trend_type: string | null
          updated_at: string | null
        }
        Insert: {
          analytics_id: string
          average_sales?: number | null
          created_at?: string | null
          product_id: string
          ranking?: number | null
          time_period?: string | null
          total_quantity_sold: number
          total_sales: number
          trend_type?: string | null
          updated_at?: string | null
        }
        Update: {
          analytics_id?: string
          average_sales?: number | null
          created_at?: string | null
          product_id?: string
          ranking?: number | null
          time_period?: string | null
          total_quantity_sold?: number
          total_sales?: number
          trend_type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sales_details: {
        Row: {
          created_at: string | null
          discount_applied: number | null
          price: number
          product_id: string
          quantity: number
          sales_detail_id: string
          sales_id: string
          subtotal: number
        }
        Insert: {
          created_at?: string | null
          discount_applied?: number | null
          price: number
          product_id: string
          quantity: number
          sales_detail_id: string
          sales_id: string
          subtotal: number
        }
        Update: {
          created_at?: string | null
          discount_applied?: number | null
          price?: number
          product_id?: string
          quantity?: number
          sales_detail_id?: string
          sales_id?: string
          subtotal?: number
        }
        Relationships: []
      }
      sales_summary: {
        Row: {
          created_at: string | null
          summary_date: string
          summary_id: string
          total_item_sold: number
          total_revenue: number
          total_transaction: number
        }
        Insert: {
          created_at?: string | null
          summary_date: string
          summary_id: string
          total_item_sold: number
          total_revenue: number
          total_transaction: number
        }
        Update: {
          created_at?: string | null
          summary_date?: string
          summary_id?: string
          total_item_sold?: number
          total_revenue?: number
          total_transaction?: number
        }
        Relationships: []
      }
      sales_transaction: {
        Row: {
          created_at: string | null
          customer_id: string | null
          sales_id: string
          total_amount: number
          transaction_date: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          sales_id: string
          total_amount: number
          transaction_date?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          sales_id?: string
          total_amount?: number
          transaction_date?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          name: string
          password: string
          role_id: string
          staff_code: string | null
          status: string | null
          updated_at: string | null
          user_id: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          name: string
          password: string
          role_id: string
          staff_code?: string | null
          status?: string | null
          updated_at?: string | null
          user_id: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          name?: string
          password?: string
          role_id?: string
          staff_code?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
          username?: string
        }
        Relationships: []
      }
    }
    Views: { [key: string]: never }
    Functions: { [key: string]: never }
    Enums: { [key: string]: never }
    CompositeTypes: { [key: string]: never }
  }
}

