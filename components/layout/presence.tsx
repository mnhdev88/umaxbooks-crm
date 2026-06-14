'use client'

import { createContext, useContext } from 'react'

// Set of user ids currently online (anyone with the CRM open). The value is
// provided by DashboardShell from a single Supabase Realtime Presence channel
// and consumed by the chat UI (widget, windows, /messages page).
export const OnlineContext = createContext<Set<string>>(new Set())
export function useOnlineUsers() { return useContext(OnlineContext) }
