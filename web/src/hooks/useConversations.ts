import { collection, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import type { Conversation, Job, Message, Project } from "../lib/types";
import { useDoc, useQuery } from "./useFirestore";
import { useAuth } from "./useAuth";

/** Sidebar list: one query, newest first. */
export function useConversations() {
  const { user } = useAuth();
  return useQuery<Conversation>(user ? `convs:${user.uid}` : null, () =>
    query(collection(db, "conversations"), where("ownerUid", "==", user!.uid), orderBy("updatedAt", "desc"), limit(100)),
  );
}

export const useConversation = (id: string | null) => useDoc<Conversation>(id ? `conversations/${id}` : null);
export const useProject = (id: string | null) => useDoc<Project>(id ? `projects/${id}` : null);
export const useJob = (id: string | null) => useDoc<Job>(id ? `jobs/${id}` : null);

/** Messages of the open conversation only (latest 100). */
export function useMessages(conversationId: string | null) {
  return useQuery<Message>(conversationId ? `msgs:${conversationId}` : null, () =>
    query(collection(db, "conversations", conversationId!, "messages"), orderBy("createdAt", "asc"), limit(100)),
  );
}
